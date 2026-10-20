// WCAG 2.x contrast checks for the design tokens in both themes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOKENS, HUES } from '../src/core/theme.js';

function luminance(hex) {
  const n = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => {
    const v = parseInt(n.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const THEMES = ['light', 'dark'];

function expectContrast(fg, bg, min, label) {
  const ratio = contrast(fg, bg);
  assert.ok(ratio >= min, `${label}: ${fg} on ${bg} is ${ratio.toFixed(2)}:1, needs ${min}:1`);
}

test('contrast helper matches known WCAG values', () => {
  assert.equal(contrast('#000000', '#ffffff').toFixed(1), '21.0');
  assert.equal(contrast('#777777', '#ffffff').toFixed(2), '4.48');
});

for (const theme of THEMES) {
  const t = TOKENS[theme];

  test(`${theme}: text tokens reach 4.5:1 on bg and surface`, () => {
    // ink3 is used for small labels, so it is held to the body-text minimum too
    for (const key of ['ink', 'ink2', 'ink3']) {
      for (const ground of ['bg', 'surface']) expectContrast(t[key], t[ground], 4.5, `${theme} ${key} on ${ground}`);
    }
  });

  test(`${theme}: accent reaches 4.5:1 on bg and surface, accentInk on accent`, () => {
    expectContrast(t.accent, t.bg, 4.5, `${theme} accent on bg`);
    expectContrast(t.accent, t.surface, 4.5, `${theme} accent on surface`);
    expectContrast(t.accentInk, t.accent, 4.5, `${theme} accentInk on accent`);
  });

  test(`${theme}: edges reach 3:1 on bg (graphical object)`, () => {
    expectContrast(t.edge, t.bg, 3, `${theme} edge on bg`);
  });

  test(`${theme}: every role hue reaches 4.5:1 on surface (kicker text)`, () => {
    for (const [name, hue] of Object.entries(HUES)) expectContrast(hue[theme], t.surface, 4.5, `${theme} hue ${name} on surface`);
  });
}
