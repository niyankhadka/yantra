/**
 * Design tokens - the single source of truth for colours. The app injects
 * these as CSS custom properties; the SVG exporter reads them directly.
 */

export const TOKENS = {
  light: {
    bg: '#f6f6f3',
    grid: '#dddbd4',
    surface: '#ffffff',
    surface2: '#f1f0ec',
    border: '#dcdad3',
    borderStrong: '#c4c1b8',
    ink: '#1c1e23',
    ink2: '#4a4f59',
    ink3: '#6b707a',
    edge: '#878b93',
    accent: '#2f5bd3',
    accentInk: '#ffffff',
    accentSoft: 'rgba(47, 91, 211, 0.12)',
    shadow: '0 1px 2px rgba(28, 30, 35, 0.06)',
    overlay: 'rgba(255, 255, 255, 0.92)'
  },
  dark: {
    bg: '#0f1115',
    grid: '#23272e',
    surface: '#171a20',
    surface2: '#1e2229',
    border: '#2b3039',
    borderStrong: '#3b414c',
    ink: '#e7e9ed',
    ink2: '#a9afba',
    ink3: '#7d8490',
    edge: '#5d6470',
    accent: '#7ea3ff',
    accentInk: '#0f1115',
    accentSoft: 'rgba(126, 163, 255, 0.16)',
    shadow: '0 1px 2px rgba(0, 0, 0, 0.4)',
    overlay: 'rgba(23, 26, 32, 0.94)'
  }
};

/** Role hues: muted so that the accent (active path) stays the loudest colour. */
export const HUES = {
  blue: { light: '#3b63c4', dark: '#86a6f0' },
  teal: { light: '#11827b', dark: '#5cc4bc' },
  green: { light: '#3d7f3a', dark: '#87c27f' },
  amber: { light: '#a56704', dark: '#e0aa4f' },
  rose: { light: '#b83a5b', dark: '#ec8aa3' },
  violet: { light: '#7247b8', dark: '#b294ec' },
  orange: { light: '#b85421', dark: '#f0996a' },
  slate: { light: '#59606d', dark: '#a3aab6' }
};

export const HUE_ORDER = ['blue', 'teal', 'violet', 'amber', 'green', 'rose', 'orange', 'slate'];

export const FONT_SANS = "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";
export const FONT_MONO = "ui-monospace, 'Cascadia Code', 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace";

const kebab = (s) => s.replace(/[A-Z0-9]/g, (c) => `-${c.toLowerCase()}`);

function block(theme) {
  const t = TOKENS[theme];
  const vars = Object.entries(t).map(([k, v]) => `--y-${kebab(k)}: ${v};`);
  for (const [name, hue] of Object.entries(HUES)) vars.push(`--y-hue-${name}: ${hue[theme]};`);
  return vars.join(' ');
}

/** CSS text declaring every token for both themes. */
export function themeCss() {
  return [
    `:root { --y-font-sans: ${FONT_SANS}; --y-font-mono: ${FONT_MONO}; ${block('light')} }`,
    `:root[data-theme="dark"] { ${block('dark')} color-scheme: dark; }`,
    ...Object.keys(HUES).map((name) => `[data-hue="${name}"] { --y-hue: var(--y-hue-${name}); }`)
  ].join('\n');
}
