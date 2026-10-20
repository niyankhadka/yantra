/**
 * Renderer - draws a scene as HTML cards over an SVG edge layer and applies
 * visual state (step highlight, selection focus, role filter, signal dots).
 *
 * Active edges take their colours from the nodes they join: the line is a
 * gradient from the source role colour to the target role colour, the arrow
 * head uses the target colour, and signal dots shift colour as they travel.
 */
import { HUES } from '../core/theme.js';
import { iconSvg } from '../core/icons.js';
import { escapeHtml as h } from '../core/text.js';
import { sequenceLive } from '../core/sequence.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const hueVar = (hue) => `var(--y-hue-${HUES[hue] ? hue : 'slate'})`;

export class Renderer {
  constructor(world) {
    this.world = world;
    const markers = Object.keys(HUES)
      .map((hue) => `<marker id="y-arrow-${hue}" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0 1 10 5 0 9z" style="fill:${hueVar(hue)}"/></marker>`)
      .join('');
    world.innerHTML = `
      <div class="y-group-layer" aria-hidden="true"></div>
      <svg class="y-edges" xmlns="${SVG_NS}" aria-hidden="true">
        <defs>
          <marker id="y-arrow" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0 1 10 5 0 9z" class="y-arrow"/></marker>
          ${markers}
        </defs>
        <defs class="y-gradients"></defs>
        <g class="y-edge-layer"></g>
      </svg>
      <div class="y-packet-layer" aria-hidden="true"></div>
      <div class="y-label-layer"></div>
      <div class="y-node-layer"></div>`;
    this.svg = world.querySelector('.y-edges');
    this.groupLayer = world.querySelector('.y-group-layer');
    this.gradientDefs = world.querySelector('.y-gradients');
    this.edgeLayer = world.querySelector('.y-edge-layer');
    this.packetLayer = world.querySelector('.y-packet-layer');
    this.labelLayer = world.querySelector('.y-label-layer');
    this.nodeLayer = world.querySelector('.y-node-layer');
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
      path.setAttribute('marker-end', 'url(#y-arrow)');
      g.appendChild(path);
      this.edgeLayer.appendChild(g);
      this.edges.set(e.id, { g, path, gradient, gradId, from, to });

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
    for (const layer of [this.groupLayer, this.nodeLayer, this.edgeLayer, this.labelLayer, this.gradientDefs, this.packetLayer]) layer.textContent = '';
    this.nodes.clear();
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

  /** A node card; the sequence view reuses it for participant headers. */
  addCard(n) {
    const el = document.createElement('div');
    el.className = 'y-node';
    el.dataset.id = n.id;
    el.dataset.hue = n.hue;
    el.dataset.role = n.node.type || 'node';
    el.tabIndex = 0;
    el.setAttribute('role', 'button');
    el.setAttribute('aria-label', [n.node.data?.title, n.node.data?.subtitle].filter(Boolean).join(', '));
    el.innerHTML =
      `<div class="y-node-kicker">${iconSvg(n.icon, 14)}<span>${h(n.kicker)}</span></div>` +
      `<div class="y-node-title">${n.lines.title.map((l) => `<span>${h(l)}</span>`).join('')}</div>` +
      (n.lines.subtitle.length ? `<div class="y-node-sub">${n.lines.subtitle.map((l) => `<span>${h(l)}</span>`).join('')}</div>` : '') +
      (n.lines.tech ? `<div class="y-node-tech">${h(n.lines.tech)}</div>` : '');
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
      this.edges.set(m.id, { g, path, gradient, gradId, from, to });

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
      rec.path.setAttribute('marker-end', on || !focused ? `url(#y-arrow-${HUES[rec.to] ? rec.to : 'slate'})` : 'url(#y-arrow)');
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
    }
    this.edges.forEach((rec, id) => {
      const on = focused && activeEdges.has(id);
      rec.g.classList.toggle('is-active', on);
      rec.g.classList.toggle('is-dim', focused && !on);
      rec.path.style.stroke = on ? `url(#${rec.gradId})` : '';
      rec.path.setAttribute('marker-end', on ? `url(#y-arrow-${HUES[rec.to] ? rec.to : 'slate'})` : 'url(#y-arrow)');
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

  renderPackets(edges) {
    this.packetLayer.textContent = '';
    if (this.reducedMotion) return;
    edges.forEach((e, i) => {
      const rec = this.edges.get(e.id);
      if (!rec) return;
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
