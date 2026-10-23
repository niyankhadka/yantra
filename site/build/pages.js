/**
 * Every page of https://yantra.nbk.com.np/ except the playground (which is its own Vite
 * HTML entry): the landing page, /docs/ (rendered from docs/*.md and site/guides/*.md),
 * 404.html, sitemap.xml, robots.txt, the docs search index and the static files the
 * pages use (logos, social image, diagram thumbnails, the live demo viewer).
 *
 * `siteFiles({ assets })` returns { "<path in dist-pages>": string | Buffer }. `assets`
 * names the site's script and stylesheets: the built files, or the dev server's sources.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT, buildHtml, resolveLevels } from '../../lib/build.js';
import { renderSvg } from '../../src/core/svg.js';
import { sceneForView } from '../../src/core/sequence.js';
import { GUIDES, SITE, guideUrl, referencePages, referenceUrl } from './content.js';
import { escapeHtml as esc, highlight } from './highlight.js';
import { renderMarkdown } from './markdown.js';

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf-8');
const abs = (p) => `${SITE.url}${p}`;

// --- dates and structured data ---------------------------------------------------------
const BUILD_DATE = new Date().toISOString();
const MODIFIED = new Map();
/**
 * Last commit date of repository files (ISO 8601), the newest of them; the build date when
 * git or the history is not available (a shallow clone gives the date of its one commit).
 */
export function lastModified(...rels) {
  let best = '';
  for (const rel of rels) {
    if (!MODIFIED.has(rel)) {
      let d = '';
      try {
        d = execFileSync('git', ['log', '-1', '--format=%cI', '--', rel], { cwd: ROOT, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      } catch {
        // not a git checkout
      }
      MODIFIED.set(rel, d ? new Date(d).toISOString() : '');
    }
    const d = MODIFIED.get(rel);
    if (d > best) best = d;
  }
  return best || BUILD_DATE;
}

/** JSON-LD in a script element; `<` is escaped so text cannot close the element. */
const jsonLdScript = (data) => `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, '\u003c')}</script>`;

const PERSON = { '@type': 'Person', '@id': `${SITE.url}/#maintainer`, name: SITE.maintainer, url: SITE.maintainerUrl, sameAs: [SITE.maintainerUrl] };
const SOCIAL = { url: '/social-preview.png', width: 1280, height: 640, alt: 'Yantra: interactive, step-by-step diagrams and one-page answers' };

/** Search-engine ownership checks: set at build time (repository variables in pages.yml); off when unset. */
function verificationTags() {
  const tags = [];
  const google = process.env.YANTRA_SITE_GOOGLE_VERIFICATION?.trim();
  const bing = process.env.YANTRA_SITE_BING_VERIFICATION?.trim();
  if (google) tags.push(`<meta name="google-site-verification" content="${esc(google)}">`);
  if (bing) tags.push(`<meta name="msvalidate.01" content="${esc(bing)}">`);
  return tags.map((t) => `${t}\n`).join('');
}

function breadcrumbs(items) {
  return {
    '@type': 'BreadcrumbList',
    itemListElement: items.map(([name, url], i) => ({ '@type': 'ListItem', position: i + 1, name, item: abs(url) }))
  };
}

// --- icons (inline SVG, stroke = currentColor) ----------------------------------
const ICON = {
  github: '<svg class="i" viewBox="0 0 16 16" width="18" height="18" aria-hidden="true" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8a8 8 0 0 0 5.47 7.59c.4.07.55-.17.55-.38v-1.33c-2.23.48-2.7-1.07-2.7-1.07-.36-.92-.89-1.17-.89-1.17-.73-.5.05-.49.05-.49.8.06 1.23.83 1.23.83.72 1.22 1.88.87 2.33.66.07-.52.28-.87.5-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.6 7.6 0 0 1 4 0c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48v2.2c0 .21.15.46.55.38A8 8 0 0 0 16 8c0-4.42-3.58-8-8-8Z"/></svg>',
  sun: '<svg class="i i-sun" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  moon: '<svg class="i i-moon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z"/></svg>',
  system: '<svg class="i i-system" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg>',
  copy: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>',
  arrow: '<svg class="i" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
  menu: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/></svg>',
  search: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  edit: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>'
};

/** Line icons for the landing page's problem and feature cards (24px grid, currentColor). */
const svgIcon = (p) => `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
const FI = {
  clock: svgIcon('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  text: svgIcon('<path d="M4 6h16M4 10h16M4 14h10M4 18h7"/>'),
  broken: svgIcon('<rect x="3" y="4" width="9" height="6" rx="1.5"/><rect x="8" y="8" width="9" height="6" rx="1.5"/><path d="m16 17 5 4M21 17l-5 4"/>'),
  layout: svgIcon('<rect x="3" y="3" width="7" height="5" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="8.5" y="16" width="7" height="5" rx="1"/><path d="M6.5 8v3h11V8M12 11v5"/>'),
  check: svgIcon('<path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z"/><path d="m9 12 2 2 4-4"/>'),
  steps: svgIcon('<circle cx="5" cy="6" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="18" r="2"/><path d="m6.5 7.5 4 3M13.5 13.5l4 3"/>'),
  shapes: svgIcon('<rect x="3" y="3" width="8" height="8" rx="1.5"/><circle cx="17" cy="7" r="4"/><path d="M7 14l4 7H3z"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>'),
  agent: svgIcon('<rect x="4" y="8" width="16" height="12" rx="3"/><path d="M12 8V5M9 13h.01M15 13h.01M9.5 17h5"/><circle cx="12" cy="4" r="1"/>'),
  import: svgIcon('<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>'),
  share: svgIcon('<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/>'),
  globe: svgIcon('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>'),
  cross: svgIcon('<path d="M18 6 6 18M6 6l12 12"/>'),
  tick: svgIcon('<path d="M20 6 9 17l-5-5"/>'),
  file: svgIcon('<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M9 14l2 2 4-4"/>'),
  chat: svgIcon('<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>'),
  terminal: svgIcon('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m7 9 3 3-3 3M12 15h5"/>')
};

/** A monochrome brand logo from site/assets/logos (Simple Icons), drawn in currentColor. */
function brandLogo(slug) {
  const svg = fs.readFileSync(path.join(ROOT, 'site', 'assets', 'logos', `${slug}.svg`), 'utf8');
  return svg.replace(/<title>[^<]*<\/title>/, '').replace('<svg ', '<svg class="logo-mark" width="20" height="20" fill="currentColor" aria-hidden="true" focusable="false" ').replace(' role="img"', '');
}

/** "Works with" row: [logo slug or null, name]. */
const WORKS_WITH = [
  ['claude', 'Claude Code & Claude.ai'],
  ['openai', 'Codex & ChatGPT'],
  ['cursor', 'Cursor'],
  ['googlegemini', 'Gemini'],
  [null, 'Antigravity'],
  ['modelcontextprotocol', 'Any MCP client'],
  ['python', 'Python']
];

/** The problem, as [without Yantra, with Yantra] pairs (HTML). */
const PAINS = [
  ['Hours of dragging boxes, and the diagram is out of date by Friday', 'A few lines of description; layout, routing and labels are automatic'],
  ['Ask an AI how something works and get a wall of text', 'Your agent answers with a diagram readers can step through'],
  ['AI diagrams where boxes overlap and arrows point at nothing', 'A validator catches it first, with codes the agent can fix'],
  ['A screenshot pasted into a doc that nobody can explore', 'One file with a walkthrough, an inspector and links to each step']
];

/** How it works: [id, title, text]; each has a matching panel in the stepper. */
const STEPS = [
  ['describe', 'Describe it', 'A few lines of JSON, written by you or your coding agent. No coordinates.'],
  ['check', 'Yantra checks it', 'Broken references, overlaps and colliding labels are caught before anyone sees them.'],
  ['step', 'Readers step through it', 'Each step lights up what matters, with a short explanation.'],
  ['share', 'Share it anywhere', 'One HTML file, links to a single step, or SVG, PNG and Markdown.']
];

/** Landing page features: [icon, title, text (HTML)]. */
const FEATURES = [
  ['layout', 'No boxes to place', 'Layered layout with routed edges and placed labels, plus trees, mind maps and nested groups. There are no coordinates to write.'],
  ['check', 'Checked before anyone sees it', 'The validator reports broken references, overlaps, edges through cards and label collisions, each with a stable code.'],
  ['steps', 'Walkthroughs', 'Steps that light up what matters, scenarios, autoplay, camera follow, present mode and drill-down into detail diagrams.'],
  ['shapes', 'Every shape of answer', 'Architecture, sequence, state, ER, class, org chart and mind map diagrams, answer pages with charts, books and slides.'],
  ['agent', 'Built for AI', 'An MCP server, agent skills set up by <code>yantra init</code>, and prompts for Claude.ai, ChatGPT and any chat.'],
  ['import', 'Bring your diagrams', 'Import Mermaid, PlantUML, draw.io and Visio files, then add the story.'],
  ['share', 'Share it anywhere', 'One HTML file with no network requests, links that reopen a step, and SVG, PNG and Markdown exports.'],
  ['globe', 'For every reader', '18 interface languages, right-to-left layouts, light and dark themes and full keyboard control.']
];

// Theme before first paint: saved choice (shared with the playground and viewer) or the system
const THEME_SCRIPT = "(function(){var s=null;try{s=localStorage.getItem('yantra:theme')}catch(e){}var p=s==='light'||s==='dark'?s:'system';var d=window.matchMedia&&matchMedia('(prefers-color-scheme: dark)').matches;var r=document.documentElement;r.setAttribute('data-theme',p==='system'?(d?'dark':'light'):p);r.setAttribute('data-theme-pref',p)})()";
// The playground used to be the site root: /#example=..., /?lang=... go to /playground/
const FORWARD_SCRIPT = "(function(){var l=location;if(/(?:^#|&)example=/.test(l.hash)||/[?&]lang=/.test(l.search))l.replace('/playground/'+l.search+l.hash)})()";

function codeBlock(code, lang, label) {
  return `<div class="code"${lang ? ` data-lang="${esc(lang)}"` : ''}${label ? ` data-label="${esc(label)}"` : ''}><pre><code>${highlight(code, lang)}</code></pre></div>`;
}

// --- chrome ----------------------------------------------------------------------
function header(current) {
  const link = (href, label, key, extra = '') =>
    `<li${extra}><a href="${href}"${current === key ? ' aria-current="page"' : ''}>${label}</a></li>`;
  return `<header class="topbar">
  <div class="topbar-in">
    <a class="brand" href="/" aria-label="Yantra home">
      <img class="only-light" src="/logo-light.svg" width="28" height="28" alt="">
      <img class="only-dark" src="/logo-dark.svg" width="28" height="28" alt="" loading="lazy">
      <span>Yantra</span>
    </a>
    <nav class="mainnav" aria-label="Main">
      <ul>
        ${link('/docs/', 'Docs', 'docs')}
        ${link('/playground/', 'Playground', 'playground')}
        ${link('/#examples', 'Examples', 'examples', ' class="wide-only"')}
        <li><a class="gh" href="${SITE.repo}" aria-label="GitHub repository">${ICON.github}<span class="wide-only">GitHub</span></a></li>
      </ul>
    </nav>
    <button class="theme-btn" type="button" data-theme-toggle aria-label="Colour theme: system" title="Colour theme: system">${ICON.system}${ICON.sun}${ICON.moon}</button>
  </div>
</header>`;
}

function footer() {
  const blob = (f) => `${SITE.repo}/blob/${SITE.branch}/${f}`;
  return `<footer class="footer">
  <div class="footer-in">
    <div class="footer-brand">
      <a class="brand" href="/"><img class="only-light" src="/logo-light.svg" width="24" height="24" alt="" loading="lazy"><img class="only-dark" src="/logo-dark.svg" width="24" height="24" alt="" loading="lazy"><span>Yantra</span></a>
      <p>${esc(SITE.tagline)}</p>
      <p class="muted">Version ${esc(SITE.version)}</p>
    </div>
    <nav class="footer-cols" aria-label="Footer">
      <div><h2>Product</h2><ul>
        <li><a href="/playground/">Playground</a></li>
        <li><a href="/docs/">Documentation</a></li>
        <li><a href="/#examples">Examples</a></li>
        <li><a href="/docs/changelog/">Changelog</a></li>
      </ul></div>
      <div><h2>Get it</h2><ul>
        <li><a href="${SITE.repo}">GitHub</a></li>
        <li><a href="${SITE.npm}">npm</a></li>
        <li><a href="${SITE.pypi}">PyPI</a></li>
      </ul></div>
      <div><h2>Project</h2><ul>
        <li><a href="${blob('LICENSE')}">MIT licence</a></li>
        <li><a href="${blob('TRADEMARKS.md')}">Trademark policy</a></li>
        <li><a href="${blob('SECURITY.md')}">Security</a></li>
        <li><a href="${SITE.sponsor}">Sponsor</a></li>
      </ul></div>
    </nav>
  </div>
  <p class="footer-legal">MIT © ${esc(SITE.maintainer)}. The licence covers the code; the Yantra name and logo are covered by the <a href="${blob('TRADEMARKS.md')}">trademark policy</a>.</p>
</footer>`;
}

function layout({ path: urlPath, title, description, body, current, assets, bodyClass = '', head = '', noindex = false, jsonLd = [], ogType = 'website', modified = null }) {
  const canonical = abs(urlPath);
  const fullTitle = title === SITE.name ? `${SITE.name}: interactive diagrams and one-page answers` : `${title} | ${SITE.name}`;
  const graph = jsonLd.length ? `${jsonLdScript({ '@context': 'https://schema.org', '@graph': jsonLd })}\n` : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(fullTitle)}</title>
<meta name="description" content="${esc(description)}">
${noindex ? '<meta name="robots" content="noindex">\n' : ''}<link rel="canonical" href="${canonical}">
${noindex ? '' : verificationTags()}<meta property="og:type" content="${ogType}">
<meta property="og:site_name" content="${SITE.name}">
<meta property="og:locale" content="en_GB">
<meta property="og:title" content="${esc(fullTitle)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${canonical}">
<meta property="og:image" content="${abs(SOCIAL.url)}">
<meta property="og:image:type" content="image/png">
<meta property="og:image:width" content="${SOCIAL.width}">
<meta property="og:image:height" content="${SOCIAL.height}">
<meta property="og:image:alt" content="${esc(SOCIAL.alt)}">
${modified ? `<meta property="article:modified_time" content="${modified}">\n` : ''}<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(fullTitle)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${abs(SOCIAL.url)}">
<meta name="twitter:image:alt" content="${esc(SOCIAL.alt)}">
<meta name="theme-color" content="#f6f6f3" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0f1115" media="(prefers-color-scheme: dark)">
<link rel="icon" type="image/svg+xml" href="/logo-light.svg" media="(prefers-color-scheme: light)">
<link rel="icon" type="image/svg+xml" href="/logo-dark.svg" media="(prefers-color-scheme: dark)">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="manifest" href="/manifest.webmanifest">
<script>${THEME_SCRIPT}</script>
${head}${assets.css.map((href) => `<link rel="stylesheet" href="${href}">`).join('\n')}
<script type="module" src="${assets.js}"></script>
${graph}</head>
<body class="${bodyClass}">
<a class="skip" href="#main">Skip to content</a>
${header(current)}
${body}
${footer()}
</body>
</html>
`;
}

// --- diagram thumbnails ------------------------------------------------------------
/** Static SVG of a gallery example (src/core/svg.js, as `yantra export -f svg`). */
function thumbnail(id, theme, view) {
  const file = path.join(ROOT, 'examples', `${id}.json`);
  const payload = resolveLevels(JSON.parse(fs.readFileSync(file, 'utf-8')), path.dirname(file), { root: ROOT });
  return renderSvg(sceneForView(payload, { view: view || payload.meta?.view }), { theme, step: null, logo: null });
}

const thumbSize = (svg) => {
  const m = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg);
  return m ? { w: Math.round(+m[1]), h: Math.round(+m[2]) } : { w: 1200, h: 700 };
};

function themedImg(base, alt, { w, h }, cls = '') {
  return `<img class="only-light ${cls}" src="${base}-light.svg" width="${w}" height="${h}" alt="${esc(alt)}" loading="lazy" decoding="async"><img class="only-dark ${cls}" src="${base}-dark.svg" width="${w}" height="${h}" alt="${esc(alt)}" loading="lazy" decoding="async">`;
}

// --- landing page ------------------------------------------------------------------
const KINDS = [
  { id: 'cloud-architecture', title: 'Flow and architecture', text: 'Layered layout with routed edges and nested groups for VPCs, teams or phases.' },
  { id: 'oauth-login', view: 'sequence', title: 'Sequence', text: 'The same payload as lifelines, one message per step: auth, payments, protocols.' },
  { id: 'ticket-lifecycle', title: 'State machines', text: 'States, initial and final markers, choices, fork and join, concurrent regions.' },
  { id: 'ecommerce-schema', title: 'ERD and class diagrams', text: 'Fields and methods rows, crow’s foot cardinality and UML end markers.' },
  { id: 'org-chart', title: 'Org charts and trees', text: 'Tidy trees top-down or left-right; fold a branch and unfold it with +N.' },
  { id: 'study-plan-mindmap', title: 'Mind maps', text: 'Balanced branches with curved connectors and a hue per branch.' },
  { id: 'smart-city-operations', title: 'Deep nesting and drill-down', text: 'Six levels of boxes, fold to a depth, zoom to a group, open detail diagrams.' },
  { id: 'live-operations-dashboard', title: 'Charts in cards', text: 'A mini chart on any card, or a chart card that connects like any other.' },
  { id: 'answer-quarterly-review', page: true, title: 'Answer pages', text: 'The conclusion first, then points, metrics, charts, tables, gantt plans and FAQs.' },
  { id: 'book-checkout-explained', image: 'kind-book.png', title: 'Books and reading modes', text: 'Several pages in one file, read as one page, a screen at a time like an e-reader, or as slides.' },
  { id: 'answer-quarterly-review', image: 'kind-present.png', title: 'Pages as slides', text: 'Present any page or book one row of blocks at a time, full screen, for a meeting.' },
  { id: 'playground', href: '/playground/', image: 'kind-playground.png', title: 'Start from a template', text: 'Search templates and examples by kind in the playground, or describe the diagram in words.' }
];

const STRIP = [
  ['aws-serverless', 'AWS serverless', 'Groups'],
  ['platform-overview', 'Shop platform', 'Drill-down'],
  ['payment-classes', 'Order classes', 'UML'],
  ['parallel-checkout-states', 'Parallel checkout', 'Fork and join'],
  ['incident-triage-decision-tree', 'Incident triage', 'Decision tree'],
  ['ml-training-pipeline', 'ML training pipeline', 'Pipeline'],
  ['customer-support-escalation', 'Support escalation', 'Modes'],
  ['order-fulfilment-arabic', 'Order fulfilment', 'Arabic, right to left'],
  ['health-referral-nepali', 'Patient referral', 'Nepali']
];

const PAGE_CHIPS = [
  ['answer-build-or-buy-crm', 'Build or buy a CRM'],
  ['answer-incident-review', 'Checkout outage review'],
  ['answer-how-to-choose-database', 'Choosing a database'],
  ['answer-what-happens-url', 'Typing a URL into a browser'],
  ['chart-sales-dashboard', 'Sales dashboard'],
  ['chart-sla-monitoring', 'Service levels'],
  ['answer-launch-plan', 'Launch plan (gantt)'],
  ['chart-survey-results', 'Survey results']
];

const FAQ = [
  ['What is Yantra?', '<p>An open-source explanation engine. You describe a system, a process or a decision in a few lines of JSON, or ask your coding agent or AI chat to. Yantra lays it out, checks it with a validator and turns it into a walkthrough readers can step through: a diagram, an answer page or a book, in one HTML file.</p>'],
  ['How is it different from Mermaid or draw.io?', '<p>In draw.io you place every box by hand. Mermaid draws from text, but you get a picture rather than a story. Yantra adds walkthrough steps, answer pages and books, and a validator that checks the rendered result: overlaps, edges through cards and label collisions. It also imports Mermaid, PlantUML, draw.io and Visio files, so you can start from what you have.</p>'],
  ['Do the files really work offline?', '<p>Yes. <code>yantra build</code> writes one HTML file with the viewer, its styles and your data inlined. It makes no network requests, so it opens from an email attachment, a ticket or a USB stick. The playground also keeps working offline once it has loaded.</p>'],
  ['What does it cost, and what is the licence?', `<p>Nothing. Yantra is open source under the <a href="${SITE.repo}/blob/${SITE.branch}/LICENSE">MIT licence</a>, so you can use it at work and in commercial projects. The Yantra name and logo are covered by the <a href="${SITE.repo}/blob/${SITE.branch}/TRADEMARKS.md">trademark policy</a>. If it helps you, you can <a href="${SITE.sponsor}">sponsor the project</a>.</p>`],
  ['Where does my data go?', '<p>Nowhere. The CLI, the MCP server and the Python SDK run on your machine. The playground validates and renders in your browser and uploads nothing. Built files make no external requests. This website loads no analytics or third-party scripts; it only remembers your colour theme in your browser.</p>'],
  ['Which Node.js version do I need?', '<p>Node.js 20.19 or later, or 22.12 or later on Node 22. The Python SDK needs Python 3.9 or later and calls the CLI to validate and build, so Node.js is still needed for those steps. The playground needs only a browser.</p>'],
  ['Do I need an AI tool?', '<p>No. You can write the JSON by hand, generate it from a script or the Python SDK, or import a Mermaid, PlantUML, draw.io or Visio file. Coding agents and AI chats are a convenient way to write it, not a requirement.</p>'],
  ['Can I bring my existing diagrams?', '<p><code>yantra import</code> reads Mermaid, PlantUML, draw.io / diagrams.net (including PNG exports with the diagram embedded) and Visio <code>.vsdx</code>, then validates the result. The importers are best effort and print warnings for anything they skip. See <a href="/docs/guides/import/">the import guide</a>.</p>'],
  ['Which languages does the viewer speak?', '<p>18 interface languages, with right-to-left layout for Arabic, Hebrew, Persian and Urdu and locale number formats. Set <code>meta.lang</code> on a diagram or page.</p>']
];

async function starCount() {
  if (process.env.YANTRA_SITE_STARS === '0') return null;
  try {
    const res = await fetch('https://api.github.com/repos/niyankhadka/yantra', {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'yantra-site-build' },
      signal: AbortSignal.timeout(3000)
    });
    if (!res.ok) return null;
    const n = (await res.json())?.stargazers_count;
    return Number.isInteger(n) ? n : null;
  } catch {
    return null;
  }
}

const LANDING_DESCRIPTION = 'Make your AI show its work: Yantra turns a description from you or your coding agent into checked, step-by-step diagrams, one-page answers and books.';

/**
 * Promo videos in site/assets/video/ are named <name>-v<major.minor.patch>.mp4 (with a .jpg poster);
 * the newest version of a name, e.g. 'yantra-teaser-v1.0.0', or null when there is none.
 */
const VIDEO_DIR = path.join(ROOT, 'site', 'assets', 'video');
function latestVideo(name) {
  if (!fs.existsSync(VIDEO_DIR)) return null;
  const re = new RegExp(`^${name}-v(\\d+)\\.(\\d+)\\.(\\d+)\\.mp4$`);
  const found = fs.readdirSync(VIDEO_DIR).map((f) => f.match(re)).filter(Boolean)
    .sort((a, b) => (a[1] - b[1]) || (a[2] - b[2]) || (a[3] - b[3]));
  return found.length ? found.at(-1)[0].replace(/\.mp4$/, '') : null;
}

const stripHtml = (html) => html.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();

/** Landing page structured data: the site (with the docs search), the software, its maintainer and the visible FAQ. */
function landingJsonLd() {
  return [
    {
      '@type': 'WebSite',
      '@id': `${SITE.url}/#website`,
      url: abs('/'),
      name: SITE.name,
      description: LANDING_DESCRIPTION,
      inLanguage: 'en',
      publisher: { '@id': PERSON['@id'] },
      potentialAction: { '@type': 'SearchAction', target: { '@type': 'EntryPoint', urlTemplate: abs('/docs/?q={search_term_string}') }, 'query-input': 'required name=search_term_string' }
    },
    {
      '@type': 'SoftwareApplication',
      '@id': `${SITE.url}/#software`,
      name: SITE.name,
      description: SITE.description,
      url: abs('/'),
      applicationCategory: 'DeveloperApplication',
      operatingSystem: 'Windows, macOS, Linux',
      softwareVersion: SITE.version,
      license: 'https://opensource.org/licenses/MIT',
      downloadUrl: SITE.npm,
      installUrl: SITE.npm,
      codeRepository: SITE.repo,
      keywords: SITE.keywords.join(', '),
      image: abs(SOCIAL.url),
      screenshot: abs('/images/walkthrough.png'),
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
      author: { '@id': PERSON['@id'] }
    },
    PERSON,
    {
      '@type': 'FAQPage',
      '@id': `${SITE.url}/#faq`,
      mainEntity: FAQ.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: stripHtml(a) } }))
    }
  ];
}

function landing({ assets, thumbs, stars }) {
  const kindCards = KINDS.map((k) => {
    const media = k.image
      ? `<img src="/images/${k.image}" width="${thumbs[k.image].w}" height="${thumbs[k.image].h}" alt="${esc(`${k.title}: a screenshot`)}" loading="lazy" decoding="async">`
      : k.page
      ? `<img src="/images/answer-page.png" width="${thumbs.answerPage.w}" height="${thumbs.answerPage.h}" alt="${esc(`${k.title}: an example answer page`)}" loading="lazy" decoding="async">`
      : themedImg(`/thumbs/${k.id}`, `${k.title}: an example diagram`, thumbs[k.id]);
    return `<li class="kind">
      <a href="${k.href || `/playground/#example=${k.id}`}">
        <span class="kind-media">${media}</span>
        <span class="kind-body"><span class="kind-title">${esc(k.title)}</span><span class="kind-text">${esc(k.text)}</span><span class="kind-link">Open in the playground ${ICON.arrow}</span></span>
      </a>
    </li>`;
  }).join('\n');

  const strip = STRIP.map(([id, name, tag]) => `<li><a class="ex" href="/playground/#example=${id}"><span class="ex-media">${themedImg(`/thumbs/${id}`, `${name} diagram`, thumbs[id])}</span><span class="ex-name">${esc(name)}</span><span class="ex-tag">${esc(tag)}</span></a></li>`).join('\n');
  const chips = PAGE_CHIPS.map(([id, name]) => `<li><a class="chip" href="/playground/#example=${id}">${esc(name)}</a></li>`).join('\n');
  const faq = FAQ.map(([q, a]) => `<details class="faq-item"><summary>${esc(q)}</summary>${a}</details>`).join('\n');
  const teaser = latestVideo('yantra-teaser');
  // [who, outcome, text, href, link label, image]
  const shot = (src, alt, w = 1200, h = 750) => `<img src="${src}" width="${w}" height="${h}" alt="${esc(alt)}" loading="lazy" decoding="async">`;
  const USES = [
    ['Developers', 'Understand a codebase', '"How does this work?", answered as a walkthrough instead of a wall of text.', guideUrl('coding-agents'), 'Diagrams from your codebase', shot('/images/kind-cloud-architecture.png', 'An order and payment pipeline explained as an architecture diagram', 960, 600)],
    ['Tech leads', 'Onboard a new hire', 'An architecture overview they can step through on day one, with detail diagrams a click away.', '/playground/#example=platform-overview', 'Open a platform overview', themedImg('/thumbs/platform-overview', 'A shop platform overview diagram', thumbs['platform-overview'])],
    ['SRE and on-call', 'Review an incident', 'The timeline, the cause and the fix on one page anyone can read.', '/playground/#example=answer-incident-review', 'Open an incident review', shot('/images/use-incident-review.png', 'An incident review answer page: the cause first, then the impact')],
    ['Product and operations', 'Make a decision', 'Options compared side by side, with the recommendation first.', '/playground/#example=answer-build-or-buy-crm', 'Open a decision record', shot('/images/use-decision.png', 'A build-or-buy decision page with the recommendation and three options')],
    ['Teachers and writers', 'Teach a lesson', 'Lessons and processes, one step or one chapter at a time.', '/playground/#example=book-checkout-explained', 'Open a book', shot('/images/kind-book.png', 'A book in book mode: the cover and its chapters', 960, 600)],
    ['Teams on Mermaid or draw.io', 'Upgrade the diagrams you have', 'Import what you already have and turn it into a story.', guideUrl('import'), 'Import a diagram', shot('/images/use-import.png', 'A Mermaid flowchart imported into Yantra, with groups and routed edges')]
  ];
  const starLabel = stars === null ? 'Star on GitHub' : `Star on GitHub <span class="count">${stars.toLocaleString('en-GB')}</span>`;

  const body = `<main id="main" class="landing">
<section class="hero">
  <div class="wrap hero-in">
    <div class="hero-copy">
      <div class="hero-badges">
        <span class="kicker">Open source · MIT · v${esc(SITE.version)}</span>
        <a class="star" href="${SITE.repo}">${ICON.github}<span>${starLabel}</span></a>
      </div>
      <h1>Make your AI show its work.</h1>
      <p class="lede"><strong>Diagrams that explain, one step at a time.</strong> Describe a system, a process or a decision, or ask your coding agent or AI chat to. Yantra lays it out, checks it and turns it into a walkthrough anyone can follow.</p>
      <div class="cta">
        <a class="btn btn-primary btn-lg" href="/playground/">Open the playground ${ICON.arrow}</a>
        <a class="btn btn-lg" href="#start">Get started</a>
      </div>
      <div class="hero-install">${codeBlock('npx @niyankhadka/yantra init', 'bash', 'Set up your coding agent')}</div>
    </div>
    ${teaser ? `<figure class="hero-media">
      <div class="player" data-player>
        <video controls playsinline preload="none" poster="/video/${teaser}.jpg" width="1920" height="1080">
          <source src="/video/${teaser}.mp4" type="video/mp4">
          <track kind="captions" src="/video/${teaser}.vtt" srclang="en" label="English">
          <a href="/video/${teaser}.mp4">Watch the 42-second tour</a>
        </video>
        <button class="player-play" type="button" hidden aria-label="Play the 42-second tour, with sound and captions">
          <span class="player-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="30" height="30"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.6-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z" fill="currentColor"/></svg></span>
          <span class="player-label" aria-hidden="true"><strong>Watch the tour</strong><span>0:42 · sound and captions</span></span>
        </button>
      </div>
    </figure>` : ''}
  </div>
  <div class="wrap">
    <div class="works-with">
      <p class="works-with-label">Works with</p>
      <ul>
${WORKS_WITH.map(([logo, name]) => `        <li>${logo ? brandLogo(logo) : FI.agent}<span>${esc(name)}</span></li>`).join('\n')}
      </ul>
    </div>
  </div>
</section>

<section class="section" id="problem" aria-labelledby="problem-title">
  <div class="wrap">
    <div class="section-intro">
      <p class="eyebrow">The problem</p>
      <h2 id="problem-title" class="section-title">Explaining a system shouldn't take all afternoon</h2>
      <p class="section-lede">Whether you draw it yourself or ask an AI, the result is usually slow, stale or wrong. Yantra changes each of those.</p>
    </div>
    <div class="compare">
      <p class="compare-head is-before" aria-hidden="true">Without Yantra</p>
      <p class="compare-head is-after" aria-hidden="true">With Yantra</p>
      <ul class="compare-rows">
${PAINS.map(([before, after]) => `        <li class="reveal"><p class="before"><span class="mark" aria-hidden="true">${FI.cross}</span><span><span class="sr-only">Without Yantra: </span>${before}</span></p><span class="compare-arrow" aria-hidden="true">${ICON.arrow}</span><p class="after"><span class="mark" aria-hidden="true">${FI.tick}</span><span><span class="sr-only">With Yantra: </span>${after}</span></p></li>`).join('\n')}
      </ul>
    </div>
  </div>
</section>

<section class="section section-alt" id="how" aria-labelledby="how-title">
  <div class="wrap">
    <div class="section-intro">
      <p class="eyebrow">How it works</p>
      <h2 id="how-title" class="section-title">Describe it. Yantra does the rest.</h2>
      <p class="section-lede">Four steps from a question to an explanation anyone can follow.</p>
    </div>
    <div class="stepper" data-tabs data-autoplay="6000">
      <div class="stepper-list" role="tablist" aria-orientation="vertical" aria-label="How Yantra works">
${STEPS.map(([id, title, text], i) => `        <button type="button" role="tab" id="step-${id}" aria-controls="stage-${id}" aria-selected="${i === 0}"${i ? ' tabindex="-1"' : ''}><span class="step-n" aria-hidden="true">${i + 1}</span><span class="step-text"><strong>${esc(title)}</strong><span>${esc(text)}</span></span><span class="step-bar" aria-hidden="true"></span></button>`).join('\n')}
      </div>
      <div class="stepper-stage">
        <div class="tabpanel" role="tabpanel" id="stage-describe" aria-labelledby="step-describe" tabindex="0">
          <h3 class="tab-h">1. Describe it</h3>
          ${codeBlock('{\n  "meta": { "title": "Checkout" },\n  "nodes": [\n    { "id": "web", "data": { "title": "Web app" } },\n    { "id": "api", "data": { "title": "Orders API" } },\n    { "id": "db", "data": { "title": "Orders DB" } }\n  ],\n  "edges": [\n    { "id": "e1", "source": "web", "target": "api", "label": "POST /orders" },\n    { "id": "e2", "source": "api", "target": "db", "label": "INSERT" }\n  ],\n  "steps": [\n    { "title": "Overview" },\n    { "title": "Submit", "highlightNodes": ["web", "api"] }\n  ]\n}', 'json', 'checkout.json')}
        </div>
        <div class="tabpanel" role="tabpanel" id="stage-check" aria-labelledby="step-check" tabindex="0">
          <h3 class="tab-h">2. Yantra checks it</h3>
          <div class="term" role="img" aria-label="Terminal: yantra validate reports that edge api-db targets dbx, which is not a node; after the fix it reports that checkout.json is valid.">
            <p><span class="t-p">$</span> yantra validate checkout.json</p>
            <p>&nbsp;&nbsp;<span class="t-err">error</span>&nbsp;&nbsp;<span class="t-dim">ref/edge-unknown-target</span></p>
            <p>&nbsp;&nbsp;Edge "api-db" target "dbx" is not a node.</p>
            <p><span class="t-err">✗ checkout.json: 1 error</span></p>
            <p class="t-gap"><span class="t-p">$</span> yantra validate checkout.json</p>
            <p><span class="t-ok">✓ checkout.json is valid</span></p>
          </div>
        </div>
        <div class="tabpanel" role="tabpanel" id="stage-step" aria-labelledby="step-step" tabindex="0">
          <h3 class="tab-h">3. Readers step through it</h3>
          <img class="stage-shot" src="/images/walkthrough.png" width="1400" height="860" alt="A cloud architecture diagram at step 3 of its walkthrough: two cards are highlighted, the rest are dimmed, and the storyboard below describes the step." loading="lazy" decoding="async">
        </div>
        <div class="tabpanel" role="tabpanel" id="stage-share" aria-labelledby="step-share" tabindex="0">
          <h3 class="tab-h">4. Share it anywhere</h3>
          <div class="share">
            <div class="share-file"><span class="share-icon" aria-hidden="true">${FI.file}</span><div><strong>checkout.html</strong><span>One file · no network requests · opens anywhere</span></div></div>
            <p class="share-label">Or export</p>
            <ul class="share-chips"><li>SVG</li><li>PNG</li><li>Markdown</li></ul>
            <p class="share-label">Link to one step</p>
            <code class="share-link">checkout.html#step=3&amp;theme=dark</code>
          </div>
        </div>
      </div>
    </div>
  </div>
</section>

<section class="section demo" aria-labelledby="demo-title">
  <div class="wrap">
    <div class="section-head">
      <div>
        <p class="eyebrow">Try it</p>
        <h2 id="demo-title" class="section-title">Step through a real one</h2>
        <p class="section-lede">This is the actual file <code>yantra build</code> writes, running right here.</p>
      </div>
      <a class="btn" href="/playground/#example=cloud-architecture">Edit it in the playground ${ICON.arrow}</a>
    </div>
    <div class="demo-frame">
      <div class="demo-bar">
        <span class="dots" aria-hidden="true"><i></i><i></i><i></i></span>
        <p class="demo-file">cloud-architecture.html <span class="muted">· live</span></p>
      </div>
      <div class="demo-stage" data-demo="/demo/cloud-architecture.html">
        <div class="demo-poster" aria-hidden="true">${themedImg('/thumbs/cloud-architecture', '', thumbs['cloud-architecture'])}</div>
        <button class="btn btn-primary demo-load" type="button">Load the live demo</button>
        <noscript><p class="demo-noscript">The live demo needs JavaScript. <a href="/demo/cloud-architecture.html">Open the file on its own</a>.</p></noscript>
      </div>
    </div>
    <p class="demo-hint">Use <kbd>→</kbd> and <kbd>←</kbd> to step through, click a card to inspect it, <kbd>V</kbd> for the sequence view and <kbd>?</kbd> for every shortcut.</p>
  </div>
</section>

<section class="section section-alt" id="features" aria-labelledby="features-title">
  <div class="wrap">
    <div class="section-intro">
      <p class="eyebrow">Features</p>
      <h2 id="features-title" class="section-title">Everything an explanation needs</h2>
      <p class="section-lede">One format and one viewer for every kind of explanation, and the tools to write it with or without AI.</p>
    </div>
    <ul class="bento">
${FEATURES.map(([icon, title, text], i) => `      <li class="feat reveal${i === 0 ? ' feat-wide' : ''}"><div class="feat-body"><span class="feat-icon" aria-hidden="true">${FI[icon]}</span><h3>${esc(title)}</h3><p>${text}</p></div>${i === 0 ? `<div class="feat-media">${themedImg('/thumbs/aws-serverless', 'An AWS serverless diagram laid out automatically, with nested groups and routed edges', thumbs['aws-serverless'])}</div>` : ''}</li>`).join('\n')}
    </ul>
  </div>
</section>

<section class="section" id="use-cases" aria-labelledby="uses-title">
  <div class="wrap">
    <div class="section-intro">
      <p class="eyebrow">Use cases</p>
      <h2 id="uses-title" class="section-title">What people explain with Yantra</h2>
      <p class="section-lede">The same walkthrough works for a codebase, an incident, a decision or a lesson.</p>
    </div>
    <ul class="uses">
${USES.map(([who, title, text, href, link, img]) => `      <li class="use reveal"><a href="${href}"><span class="use-media">${img}</span><span class="use-body"><span class="use-who">${esc(who)}</span><span class="use-title">${esc(title)}</span><span class="use-text">${esc(text)}</span><span class="use-link">${esc(link)} ${ICON.arrow}</span></span></a></li>`).join('\n')}
    </ul>
  </div>
</section>

<section class="section section-alt" aria-labelledby="kinds-title">
  <div class="wrap">
    <div class="section-intro">
      <p class="eyebrow">Diagram kinds</p>
      <h2 id="kinds-title" class="section-title">One format, every kind of diagram</h2>
      <p class="section-lede">Every kind shares the same viewer: walkthroughs, an inspector, folding, light and dark themes, 18 interface languages and full keyboard control.</p>
    </div>
    <ul class="kinds">
${kindCards}
    </ul>
  </div>
</section>

<section class="section" id="start" aria-labelledby="start-title">
  <div class="wrap">
    <div class="section-intro">
      <p class="eyebrow">Get started</p>
      <h2 id="start-title" class="section-title">Start in a minute, your way</h2>
      <p class="section-lede">Every route writes the same JSON and builds the same file. The CLI needs Node.js 20.19 or later; the playground needs only a browser.</p>
    </div>
    <div class="tabs" data-tabs>
      <div class="tablist" role="tablist" aria-label="Ways to use Yantra">
        <button type="button" role="tab" id="tab-agent" aria-controls="panel-agent" aria-selected="true">${FI.agent}<span>Coding agent</span></button>
        <button type="button" role="tab" id="tab-chat" aria-controls="panel-chat" aria-selected="false" tabindex="-1">${FI.chat}<span>AI chat</span></button>
        <button type="button" role="tab" id="tab-cli" aria-controls="panel-cli" aria-selected="false" tabindex="-1">${FI.terminal}<span>Command line</span></button>
        <button type="button" role="tab" id="tab-python" aria-controls="panel-python" aria-selected="false" tabindex="-1">${brandLogo('python')}<span>Python</span></button>
      </div>
      <div class="tabpanel" role="tabpanel" id="panel-agent" aria-labelledby="tab-agent" tabindex="0">
        <h3 class="tab-h">Coding agent</h3>
        <ol class="steps">
          <li><strong>Set up your project.</strong> One command adds the Yantra skill, the MCP server and short rules for Claude Code, Cursor, Codex or Antigravity.${codeBlock('npx @niyankhadka/yantra init', 'bash')}</li>
          <li><strong>Ask for an explanation.</strong> For example: <em>"Explain how our checkout works as a Yantra diagram."</em> The agent reads your code, writes the JSON and fixes anything the validator finds.</li>
          <li><strong>Open the HTML file it builds,</strong> and step through it.</li>
        </ol>
        <a class="more" href="${guideUrl('coding-agents')}">Diagrams from your codebase ${ICON.arrow}</a>
      </div>
      <div class="tabpanel" role="tabpanel" id="panel-chat" aria-labelledby="tab-chat" tabindex="0">
        <h3 class="tab-h">AI chat</h3>
        <ol class="steps">
          <li><strong>Open the playground</strong> and press <em>Copy prompt for your chat</em>.</li>
          <li><strong>Paste it into Claude.ai, ChatGPT, Gemini or any chat,</strong> and ask for a diagram or an answer page.</li>
          <li><strong>Paste the JSON back</strong> to check it, see it and download the file. Everything runs in your browser.</li>
        </ol>
        <div class="cta"><a class="btn btn-primary" href="/playground/">Open the playground ${ICON.arrow}</a><a class="more" href="${guideUrl('chat')}">Use with AI chats ${ICON.arrow}</a></div>
      </div>
      <div class="tabpanel" role="tabpanel" id="panel-cli" aria-labelledby="tab-cli" tabindex="0">
        <h3 class="tab-h">Command line</h3>
        ${codeBlock('npm i -g @niyankhadka/yantra    # or run any command with npx\nyantra new diagram.json         # a starter (--page, --book, --kind sequence...)\nyantra validate diagram.json    # checks references, story and layout\nyantra build diagram.json       # -> diagram.html', 'bash')}
        <p>Already have diagrams? <code>yantra import flow.mmd</code> reads Mermaid, PlantUML, draw.io and Visio.</p>
        <a class="more" href="${guideUrl('first-diagram')}">Install and your first diagram ${ICON.arrow}</a>
      </div>
      <div class="tabpanel" role="tabpanel" id="panel-python" aria-labelledby="tab-python" tabindex="0">
        <h3 class="tab-h">Python</h3>
        ${codeBlock('pip install niyankhadka-yantra', 'bash')}
        <p>Build diagrams, answer pages and books in Python with no third-party dependencies, then validate and build them through the CLI.</p>
        <a class="more" href="${guideUrl('python')}">Python SDK ${ICON.arrow}</a>
      </div>
    </div>
  </div>
</section>

<section class="section" aria-labelledby="examples-title" id="examples">
  <div class="wrap">
    <div class="section-head">
      <div>
        <h2 id="examples-title" class="section-title">Examples</h2>
        <p class="section-lede">25 diagrams, 13 answer pages and 7 chart pages ship with Yantra. Open any of them in the playground, then change it. Companies and data in the examples are fictional.</p>
      </div>
      <a class="btn" href="/playground/">Browse all in the playground</a>
    </div>
    <ul class="strip" aria-label="Diagram examples">
${strip}
    </ul>
    <h3 class="chips-title">Answer pages and dashboards</h3>
    <ul class="chips">
${chips}
    </ul>
  </div>
</section>

<section class="section section-alt" aria-labelledby="faq-title">
  <div class="wrap wrap-narrow">
    <h2 id="faq-title" class="section-title">Questions</h2>
    <div class="faq">
${faq}
    </div>
  </div>
</section>

<section class="section closing">
  <div class="wrap closing-in">
    <h2>Don't draw it. Explain it.</h2>
    <p class="closing-lede">Describe your next system, process or decision, and let readers step through it.</p>
    <div class="cta">
      <a class="btn btn-primary" href="/playground/">Open the playground ${ICON.arrow}</a>
      <a class="btn" href="#start">Get started</a>
      <a class="btn btn-ghost" href="/docs/">Read the docs</a>
    </div>
  </div>
</section>
</main>`;
  return layout({
    path: '/',
    title: SITE.name,
    description: LANDING_DESCRIPTION,
    body,
    current: 'home',
    jsonLd: landingJsonLd(),
    assets,
    bodyClass: 'is-landing',
    head: `<script>${FORWARD_SCRIPT}</script>\n`
  });
}

// --- docs ----------------------------------------------------------------------------
function loadDocs() {
  const all = [
    ...GUIDES.map((g) => ({ ...g, section: 'Guides', url: guideUrl(g.slug) })),
    ...referencePages().map((r) => ({ ...r, section: 'Reference', url: referenceUrl(r.slug) }))
  ];
  const broken = [];
  for (const d of all) {
    const r = renderMarkdown(read(d.file), d.file);
    Object.assign(d, r, { nav: d.nav || r.nav || r.title });
    broken.push(...r.broken);
  }
  if (broken.length) throw new Error(`Broken links in the docs:\n  ${broken.join('\n  ')}`);
  return all;
}

function sidebar(docs, currentUrl) {
  const section = (name) => `<div class="side-section"><h2>${name}</h2><ul>${docs
    .filter((d) => d.section === name)
    .map((d) => `<li><a href="${d.url}"${d.url === currentUrl ? ' aria-current="page"' : ''}>${esc(d.nav)}</a></li>`)
    .join('')}</ul></div>`;
  return `<aside class="sidebar" id="docs-nav" aria-label="Documentation">
  <div class="sidebar-in">
    <div class="search" role="search">
      <label class="sr-only" for="docs-search">Search the docs</label>
      <span class="search-icon" aria-hidden="true">${ICON.search}</span>
      <input id="docs-search" type="search" placeholder="Search the docs" autocomplete="off" spellcheck="false" aria-describedby="search-hint" aria-controls="search-results">
      <kbd class="search-key" aria-hidden="true">/</kbd>
      <p id="search-hint" class="sr-only">Results appear below as you type.</p>
      <div id="search-results" class="search-results" hidden></div>
    </div>
    <ul class="side-top"><li><a href="/docs/"${currentUrl === '/docs/' ? ' aria-current="page"' : ''}>Overview</a></li></ul>
    ${section('Guides')}
    ${section('Reference')}
  </div>
</aside>`;
}

function docsShell(docs, { url, article, toc = '' }) {
  return `<main id="main" class="docs-main">
<div class="docs-bar">
  <button class="btn btn-small docs-menu" type="button" aria-expanded="false" aria-controls="docs-nav">${ICON.menu}<span>Menu</span></button>
</div>
<div class="docs${toc ? '' : ' no-toc'}">
${sidebar(docs, url)}
<div class="docs-scrim" hidden></div>
${article}
${toc}
</div>
</main>`;
}

function tocOf(doc) {
  const items = doc.headings.filter((h) => h.depth === 2 || h.depth === 3);
  if (items.length < 2) return '';
  return `<nav class="toc" aria-labelledby="toc-title"><div class="toc-in"><h2 id="toc-title">On this page</h2><ul>${items
    .map((h) => `<li class="toc-${h.depth}"><a href="#${h.id}">${esc(h.text)}</a></li>`)
    .join('')}</ul></div></nav>`;
}

/** "Related guides" at the end of a guide (content.js `related`). */
function relatedGuides(docs, doc) {
  const items = (doc.related || []).map((slug) => docs.find((d) => d.url === guideUrl(slug))).filter(Boolean);
  if (!items.length) return '';
  return `<nav class="related" aria-labelledby="related-title"><h2 id="related-title">Related guides</h2><ul class="cards">${items
    .map((d) => `<li><a href="${d.url}"><span class="card-title">${esc(d.nav)}</span><span class="card-text">${esc(d.description)}</span></a></li>`)
    .join('')}</ul></nav>`;
}

function docPage(docs, i, assets) {
  const doc = docs[i];
  const prev = docs[i - 1];
  const next = docs[i + 1];
  const edit = `${SITE.repo}/edit/${SITE.branch}/${doc.file}`;
  const article = `<article class="prose doc">
  <p class="crumbs"><a href="/docs/">Docs</a> <span aria-hidden="true">/</span> ${doc.section}</p>
  ${doc.html}
  ${relatedGuides(docs, doc)}
  <div class="doc-foot">
    <a class="edit" href="${edit}">${ICON.edit}<span>Edit this page on GitHub</span></a>
  </div>
  <nav class="prevnext" aria-label="Previous and next">
    ${prev ? `<a class="prev" href="${prev.url}"><span>Previous</span>${esc(prev.nav)}</a>` : '<span></span>'}
    ${next ? `<a class="next" href="${next.url}"><span>Next</span>${esc(next.nav)}</a>` : '<span></span>'}
  </nav>
</article>`;
  const modified = lastModified(doc.file);
  return layout({
    path: doc.url,
    title: doc.title,
    description: doc.description,
    ogType: 'article',
    modified,
    jsonLd: [
      {
        '@type': 'TechArticle',
        '@id': `${abs(doc.url)}#article`,
        headline: doc.title,
        description: doc.description,
        url: abs(doc.url),
        mainEntityOfPage: abs(doc.url),
        dateModified: modified,
        inLanguage: 'en',
        image: abs(SOCIAL.url),
        author: PERSON,
        publisher: PERSON,
        about: { '@type': 'SoftwareApplication', name: SITE.name, url: abs('/') },
        isPartOf: { '@type': 'WebSite', name: SITE.name, url: abs('/') }
      },
      breadcrumbs([['Home', '/'], ['Docs', '/docs/'], [doc.section, doc.section === 'Guides' ? '/docs/#guides' : '/docs/#reference'], [doc.nav, doc.url]])
    ],
    body: docsShell(docs, { url: doc.url, article, toc: tocOf(doc) }),
    current: 'docs',
    assets,
    bodyClass: 'is-docs'
  });
}

function docsIndex(docs, assets) {
  const cards = (name) => docs
    .filter((d) => d.section === name)
    .map((d) => `<li><a href="${d.url}"><span class="card-title">${esc(d.nav)}</span><span class="card-text">${esc(d.description)}</span></a></li>`)
    .join('\n');
  const article = `<article class="prose doc docs-index">
  <h1 id="documentation">Documentation</h1>
  <p class="lede">Start with a guide, then keep the reference open while you work. The reference pages are the same files as <code>docs/</code> in the repository, so they always match the release.</p>
  <h2 id="guides"><a class="anchor" href="#guides" aria-hidden="true" tabindex="-1">#</a>Guides</h2>
  <ul class="cards">${cards('Guides')}</ul>
  <h2 id="reference"><a class="anchor" href="#reference" aria-hidden="true" tabindex="-1">#</a>Reference</h2>
  <ul class="cards">${cards('Reference')}</ul>
</article>`;
  return layout({
    path: '/docs/',
    title: 'Documentation',
    description: 'Guides and reference for Yantra: install, your first diagram, coding agents, answer pages, imports, AI chats, the Python SDK, sharing and self-hosting.',
    jsonLd: [
      {
        '@type': 'CollectionPage',
        '@id': `${abs('/docs/')}#page`,
        name: 'Yantra documentation',
        url: abs('/docs/'),
        dateModified: lastModified(...docs.map((d) => d.file)),
        inLanguage: 'en',
        hasPart: docs.map((d) => ({ '@type': 'TechArticle', headline: d.title, url: abs(d.url) }))
      },
      breadcrumbs([['Home', '/'], ['Docs', '/docs/']])
    ],
    body: docsShell(docs, { url: '/docs/', article }),
    current: 'docs',
    assets,
    bodyClass: 'is-docs'
  });
}

function notFound(assets) {
  const body = `<main id="main" class="notfound">
  <div class="wrap wrap-narrow">
    <p class="kicker">404</p>
    <h1>This page is not here.</h1>
    <p class="lede">The address may be old or mistyped. The playground moved to <a href="/playground/">/playground/</a>; the docs live under <a href="/docs/">/docs/</a>.</p>
    <div class="cta">
      <a class="btn btn-primary" href="/">Home</a>
      <a class="btn" href="/docs/">Documentation</a>
      <a class="btn" href="/playground/">Playground</a>
    </div>
  </div>
</main>`;
  return layout({ path: '/404.html', title: 'Page not found', description: 'This page does not exist on the Yantra website.', body, current: '', assets, bodyClass: 'is-404', noindex: true });
}

function searchIndex(docs) {
  return JSON.stringify(docs.map((d) => ({
    t: d.title,
    n: d.nav,
    u: d.url,
    s: d.sections.map((s) => ({ i: s.id, h: s.title, x: s.text.length > 1000 ? `${s.text.slice(0, 1000)}…` : s.text }))
  })));
}

function sitemap(entries) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.map(([u, d]) => `  <url><loc>${abs(u)}</loc><lastmod>${d.slice(0, 10)}</lastmod></url>`).join('\n')}
</urlset>
`;
}

// --- everything ------------------------------------------------------------------------
const THUMB_IDS = [...new Set([...KINDS.filter((k) => !k.page && !k.image).map((k) => k.id), ...STRIP.map(([id]) => id)])];

/** Static files that do not depend on the built assets (computed once per build). */
export function staticFiles() {
  const files = {};
  const thumbs = {};
  for (const id of THUMB_IDS) {
    const view = KINDS.find((k) => k.id === id)?.view;
    for (const theme of ['light', 'dark']) {
      const svg = thumbnail(id, theme, view);
      files[`thumbs/${id}-${theme}.svg`] = svg;
      thumbs[id] = thumbSize(svg);
    }
  }
  for (const f of fs.readdirSync(path.join(ROOT, 'docs', 'images')).filter((x) => x !== 'social-preview.png')) files[`images/${f}`] = fs.readFileSync(path.join(ROOT, 'docs', 'images', f));
  const png = files['images/answer-page.png'];
  thumbs.answerPage = { w: png.readUInt32BE(16), h: png.readUInt32BE(20) };
  for (const k of KINDS.filter((x) => x.image)) {
    const img = files[`images/${k.image}`];
    thumbs[k.image] = { w: img.readUInt32BE(16), h: img.readUInt32BE(20) };
  }
  files['social-preview.png'] = fs.readFileSync(path.join(ROOT, 'docs', 'images', 'social-preview.png'));
  for (const f of ['apple-touch-icon.png', 'icon-192.png', 'icon-512.png']) files[f] = fs.readFileSync(path.join(ROOT, 'site', 'assets', f));
  // promo videos, posters and the README preview, served at /video/; the newest poster and preview
  // also at stable addresses (/video/<name>.jpg, /video/yantra-teaser-preview.webp) so the README
  // never needs a version bump
  if (fs.existsSync(VIDEO_DIR)) for (const f of fs.readdirSync(VIDEO_DIR).filter((x) => /\.(mp4|jpg|webp|vtt)$/.test(x))) files[`video/${f}`] = fs.readFileSync(path.join(VIDEO_DIR, f));
  for (const name of ['yantra-teaser', 'yantra-teaser-vertical']) {
    const latest = latestVideo(name);
    if (latest && files[`video/${latest}.jpg`]) files[`video/${name}.jpg`] = files[`video/${latest}.jpg`];
  }
  const teaser = latestVideo('yantra-teaser');
  const preview = teaser && `video/${teaser.replace('yantra-teaser-', 'yantra-teaser-preview-')}.webp`;
  if (preview && files[preview]) files['video/yantra-teaser-preview.webp'] = files[preview];
  files['manifest.webmanifest'] = `${JSON.stringify({
    name: 'Yantra',
    short_name: 'Yantra',
    description: SITE.tagline,
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#f6f6f3',
    theme_color: '#f6f6f3',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/logo-light.svg', sizes: 'any', type: 'image/svg+xml' }
    ]
  }, null, 2)}\n`;
  files['logo-light.svg'] = read('src/assets/logo-light.svg');
  files['logo-dark.svg'] = read('src/assets/logo-dark.svg');
  const demo = path.join(ROOT, 'examples', 'cloud-architecture.json');
  files['demo/cloud-architecture.html'] = buildHtml(resolveLevels(JSON.parse(fs.readFileSync(demo, 'utf-8')), path.dirname(demo), { root: ROOT }));
  files['robots.txt'] = `User-agent: *\nAllow: /\n\nSitemap: ${abs('/sitemap.xml')}\n`;
  files['.nojekyll'] = '';
  return { files, thumbs };
}

/** Every site file: pages, search index, sitemap and the static files. */
export async function siteFiles({ assets, statics = staticFiles() }) {
  const docs = loadDocs();
  const stars = await starCount();
  const files = { ...statics.files };
  files['index.html'] = landing({ assets, thumbs: statics.thumbs, stars });
  files['docs/index.html'] = docsIndex(docs, assets);
  docs.forEach((d, i) => {
    files[`${d.url.slice(1)}index.html`] = docPage(docs, i, assets);
  });
  files['404.html'] = notFound(assets);
  files['docs/search-index.json'] = searchIndex(docs);
  files['sitemap.xml'] = sitemap([
    ['/', lastModified('site/build/pages.js', 'site/build/content.js', 'package.json')],
    ['/playground/', lastModified('playground/index.html', 'playground/main.js', 'playground/prompt.js', 'playground/style.css')],
    ['/docs/', lastModified(...docs.map((d) => d.file))],
    ...docs.map((d) => [d.url, lastModified(d.file)])
  ]);
  return files;
}
