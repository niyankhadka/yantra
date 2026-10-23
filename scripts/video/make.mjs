// Renders the Yantra teaser from scripts/video/: node scripts/video/make.mjs [--format landscape|vertical|both] [--stills t1,t2,...]
// Writes site/assets/video/yantra-teaser(-vertical)-v<VERSION>.mp4 and .jpg. Frames, captures and audio stems go to the system
// temp folder (or YANTRA_VIDEO_WORK). Needs Chrome or Edge, and ffmpeg (FFMPEG=path, or on PATH).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { openBrowser } from './cdp.mjs';
import { buildScene } from './scene.mjs';
import { writeMix } from './synth.mjs';

const SRC = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SRC, '../..');
const OUT = path.join(ROOT, 'site/assets/video');
const WORK = process.env.YANTRA_VIDEO_WORK || path.join(os.tmpdir(), 'yantra-video');
const CLI = path.join(ROOT, 'bin/yantra.js');
// The video version: bump it when the video changes (new take, new cut). The site shows the newest.
const VERSION = '1.0.0';
const FPS = 30;
const BEAT = 0.5;
const VO_OFFSET = 0.25; // the voice starts this long after the first frame
// Phrases per voice-over line, split by the pauses in the take (plan.md lists the words)
const PHRASES_PER_LINE = [2, 2, 1, 2, 2, 2, 2, 3, 2, 3];
// The words of each line, for the captions (the voice says "Yun-truh"; captions spell Yantra)
const CAPTIONS = [
  'Diagrams take hours… and go stale by Friday.',
  'AI drawings? Overlapping boxes. Arrows to nowhere.',
  'Meet Yantra.',
  'Describe it, or ask your agent. Yantra draws it.',
  'Every diagram is checked… before anyone sees it.',
  'Then step through it, like a story.',
  'Diagrams. Answer pages. Books.',
  'Onboard a team. Review an incident. Teach a lesson.',
  'One file. Even offline.',
  "Yantra… Don't draw it. Explain it."
];
const FORMATS = { landscape: { w: 1920, h: 1080 }, vertical: { w: 1080, h: 1920 } };

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const formats = opt('--format', 'both') === 'both' ? Object.keys(FORMATS) : [opt('--format')];
const stills = opt('--stills', null);

function findFfmpeg() {
  if (process.env.FFMPEG) return process.env.FFMPEG;
  const pk = path.join(process.env.LOCALAPPDATA || '', 'Microsoft/WinGet/Packages');
  if (fs.existsSync(pk)) {
    for (const d of fs.readdirSync(pk).filter((x) => x.startsWith('Gyan.FFmpeg'))) {
      for (const b of fs.readdirSync(path.join(pk, d))) {
        const exe = path.join(pk, d, b, 'bin/ffmpeg.exe');
        if (fs.existsSync(exe)) return exe;
      }
    }
  }
  return 'ffmpeg';
}
const FFMPEG = findFfmpeg();
const ff = (...a) => execFileSync(FFMPEG, ['-hide_banner', '-y', ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const yantra = (...a) => execFileSync(process.execPath, [CLI, ...a], { cwd: WORK, encoding: 'utf8', stdio: 'pipe' });

// ---- 1. the voice-over: level it, then find each phrase and line
fs.mkdirSync(WORK, { recursive: true });
const voWav = path.join(WORK, 'vo.wav');
execFileSync(FFMPEG, ['-hide_banner', '-y', '-i', path.join(SRC, 'voiceover.wav'), '-af',
  'highpass=f=80,acompressor=threshold=-24dB:ratio=4:attack=4:release=120:makeup=2,alimiter=limit=0.85,aresample=44100',
  '-ac', '1', voWav], { stdio: 'pipe' });
// silencedetect reports on stderr
const sdText = spawnSync(FFMPEG, ['-hide_banner', '-i', voWav, '-af', 'silencedetect=noise=-38dB:d=0.25', '-f', 'null', '-'], { encoding: 'utf8' }).stderr;
const silences = [];
for (const m of sdText.matchAll(/silence_start: ([\d.]+)[\s\S]*?silence_end: ([\d.]+)/g)) silences.push([+m[1], +m[2]]);
const voDur = +execFileSync(path.join(path.dirname(FFMPEG), 'ffprobe' + path.extname(FFMPEG)), ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', voWav], { encoding: 'utf8' });
const speech = [];
let t0 = 0;
for (const [s, e] of silences) { if (s - t0 > 0.15) speech.push([t0, s]); t0 = e; }
if (voDur - t0 > 0.15) speech.push([t0, voDur]);
const expected = PHRASES_PER_LINE.reduce((a, b) => a + b, 0);
if (speech.length !== expected) throw new Error(`Found ${speech.length} phrases in voiceover.wav, expected ${expected}: adjust PHRASES_PER_LINE or the pauses.`);
const phrases = speech.map(([a, b]) => [+(a + VO_OFFSET).toFixed(3), +(b + VO_OFFSET).toFixed(3)]);
const lines = [];
let k = 0;
for (const n of PHRASES_PER_LINE) { lines.push(phrases.slice(k, k + n)); k += n; }
// cuts: on the beat just before each line, the first at 0; the end on a whole bar after the last word
const cuts = lines.map((l, i) => (i === 0 ? 0 : Math.floor((l[0][0] - 0.12) / BEAT) * BEAT));
const end = Math.ceil((phrases.at(-1)[1] + 1.2) / 2) * 2;
const T = { cuts: [...cuts, end], lines, end, voOffset: VO_OFFSET };
fs.writeFileSync(path.join(WORK, 'timeline.json'), JSON.stringify(T, null, 2));
console.log(`voice-over: ${phrases.length} phrases, cuts at ${T.cuts.join(', ')}s`);

// captions (WebVTT), one cue per voice-over line; both formats share them
const vtt = (s) => { const m = Math.floor(s / 60), r = (s - m * 60).toFixed(3).padStart(6, '0'); return `00:${String(m).padStart(2, '0')}:${r}`; };
const cues = CAPTIONS.map((text, i) => `${i + 1}\n${vtt(lines[i][0][0])} --> ${vtt(lines[i].at(-1)[1] + 0.3)}\n${text}`);
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, `yantra-teaser-v${VERSION}.vtt`), `WEBVTT\n\n${cues.join('\n\n')}\n`);
if (args.includes('--captions')) process.exit(0);

// ---- 2. real Yantra output for the scenes
fs.copyFileSync(path.join(SRC, 'checkout.json'), path.join(WORK, 'checkout.json'));
const tb = JSON.parse(fs.readFileSync(path.join(SRC, 'checkout.json'), 'utf8'));
tb.meta.layout = { direction: 'TB' };
fs.writeFileSync(path.join(WORK, 'checkout-tb.json'), JSON.stringify(tb, null, 2));
yantra('export', 'checkout-tb.json', '-f', 'svg', '-o', 'checkout-tb.svg');
fs.mkdirSync(path.join(WORK, 'bad'), { recursive: true });
fs.writeFileSync(path.join(WORK, 'bad/checkout.json'), fs.readFileSync(path.join(SRC, 'checkout.json'), 'utf8').replace('"target": "db"', '"target": "dbx"'));
let report = '';
try { execFileSync(process.execPath, [CLI, 'validate', 'checkout.json'], { cwd: path.join(WORK, 'bad'), encoding: 'utf8', stdio: 'pipe' }); }
catch (e) { report = `${e.stdout}\n${e.stderr}`; }
const error = report.split('\n').find((l) => l.includes('ref/edge-unknown-target'));
if (!error) throw new Error(`Unexpected validator output:\n${report}`);
for (const f of ['kind-cloud-architecture.png', 'kind-answer-page.png', 'kind-book.png']) fs.copyFileSync(path.join(ROOT, 'docs/images', f), path.join(WORK, f));

const built = {};
for (const ex of ['cloud-architecture', 'platform-overview', 'answer-incident-review', 'answer-explain-photosynthesis']) {
  const html = path.join(WORK, `${ex}.html`);
  if (!fs.existsSync(html)) yantra('build', path.join(ROOT, 'examples', `${ex}.json`), '-o', html);
  built[ex] = pathToFileURL(html).href;
}
const capFile = path.join(WORK, 'captures.json');
const captures = fs.existsSync(capFile) ? JSON.parse(fs.readFileSync(capFile, 'utf8')) : {};
const browser = await openBrowser();
async function capture(name, href, w, h, nextButton = false) {
  const file = path.join(WORK, `${name}.png`);
  if (fs.existsSync(file) && captures[name]) return;
  await browser.load(href, w, h, 2200);
  await browser.shot(file);
  captures[name] = { w, h, next: nextButton ? await browser.eval("(() => { const r = document.getElementById('btn-next').getBoundingClientRect(); return { x: r.x + r.width * 0.72, y: r.y + r.height * 0.62 }; })()") : null };
}
for (const s of [2, 3, 4]) {
  await capture(`walk-landscape-${s}`, `${built['cloud-architecture']}#theme=light&step=${s}`, 1600, 900, true);
  await capture(`walk-vertical-${s}`, `${built['cloud-architecture']}#theme=light&step=${s}`, 960, 1240, true);
}
await capture('share-light', `${built['cloud-architecture']}#theme=light&story=off`, 1600, 1000);
await capture('share-dark', `${built['cloud-architecture']}#theme=dark&story=off`, 1600, 1000);
await capture('use-platform', `${built['platform-overview']}#theme=light&story=off`, 1600, 1000);
await capture('use-incident', `${built['answer-incident-review']}#theme=light`, 1440, 900);
await capture('use-lesson', `${built['answer-explain-photosynthesis']}#theme=light`, 1440, 900);
browser.close();
fs.writeFileSync(capFile, JSON.stringify(captures, null, 2));

// ---- 3. per format: the scene page, then stills or frames + audio + encode
for (const format of formats) {
  const { w, h } = FORMATS[format];
  buildScene({ root: ROOT, work: WORK, src: SRC, format, w, h, T, error: error.trim(), captures });
  const page = pathToFileURL(path.join(WORK, `scene-${format}.html`)).href;
  const b = await openBrowser();
  await b.load(page, w, h, 1500);
  await b.eval('window.ready', true);
  if (stills) {
    const dir = path.join(WORK, 'stills'); fs.mkdirSync(dir, { recursive: true });
    for (const t of stills.split(',').map(Number)) { await b.eval(`window.render(${t})`); await b.shot(path.join(dir, `${format}-${t.toFixed(2)}.png`)); }
    b.close();
    console.log(`stills in ${dir}`);
    continue;
  }
  const frames = path.join(WORK, `frames-${format}`);
  fs.rmSync(frames, { recursive: true, force: true }); fs.mkdirSync(frames, { recursive: true });
  const n = Math.round(T.end * FPS);
  for (let f = 0; f < n; f++) {
    await b.eval(`window.render(${f / FPS})`);
    await b.shot(path.join(frames, `f${String(f).padStart(4, '0')}.jpg`), 'jpeg');
    if (f % 150 === 0) console.log(`${format}: frame ${f}/${n}`);
  }
  b.close();
  const mix = path.join(WORK, 'mix.wav');
  if (!fs.existsSync(mix) || format === formats[0]) writeMix({ out: mix, vo: voWav, T });
  // poster: the settled ending (logo, tagline, command), baked in as frame 0
  const posterFrame = Math.round((T.end - 0.6) * FPS);
  const base = `${format === 'landscape' ? 'yantra-teaser' : 'yantra-teaser-vertical'}-v${VERSION}`;
  fs.copyFileSync(path.join(frames, `f${String(posterFrame).padStart(4, '0')}.jpg`), path.join(OUT, `${base}.jpg`));
  fs.copyFileSync(path.join(OUT, `${base}.jpg`), path.join(frames, 'f0000.jpg'));
  ff('-loglevel', 'error', '-framerate', String(FPS), '-i', path.join(frames, 'f%04d.jpg'), '-i', mix,
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
    '-af', 'loudnorm=I=-14:TP=-1.5:LRA=9', '-ar', '48000', '-c:a', 'aac', '-b:a', '192k', '-shortest', path.join(OUT, `${base}.mp4`));
  console.log(`Wrote ${path.join(OUT, `${base}.mp4`)}`);
  if (format === 'landscape') {
    // a silent animated preview for the README (GitHub plays WebP inline): describe, checked, story, ending
    const c = T.cuts;
    const parts = [[c[3] + 0.5, c[4] - 0.1], [c[4] + 0.9, c[5] - 0.1], [c[5] + 0.2, c[6] - 0.1], [c[9] + 1.0, T.end - 0.1]];
    const trims = parts.map(([a, b], i) => `[0:v]trim=${a}:${b},setpts=PTS-STARTPTS[p${i}]`).join(';');
    ff('-loglevel', 'error', '-i', path.join(OUT, `${base}.mp4`), '-filter_complex',
      `${trims};${parts.map((_, i) => `[p${i}]`).join('')}concat=n=${parts.length}:v=1:a=0,fps=15,scale=900:-1:flags=lanczos`,
      '-c:v', 'libwebp_anim', '-lossless', '0', '-quality', '72', '-compression_level', '6', '-loop', '0',
      path.join(OUT, `yantra-teaser-preview-v${VERSION}.webp`));
  }
}
