/**
 * Yantra MCP over Streamable HTTP (MCP spec 2025-06-18, "Transports"): one endpoint
 * (default /mcp) that takes JSON-RPC messages by POST and answers each request
 * with a single JSON response. There are no server-initiated messages, so GET
 * (an SSE stream) is answered 405. DELETE ends a session.
 *
 * Security defaults (docs/remote-mcp.md):
 *   - binds 127.0.0.1; on a loopback address the Host header must be a loopback
 *     name too (DNS rebinding), unless YANTRA_MCP_ALLOWED_HOSTS lists it;
 *   - a request with an Origin header is refused (403) unless the origin is listed
 *     in YANTRA_MCP_ALLOWED_ORIGINS, or is a loopback origin while bound to loopback;
 *   - YANTRA_MCP_TOKEN, when set, is required as `Authorization: Bearer <token>`;
 *   - tools get no file access unless YANTRA_INPUT_ROOT / YANTRA_OUTPUT_ROOT are set
 *     (mcp/tools.js): payloads come in, payloads / HTML / SVG / Markdown go out;
 *   - bodies over 4 MB (YANTRA_MCP_MAX_BODY bytes) are refused; at most 1000 sessions,
 *     each forgotten after an hour without requests.
 */
import crypto from 'node:crypto';
import http from 'node:http';
import { createToolset, SUPPORTED } from './tools.js';

const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '::1', '[::1]'];
const MAX_SESSIONS = 1000;
const SESSION_IDLE_MS = 60 * 60 * 1000;

const isLoopback = (host) => LOOPBACK_HOSTS.includes(String(host).toLowerCase()) || /^127\./.test(host);
const list = (v) => (typeof v === 'string' ? v.split(',').map((s) => s.trim()).filter(Boolean) : Array.isArray(v) ? v : []);

/** Host name of a Host header ("localhost:8787" -> "localhost", "[::1]:80" -> "[::1]"). */
function hostName(header) {
  const h = String(header || '').trim().toLowerCase();
  if (h.startsWith('[')) return h.slice(0, h.indexOf(']') + 1);
  return h.split(':')[0];
}

function sameToken(given, expected) {
  const a = Buffer.from(String(given));
  const b = Buffer.from(String(expected));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Options from the environment (and CLI flags): { host, port, path, token,
 * allowedOrigins, allowedHosts, maxBody, inputRoot, outputRoot }.
 */
export function httpOptions(argv = process.argv.slice(2), env = process.env) {
  const flag = (name) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 && argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[i + 1] : undefined;
  };
  const port = Number(flag('port') ?? env.YANTRA_MCP_PORT ?? env.PORT ?? 8787);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error(`--port must be a port number (0-65535), not "${flag('port') ?? env.PORT}".`);
  return {
    host: flag('host') ?? env.YANTRA_MCP_HOST ?? '127.0.0.1',
    port,
    path: env.YANTRA_MCP_PATH || '/mcp',
    token: env.YANTRA_MCP_TOKEN || null,
    allowedOrigins: list(env.YANTRA_MCP_ALLOWED_ORIGINS),
    allowedHosts: list(env.YANTRA_MCP_ALLOWED_HOSTS),
    maxBody: Number(env.YANTRA_MCP_MAX_BODY) > 0 ? Number(env.YANTRA_MCP_MAX_BODY) : 4 * 1024 * 1024,
    // File access only when a root is set explicitly
    inputRoot: env.YANTRA_INPUT_ROOT || null,
    outputRoot: env.YANTRA_OUTPUT_ROOT || null
  };
}

/**
 * An http.Server (not yet listening) serving MCP at `path`. `host` is the address
 * it will bind, used for the loopback Host / Origin rules.
 */
export function createHttpServer({
  host = '127.0.0.1',
  path = '/mcp',
  token = null,
  allowedOrigins = [],
  allowedHosts = [],
  maxBody = 4 * 1024 * 1024,
  inputRoot = null,
  outputRoot = null
} = {}) {
  const toolset = createToolset({ inputRoot, outputRoot, screenshot: !!(inputRoot && outputRoot) });
  const loopback = isLoopback(host);
  const sessions = new Map(); // id -> { seen, protocolVersion }

  const originAllowed = (origin) => {
    if (allowedOrigins.includes('*') || allowedOrigins.includes(origin)) return true;
    if (!loopback) return false;
    try {
      return isLoopback(new URL(origin).hostname);
    } catch {
      return false;
    }
  };
  const hostAllowed = (header) => {
    const name = hostName(header);
    if (allowedHosts.length) return allowedHosts.map((h) => h.toLowerCase()).includes(name) || (loopback && isLoopback(name));
    return !loopback || isLoopback(name);
  };

  const prune = () => {
    const now = Date.now();
    for (const [id, s] of sessions) if (now - s.seen > SESSION_IDLE_MS) sessions.delete(id);
    while (sessions.size >= MAX_SESSIONS) sessions.delete(sessions.keys().next().value);
  };

  const send = (res, status, body, headers = {}) => {
    const text = body === undefined ? '' : JSON.stringify(body);
    res.writeHead(status, { ...(text ? { 'Content-Type': 'application/json' } : {}), 'Cache-Control': 'no-store', ...headers });
    res.end(text);
  };
  const rpcError = (res, status, code, message, headers) => send(res, status, { jsonrpc: '2.0', id: null, error: { code, message } }, headers);

  function readBody(req) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;
      const tooLarge = () => Object.assign(new Error(`Request body too large (limit ${maxBody} bytes).`), { status: 413 });
      if (Number(req.headers['content-length']) > maxBody) {
        req.resume(); // drain, so the 413 reaches the client
        return reject(tooLarge());
      }
      req.on('data', (c) => {
        size += c.length;
        if (size <= maxBody) chunks.push(c);
      });
      req.on('end', () => (size > maxBody ? reject(tooLarge()) : resolve(Buffer.concat(chunks).toString('utf-8'))));
      req.on('error', reject);
    });
  }

  async function onRequest(req, res) {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname !== path) return send(res, 404, { error: 'Not found. The MCP endpoint is ' + path });
    if (!hostAllowed(req.headers.host)) return rpcError(res, 403, -32000, 'Forbidden: Host not allowed.');
    const origin = req.headers.origin;
    if (origin !== undefined && !originAllowed(origin)) return rpcError(res, 403, -32000, 'Forbidden: Origin not allowed.');
    if (token) {
      const m = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '');
      if (!m || !sameToken(m[1].trim(), token)) return rpcError(res, 401, -32001, 'Unauthorized.', { 'WWW-Authenticate': 'Bearer' });
    }
    const sid = req.headers['mcp-session-id'];

    if (req.method === 'GET') return send(res, 405, undefined, { Allow: 'POST, DELETE' }); // no server-initiated stream
    if (req.method === 'DELETE') {
      if (!sid) return rpcError(res, 400, -32000, 'Bad Request: Mcp-Session-Id header is required.');
      if (!sessions.delete(sid)) return rpcError(res, 404, -32001, 'Session not found.');
      return send(res, 204);
    }
    if (req.method !== 'POST') return send(res, 405, undefined, { Allow: 'POST, DELETE' });

    const type = String(req.headers['content-type'] || '').toLowerCase();
    if (!type.startsWith('application/json')) return rpcError(res, 415, -32000, 'Unsupported Media Type: send application/json.');
    const accept = String(req.headers.accept || '*/*').toLowerCase();
    if (!/application\/json|\*\/\*|application\/\*/.test(accept)) return rpcError(res, 406, -32000, 'Not Acceptable: the server answers with application/json.');

    let text;
    try {
      text = await readBody(req);
    } catch (err) {
      return rpcError(res, err.status || 400, -32000, err.message);
    }
    let msg;
    try {
      msg = JSON.parse(text);
    } catch (err) {
      return rpcError(res, 400, -32700, `Parse error: ${err.message}`);
    }
    if (Array.isArray(msg)) return rpcError(res, 400, -32600, 'Invalid Request: JSON-RPC batches are not supported.');
    if (!msg || typeof msg !== 'object') return rpcError(res, 400, -32600, 'Invalid Request: expected a JSON-RPC object.');

    if (msg.method === 'initialize') {
      prune();
      const reply = toolset.handle(msg);
      const id = crypto.randomUUID();
      sessions.set(id, { seen: Date.now(), protocolVersion: reply?.result?.protocolVersion });
      return send(res, 200, { jsonrpc: '2.0', ...reply }, { 'Mcp-Session-Id': id });
    }

    if (!sid) return rpcError(res, 400, -32000, 'Bad Request: Mcp-Session-Id header is required (send initialize first).');
    const session = sessions.get(sid);
    if (!session) return rpcError(res, 404, -32001, 'Session not found: initialize again.');
    const version = req.headers['mcp-protocol-version'];
    if (version !== undefined && !SUPPORTED.includes(version)) return rpcError(res, 400, -32000, `Bad Request: unsupported MCP-Protocol-Version "${version}".`);
    session.seen = Date.now();

    // Notifications and responses from the client: accepted, nothing to return
    if (msg.id === undefined || msg.method === undefined) return send(res, 202);
    return send(res, 200, { jsonrpc: '2.0', ...toolset.handle(msg) });
  }

  const server = http.createServer((req, res) => {
    onRequest(req, res).catch((err) => {
      if (!res.headersSent) rpcError(res, 500, -32603, `Internal error: ${err?.message || err}`);
      else res.end();
    });
  });
  server.toolset = toolset;
  server.sessions = sessions;
  return server;
}

/** Start the HTTP server from CLI flags and the environment; logs to stderr. */
export function startHttp(argv = process.argv.slice(2), env = process.env) {
  const opts = httpOptions(argv, env);
  const server = createHttpServer(opts);
  server.listen(opts.port, opts.host, () => {
    const { port } = server.address();
    const shown = opts.host.includes(':') ? `[${opts.host}]` : opts.host;
    console.error(`Yantra MCP (Streamable HTTP) listening on http://${shown}:${port}${opts.path}`);
    const files = [opts.inputRoot && `reads ${server.toolset.inputRoot}`, opts.outputRoot && `writes ${server.toolset.outputRoot}`].filter(Boolean);
    console.error(files.length ? `File access: ${files.join(', ')}` : 'File access: none (payloads in, results out)');
    if (!isLoopback(opts.host) && !opts.token) console.error('Warning: listening beyond this machine without YANTRA_MCP_TOKEN; put it behind an authenticating HTTPS proxy.');
  });
  const stop = () => server.close(() => process.exit(0));
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  return server;
}
