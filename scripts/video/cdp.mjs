// A headless Chrome session over the DevTools Protocol (no npm dependency).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { findBrowser } from '../../lib/browser.js';

let nextPort = 9300 + (process.pid % 400) * 2;

export async function openBrowser() {
  const browser = findBrowser();
  if (!browser) throw new Error('No Chrome/Edge found. Set YANTRA_BROWSER.');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'yantra-video-'));
  const port = nextPort++;
  const proc = spawn(browser, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--allow-file-access-from-files',
    `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
  let url;
  for (let i = 0; i < 100 && !url; i++) {
    try { url = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((x) => x.type === 'page')?.webSocketDebuggerUrl; } catch {}
    if (!url) await new Promise((r) => setTimeout(r, 100));
  }
  if (!url) throw new Error('Chrome did not start');
  const ws = new WebSocket(url);
  await new Promise((r) => ws.addEventListener('open', r));
  let id = 0;
  const waiting = new Map();
  ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); } });
  const send = (method, params = {}) => new Promise((res, rej) => {
    const i = ++id;
    waiting.set(i, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)));
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  await send('Page.enable');

  return {
    async load(href, width, height, settle = 1500) {
      await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
      await send('Page.navigate', { url: 'about:blank' });
      await send('Page.navigate', { url: href });
      await new Promise((r) => setTimeout(r, settle));
    },
    async eval(expression, awaitPromise = false) {
      const { result } = await send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
      return result.value;
    },
    async shot(file, format = 'png') {
      const { data } = await send('Page.captureScreenshot', { format, ...(format === 'jpeg' ? { quality: 94 } : {}) });
      fs.writeFileSync(file, Buffer.from(data, 'base64'));
    },
    close() {
      ws.close();
      proc.kill();
      setTimeout(() => fs.rmSync(profile, { recursive: true, force: true }), 500);
    }
  };
}
