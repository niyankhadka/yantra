/**
 * Small UI primitives: a horizontal scroller (hidden scrollbar, edge fades,
 * arrow buttons, wheel and mouse-drag scrolling) and tooltips that replace
 * the native `title` bubble.
 */

const CHEVRON = (d) =>
  `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>`;

const scrollBehavior = () => (matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth');

/**
 * +1 when "forward" scrolls to the right, -1 in right-to-left containers,
 * where scrollLeft starts at 0 and runs negative (CSSOM View).
 */
const flow = (el) => (getComputedStyle(el).direction === 'rtl' ? -1 : 1);

/**
 * Turn an element into a horizontal scroller. Safe to call repeatedly; returns
 * { update, reveal(child) }. "prev" is the inline start (the right in RTL).
 */
export function hscroll(el) {
  if (el.__hscroll) {
    el.__hscroll.update();
    return el.__hscroll;
  }
  el.classList.add('y-hscroll');
  const wrap = document.createElement('div');
  wrap.className = 'y-hscroll-wrap';
  el.parentNode.insertBefore(wrap, el);
  wrap.appendChild(el);

  const arrow = (dir) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `y-hscroll-btn is-${dir}`;
    b.tabIndex = -1; // keyboard users scroll by moving focus through the items
    b.setAttribute('aria-hidden', 'true');
    b.innerHTML = CHEVRON(dir === 'prev' ? 'm15 18-6-6 6-6' : 'm9 18 6-6-6-6');
    b.addEventListener('click', () => el.scrollBy({ left: (dir === 'prev' ? -1 : 1) * flow(el) * el.clientWidth * 0.7, behavior: scrollBehavior() }));
    return b;
  };
  wrap.prepend(arrow('prev'));
  wrap.append(arrow('next'));

  const update = () => {
    // Arrow gutters (28px each side) appear only when the items overflow;
    // measure against the width without them so the state never flip-flops.
    const gutters = wrap.classList.contains('is-overflow') ? 56 : 0;
    wrap.classList.toggle('is-overflow', el.scrollWidth > el.clientWidth + gutters + 1);
    const max = el.scrollWidth - el.clientWidth;
    const pos = Math.abs(el.scrollLeft);
    wrap.classList.toggle('can-prev', max > 1 && pos > 1);
    wrap.classList.toggle('can-next', max > 1 && pos < max - 1);
  };
  el.addEventListener('scroll', update, { passive: true });
  if (typeof ResizeObserver === 'function') new ResizeObserver(update).observe(el);

  // Vertical wheel scrolls sideways when there is somewhere to go
  el.addEventListener(
    'wheel',
    (e) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX) || el.scrollWidth <= el.clientWidth) return;
      el.scrollLeft += e.deltaY * flow(el);
      e.preventDefault();
    },
    { passive: false }
  );

  // Hold and drag with the mouse; touch keeps native panning
  let drag = null;
  el.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    drag = { x: e.clientX, left: el.scrollLeft, id: e.pointerId, moved: false };
  });
  el.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    if (!drag.moved) {
      if (Math.abs(dx) < 5) return;
      drag.moved = true;
      el.setPointerCapture(drag.id);
      el.classList.add('is-dragging');
    }
    el.scrollLeft = drag.left - dx;
  });
  const end = () => {
    if (!drag) return;
    if (drag.moved) {
      el.classList.remove('is-dragging');
      // A drag must not also click the item under the pointer
      const swallow = (ev) => {
        ev.stopPropagation();
        ev.preventDefault();
      };
      el.addEventListener('click', swallow, { capture: true, once: true });
      setTimeout(() => el.removeEventListener('click', swallow, true), 0);
    }
    drag = null;
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);

  const api = {
    update,
    /** Scroll so that `child` is fully visible, centred when possible. */
    reveal(child, smooth = true) {
      if (!child) return;
      const left = child.offsetLeft - (el.clientWidth - child.offsetWidth) / 2;
      el.scrollTo({ left: flow(el) < 0 ? Math.min(0, left) : Math.max(0, left), behavior: smooth ? scrollBehavior() : 'auto' });
    }
  };
  el.__hscroll = api;
  requestAnimationFrame(update);
  return api;
}

/**
 * Tooltips for any element inside `root` that has a `title` or `data-tip`.
 * The title moves to data-tip so the native bubble never appears. Text ending
 * in "(K)" renders K as a key hint. Hoverable and dismissible with Escape
 * (WCAG 1.4.13).
 */
export function tooltips(root = document.body) {
  const tip = document.createElement('div');
  tip.className = 'y-tooltip';
  tip.id = 'y-tooltip';
  const usePopover = 'popover' in HTMLElement.prototype;
  if (usePopover) tip.setAttribute('popover', 'manual');
  document.body.appendChild(tip);

  let target = null;
  let showTimer = 0;
  let hideTimer = 0;
  let lastHidden = 0;

  const textOf = (el) => {
    if (el.hasAttribute('title')) {
      el.dataset.tip = el.getAttribute('title');
      el.removeAttribute('title');
    }
    return el.dataset.tip || '';
  };

  const place = () => {
    const r = target.getBoundingClientRect();
    const t = tip.getBoundingClientRect();
    const gap = 8;
    let top = r.bottom + gap;
    if (top + t.height > innerHeight - 4) top = r.top - t.height - gap; // flip above
    const left = Math.min(innerWidth - t.width - 6, Math.max(6, r.left + r.width / 2 - t.width / 2));
    tip.style.top = `${Math.round(top)}px`;
    tip.style.left = `${Math.round(left)}px`;
  };

  const show = (el) => {
    const text = textOf(el);
    if (!text) return;
    target = el;
    const m = /^(.*?)\s*\(([^()]{1,12})\)$/.exec(text);
    tip.innerHTML = '';
    tip.append(m ? m[1] : text);
    if (m) {
      const k = document.createElement('kbd');
      k.textContent = m[2];
      tip.append(k);
    }
    if (usePopover && !tip.matches(':popover-open')) tip.showPopover();
    tip.classList.add('is-on');
    el.setAttribute('aria-describedby', tip.id);
    place();
  };

  const hide = () => {
    clearTimeout(showTimer);
    if (!target) return;
    target.removeAttribute('aria-describedby');
    target = null;
    tip.classList.remove('is-on');
    if (usePopover && tip.matches(':popover-open')) tip.hidePopover();
    lastHidden = Date.now();
  };

  const schedule = (el) => {
    clearTimeout(hideTimer);
    if (el === target) return;
    clearTimeout(showTimer);
    // Moving between controls feels instant once one tooltip has been seen
    const delay = Date.now() - lastHidden < 600 || target ? 60 : 450;
    showTimer = setTimeout(() => show(el), delay);
  };
  const leave = () => {
    clearTimeout(showTimer);
    hideTimer = setTimeout(hide, 120);
  };

  root.addEventListener('pointerover', (e) => {
    if (e.pointerType === 'touch') return;
    const el = e.target.closest?.('[title], [data-tip]');
    if (el && root.contains(el)) schedule(el);
  });
  root.addEventListener('pointerout', (e) => {
    const el = e.target.closest?.('[data-tip]');
    if (el && !el.contains(e.relatedTarget) && !tip.contains(e.relatedTarget)) leave();
  });
  root.addEventListener('focusin', (e) => {
    const el = e.target.closest?.('[title], [data-tip]');
    if (el && e.target.matches(':focus-visible')) schedule(el);
  });
  root.addEventListener('focusout', leave);
  tip.addEventListener('pointerenter', () => clearTimeout(hideTimer));
  tip.addEventListener('pointerleave', leave);
  addEventListener('pointerdown', hide, true);
  addEventListener('scroll', hide, true);
  addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && target) {
      hide();
      e.stopPropagation();
    }
  }, true);
}

/**
 * WAI-ARIA menu button: `trigger` opens `list` (role="menu"). Enter, Space and
 * ArrowDown open on the first item, ArrowUp on the last; arrows, Home and End
 * move a roving tabindex; Escape closes and returns focus to the trigger; Tab
 * and a click outside close. Returns { open, close, toggle, isOpen }.
 */
export function menu(trigger, list, { canOpen = () => true } = {}) {
  const items = () => [...list.querySelectorAll('[role^="menuitem"]')].filter((el) => !el.disabled && !el.hidden);

  const focusItem = (el) => {
    if (!el) return;
    for (const it of items()) it.tabIndex = it === el ? 0 : -1;
    el.focus();
  };

  const isOpen = () => !list.hidden;

  const open = (where = 'first') => {
    if (!canOpen()) return;
    list.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    const all = items();
    focusItem(where === 'last' ? all[all.length - 1] : all[0]);
  };

  const close = (restoreFocus = false) => {
    if (!isOpen()) return;
    list.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    if (restoreFocus) trigger.focus();
  };

  const toggle = () => (isOpen() ? close(true) : open());

  trigger.setAttribute('aria-haspopup', 'menu');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.addEventListener('click', toggle);
  trigger.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    e.stopPropagation();
    open(e.key === 'ArrowUp' ? 'last' : 'first');
  });

  list.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') return close();
    const all = items();
    const i = all.indexOf(document.activeElement);
    const to = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: all.length - 1 }[e.key];
    if (to !== undefined) focusItem(all[(to + all.length) % all.length]);
    else if (e.key === 'Escape') close(true);
    else return;
    e.preventDefault();
    e.stopPropagation();
  });

  // composedPath, not target: an item may be re-rendered (detached) by its own click
  document.addEventListener('click', (e) => {
    const path = e.composedPath();
    if (isOpen() && !path.includes(list) && !path.includes(trigger)) close();
  });

  return { open, close, toggle, isOpen, focusItem };
}
