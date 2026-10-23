// Event times shared by the picture (scene.mjs) and the sound (synth.mjs), from the measured timeline:
// T.cuts (one per voice-over line, plus the end) and T.lines (each line's phrases as [start, end]).
export const BEAT = 0.5;
export const snap = (t, grid = BEAT / 4) => Math.round(t / grid) * grid;

export function events(T) {
  const c = T.cuts, L = T.lines;
  const within = (ph, f) => ph[0] + f * (ph[1] - ph[0]);
  const e = {
    cuts: c,
    end: T.end,
    // 1 pain: drawing by hand
    drags: [1.5, 3.5].filter((t) => t < c[1] - 0.5),
    stale: L[0][1][0],
    // 2 pain: AI drawings
    ai: L[1][0][0],
    overlap: L[1][1][0],
    nowhere: within(L[1][1], 0.52),
    // 3 turn
    meet: c[2],
    meetSub: c[2] + 0.75,
    // 4 describe it
    prompt: [c[3] + 0.1, c[3] + 0.7],
    json: [c[3] + 0.8, L[3][1][0] - 0.15],
    // 5 checked
    cmd: [c[4] + 0.1, c[4] + 0.5]
  };
  const draws = snap(L[3][1][0], BEAT / 2);
  e.pops = [draws, draws + 0.25, draws + 0.5];
  e.edges = [draws + 0.75, draws + 1.0];
  e.err = snap(c[4] + 0.75, BEAT / 2);
  e.fix = e.err + 1.0;
  e.rerun = [e.fix + 0.25, e.fix + 0.6];
  e.ok = e.fix + 0.75;
  // 6 story: Next clicked on beats
  e.clicks = [c[5] + 1.0, c[5] + 2.0];
  // 7 shapes: one tile per spoken word
  e.shapes = [L[6][0][0], within(L[6][0], 0.45), L[6][1][0]];
  // 8 use cases: one card per phrase
  e.uses = L[7].map((ph) => ph[0]);
  // 9 share
  e.file = c[8] + 0.1;
  e.chips = [0, 1, 2, 3].map((i) => c[8] + 0.5 + i * 0.25);
  e.wipe = [c[8] + 1.25, c[8] + 1.75];
  // 10 ending
  e.lockup = c[9];
  e.tag = [L[9][1][0], L[9][2][0]];
  e.resolve = T.end - 2;
  e.cta = [e.resolve, e.resolve + 0.5];
  return e;
}
