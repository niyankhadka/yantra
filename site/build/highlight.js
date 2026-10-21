/**
 * A small build-time syntax highlighter for the languages the docs use (JSON, shell,
 * JavaScript, Python, TOML/YAML). It scans with a list of sticky regular expressions and
 * wraps the matches in <span class="t-...">; everything else is escaped text. No runtime
 * code, no dependency: unknown languages are only escaped.
 */
export const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const JS_KEYWORDS = 'await|break|case|catch|class|const|continue|default|delete|do|else|export|extends|finally|for|from|function|if|import|in|instanceof|let|new|of|return|static|super|switch|this|throw|try|typeof|var|void|while|yield|async';
const PY_KEYWORDS = 'and|as|assert|async|await|break|class|continue|def|del|elif|else|except|finally|for|from|global|if|import|in|is|lambda|nonlocal|not|or|pass|raise|return|try|while|with|yield';

const RULES = {
  json: [
    [/"(?:[^"\\\n]|\\.)*"(?=\s*:)/y, 'key'],
    [/"(?:[^"\\\n]|\\.)*"/y, 'str'],
    [/-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/y, 'num'],
    [/\b(?:true|false|null)\b/y, 'kw'],
    [/\/\/[^\n]*/y, 'com']
  ],
  shell: [
    [/(?<=^|\s)#[^\n]*/y, 'com'],
    [/'[^'\n]*'/y, 'str'],
    [/"(?:[^"\\\n]|\\.)*"/y, 'str'],
    [/(?<=^|\n|&& |\| |; )\s*[A-Za-z_][\w.-]*(?==)/y, 'key'],
    [/(?<=^|\n|&& |\| |; )(?:npx|npm|yantra|node|pip|python|git|cd|docker|curl|cmd|set|export)\b/y, 'kw'],
    [/(?<=\s)--?[A-Za-z][\w-]*/y, 'attr']
  ],
  js: [
    [/\/\/[^\n]*/y, 'com'],
    [/\/\*[\s\S]*?\*\//y, 'com'],
    [/'(?:[^'\\\n]|\\.)*'/y, 'str'],
    [/"(?:[^"\\\n]|\\.)*"/y, 'str'],
    [/`(?:[^`\\]|\\.)*`/y, 'str'],
    [new RegExp(`\\b(?:${JS_KEYWORDS}|true|false|null|undefined)\\b`, 'y'), 'kw'],
    [/\b\d+(?:\.\d+)?\b/y, 'num']
  ],
  python: [
    [/#[^\n]*/y, 'com'],
    [/(?:"""[\s\S]*?"""|'''[\s\S]*?''')/y, 'str'],
    [/[rbfu]?'(?:[^'\\\n]|\\.)*'/y, 'str'],
    [/[rbfu]?"(?:[^"\\\n]|\\.)*"/y, 'str'],
    [new RegExp(`\\b(?:${PY_KEYWORDS}|True|False|None)\\b`, 'y'), 'kw'],
    [/\b\d+(?:\.\d+)?\b/y, 'num']
  ],
  toml: [
    [/#[^\n]*/y, 'com'],
    [/"(?:[^"\\\n]|\\.)*"/y, 'str'],
    [/'[^'\n]*'/y, 'str'],
    [/^\s*\[[^\]\n]+\]/my, 'kw'],
    [/(?<=^|\n)\s*[\w.-]+(?=\s*[=:])/y, 'key'],
    [/\b(?:true|false)\b/y, 'kw'],
    [/\b\d+(?:\.\d+)?\b/y, 'num']
  ]
};

const ALIASES = {
  json: 'json', jsonc: 'json',
  bash: 'shell', sh: 'shell', shell: 'shell', console: 'shell', zsh: 'shell', powershell: 'shell', ps1: 'shell', cmd: 'shell',
  js: 'js', javascript: 'js', mjs: 'js', ts: 'js', typescript: 'js',
  py: 'python', python: 'python',
  toml: 'toml', yaml: 'toml', yml: 'toml', ini: 'toml'
};

export const languageOf = (lang) => ALIASES[String(lang || '').toLowerCase()] || null;

/** Highlighted, escaped HTML for `code` in `lang`. */
export function highlight(code, lang) {
  const rules = RULES[languageOf(lang)];
  if (!rules) return escapeHtml(code);
  let out = '';
  let plain = '';
  let i = 0;
  while (i < code.length) {
    let hit = null;
    for (const [re, cls] of rules) {
      re.lastIndex = i;
      const m = re.exec(code);
      if (m && m[0].length) {
        hit = [m[0], cls];
        break;
      }
    }
    if (hit) {
      out += escapeHtml(plain) + `<span class="t-${hit[1]}">${escapeHtml(hit[0])}</span>`;
      plain = '';
      i += hit[0].length;
    } else {
      // Advance over a whole word so rules never start inside one
      const w = /[\w$]+|[^\w$]/y;
      w.lastIndex = i;
      const m = w.exec(code);
      plain += m[0];
      i += m[0].length;
    }
  }
  return out + escapeHtml(plain);
}
