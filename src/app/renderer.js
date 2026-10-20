/**
 * Renderer - draws a scene as HTML cards over an SVG edge layer and applies
 * visual state (step highlight, selection focus, role filter, signal dots).
 *
 * Active edges take their colours from the nodes they join: the line is a
 * gradient from the source role colour to the target role colour, the arrow
 * head uses the target colour, and signal dots shift colour as they travel.
 */
import { HUES } from '../core/theme.js';
import { iconSvg, DRILL_ICON } from '../core/icons.js';
import { DRILL_TEXT } from './levels.js';
import { escapeHtml as h } from '../core/text.js';
import { sequenceLive } from '../core/sequence.js';
import { END_KINDS, markerDef } from '../core/notation.js';
import { POINT_SHAPES } from '../core/model.js';
import { POINT_BADGE } from '../core/tree.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const hueVar = (hue) => `var(--y-hue-${HUES[hue] ? hue : 'slate'})`;

export class Renderer {
  constructor(world) {
    this.world = world;
    const markers = Object.keys(HUES)
      .map((hue) => `<marker id="y-arrow-${hue}" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0 1 10 5 0 9z" style="fill:${hueVar(hue)}"/></marker>`)
      .join('');
    // Notation markers (UML heads, ER cardinality) in the edge colour and every hue
    const ends = END_KINDS.filter((k) => k !== 'none' && k !== 'arrow')
      .flatMap((kind) => [
        markerDef(`y-end-${kind}`, kind, 'var(--y-edge)', 'var(--y-bg)', true),
        ...Object.keys(HUES).map((hue) => markerDef(`y-end-${kind}-${hue}`, kind, hueVar(hue), 'var(--y-bg)', true))
      ])
      .join('');
    world.innerHTML = `
      <div class="y-group-layer" aria-hidden="true"></div>
      <svg class="y-edges" xmlns="${SVG_NS}" aria-hidden="true">
        <defs>
          <marker id="y-arrow" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0 1 10 5 0 9z" class="y-arrow"/></marker>
          ${markers}${ends}
        </defs>
        <defs class="y-gradients"></defs>
        <g class="y-edge-layer"></g>
      </svg>
      <div class="y-packet-layer" aria-hidden="true"></div>
      <div class="y-label-layer"></div>
      <div class="y-node-layer"></div>
      <div class="y-toggle-layer"></div>`;
    this.svg = world.querySelector('.y-edges');
    this.groupLayer = world.querySelector('.y-group-layer');
    this.gradientDefs = world.querySelector('.y-gradients');
    this.edgeLayer = world.querySelector('.y-edge-layer');
    this.packetLayer = world.querySelector('.y-packet-layer');
    this.labelLayer = world.querySelector('.y-label-layer');
    this.nodeLayer = world.querySelector('.y-node-layer');
    this.toggleLayer = world.querySelector('.y-toggle-layer');
    this.toggles = new Map(); // node or group id -> fold button
    this.nodes = new Map();
    this.groups = new Map();
    this.edges = new Map(); // id -> { g, path, gradient, from, to }
    this.labels = new Map();
    this.reducedMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  render(scene) {
    if (scene.kind === 'sequence') return this.renderSequence(scene);
    this.clear();
    const hueOf = new Map(scene.nodes.map((n) => [n.id, n.hue]));
    this.addGroups(scene);
    for (const n of scene.nodes) this.addCard(n);
    this.addToggles(scene);

    scene.edges.forEach((e, i) => {
      const from = hueOf.get(e.edge.source) || 'slate';
      const to = hueOf.get(e.edge.target) || 'slate';
      const gradId = `y-grad-${i}`;
      const gradient = document.createElementNS(SVG_NS, 'linearGradient');
      gradient.id = gradId;
      gradient.setAttribute('gradientUnits', 'userSpaceOnUse');
      gradient.innerHTML = `<stop offset="0" style="stop-color:${hueVar(from)}"/><stop offset="1" style="stop-color:${hueVar(to)}"/>`;
      this.gradientDefs.appendChild(gradient);

      const g = document.createElementNS(SVG_NS, 'g');
      g.setAttribute('class', `y-edge${e.dashed ? ' is-dashed' : ''}${e.dotted ? ' is-dotted' : ''}`);
      g.dataset.id = e.id;
      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('class', 'y-edge-line');
      g.appendChild(path);
      this.edgeLayer.appendChild(g);
      // start / end: arrowheads (edge `arrow`) or notation markers, resolved in the core
      const rec = { g, path, gradient, gradId, from, to, arrow: e.arrow, start: e.start ?? null, end: e.end === undefined ? 'arrow' : e.end };
      this.edges.set(e.id, rec);
      this.setMarkers(rec, false);

      if (e.edge.label) {
        const lab = document.createElement('div');
        lab.className = 'y-label';
        lab.dataset.id = e.id;
        lab.dataset.hue = from;
        lab.textContent = e.edge.label;
        this.labelLayer.appendChild(lab);
        this.labels.set(e.id, lab);
      }
    });
    this.update(scene);
  }

  clear() {
    for (const layer of [this.groupLayer, this.nodeLayer, this.edgeLayer, this.labelLayer, this.gradientDefs, this.packetLayer, this.toggleLayer]) layer.textContent = '';
    this.nodes.clear();
    this.toggles.clear();
    this.groups.clear();
    this.edges.clear();
    this.labels.clear();
    this.rows = new Map();
    this.lifelines = new Map();
  }

  addGroups(scene) {
    for (const g of scene.groups || []) {
      const el = document.createElement('div');
      el.className = `y-group${g.dashed ? '' : ' is-solid'}`;
      el.dataset.id = g.id;
      el.dataset.hue = g.hue;
      el.dataset.depth = g.depth;
      el.innerHTML = `<span class="y-group-title">${h(g.label)}</span>`;
      this.groupLayer.appendChild(el);
      this.groups.set(g.id, el);
    }
  }

  /**
   * Fold buttons: on the child side of every card with a subtree (tree and
   * mind-map layouts), on folded group cards and on group boxes (layered).
   * They live in their own layer so a card stays a single focusable control.
   */
  addToggles(scene) {
    const make = (id, title, folded, count, side) => {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = `y-toggle${folded ? ' is-folded' : ''}`;
      el.dataset.toggle = id;
      el.dataset.side = side;
      el.setAttribute('aria-expanded', String(!folded));
      const L = this.L;
      const label = L ? L.t(folded ? 'fold.expand' : 'fold.collapse', { title, n: L.num(count) }) : folded ? `Expand ${title} (${count} hidden)` : `Collapse ${title}`;
      el.setAttribute('aria-label', label);
      el.title = label;
      el.textContent = folded ? `+${L ? L.num(count) : count}` : '\u2212';
      this.toggleLayer.appendChild(el);
      this.toggles.set(id, el);
      return el;
    };
    for (const n of scene.nodes) {
      if (!n.toggle) continue;
      make(n.id, n.node.data?.title || n.id, n.collapsed > 0 || !!n.node.summary, n.collapsed, n.toggle).dataset.hue = n.hue;
    }
    if (scene.layout === 'layered')
      for (const g of scene.groups || []) make(g.id, g.title, false, 0, 'group').dataset.hue = g.hue;
  }

  /** Toggle centre for a card side or a group box corner (the top-left corner in RTL, clear of the mirrored title). */
  toggleAt(scene, id) {
    const rtl = this.L?.dir === 'rtl';
    const n = scene.nodes.find((m) => m.id === id);
    if (n) {
      // a folded pseudo-state's +N badge sits just outside the dot or diamond
      const off = POINT_SHAPES.has(n.shape) ? POINT_BADGE : 0;
      if (n.toggle === 'bottom') return { x: n.x + n.w / 2, y: n.y + n.h + off };
      if (n.toggle === 'right') return { x: n.x + n.w + off, y: n.y + n.h / 2 };
      if (n.toggle === 'left') return { x: n.x - off, y: n.y + n.h / 2 };
      return { x: rtl ? n.x + 26 : n.x + n.w - 26, y: n.y };
    }
    const g = (scene.groups || []).find((m) => m.id === id);
    return g ? { x: rtl ? g.x + 20 : g.x + g.w - 20, y: g.y + 16 } : null;
  }

  /** A node card; the sequence view reuses it for participant headers. */
  addCard(n) {
    const el = document.createElement('div');
    el.className = 'y-node';
    el.dataset.id = n.id;
    el.dataset.hue = n.hue;
    el.dataset.role = n.node.type || 'node';
    el.tabIndex = 0;
    el.setAttribute('role', 'button');
    const drill = typeof n.node.data?.drill === 'string' && n.node.data.drill;
    el.setAttribute('aria-label', [n.node.data?.title, n.node.data?.subtitle, drill && DRILL_TEXT.cardHint].filter(Boolean).join(', '));
    el.classList.toggle('has-drill', !!drill);
    if (n.shape === 'state') el.classList.add('is-state');
    if (POINT_SHAPES.has(n.shape)) {
      // Pseudo-states are textless; the title shows as a tooltip and in the inspector
      el.classList.add('y-point', `is-${n.shape}`);
      el.title = n.node.data?.title || n.id;
      el.innerHTML = pointMarkup(n);
      this.nodeLayer.appendChild(el);
      this.nodes.set(n.id, el);
      return el;
    }
    el.innerHTML =
      // Drill mark: clicking it opens the detail diagram (the card itself stays the one control)
      (drill ? `<span class="y-node-drill" aria-hidden="true"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${DRILL_ICON}</svg></span>` : '') +
      `<div class="y-node-kicker">${iconSvg(n.icon, 14)}<span>${h(n.kicker)}</span></div>` +
      `<div class="y-node-title">${n.lines.title.map((l) => `<span>${h(l)}</span>`).join('')}</div>` +
      (n.lines.subtitle.length ? `<div class="y-node-sub">${n.lines.subtitle.map((l) => `<span>${h(l)}</span>`).join('')}</div>` : '') +
      (n.lines.tech ? `<div class="y-node-tech">${h(n.lines.tech)}</div>` : '') +
      (n.lines.rows ? rowsHtml(n.lines.rows, this.L) : '');
    if (n.stereotype) el.classList.add('is-stereotype');
    if (n.lines.rows) el.classList.add('is-entity');
    this.nodeLayer.appendChild(el);
    this.nodes.set(n.id, el);
    return el;
  }

  /**
   * Sequence view: step rows and group boxes behind, lifelines and messages
   * in the SVG layer, labels and notes as pills, participant headers as cards.
   */
  renderSequence(scene) {
    this.clear();
    const hueOf = new Map(scene.participants.map((p) => [p.id, p.hue]));
    const place = (el, r) => {
      el.style.transform = `translate(${r.x}px, ${r.y}px)`;
      el.style.width = `${r.w}px`;
      el.style.height = `${r.h}px`;
    };

    for (const r of scene.rows) {
      const el = document.createElement('div');
      el.className = `y-seq-row${r.index % 2 ? ' is-alt' : ''}`;
      el.innerHTML = `<span class="y-seq-badge">${r.index + 1}</span>`;
      place(el, r);
      this.groupLayer.appendChild(el);
      this.rows.set(r.index, el);
    }
    this.addGroups(scene);
    for (const g of scene.groups) place(this.groups.get(g.id), g);

    for (const p of scene.participants) {
      const line = document.createElementNS(SVG_NS, 'line');
      line.setAttribute('class', 'y-lifeline');
      line.dataset.hue = p.hue;
      for (const [k, v] of Object.entries({ x1: p.cx, x2: p.cx, y1: scene.lifeline.y1, y2: scene.lifeline.y2 })) line.setAttribute(k, v);
      this.edgeLayer.appendChild(line);
      this.lifelines.set(p.id, line);
      place(this.addCard(p), p);
    }

    scene.messages.forEach((m, i) => {
      const from = hueOf.get(m.source) || 'slate';
      const to = hueOf.get(m.target) || 'slate';
      const gradId = `y-grad-${i}`;
      const a = m.points[0];
      const b = m.points[m.points.length - 1];
      const gradient = document.createElementNS(SVG_NS, 'linearGradient');
      gradient.id = gradId;
      gradient.setAttribute('gradientUnits', 'userSpaceOnUse');
      for (const [k, v] of Object.entries({ x1: a.x, y1: a.y, x2: b.x === a.x ? b.x + 1 : b.x, y2: b.y })) gradient.setAttribute(k, v);
      gradient.innerHTML = `<stop offset="0" style="stop-color:${hueVar(from)}"/><stop offset="1" style="stop-color:${hueVar(to)}"/>`;
      this.gradientDefs.appendChild(gradient);
      const g = document.createElementNS(SVG_NS, 'g');
      g.setAttribute('class', `y-edge y-message${m.dashed ? ' is-dashed' : ''}${m.dotted ? ' is-dotted' : ''}`);
      g.dataset.id = m.id;
      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('class', 'y-edge-line');
      path.setAttribute('d', m.d);
      g.appendChild(path);
      this.edgeLayer.appendChild(g);
      this.edges.set(m.id, { g, path, gradient, gradId, from, to, arrow: m.arrow });

      const lab = document.createElement('div');
      lab.className = 'y-label';
      lab.dataset.id = m.id;
      lab.dataset.hue = from;
      lab.textContent = m.text;
      lab.style.transform = `translate(${m.label.x}px, ${m.label.y}px) translate(-50%, -50%)`;
      this.labelLayer.appendChild(lab);
      this.labels.set(m.id, lab);
    });
    for (const r of scene.rows.filter((row) => row.note)) {
      const el = document.createElement('div');
      el.className = 'y-note';
      el.dataset.step = r.index;
      el.textContent = r.note.text;
      place(el, { x: r.note.x - r.note.w / 2, y: r.note.y - r.note.h / 2, w: r.note.w, h: r.note.h });
      this.labelLayer.appendChild(el);
    }

    const b = scene.bounds;
    this.svg.setAttribute('width', Math.max(1, b.x + b.w + 40));
    this.svg.setAttribute('height', Math.max(1, b.y + b.h + 40));
    this.scene = scene;
    if (this.state) this.applyState(this.state, { force: true });
  }

  /** Current row (or selection / role filter) drives the sequence highlight. */
  applySequenceState(state, force) {
    const scene = this.scene;
    const filtered = !!(state.selectedId || state.roleFilter);
    let people;
    let live;
    if (filtered) {
      people = new Set(state.selectedId ? [state.selectedId] : scene.participants.filter((p) => (p.node.type || 'node') === state.roleFilter).map((p) => p.id));
      live = new Set(scene.messages.filter((m) => people.has(m.source) || people.has(m.target)).map((m) => m.id));
      scene.messages.forEach((m) => live.has(m.id) && people.add(m.source).add(m.target));
    } else {
      people = sequenceLive(scene, state.step);
      live = new Set(scene.messages.filter((m) => m.step === state.step).map((m) => m.id));
    }
    const focused = people.size > 0 || live.size > 0;
    this.nodes.forEach((el, id) => {
      el.classList.toggle('is-active', focused && people.has(id));
      el.classList.toggle('is-dim', focused && !people.has(id));
      el.classList.toggle('is-selected', id === state.selectedId);
    });
    this.lifelines.forEach((el, id) => el.classList.toggle('is-dim', focused && !people.has(id)));
    this.rows.forEach((el, i) => el.classList.toggle('is-current', !filtered && i === state.step));
    this.labelLayer.querySelectorAll('.y-note').forEach((el) => el.classList.toggle('is-dim', filtered || Number(el.dataset.step) !== state.step));
    for (const g of scene.groups) this.groups.get(g.id)?.classList.toggle('is-dim', focused && !g.members.some((id) => people.has(id)));
    this.edges.forEach((rec, id) => {
      const on = live.has(id);
      rec.g.classList.toggle('is-active', on);
      rec.g.classList.toggle('is-dim', focused && !on);
      rec.path.style.stroke = on || !focused ? `url(#${rec.gradId})` : '';
      setHeads(rec, on || !focused);
    });
    this.labels.forEach((el, id) => {
      el.classList.toggle('is-active', live.has(id));
      el.classList.toggle('is-dim', focused && !live.has(id));
    });
    const flowing = scene.messages.filter((m) => live.has(m.id));
    const key = flowing.map((m) => m.id).join('|');
    if (force || key !== this.packetKey) this.renderPackets(flowing);
    this.packetKey = key;
  }

  /** Reposition everything from a scene with the same nodes/edges. */
  update(scene) {
    if (scene.kind === 'sequence') return this.renderSequence(scene);
    for (const g of scene.groups || []) {
      const el = this.groups.get(g.id);
      if (!el) continue;
      el.style.transform = `translate(${g.x}px, ${g.y}px)`;
      el.style.width = `${g.w}px`;
      el.style.height = `${g.h}px`;
      el.firstChild.textContent = g.label;
    }
    for (const n of scene.nodes) {
      const el = this.nodes.get(n.id);
      if (!el) continue;
      el.style.transform = `translate(${n.x}px, ${n.y}px)`;
      el.style.width = `${n.w}px`;
      el.style.height = `${n.h}px`;
    }
    this.toggles.forEach((el, id) => {
      const at = this.toggleAt(scene, id);
      if (at) el.style.transform = `translate(${at.x}px, ${at.y}px) translate(-50%, -50%)`;
    });
    for (const e of scene.edges) {
      const rec = this.edges.get(e.id);
      if (rec) {
        rec.path.setAttribute('d', e.d);
        const a = e.points[0];
        const b = e.points[e.points.length - 1];
        // Degenerate gradients (start == end) render nothing; nudge apart
        rec.gradient.setAttribute('x1', a.x);
        rec.gradient.setAttribute('y1', a.y);
        rec.gradient.setAttribute('x2', b.x === a.x && b.y === a.y ? b.x + 1 : b.x);
        rec.gradient.setAttribute('y2', b.y);
      }
      const lab = this.labels.get(e.id);
      if (lab) {
        lab.hidden = !e.label;
        if (e.label) lab.style.transform = `translate(${e.label.x}px, ${e.label.y}px) translate(-50%, -50%)`;
      }
    }
    const b = scene.bounds;
    this.svg.setAttribute('width', Math.max(1, b.x + b.w + 40));
    this.svg.setAttribute('height', Math.max(1, b.y + b.h + 40));
    this.scene = scene;
    if (this.state) this.applyState(this.state, { force: true });
  }

  /**
   * @param state { highlight: {nodes,edges,overview}, selectedId, roleFilter }
   */
  applyState(state, { force = false } = {}) {
    this.state = state;
    const scene = this.scene;
    if (!scene) return;
    if (scene.kind === 'sequence') return this.applySequenceState(state, force);
    let activeNodes = null;
    let activeEdges = null;

    if (state.selectedId) {
      activeEdges = new Set(scene.edges.filter((e) => e.edge.source === state.selectedId || e.edge.target === state.selectedId).map((e) => e.id));
      activeNodes = new Set([state.selectedId]);
      scene.edges.forEach((e) => activeEdges.has(e.id) && activeNodes.add(e.edge.source).add(e.edge.target));
    } else if (state.roleFilter) {
      activeNodes = new Set(scene.nodes.filter((n) => (n.node.type || 'node') === state.roleFilter).map((n) => n.id));
      activeEdges = new Set(scene.edges.filter((e) => activeNodes.has(e.edge.source) || activeNodes.has(e.edge.target)).map((e) => e.id));
    } else if (state.highlight && !state.highlight.overview) {
      activeNodes = state.highlight.nodes;
      activeEdges = state.highlight.edges;
    }

    const focused = !!activeNodes;
    this.nodes.forEach((el, id) => {
      el.classList.toggle('is-active', focused && activeNodes.has(id));
      el.classList.toggle('is-dim', focused && !activeNodes.has(id));
      el.classList.toggle('is-selected', id === state.selectedId);
    });
    for (const g of scene.groups || []) {
      const el = this.groups.get(g.id);
      if (!el) continue;
      const any = focused && g.members.some((id) => activeNodes.has(id));
      el.classList.toggle('is-active', any);
      el.classList.toggle('is-dim', focused && !any);
      this.toggles.get(g.id)?.classList.toggle('is-dim', focused && !any);
    }
    for (const n of scene.nodes) this.toggles.get(n.id)?.classList.toggle('is-dim', focused && !activeNodes.has(n.id));
    // Mind maps draw every connector in its branch colour, not only active ones
    const branch = !!scene.branchColors;
    this.edges.forEach((rec, id) => {
      const on = focused && activeEdges.has(id);
      rec.g.classList.toggle('is-active', on);
      rec.g.classList.toggle('is-dim', focused && !on);
      rec.path.style.stroke = on ? `url(#${rec.gradId})` : branch ? hueVar(rec.to) : '';
      this.setMarkers(rec, on || branch);
    });
    this.labels.forEach((el, id) => {
      el.classList.toggle('is-active', focused && activeEdges.has(id));
      el.classList.toggle('is-dim', focused && !activeEdges.has(id));
    });

    // Signals travel along the active edges, or along every edge in an overview
    const flowing = scene.edges.filter((e) => (focused ? activeEdges.has(e.id) : true));
    const key = flowing.map((e) => e.id).join('|');
    if (force || key !== this.packetKey) this.renderPackets(flowing);
    this.packetKey = key;
  }

  /** marker-start / marker-end for an edge record: grey, or the end node's hue when active. */
  setMarkers(rec, on) {
    const id = (kind, hue) => {
      if (!kind) return null;
      const h = HUES[hue] ? hue : 'slate';
      if (kind === 'arrow') return on ? `url(#y-arrow-${h})` : 'url(#y-arrow)';
      return on ? `url(#y-end-${kind}-${h})` : `url(#y-end-${kind})`;
    };
    for (const [attr, value] of [['marker-start', id(rec.start, rec.from)], ['marker-end', id(rec.end, rec.to)]]) {
      if (value) rec.path.setAttribute(attr, value);
      else rec.path.removeAttribute(attr);
    }
  }

  renderPackets(edges) {
    this.packetLayer.textContent = '';
    if (this.reducedMotion) return;
    edges.forEach((e, i) => {
      const rec = this.edges.get(e.id);
      if (!rec || rec.arrow === 'none') return; // an undirected link has no flow to show
      const length = e.points.reduce((s, p, k) => (k ? s + Math.abs(p.x - e.points[k - 1].x) + Math.abs(p.y - e.points[k - 1].y) : 0), 0);
      const dur = Math.min(3.6, Math.max(1.4, length / 220));
      const dot = document.createElement('i');
      dot.className = 'y-packet';
      dot.style.offsetPath = `path("${e.d}")`;
      dot.style.setProperty('--from', hueVar(rec.from));
      dot.style.setProperty('--to', hueVar(rec.to));
      dot.style.animationDuration = `${dur}s`;
      dot.style.animationDelay = `${-((i * 0.37) % dur)}s`;
      this.packetLayer.appendChild(dot);
    });
  }
}

/** Arrow heads for an edge's `arrow` setting, in its role colours when active. */
function setHeads(rec, coloured) {
  const head = (hue) => (coloured ? `url(#y-arrow-${HUES[hue] ? hue : 'slate'})` : 'url(#y-arrow)');
  if (rec.arrow === 'none') rec.path.removeAttribute('marker-end');
  else rec.path.setAttribute('marker-end', head(rec.to));
  if (rec.arrow === 'both') rec.path.setAttribute('marker-start', head(rec.from));
  else rec.path.removeAttribute('marker-start');
}

/** Inline SVG for a pseudo-state (same outlines as the SVG export). */
function pointMarkup(n) {
  const r = n.w / 2;
  const body =
    n.shape === 'initial' ? `<circle class="y-pt-fill" cx="${r}" cy="${r}" r="${r}"/>` :
    n.shape === 'final' ? `<circle class="y-pt-ring" cx="${r}" cy="${r}" r="${r - 1}"/><circle class="y-pt-fill" cx="${r}" cy="${r}" r="${r - 5}"/>` :
    `<polygon class="y-pt-ring" points="${r},0.75 ${n.w - 0.75},${r} ${r},${n.h - 0.75} 0.75,${r}"/>`;
  return `<svg width="${n.w}" height="${n.h}" viewBox="0 0 ${n.w} ${n.h}" aria-hidden="true">${body}</svg>`;
}

/**
 * Field / method rows, positioned from the core measurement (entity.js), so the
 * card matches the SVG export and the validated height exactly.
 */
function rowsHtml(rows, L) {
  return rows.sections
    .map((sec) => {
      const items = sec.rows
        .map((r) =>
          r.more
            ? `<div class="y-row is-more" style="top:${r.y}px"><span class="y-row-name" style="inset-inline-start:${rows.nameX}px">${h(L ? L.t('card.more', { n: L.num(r.more) }) : `+ ${r.more} more`)}</span></div>`
            : `<div class="y-row${r.pk ? ' is-pk' : ''}${r.static ? ' is-static' : ''}${r.abstract ? ' is-abstract' : ''}" style="top:${r.y}px">` +
              (r.key ? `<span class="y-row-key">${h(r.key)}</span>` : '') +
              `<span class="y-row-name" style="inset-inline-start:${rows.nameX}px">${h(r.name)}</span>` +
              (r.type ? `<span class="y-row-type">${h(r.type)}</span>` : '') +
              '</div>'
        )
        .join('');
      return `<div class="y-row-rule" style="top:${sec.rule}px" data-kind="${sec.kind}"></div>${items}`;
    })
    .join('');
}
