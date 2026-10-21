import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHttpServer, httpOptions } from '../mcp/http.js';
import { ROOT } from '../lib/build.js';

const DIAGRAM = {
  meta: { title: 'Checkout' },
  roles: { client: { label: 'Client', color: 'amber' }, service: { label: 'Service', color: 'blue' } },
  nodes: [
    { id: 'web', type: 'client', data: { title: 'Web app' } },
    { id: 'api', type: 'service', data: { title: 'Orders API' } }
  ],
  edges: [{ id: 'web-api', source: 'web', target: 'api', label: 'POST /orders' }],
  scenarios: [
    {
      id: 'main',
      name: 'Order',
      steps: [
        { id: 's1', title: 'Overview' },
        { id: 's2', title: 'Submit', highlightNodes: ['web', 'api'], highlightEdges: ['web-api'] }
      ]
    }
  ]
};

/** An in-process server on a free loopback port; returns { url, post, close, server }. */
async function serve(options = {}) {
  const server = createHttpServer({ host: '127.0.0.1', ...options });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/mcp`;
  const post = (body, headers = {}) =>
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body)
    });
  return { url, post, server, close: () => new Promise((resolve) => server.close(resolve)) };
}

async function session(s, headers = {}) {
  const res = await s.post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } } }, headers);
  assert.equal(res.status, 200);
  const sid = res.headers.get('mcp-session-id');
  assert.ok(sid, 'initialize assigns a session id');
  const body = await res.json();
  return { sid, body, h: { 'Mcp-Session-Id': sid, 'MCP-Protocol-Version': '2025-06-18', ...headers } };
}

test('HTTP MCP: initialize, initialized notification, tools/list, validate, build', async () => {
  const s = await serve();
  try {
    const { sid, body, h } = await session(s);
    assert.equal(body.result.protocolVersion, '2025-06-18');
    assert.equal(body.result.serverInfo.name, 'yantra');
    assert.match(sid, /^[\x21-\x7e]+$/, 'session id is visible ASCII');

    const note = await s.post({ jsonrpc: '2.0', method: 'notifications/initialized' }, h);
    assert.equal(note.status, 202);

    const list = await (await s.post({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, h)).json();
    const names = list.result.tools.map((t) => t.name);
    assert.ok(names.includes('yantra_validate') && names.includes('yantra_build'));
    assert.ok(!names.includes('yantra_screenshot'), 'no screenshots without file roots');
    for (const t of list.result.tools) {
      assert.ok(!('filePath' in t.inputSchema.properties), `${t.name} offers no filePath`);
      assert.ok(!('outputPath' in t.inputSchema.properties), `${t.name} offers no outputPath`);
    }

    const v = await (await s.post({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'yantra_validate', arguments: { payload: DIAGRAM } } }, h)).json();
    const report = JSON.parse(v.result.content[0].text);
    assert.equal(report.valid, true, JSON.stringify(report.errors));

    const b = await (await s.post({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'yantra_build', arguments: { payload: DIAGRAM } } }, h)).json();
    assert.ok(!b.result.isError, b.result.content[0].text);
    const meta = JSON.parse(b.result.content[0].text);
    assert.equal(meta.fileName, 'checkout.html');
    const html = b.result.content[1];
    assert.equal(html.type, 'resource');
    assert.equal(html.resource.mimeType, 'text/html');
    assert.match(html.resource.text, /^<!DOCTYPE html>/i);
    assert.ok(html.resource.text.includes('"Orders API"'), 'the payload is embedded');

    const e = await (await s.post({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'yantra_export', arguments: { payload: DIAGRAM, format: 'svg' } } }, h)).json();
    assert.match(JSON.parse(e.result.content[0].text).content, /<svg/);

    const del = await fetch(s.url, { method: 'DELETE', headers: h });
    assert.equal(del.status, 204);
    const after = await s.post({ jsonrpc: '2.0', id: 6, method: 'ping' }, h);
    assert.equal(after.status, 404, 'a closed session is gone');
  } finally {
    await s.close();
  }
});

test('HTTP MCP: no file access by default', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yantra-http-'));
  const s = await serve();
  try {
    fs.writeFileSync(path.join(dir, 'd.json'), JSON.stringify(DIAGRAM));
    const { h } = await session(s);
    const call = async (id, name, args) => (await (await s.post({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } }, h)).json()).result;
    const r1 = await call(1, 'yantra_validate', { filePath: path.join(dir, 'd.json') });
    assert.equal(r1.isError, true);
    assert.match(r1.content[0].text, /not available on this server/);
    const r2 = await call(2, 'yantra_build', { payload: DIAGRAM, outputPath: path.join(dir, 'x.html') });
    assert.equal(r2.isError, true);
    assert.ok(!fs.existsSync(path.join(dir, 'x.html')), 'nothing written');
    const r3 = await call(3, 'yantra_import', { filePath: path.join(dir, 'd.json') });
    assert.equal(r3.isError, true);
    // An inline page's src is not read from disk
    const page = { kind: 'page', meta: { title: 'P' }, answer: { headline: 'H' }, blocks: [{ type: 'diagram', src: 'd.json' }] };
    const r4 = JSON.parse((await call(4, 'yantra_validate', { payload: page })).content[0].text);
    assert.ok(r4.errors.some((x) => x.code === 'page/diagram-unresolved'));
    const shot = await s.post({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'yantra_screenshot', arguments: { payload: DIAGRAM, outputPath: 'x.png' } } }, h);
    assert.equal((await shot.json()).error.code, -32602, 'screenshot is not offered');
  } finally {
    await s.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('HTTP MCP: origin, host, session and protocol checks', async () => {
  const s = await serve({ allowedOrigins: ['https://chat.example'] });
  try {
    const bad = await s.post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }, { Origin: 'https://evil.example' });
    assert.equal(bad.status, 403, 'a foreign Origin is refused');
    const ok = await s.post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }, { Origin: 'https://chat.example' });
    assert.equal(ok.status, 200, 'an allowed Origin is served');
    const local = await s.post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }, { Origin: 'http://localhost:5173' });
    assert.equal(local.status, 200, 'loopback origins are served while bound to loopback');

    const { h } = await session(s);
    assert.equal((await s.post({ jsonrpc: '2.0', id: 2, method: 'ping' })).status, 400, 'missing session id');
    assert.equal((await s.post({ jsonrpc: '2.0', id: 2, method: 'ping' }, { 'Mcp-Session-Id': 'nope' })).status, 404, 'unknown session id');
    assert.equal((await s.post({ jsonrpc: '2.0', id: 2, method: 'ping' }, { ...h, 'MCP-Protocol-Version': '1999-01-01' })).status, 400, 'unsupported protocol version');
    assert.equal((await s.post('[{"jsonrpc":"2.0","id":3,"method":"ping"}]', h)).status, 400, 'batches are refused');
    const parse = await s.post('{not json', h);
    assert.equal(parse.status, 400);
    assert.equal((await parse.json()).error.code, -32700);
    assert.equal((await fetch(s.url, { headers: h })).status, 405, 'no server-initiated stream');
    assert.equal((await fetch(s.url.replace('/mcp', '/other'), { method: 'POST', headers: h, body: '{}' })).status, 404);
    const text = await fetch(s.url, { method: 'POST', headers: { ...h, 'Content-Type': 'text/plain' }, body: '{}' });
    assert.equal(text.status, 415);
    const ping = await (await s.post({ jsonrpc: '2.0', id: 4, method: 'ping' }, h)).json();
    assert.deepEqual(ping.result, {});
  } finally {
    await s.close();
  }
  // DNS rebinding: a loopback server refuses foreign Host names
  const r = await serve();
  try {
    const port = r.server.address().port;
    const res = await new Promise((resolve, reject) => {
      import('node:http').then(({ request }) => {
        const req = request({ host: '127.0.0.1', port, path: '/mcp', method: 'POST', headers: { Host: `attacker.example:${port}`, 'Content-Type': 'application/json' } }, resolve);
        req.on('error', reject);
        req.end('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}');
      });
    });
    assert.equal(res.statusCode, 403);
    res.resume();
  } finally {
    await r.close();
  }
});

test('HTTP MCP: bearer token and body limit', async () => {
  const s = await serve({ token: 'secret-token', maxBody: 2000 });
  try {
    const init = { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} };
    const none = await s.post(init);
    assert.equal(none.status, 401);
    assert.equal(none.headers.get('www-authenticate'), 'Bearer');
    assert.equal((await s.post(init, { Authorization: 'Bearer wrong' })).status, 401);
    const { h } = await session(s, { Authorization: 'Bearer secret-token' });
    const big = await s.post({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'yantra_validate', arguments: { payload: { meta: { title: 'x'.repeat(5000) } } } } }, h);
    assert.equal(big.status, 413);
  } finally {
    await s.close();
  }
});

test('HTTP MCP: file roots are opt-in through the environment', () => {
  const plain = httpOptions(['--http'], {});
  assert.equal(plain.host, '127.0.0.1');
  assert.equal(plain.port, 8787);
  assert.equal(plain.inputRoot, null);
  assert.equal(plain.outputRoot, null);
  const set = httpOptions(['--http', '--port', '9000', '--host', '0.0.0.0'], { YANTRA_OUTPUT_ROOT: '/srv/out', YANTRA_MCP_ALLOWED_ORIGINS: 'https://a.example, https://b.example' });
  assert.equal(set.port, 9000);
  assert.equal(set.host, '0.0.0.0');
  assert.equal(set.outputRoot, '/srv/out');
  assert.deepEqual(set.allowedOrigins, ['https://a.example', 'https://b.example']);
  assert.throws(() => httpOptions(['--port', 'abc'], {}), /--port/);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yantra-http-root-'));
  try {
    const server = createHttpServer({ outputRoot: dir });
    const names = server.toolset.tools.map((t) => t.name);
    assert.ok(!names.includes('yantra_screenshot'), 'screenshots need both roots');
    const build = server.toolset.tools.find((t) => t.name === 'yantra_build');
    assert.ok('outputPath' in build.inputSchema.properties);
    const out = server.toolset.call('yantra_build', { payload: DIAGRAM, outputPath: 'x.html' });
    assert.equal(out.written, true);
    assert.ok(fs.existsSync(path.join(dir, 'x.html')));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('yantra mcp --http starts the HTTP transport', { timeout: 60000 }, async () => {
  const proc = spawn(process.execPath, [path.join(ROOT, 'bin', 'yantra.js'), 'mcp', '--http', '--port', '0'], { cwd: ROOT, stdio: ['ignore', 'ignore', 'pipe'] });
  try {
    const url = await new Promise((resolve, reject) => {
      let err = '';
      const timer = setTimeout(() => reject(new Error(`no listening line: ${err}`)), 30000);
      proc.stderr.setEncoding('utf8');
      proc.stderr.on('data', (d) => {
        err += d;
        const m = /listening on (http:\/\/\S+)/.exec(err);
        if (m) {
          clearTimeout(timer);
          resolve(m[1]);
        }
      });
      proc.on('exit', (code) => reject(new Error(`exited ${code}: ${err}`)));
    });
    assert.match(url, /^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } }) });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).result.protocolVersion, '2025-03-26');
  } finally {
    proc.kill();
  }
});
