/**
 * Shared helpers for tests that start child processes or use temp folders.
 * (Not a test file: `node --test` only runs *.test.js.)
 *
 * Windows keeps a folder busy while a process still has it as its cwd or has a
 * file open in it, so servers are always stopped (and awaited) before their
 * folders are removed, and removal retries with backoff.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** A new empty temp folder. */
export const tempDir = (prefix = 'yantra-test-') => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

/** Remove a folder, retrying while Windows still holds a handle on it. */
export function removeDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}

/** Wait for a child process to exit (resolves at once when it already has). */
export function exited(proc, ms = 10000) {
  if (proc.exitCode !== null || proc.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    proc.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

/**
 * A headless Chrome / Edge driven over the DevTools protocol on a pipe
 * (`--remote-debugging-pipe`: JSON messages separated by NUL on fds 3 and 4),
 * so no WebSocket client or npm package is needed. `open(url)` returns a page
 * with `eval(expression)` (awaits promises, returns the value), `waitFor` and
 * `send(method, params)` for raw protocol commands.
 */
export async function startBrowser(executable) {
  const profile = tempDir('yantra-cdp-');
  const proc = spawn(executable, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--remote-debugging-pipe', `--user-data-dir=${profile}`, '--window-size=1400,900',
    // Chrome refuses to sandbox as root (some CI containers)
    ...(process.getuid?.() === 0 ? ['--no-sandbox'] : []),
    'about:blank'
  ], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });
  const out = proc.stdio[3];
  const inp = proc.stdio[4];
  let next = 1;
  const waiting = new Map();
  let buf = Buffer.alloc(0);
  inp.on('data', (d) => {
    buf = Buffer.concat([buf, d]);
    let i;
    while ((i = buf.indexOf(0)) >= 0) {
      const msg = JSON.parse(buf.subarray(0, i).toString('utf8'));
      buf = buf.subarray(i + 1);
      const w = msg.id !== undefined && waiting.get(msg.id);
      if (!w) continue;
      waiting.delete(msg.id);
      if (msg.error) w.reject(new Error(`${w.method}: ${msg.error.message}`));
      else w.resolve(msg.result);
    }
  });
  const failed = new Promise((_, reject) => {
    proc.once('error', reject);
    proc.once('exit', (code) => reject(new Error(`browser exited (${code})`)));
  });
  failed.catch(() => {});
  const send = (method, params = {}, sessionId) => {
    const id = next++;
    const reply = new Promise((resolve, reject) => waiting.set(id, { resolve, reject, method }));
    out.write(`${JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })}\0`);
    return Promise.race([reply, failed, new Promise((_, reject) => setTimeout(() => reject(new Error(`${method} timed out`)), 30000))]);
  };
  await send('Browser.getVersion');
  return {
    async open(url) {
      const { targetId } = await send('Target.createTarget', { url });
      const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
      const page = {
        /** Any DevTools protocol command on this tab (Input.dispatchMouseEvent, Emulation.*, …). */
        send: (method, params = {}) => send(method, params, sessionId),
        async eval(expression) {
          const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
          if (r.exceptionDetails) throw new Error(`${expression}: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`);
          return r.result.value;
        },
        async waitFor(expression, ms = 15000) {
          const deadline = Date.now() + ms;
          for (;;) {
            const v = await page.eval(expression).catch(() => false);
            if (v) return v;
            if (Date.now() > deadline) throw new Error(`timed out waiting for ${expression}`);
            await new Promise((r) => setTimeout(r, 50));
          }
        }
      };
      return page;
    },
    async close() {
      await send('Browser.close').catch(() => {});
      if (proc.exitCode === null && proc.signalCode === null) proc.kill();
      await exited(proc);
      // Browser helper processes can hold the throwaway profile a little longer on Windows
      try {
        fs.rmSync(profile, { recursive: true, force: true, maxRetries: 30, retryDelay: 200 });
      } catch {
        /* left in the temp folder */
      }
    }
  };
}

/**
 * The MCP server on stdio. `replies` maps id -> message (in arrival order in
 * `list`); `waitFor(n)` waits until n replies with an id arrived (generous
 * deadline: the whole suite runs in parallel); `close()` stops the server and
 * waits for it to exit.
 */
export function startMcp({ cwd, env = {} } = {}) {
  const proc = spawn(process.execPath, [path.join(ROOT, 'mcp', 'server.js')], {
    cwd: cwd || ROOT,
    env: { ...process.env, ...env },
    stdio: ['pipe', 'pipe', 'inherit']
  });
  const replies = new Map();
  const list = [];
  let buf = '';
  proc.stdout.setEncoding('utf8');
  proc.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      const msg = JSON.parse(line);
      list.push(msg);
      if (msg.id !== undefined) replies.set(msg.id, msg);
    }
  });
  const send = (msg) => proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...msg })}\n`);
  return {
    proc,
    replies,
    list,
    send,
    raw: (line) => proc.stdin.write(`${line}\n`),
    call: (id, name, args) => send({ id, method: 'tools/call', params: { name, arguments: args } }),
    async waitFor(n, ms = 60000) {
      const deadline = Date.now() + ms;
      while (list.length < n && Date.now() < deadline && proc.exitCode === null) await new Promise((r) => setTimeout(r, 25));
      if (list.length < n) throw new Error(`MCP server sent ${list.length} of ${n} replies (exit code ${proc.exitCode})`);
      return replies;
    },
    async close() {
      proc.stdin.end();
      if (proc.exitCode === null && proc.signalCode === null) proc.kill();
      await exited(proc);
    }
  };
}
