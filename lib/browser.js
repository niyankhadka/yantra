/**
 * Headless screenshots with the locally installed Chrome / Edge / Chromium.
 * No npm dependency: uses the browser's own --screenshot flag.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const CANDIDATES = {
  win32: [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe'
  ],
  darwin: [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Chromium.app/Contents/MacOS/Chromium'
  ],
  linux: ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge', '/snap/bin/chromium']
};

export function findBrowser() {
  if (process.env.YANTRA_BROWSER && fs.existsSync(process.env.YANTRA_BROWSER)) return process.env.YANTRA_BROWSER;
  return (CANDIDATES[process.platform] || CANDIDATES.linux).find((p) => fs.existsSync(p)) || null;
}

/**
 * @param htmlPath  local .html file
 * @param outPath   .png destination
 * @param options   { width, height, theme, hash }
 */
export function screenshot(htmlPath, outPath, { width = 1600, height = 1000, theme, hash = '' } = {}) {
  const browser = findBrowser();
  if (!browser) throw new Error('No Chrome/Edge/Chromium found. Set YANTRA_BROWSER to the browser executable.');
  const url = `${pathToFileURL(path.resolve(htmlPath)).href}#${[theme ? `theme=${theme}` : '', hash].filter(Boolean).join('&')}`;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'yantra-shot-'));
  try {
    const res = spawnSync(
      browser,
      [
        '--headless=new',
        '--disable-gpu',
        '--hide-scrollbars',
        '--no-first-run',
        '--no-default-browser-check',
        `--user-data-dir=${profile}`,
        `--window-size=${width},${height}`,
        '--virtual-time-budget=3000',
        `--screenshot=${path.resolve(outPath)}`,
        url
      ],
      { stdio: 'ignore', timeout: 60000 }
    );
    if (res.error) throw res.error;
    if (!fs.existsSync(outPath)) throw new Error('Browser did not write a screenshot.');
  } finally {
    fs.rmSync(profile, { recursive: true, force: true });
  }
  return path.resolve(outPath);
}
