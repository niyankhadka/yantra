/**
 * Markdown -> HTML for the docs pages (marked, run at build time only). Raw HTML in the
 * source is escaped, never passed through. Headings get GitHub-style ids (so links such as
 * `authoring.md#deep-hierarchies` keep working), code blocks are highlighted, and every
 * repository-relative link is rewritten: docs and guides to their site pages, gallery
 * examples to the playground, any other repository file to GitHub. A link to a file that
 * does not exist is collected in `broken` so the build can fail on it.
 */
import fs from 'node:fs';
import path from 'node:path';
import { Marked } from 'marked';
import { ROOT } from '../../lib/build.js';
import { SITE, galleryIds, pageUrlForFile } from './content.js';
import { escapeHtml, highlight, languageOf } from './highlight.js';

/** GitHub's heading slug: lower case, punctuation dropped, spaces to hyphens. */
export function slugify(text) {
  return String(text)
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-');
}

const stripTags = (html) =>
  html
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');

/** Leading `---` block of `key: value` lines (guides use it for the page description). */
export function frontMatter(source) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(source);
  if (!m) return { data: {}, body: source };
  const data = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([\w-]+):\s*(.*)$/.exec(line);
    if (kv) data[kv[1]] = kv[2].replace(/^"(.*)"$/, '$1');
  }
  return { data, body: source.slice(m[0].length) };
}

/** A repository-relative link target, from the file `fromRel`, as a site or GitHub URL. */
export function rewriteHref(href, fromRel, broken = []) {
  // Links to this site (written in full so they also work on GitHub) become site paths
  if (href && (href === SITE.url || href.startsWith(`${SITE.url}/`))) return href.slice(SITE.url.length) || '/';
  if (!href || href.startsWith('#') || /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//')) return href;
  if (href.startsWith('/')) return href; // already a site path (guides may link /playground/ etc.)
  const [rawPath, ...rest] = href.split('#');
  const hash = rest.length ? `#${rest.join('#')}` : '';
  const target = path.posix.normalize(path.posix.join(path.posix.dirname(fromRel), decodeURI(rawPath)));
  if (target.startsWith('..')) {
    broken.push(`${fromRel}: ${href} leaves the repository`);
    return href;
  }
  const page = pageUrlForFile(target);
  if (page) return page + hash;
  const ex = /^examples\/([\w-]+)\.json$/.exec(target);
  if (ex && galleryIds().has(ex[1]) && !hash) return `/playground/#example=${ex[1]}`;
  const abs = path.join(ROOT, target);
  if (!fs.existsSync(abs)) {
    broken.push(`${fromRel}: ${href} (no such file ${target})`);
    return href;
  }
  const kind = fs.statSync(abs).isDirectory() ? 'tree' : 'blob';
  const clean = target.replace(/\/$/, '');
  return `${SITE.repo}/${kind}/${SITE.branch}/${clean.split('/').map(encodeURIComponent).join('/')}${hash}`;
}

/** Image sources: docs/images/* is copied to /images/, anything else comes from GitHub. */
function rewriteSrc(src, fromRel, broken) {
  if (!src || /^[a-z][a-z0-9+.-]*:/i.test(src) || src.startsWith('/')) return src;
  const target = path.posix.normalize(path.posix.join(path.posix.dirname(fromRel), src));
  if (!fs.existsSync(path.join(ROOT, target))) broken.push(`${fromRel}: image ${src} not found`);
  if (target.startsWith('docs/images/')) return `/images/${target.slice('docs/images/'.length)}`;
  return `https://raw.githubusercontent.com/niyankhadka/yantra/${SITE.branch}/${target}`;
}

/**
 * Render one Markdown file. Returns { html, title, description, headings: [{ depth, id, text }],
 * sections: [{ id, title, text }], broken: [...] }.
 */
export function renderMarkdown(source, fromRel) {
  const { data, body } = frontMatter(source);
  const broken = [];
  const headings = [];
  const used = new Map();
  const uniqueId = (base) => {
    const n = used.get(base) || 0;
    used.set(base, n + 1);
    return n ? `${base}-${n}` : base || 'section';
  };
  const marked = new Marked({
    gfm: true,
    renderer: {
      heading({ tokens, depth }) {
        const inner = this.parser.parseInline(tokens);
        const text = stripTags(inner).trim();
        const id = uniqueId(slugify(text));
        headings.push({ depth, id, text });
        if (depth === 1) return `<h1 id="${id}">${inner}</h1>\n`;
        return `<h${depth} id="${id}"><a class="anchor" href="#${id}" aria-hidden="true" tabindex="-1">#</a>${inner}</h${depth}>\n`;
      },
      code({ text, lang }) {
        const l = (lang || '').trim().split(/\s+/)[0];
        const label = languageOf(l) ? l : '';
        return `<div class="code"${label ? ` data-lang="${escapeHtml(label)}"` : ''}><pre><code>${highlight(text.replace(/\n$/, ''), l)}</code></pre></div>\n`;
      },
      html({ text }) {
        // Raw HTML is shown as text, never rendered; only a few bare inline tags pass
        if (/^<\/?(?:kbd|br|sub|sup|em|strong|details|summary)\s*\/?>$/i.test(text.trim())) return text.trim();
        return escapeHtml(text);
      },
      link({ href, title, tokens }) {
        const inner = this.parser.parseInline(tokens);
        const url = rewriteHref(href, fromRel, broken);
        const external = /^https?:\/\//.test(url) && !url.startsWith(SITE.url);
        return `<a href="${escapeHtml(url)}"${title ? ` title="${escapeHtml(title)}"` : ''}${external ? ' class="ext"' : ''}>${inner}</a>`;
      },
      image({ href, title, text }) {
        const src = rewriteSrc(href, fromRel, broken);
        return `<img src="${escapeHtml(src)}" alt="${escapeHtml(text || '')}"${title ? ` title="${escapeHtml(title)}"` : ''} loading="lazy" decoding="async">`;
      }
    }
  });
  let html = marked.parse(body);
  html = html.replace(/<table>/g, '<div class="table-wrap"><table>').replace(/<\/table>/g, '</table></div>');

  const h1 = headings.find((h) => h.depth === 1);
  const title = data.title || h1?.text || fromRel;
  // Description: front matter, else the first paragraph
  let description = data.description;
  if (!description) {
    const p = /<p>([\s\S]*?)<\/p>/.exec(html);
    description = p ? stripTags(p[1]).replace(/\s+/g, ' ').trim() : title;
  }
  if (description.length > 160) description = `${description.slice(0, 157).replace(/\s+\S*$/, '')}…`;

  // Search sections: text between h2/h3 headings
  const sections = [];
  const re = /<h([1-3]) id="([^"]+)"[^>]*>([\s\S]*?)<\/h\1>/g;
  const marks = [...html.matchAll(re)];
  marks.forEach((m, i) => {
    const end = i + 1 < marks.length ? marks[i + 1].index : html.length;
    const text = stripTags(html.slice(m.index + m[0].length, end)).replace(/\s+/g, ' ').trim();
    sections.push({ id: m[1] === '1' ? '' : m[2], title: stripTags(m[3]).replace(/^#/, '').trim(), text });
  });
  return { html, title, description, headings, sections, broken, nav: data.nav };
}
