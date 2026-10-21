#!/usr/bin/env node
/**
 * Yantra MCP server.
 *   node mcp/server.js                       stdio, newline-delimited JSON-RPC 2.0
 *   node mcp/server.js --http [--port 8787] [--host 127.0.0.1]
 *                                            Streamable HTTP at /mcp (mcp/http.js)
 * On stdio, stdout carries protocol messages only; diagnostics go to stderr.
 * Tools and their file rules: mcp/tools.js.
 */
import readline from 'node:readline';
import { createToolset } from './tools.js';
import { startHttp } from './http.js';

const args = process.argv.slice(2);

if (args.includes('--http')) {
  try {
    startHttp(args);
  } catch (err) {
    console.error(`✗ ${err.message}`);
    process.exit(1);
  }
} else {
  /**
   * MCP clients are not trusted with the whole disk: reads stay inside
   * YANTRA_INPUT_ROOT and writes inside YANTRA_OUTPUT_ROOT (both default to the
   * server's working directory), with a fixed set of extensions.
   */
  const toolset = createToolset({
    inputRoot: process.env.YANTRA_INPUT_ROOT || process.cwd(),
    outputRoot: process.env.YANTRA_OUTPUT_ROOT || process.cwd(),
    screenshot: true
  });
  const send = (msg) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...msg })}\n`);

  readline.createInterface({ input: process.stdin, terminal: false }).on('line', (line) => {
    if (!line.trim()) return;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch (err) {
      return send({ id: null, error: { code: -32700, message: `Parse error: ${err.message}` } });
    }
    const reply = toolset.handle(msg);
    if (reply) send(reply);
  });
}
