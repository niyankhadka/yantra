/**
 * What the site is made of: its address, the guides (site/guides/*.md, written for the
 * site) and the reference pages (the repository's docs/*.md, rendered as they are), in
 * sidebar order. Every docs/*.md gets a page: files not listed here are appended.
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../../lib/build.js';

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));

export const SITE = {
  url: 'https://yantra.nbk.com.np',
  name: 'Yantra',
  tagline: 'Interactive, step-by-step diagrams and one-page answers, shipped as one offline HTML file.',
  version: pkg.version,
  repo: 'https://github.com/niyankhadka/yantra',
  branch: 'main',
  npm: 'https://www.npmjs.com/package/@niyankhadka/yantra',
  pypi: 'https://pypi.org/project/niyankhadka-yantra/',
  sponsor: 'https://buymeacoffee.com/niyankhadka',
  maintainer: 'niyankhadka'
};

/** Guides, in reading order. `file` is relative to the repository root. */
export const GUIDES = [
  { slug: 'first-diagram', file: 'site/guides/first-diagram.md', nav: 'Install and your first diagram' },
  { slug: 'coding-agents', file: 'site/guides/coding-agents.md', nav: 'Diagrams from your codebase' },
  { slug: 'answer-pages', file: 'site/guides/answer-pages.md', nav: 'One-page answers and charts' },
  { slug: 'import', file: 'site/guides/import.md', nav: 'Import Mermaid, PlantUML, draw.io, Visio' },
  { slug: 'chat', file: 'site/guides/chat.md', nav: 'Use with Claude.ai, ChatGPT, any chat' },
  { slug: 'python', file: 'site/guides/python.md', nav: 'Python SDK' },
  { slug: 'sharing', file: 'site/guides/sharing.md', nav: 'Embedding and sharing' },
  { slug: 'self-hosting', file: 'site/guides/self-hosting.md', nav: 'Releases and self-hosting' }
];

/** Reference pages from docs/ in this order, then any other docs/*.md, then the changelog. */
const REFERENCE_ORDER = ['authoring', 'pages', 'import', 'mermaid', 'agents', 'chat', 'remote-mcp', 'architecture'];
const REFERENCE_NAV = {
  authoring: 'Authoring diagrams',
  pages: 'Answer pages',
  import: 'Import: draw.io, PlantUML, Visio',
  mermaid: 'Import: Mermaid',
  agents: 'Coding agents',
  chat: 'AI chats',
  'remote-mcp': 'Remote MCP server',
  architecture: 'Architecture',
  changelog: 'Changelog'
};

export function referencePages() {
  const found = fs.readdirSync(path.join(ROOT, 'docs')).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3));
  const order = [...REFERENCE_ORDER.filter((s) => found.includes(s)), ...found.filter((s) => !REFERENCE_ORDER.includes(s)).sort()];
  return [
    ...order.map((slug) => ({ slug, file: `docs/${slug}.md`, nav: REFERENCE_NAV[slug] || null })),
    { slug: 'changelog', file: 'CHANGELOG.md', nav: REFERENCE_NAV.changelog }
  ];
}

/** URL of a page: guides under /docs/guides/, reference pages under /docs/. */
export const guideUrl = (slug) => `/docs/guides/${slug}/`;
export const referenceUrl = (slug) => `/docs/${slug}/`;

/** Repository file (relative path) -> site URL, for the files that have a page. */
export function pageUrlForFile(rel) {
  const g = GUIDES.find((x) => x.file === rel);
  if (g) return guideUrl(g.slug);
  const r = referencePages().find((x) => x.file === rel);
  return r ? referenceUrl(r.slug) : null;
}

/** Gallery example ids the playground opens with #example= (src/app/examples.js, gallery-pages.js). */
export function galleryIds() {
  const ids = new Set();
  for (const f of ['src/app/examples.js', 'src/app/gallery-pages.js']) {
    const text = fs.readFileSync(path.join(ROOT, f), 'utf-8');
    for (const m of text.matchAll(/\{\s*id:\s*'([\w-]+)',\s*name:/g)) ids.add(m[1]);
  }
  return ids;
}
