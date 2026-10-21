/**
 * Docs search: a small index built at build time (/docs/search-index.json: page title,
 * URL and each section's heading and text) and a plain scoring loop. Every query term must
 * appear in the section, its heading or the page title; headings and titles weigh more.
 * Results are built with DOM methods (textContent), never HTML strings.
 */
let index = null;

async function loadIndex() {
  if (index) return index;
  const res = await fetch('/docs/search-index.json');
  if (!res.ok) throw new Error(`search index: HTTP ${res.status}`);
  const pages = await res.json();
  index = [];
  for (const p of pages) {
    for (const s of p.s) {
      index.push({ page: p.n || p.t, title: p.t, url: s.i ? `${p.u}#${s.i}` : p.u, heading: s.h, text: s.x, hl: s.h.toLowerCase(), tl: (p.t + ' ' + p.n).toLowerCase(), xl: s.x.toLowerCase() });
    }
  }
  return index;
}

const terms = (q) => q.toLowerCase().split(/[\s,]+/).filter((t) => t.length > 1 || /\d/.test(t));

export function search(entries, query, limit = 8) {
  const ts = terms(query);
  if (!ts.length) return [];
  const scored = [];
  for (const e of entries) {
    let score = 0;
    let ok = true;
    for (const t of ts) {
      const inH = e.hl.includes(t);
      const inT = e.tl.includes(t);
      const inX = e.xl.includes(t);
      if (!inH && !inT && !inX) {
        ok = false;
        break;
      }
      score += (inH ? 8 : 0) + (inT ? 3 : 0) + (inX ? 1 : 0);
      if (e.hl.startsWith(t)) score += 4;
    }
    if (ok) scored.push([score, e]);
  }
  scored.sort((a, b) => b[0] - a[0]);
  return scored.slice(0, limit).map(([, e]) => e);
}

function snippet(text, ts) {
  const lower = text.toLowerCase();
  let at = -1;
  for (const t of ts) {
    const i = lower.indexOf(t);
    if (i >= 0 && (at < 0 || i < at)) at = i;
  }
  const start = Math.max(0, at - 40);
  const s = (start > 0 ? '…' : '') + text.slice(start, start + 140) + (text.length > start + 140 ? '…' : '');
  return s;
}

/** Highlight query terms in `text` inside `el` with <mark>, using text nodes only. */
function fillMarked(el, text, ts) {
  const re = ts.length ? new RegExp(`(${ts.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi') : null;
  if (!re) {
    el.textContent = text;
    return;
  }
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index > last) el.append(document.createTextNode(text.slice(last, m.index)));
    const mark = document.createElement('mark');
    mark.textContent = m[0];
    el.append(mark);
    last = m.index + m[0].length;
  }
  if (last < text.length) el.append(document.createTextNode(text.slice(last)));
}

export function attach(input, box) {
  let timer = 0;
  const render = async () => {
    const q = input.value.trim();
    box.replaceChildren();
    if (!q) {
      box.hidden = true;
      return;
    }
    let entries;
    try {
      entries = await loadIndex();
    } catch {
      box.hidden = false;
      const p = document.createElement('p');
      p.className = 'search-empty';
      p.textContent = 'Search is unavailable right now.';
      box.append(p);
      return;
    }
    if (input.value.trim() !== q) return;
    const ts = terms(q);
    const hits = search(entries, q);
    box.hidden = false;
    const status = document.createElement('p');
    status.className = 'search-status';
    status.setAttribute('role', 'status');
    status.textContent = hits.length ? `${hits.length} result${hits.length === 1 ? '' : 's'}` : `No results for “${q}”`;
    box.append(status);
    if (!hits.length) return;
    const ul = document.createElement('ul');
    for (const h of hits) {
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.href = h.url;
      const head = document.createElement('span');
      head.className = 'sr-head';
      fillMarked(head, h.heading, ts);
      const page = document.createElement('span');
      page.className = 'sr-page';
      page.textContent = h.page;
      const text = document.createElement('span');
      text.className = 'sr-text';
      fillMarked(text, snippet(h.text, ts), ts);
      a.append(head, page, text);
      li.append(a);
      ul.append(li);
    }
    box.append(ul);
  };
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(render, 80);
  });
  input.addEventListener('keydown', (e) => {
    const links = [...box.querySelectorAll('a')];
    if (e.key === 'ArrowDown' && links.length) {
      e.preventDefault();
      links[0].focus();
    } else if (e.key === 'Enter' && links.length) {
      e.preventDefault();
      location.href = links[0].href;
    } else if (e.key === 'Escape') {
      input.value = '';
      render();
    }
  });
  box.addEventListener('keydown', (e) => {
    const links = [...box.querySelectorAll('a')];
    const i = links.indexOf(document.activeElement);
    if (e.key === 'ArrowDown' && i >= 0) {
      e.preventDefault();
      links[Math.min(links.length - 1, i + 1)].focus();
    } else if (e.key === 'ArrowUp' && i >= 0) {
      e.preventDefault();
      (i === 0 ? input : links[i - 1]).focus();
    } else if (e.key === 'Escape') {
      input.focus();
    }
  });
  if (input.value.trim()) render();
}
