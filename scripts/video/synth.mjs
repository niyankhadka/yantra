// Soundtrack: 120 BPM, Am-F under the pain points, C-G-Am-F from "Meet Yantra", resolving on C.
// Effects are in key and snapped to the grid; the music ducks under the voice-over. Writes a stereo mix WAV.
import fs from 'node:fs';
import { events, snap, BEAT } from './beats.mjs';

const SR = 44100, BAR = 2;
const CH = { C: ['C', 'E', 'G'], G: ['G', 'B', 'D'], Am: ['A', 'C', 'E'], F: ['F', 'A', 'C'] };
const ROOT = { C: 'C', G: 'G', Am: 'A', F: 'F' };
const midi = (m) => 440 * Math.pow(2, (m - 69) / 12);
const note = (name) => { const s = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }; const m = name.match(/^([A-G])(\d)$/); return 12 * (+m[2] + 1) + s[m[1]]; };
const env = (t, a, d) => (t < a ? t / a : Math.exp(-(t - a) / d));

function readWav(file) {
  const b = fs.readFileSync(file);
  let o = 12;
  while (o < b.length && b.toString('ascii', o, o + 4) !== 'data') o += 8 + b.readUInt32LE(o + 4);
  const n = b.readUInt32LE(o + 4) / 2, d = new Float32Array(n);
  for (let i = 0; i < n; i++) d[i] = b.readInt16LE(o + 8 + i * 2) / 32768;
  return d;
}

export function writeMix({ out, vo, T }) {
  const E = events(T);
  const N = Math.round(SR * T.end);
  const L = new Float32Array(N), R = new Float32Array(N), sL = new Float32Array(N), sR = new Float32Array(N);
  const side = new Float32Array(N).fill(1);
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  function add(t0, len, fn, { gain = 1, pan = 0, send = 0, duck = false } = {}) {
    const a = Math.floor(t0 * SR), b = Math.min(N, a + Math.floor(len * SR));
    const gl = gain * Math.cos((pan + 1) * Math.PI / 4), gr = gain * Math.sin((pan + 1) * Math.PI / 4);
    for (let i = Math.max(0, a); i < b; i++) {
      const v = fn((i - a) / SR) * (duck ? side[i] : 1);
      L[i] += v * gl; R[i] += v * gr; sL[i] += v * gl * send; sR[i] += v * gr * send;
    }
  }
  const pluck = (t, m, gain = 0.1, pan = 0, send = 0.45) => {
    const f = midi(m);
    add(t, 0.9, (u) => (Math.sin(2 * Math.PI * f * u) + 0.35 * Math.sin(4 * Math.PI * f * u) * Math.exp(-u * 18) + 0.15 * Math.sin(6 * Math.PI * f * u) * Math.exp(-u * 30)) * env(u, 0.002, 0.22), { gain, pan, send });
  };
  const tick = (t, gain) => { let p = 0; add(t, 0.03, (u) => { const x = rnd(); const h = x - p; p = x; return h * env(u, 0.0005, 0.006); }, { gain, pan: -0.15 }); };

  // chords: Am/F until the turn, then C-G-Am-F, ending G then C
  const bars = Math.round(T.end / BAR), turnBar = Math.floor(E.meet / BAR);
  const prog = Array.from({ length: bars }, (_, i) => (i < turnBar ? (i % 2 ? 'F' : 'Am') : ['C', 'G', 'Am', 'F'][(i - turnBar) % 4]));
  prog[bars - 2] = 'G'; prog[bars - 1] = 'C';

  // kick from the turn, with a sidechain shape
  const kicks = [];
  for (let t = E.meet; t < E.resolve - 1e-9; t += BEAT) kicks.push(t);
  kicks.push(E.resolve);
  for (const k of kicks) { const a = Math.floor(k * SR); for (let i = 0; i < SR * 0.3 && a + i < N; i++) side[a + i] = Math.min(side[a + i], 0.45 + 0.55 * Math.min(1, i / (SR * 0.22))); }
  for (const k of kicks) add(k, 0.45, (t) => Math.sin(2 * Math.PI * (48 * t + (110 / 28) * (1 - Math.exp(-t * 28)))) * env(t, 0.002, 0.16), { gain: 0.34 });
  for (let t = Math.ceil(E.meet / BAR) * BAR; t < E.resolve - 1e-9; t += BAR) for (const off of [BEAT, 3 * BEAT]) {
    let lp = 0; add(t + off, 0.25, (u) => { const x = rnd(); lp += 0.5 * (x - lp); return (x - lp * 0.6) * env(u, 0.001, 0.05) + Math.sin(2 * Math.PI * 196 * u) * env(u, 0.001, 0.04) * 0.4; }, { gain: 0.12, send: 0.35 });
  }
  for (let t = 0; t < E.resolve - 1e-9; t += BEAT) { let p = 0; add(t + BEAT / 2, 0.06, (u) => { const x = rnd(); const h = x - p; p = x; return h * env(u, 0.0005, 0.012); }, { gain: t < E.meet ? 0.04 : 0.06, pan: 0.25 }); }

  // bass (from the turn), pad, arpeggio
  prog.forEach((c, bi) => {
    const last = bi === bars - 1, t0 = bi * BAR;
    if (t0 + BAR > E.meet) {
      const f = midi(note(ROOT[c] + '2'));
      for (let s = 0; s < (last ? 1 : 8); s++) {
        const t = t0 + s * BEAT / 2; if (t < E.meet) continue;
        let lp = 0; const len = last ? 1.9 : 0.22, oct = s % 2 ? 2 : 1;
        add(t, len, (u) => { const saw = 2 * ((f * oct * u) % 1) - 1; lp += 0.08 * (saw - lp); return (lp * 1.6 + Math.sin(2 * Math.PI * f * u) * 0.7) * env(u, 0.004, last ? 0.8 : 0.12); }, { gain: 0.26, duck: true });
      }
    }
    for (const m of [...CH[c].map((x) => note(x + '4')), note(ROOT[c] + '3')]) {
      const f = midi(m), len = last ? 2 : BAR + 0.05; let lp = 0;
      add(t0, len, (u) => { const s = ((f * u) % 1) * 2 - 1 + (((f * 1.004 * u) % 1) * 2 - 1); lp += 0.03 * (s - lp); return lp * Math.min(1, u / 0.12) * (last ? Math.exp(-u / 0.9) : Math.min(1, (len - u) / 0.08)); }, { gain: t0 < E.meet ? 0.05 : 0.045, send: 0.5, duck: true, pan: (m % 3 - 1) * 0.3 });
    }
    if (last) return;
    const tones = CH[c].map((x) => note(x + '5')), pat = [0, 1, 2, 1, 0, 2, 1, 2];
    for (let s = 0; s < 8; s++) pluck(t0 + s * BEAT / 2, tones[pat[s]] - (s % 4 === 0 ? 12 : 0), t0 < E.meet ? 0.07 : 0.05, s % 2 ? 0.35 : -0.35, 0.4);
  });

  // effects, in key and on a sixteenth grid
  E.drags.forEach((t) => pluck(t, note('A3'), 0.1, -0.2, 0.2));
  pluck(snap(E.overlap), note('E4'), 0.09, 0, 0.3); pluck(snap(E.nowhere), note('C4'), 0.09, 0, 0.3);
  ['C5', 'E5', 'G5', 'C6'].forEach((x, i) => { const f = midi(note(x)); add(E.meet, 2.2, (u) => (Math.sin(2 * Math.PI * f * u) + 0.2 * Math.sin(2 * Math.PI * f * 2.01 * u) * Math.exp(-u * 4)) * env(u, 0.004, 0.8), { gain: 0.06, pan: (i - 1.5) * 0.3, send: 0.7 }); });
  for (let t = snap(E.prompt[0]); t < E.prompt[1]; t += 0.125) tick(t, 0.04);
  for (let t = snap(E.json[0]); t < E.json[1]; t += 0.125) tick(t, 0.03);
  E.pops.forEach((t, i) => pluck(t, note(['G5', 'C6', 'E6'][i]), 0.11, 0, 0.55));
  E.edges.forEach((t, i) => pluck(t, note(['E5', 'G5'][i]), 0.09, 0, 0.55));
  for (let t = snap(E.cmd[0]); t < E.cmd[1]; t += 0.125) tick(t, 0.035);
  pluck(E.err, note('A4'), 0.11, 0, 0.3); pluck(E.err, note('C5'), 0.07, 0, 0.3);
  pluck(E.fix, note('E5'), 0.07, 0.2, 0.4);
  ['F5', 'A5', 'C6'].forEach((x, i) => pluck(E.ok, note(x), 0.08, (i - 1) * 0.3, 0.6));
  E.clicks.forEach((t) => pluck(t, note('E6'), 0.09, 0.2, 0.5));
  E.shapes.forEach((t, i) => pluck(snap(t), note(['C6', 'E6', 'G6'][i]), 0.07, (i - 1) * 0.4, 0.6));
  E.uses.forEach((t, i) => pluck(snap(t), note(['G5', 'C6', 'E6'][i]), 0.07, (i - 1) * 0.4, 0.6));
  E.chips.forEach((t, i) => pluck(t, note(['C6', 'D6', 'E6', 'G6'][i]), 0.05, (i % 2 ? 0.3 : -0.3), 0.6));
  ['C5', 'E5', 'G5', 'C6'].forEach((x, i) => { const f = midi(note(x)); add(E.resolve, 2.0, (u) => (Math.sin(2 * Math.PI * f * u) + 0.2 * Math.sin(2 * Math.PI * f * 2.01 * u) * Math.exp(-u * 4)) * env(u, 0.004, 0.7), { gain: 0.07, pan: (i - 1.5) * 0.3, send: 0.7 }); });
  for (const cut of T.cuts.slice(1, -1)) {
    let lp = 0; const big = cut === E.meet;
    add(cut - 0.5, 0.75, (u) => { const x = rnd(); const k = 0.02 + 0.25 * Math.min(1, u / 0.5); lp += k * (x - lp); return lp * (u < 0.5 ? Math.pow(u / 0.5, 2) : Math.exp(-(u - 0.5) / 0.06)); }, { gain: big ? 0.24 : 0.12, send: 0.6 });
  }

  // reverb (Schroeder: 4 combs + 2 allpasses per side)
  function reverb(x, delays, ap) {
    const y = new Float32Array(N);
    for (const d of delays) { const D = Math.floor(d * SR), buf = new Float32Array(D); let i = 0, lp = 0;
      for (let s = 0; s < N; s++) { const o = buf[i]; lp = o * 0.7 + lp * 0.3; buf[i] = x[s] + lp * 0.78; i = (i + 1) % D; y[s] += o * 0.25; } }
    for (const d of ap) { const D = Math.floor(d * SR), buf = new Float32Array(D); let i = 0;
      for (let s = 0; s < N; s++) { const b = buf[i], v = y[s] + b * 0.5; buf[i] = v; y[s] = b - v * 0.5; i = (i + 1) % D; } }
    return y;
  }
  const wl = reverb(sL, [0.0297, 0.0371, 0.0411, 0.0437], [0.005, 0.0017]);
  const wr = reverb(sR, [0.0311, 0.0359, 0.0423, 0.0451], [0.0051, 0.0018]);

  // voice-over on top; the music ducks about 9 dB while it speaks
  const voice = readWav(vo), voStart = Math.round(T.voOffset * SR);
  const duckEnv = new Float32Array(N);
  let level = 0;
  for (let i = 0; i < N; i++) {
    const j = i - voStart, a = j >= 0 && j < voice.length ? Math.abs(voice[j]) : 0;
    level = a > level ? level + (a - level) * 0.002 : level * 0.99995;
    duckEnv[i] = Math.min(1, level * 12);
  }
  const mix = new Float32Array(N * 2);
  let peak = 0;
  for (let i = 0; i < N; i++) {
    const g = 1 - 0.65 * duckEnv[i], fade = i / SR > T.end - 0.35 ? Math.max(0, (T.end - i / SR) / 0.35) : 1;
    const j = i - voStart, v = j >= 0 && j < voice.length ? voice[j] * 0.9 : 0;
    const l = (Math.tanh((L[i] + wl[i] * 0.55) * 1.1) * 0.55 * g + v) * fade, r = (Math.tanh((R[i] + wr[i] * 0.55) * 1.1) * 0.55 * g + v) * fade;
    mix[i * 2] = l; mix[i * 2 + 1] = r; peak = Math.max(peak, Math.abs(l), Math.abs(r));
  }
  const pcm = new Int16Array(N * 2), gain = 0.89 / peak;
  for (let i = 0; i < pcm.length; i++) pcm[i] = Math.round(mix[i] * gain * 32767);
  const hdr = Buffer.alloc(44);
  hdr.write('RIFF', 0); hdr.writeUInt32LE(36 + pcm.length * 2, 4); hdr.write('WAVE', 8); hdr.write('fmt ', 12);
  hdr.writeUInt32LE(16, 16); hdr.writeUInt16LE(1, 20); hdr.writeUInt16LE(2, 22); hdr.writeUInt32LE(SR, 24); hdr.writeUInt32LE(SR * 4, 28); hdr.writeUInt16LE(4, 32); hdr.writeUInt16LE(16, 34);
  hdr.write('data', 36); hdr.writeUInt32LE(pcm.length * 2, 40);
  fs.writeFileSync(out, Buffer.concat([hdr, Buffer.from(pcm.buffer)]));
}
