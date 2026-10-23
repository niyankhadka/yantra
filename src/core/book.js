/**
 * Books: several answer pages (chapters) read in order, in one offline file.
 * A cover (title, summary, contents) comes first; each chapter keeps the page
 * rules (its answer first, then blocks). Rendering reuses page.js, with each
 * chapter's anchors and SVG ids prefixed (c1-, c2-, ...) so they stay unique,
 * and the reader (reader.js) adds the book and present modes. Pure strings.
 */
import { escapeHtml as h, mdInline as mi, mdBlock } from './text.js';
import { pageParts, pageDocument, pageContents, pageToMarkdown, readKey, inline, isBook, md, detailSections } from './page.js';
import { detailsOf } from './details.js';
import { localeOf } from './i18n.js';

export { isBook };

/** Chapters past this many are a budget warning (a longer book is documentation). */
export const BOOK_BUDGET = { chapters: 12 };

const list = (v) => (Array.isArray(v) ? v : []);
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/** A chapter as a page: its own meta, with the book's language when it sets none. */
export function chapterPage(chapter, bookMeta = {}) {
  const c = isObj(chapter) ? chapter : {};
  const meta = isObj(c.meta) ? c.meta : {};
  const lang = meta.lang ? {} : { ...(bookMeta.lang ? { lang: bookMeta.lang } : {}), ...(bookMeta.dir ? { dir: bookMeta.dir } : {}), ...(bookMeta.strings ? { strings: bookMeta.strings } : {}) };
  return { ...c, kind: 'page', meta: { ...lang, ...meta } };
}

/** Chapter id (anchor) and title, and the titled blocks under it, for the contents menu. */
export function bookContents(book) {
  return list(book?.chapters).map((ch, i) => {
    const page = chapterPage(ch, book.meta);
    const prefix = `c${i + 1}-`;
    const { anchors } = pageContents(page, prefix);
    const items = list(page.blocks)
      .map((b, k) => (anchors[k] ? { id: anchors[k], title: plainTitle(b.title) } : null))
      .filter(Boolean);
    return { id: `c${i + 1}`, title: plainTitle(page.meta.title || page.meta.question || ''), items };
  });
}

const plainTitle = (t) => String(t ?? '').replace(/[*`]/g, '').trim();

export const BOOK_CSS = `
.p-cover .p-title{font-size:clamp(30px,5vw,46px)}
.p-cover-list{margin:22px 0 0;padding:18px 22px;border:1px solid var(--y-border);border-radius:12px;background:var(--y-surface)}
.p-cover-list ol{margin:8px 0 0;padding:0;list-style:none;counter-reset:ch}
.p-cover-list li{counter-increment:ch;display:flex;gap:10px;padding:6px 0;border-top:1px solid var(--y-border)}
.p-cover-list li:first-child{border-top:0}
.p-cover-list li::before{content:counter(ch);flex:none;width:22px;color:var(--y-ink-3);font-weight:700;font-variant-numeric:tabular-nums}
.p-cover-list a{color:var(--y-ink);font-weight:600;text-decoration:none}
.p-cover-list a:hover{color:var(--y-accent)}
.p-chapter{margin-top:64px;padding-top:30px;border-top:2px solid var(--y-border)}
.p-chapter>.p-lead{scroll-margin-top:16px}
.p-chapter-kicker{margin:0 0 6px;color:var(--y-accent);font-size:12px;font-weight:700;letter-spacing:.1em;text-transform:uppercase}
:root[dir="rtl"] .p-chapter-kicker{letter-spacing:0}
:root[data-read="book"] .p-chapter,:root[data-read="present"] .p-chapter{margin-top:0;padding-top:0;border-top:0}
@media print{.p-chapter{break-before:page;margin-top:0;border-top:0}}
`;

/**
 * @param book    book payload (chapter `$ref`s and diagram `src`s already resolved)
 * @param options { logos, viewerHtml, frameSandbox } as for renderPage
 */
export function renderBook(book, { logos = {}, viewerHtml = null, frameSandbox = null } = {}) {
  const meta = isObj(book.meta) ? book.meta : {};
  const L = localeOf(meta);
  const contents = bookContents(book);
  const byline = [meta.author, meta.date].filter(Boolean).map(h).join(' · ');
  const cover = `<div class="p-lead p-cover">
    <div class="p-lead-head">
    <h1 class="p-title">${inline(meta.title || '')}</h1>
    ${meta.description ? `<p class="p-subtitle">${inline(meta.description)}</p>` : ''}
    ${byline ? `<p class="p-byline">${byline}</p>` : ''}
    </div>
    ${book.summary ? `<section class="p-answer" aria-label="${h(L.t('book.summary'))}"><span class="p-label">${h(L.t('book.summary'))}</span>${md(book.summary)}</section>` : ''}
    ${contents.length ? `<nav class="p-cover-list" aria-label="${h(L.t('page.contents'))}"><span class="p-label">${h(L.t('page.contents'))}</span><ol>${contents.map((c) => `<li><a href="#${h(c.id)}">${h(c.title)}</a></li>`).join('')}</ol></nav>` : ''}
  </div>`;
  // Each chapter's detail pages (keys c1-id, c2-id, ...) come after the book, shown one at a time
  const details = [];
  const chapters = list(book.chapters)
    .map((ch, i) => {
      const n = i + 1;
      const page = chapterPage(ch, meta);
      const keyPrefix = `c${n}-`;
      const parts = pageParts(page, { viewerHtml, frameSandbox, prefix: `c${n}-`, level: 2, kicker: L.t('book.chapter', { n: L.num(n) }), details: detailsOf(page), detailKey: (id) => `${keyPrefix}${id}` });
      details.push(detailSections(page, { viewerHtml, frameSandbox, prefix: `c${n}-`, keyPrefix, homeHref: `#c${n}`, homeTitle: page.meta.title || page.meta.question || '' }));
      return `<section class="p-chapter" id="c${n}" data-chapter="${n}">
  ${parts.lead}
  ${parts.grid}
</section>`;
    })
    .join('\n');
  return pageDocument({
    meta,
    L,
    logos,
    body: `<div class="p-main">\n${cover}\n${chapters}\n</div>\n${details.join('\n')}`,
    title: meta.title || L.t('page.answer'),
    description: meta.description || book.summary || '',
    kicker: meta.kicker || '',
    start: meta.reading || 'book',
    key: readKey(`${meta.title || ''}\n${contents.map((c) => c.title).join('\n')}`),
    contents,
    book: true,
    css: BOOK_CSS
  });
}

/** Markdown version of a book: the cover, contents, then every chapter one heading level down. */
export function bookToMarkdown(book) {
  const meta = isObj(book?.meta) ? book.meta : {};
  const L = localeOf(meta);
  const contents = bookContents(book);
  const out = [`# ${mi(meta.title || '')}`, ''];
  if (meta.description) out.push(`*${mi(meta.description)}*`, '');
  if (book.summary) out.push(mdBlock(book.summary), '');
  if (contents.length) out.push(`**${mi(L.t('page.contents'))}**`, '', ...contents.map((c, i) => `${i + 1}. [${mi(c.title)}](#${c.id})`), '');
  list(book.chapters).forEach((ch, i) => {
    out.push(pageToMarkdown(chapterPage(ch, meta), { base: 1, prefix: `c${i + 1}-`, kicker: L.t('book.chapter', { n: L.num(i + 1) }), detailKey: (id) => `c${i + 1}-${id}` }).trim(), '');
  });
  return `${out.join('\n').replace(/\n{3,}/g, '\n\n')}\n`;
}
