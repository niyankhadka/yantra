/**
 * InteractionManager - pointer pan, wheel/pinch zoom, node dragging (with
 * live re-routing) and fit-to-view that respects the UI chrome.
 */
const GRID = 10;
const CLICK_SLOP = 4;

export class InteractionManager {
  constructor(viewport, world, { getScene, getInsets, onNodeMove, onNodeMoveEnd, onNodeClick, onBackgroundClick, onZoom }) {
    this.viewport = viewport;
    this.world = world;
    this.cb = { getScene, getInsets, onNodeMove, onNodeMoveEnd, onNodeClick, onBackgroundClick, onZoom };
    this.x = 0;
    this.y = 0;
    this.zoom = 1;
    this.min = 0.2;
    this.max = 2.5;
    this.drag = null;
    this.pointers = new Map();

    viewport.addEventListener('pointerdown', (e) => this.down(e));
    window.addEventListener('pointermove', (e) => this.move(e));
    window.addEventListener('pointerup', (e) => this.up(e));
    window.addEventListener('pointercancel', (e) => this.up(e));
    viewport.addEventListener('wheel', (e) => this.wheel(e), { passive: false });
  }

  toWorld(cx, cy) {
    const r = this.viewport.getBoundingClientRect();
    return { x: (cx - r.left - this.x) / this.zoom, y: (cy - r.top - this.y) / this.zoom };
  }

  apply() {
    this.world.style.transform = `translate(${this.x}px, ${this.y}px) scale(${this.zoom})`;
    // keep the dot grid attached to the canvas
    this.viewport.style.backgroundPosition = `${this.x}px ${this.y}px`;
    this.viewport.style.backgroundSize = `${20 * this.zoom}px ${20 * this.zoom}px`;
    this.cb.onZoom?.(this.zoom);
  }

  /** Current camera, so a temporary change (printing) can be undone. */
  view() {
    return { x: this.x, y: this.y, zoom: this.zoom };
  }

  setView({ x, y, zoom }) {
    this.world.classList.remove('is-gliding');
    Object.assign(this, { x, y, zoom });
    this.apply();
  }

  /** Centre the whole diagram in a w x h box at the top-left, ignoring panels. */
  fitBox(w, h, pad = 16) {
    const b = this.cb.getScene().bounds;
    const zoom = Math.min(1, (w - pad * 2) / Math.max(1, b.w), (h - pad * 2) / Math.max(1, b.h));
    this.setView({ zoom, x: (w - b.w * zoom) / 2 - b.x * zoom, y: (h - b.h * zoom) / 2 - b.y * zoom });
  }

  down(e) {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 2) {
      this.drag = { kind: 'pinch', dist: this.pinchDistance(), zoom: this.zoom };
      return;
    }
    const nodeEl = e.target.closest('.y-node');
    const start = { sx: e.clientX, sy: e.clientY, moved: false };
    if (nodeEl && this.cb.getScene().kind === 'sequence') {
      // Sequence headers are fixed: a press pans, a click still selects
      this.drag = { kind: 'pan', ox: this.x, oy: this.y, clickId: nodeEl.dataset.id, ...start };
    } else if (nodeEl) {
      const id = nodeEl.dataset.id;
      const n = this.cb.getScene().nodes.find((m) => m.id === id);
      const w = this.toWorld(e.clientX, e.clientY);
      this.drag = { kind: 'node', id, el: nodeEl, dx: w.x - n.x, dy: w.y - n.y, ...start };
    } else {
      this.drag = { kind: 'pan', ox: this.x, oy: this.y, ...start };
    }
    this.viewport.setPointerCapture?.(e.pointerId);
  }

  move(e) {
    if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const d = this.drag;
    if (!d) return;
    if (d.kind === 'pinch') {
      if (this.pointers.size < 2) return;
      const [a, b] = [...this.pointers.values()];
      this.zoomAt(d.zoom * (this.pinchDistance() / d.dist), (a.x + b.x) / 2, (a.y + b.y) / 2);
      return;
    }
    if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < CLICK_SLOP) return;
    d.moved = true;
    if (d.kind === 'pan') {
      this.viewport.classList.add('is-panning');
      this.x = d.ox + e.clientX - d.sx;
      this.y = d.oy + e.clientY - d.sy;
      this.apply();
    } else {
      d.el.classList.add('is-dragging');
      const w = this.toWorld(e.clientX, e.clientY);
      const x = Math.round((w.x - d.dx) / GRID) * GRID;
      const y = Math.round((w.y - d.dy) / GRID) * GRID;
      if (x !== d.lastX || y !== d.lastY) {
        d.lastX = x;
        d.lastY = y;
        this.cb.onNodeMove?.(d.id, x, y);
      }
    }
  }

  up(e) {
    this.pointers.delete(e.pointerId);
    const d = this.drag;
    if (!d) return;
    if (d.kind === 'pinch') {
      if (this.pointers.size === 0) this.drag = null;
      return;
    }
    this.drag = null;
    this.viewport.classList.remove('is-panning');
    if (d.kind === 'node') {
      d.el.classList.remove('is-dragging');
      if (d.moved) this.cb.onNodeMoveEnd?.(d.id);
      else this.cb.onNodeClick?.(d.id);
    } else if (!d.moved && d.clickId) {
      this.cb.onNodeClick?.(d.clickId);
    } else if (!d.moved) {
      this.cb.onBackgroundClick?.();
    }
  }

  pinchDistance() {
    const [a, b] = [...this.pointers.values()];
    return Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
  }

  wheel(e) {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey || Math.abs(e.deltaY) > Math.abs(e.deltaX) * 2) {
      this.zoomAt(this.zoom * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), e.clientX, e.clientY);
    } else {
      this.x -= e.deltaX;
      this.y -= e.deltaY;
      this.apply();
    }
  }

  zoomAt(z, cx, cy) {
    const zoom = Math.min(this.max, Math.max(this.min, z));
    const r = this.viewport.getBoundingClientRect();
    const px = cx - r.left;
    const py = cy - r.top;
    this.x = px - ((px - this.x) / this.zoom) * zoom;
    this.y = py - ((py - this.y) / this.zoom) * zoom;
    this.zoom = zoom;
    this.apply();
  }

  /** Glide the canvas by a screen-space offset. */
  panBy(dx, dy) {
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.world.classList.add('is-gliding');
      clearTimeout(this.glideTimer);
      this.glideTimer = setTimeout(() => this.world.classList.remove('is-gliding'), 500);
    }
    this.x += dx;
    this.y += dy;
    this.apply();
  }

  zoomBy(f) {
    const r = this.viewport.getBoundingClientRect();
    const inset = this.cb.getInsets();
    this.zoomAt(this.zoom * f, r.left + (inset.left + r.width - inset.right) / 2, r.top + (inset.top + r.height - inset.bottom) / 2);
  }

  /**
   * Fit a region (default: whole diagram) into the area not covered by
   * toolbars and panels. A focused region never zooms past 100% nor out
   * further than the whole-diagram fit.
   */
  fit(region = null, { animate = false } = {}) {
    const all = this.cb.getScene().bounds;
    const r = this.viewport.getBoundingClientRect();
    const inset = this.cb.getInsets();
    const pad = 32;
    const availW = Math.max(100, r.width - inset.left - inset.right - pad * 2);
    const availH = Math.max(100, r.height - inset.top - inset.bottom - pad * 2);
    const scale = (b) => Math.min(availW / Math.max(1, b.w), availH / Math.max(1, b.h));
    const fitAll = Math.min(1.25, Math.max(this.min, scale(all)));
    const b = region || all;
    this.zoom = region ? Math.max(fitAll, Math.min(1, scale(b))) : fitAll;
    this.x = inset.left + pad + (availW - b.w * this.zoom) / 2 - b.x * this.zoom;
    this.y = inset.top + pad + (availH - b.h * this.zoom) / 2 - b.y * this.zoom;
    if (animate && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.world.classList.add('is-gliding');
      clearTimeout(this.glideTimer);
      this.glideTimer = setTimeout(() => this.world.classList.remove('is-gliding'), 500);
    }
    this.apply();
  }
}
