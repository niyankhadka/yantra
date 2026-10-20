/**
 * YantraEngine - diagram state: scenarios, steps, modes, selection, autoplay
 * and dragged-position overrides. Geometry comes from core/computeScene.
 */
import { normalize, getMode } from '../core/model.js';
import { computeScene } from '../core/scene.js';
import { computeSequenceScene, hasSequence } from '../core/sequence.js';
import { lint } from '../core/lint.js';
import { layoutStorageKey } from './hash.js';

export class YantraEngine {
  constructor(payload) {
    this.listeners = new Map();
    this.playSpeed = 4500; // ms per step
    this.load(payload);
  }

  load(payload) {
    this.pause();
    this.payload = payload;
    this.model = normalize(payload);
    this.scenarioIndex = 0;
    this.stepIndex = 0;
    this.modeId = getMode(this.model, this.model.meta.defaultMode)?.id;
    this.view = this.model.meta.view === 'sequence' ? 'sequence' : 'flow';
    this.selectedNodeId = null;
    this.layoutCache = new Map();
    this.overrides = this.readOverrides();
    this.scene = null;
    this.emit('loaded', this.model);
  }

  // --- Geometry -----------------------------------------------------------
  /** Scene of the active view: the flow graph or the sequence of the current scenario. */
  getScene() {
    if (this.getView() !== 'sequence') return this.getFlowScene();
    if (!this.sequenceScene) this.sequenceScene = computeSequenceScene(this.payload, { modeId: this.modeId, scenarioIndex: this.scenarioIndex });
    return this.sequenceScene;
  }

  /** The node-link scene, whatever the view (connections, counts, layout export). */
  getFlowScene() {
    if (!this.scene) {
      this.scene = computeScene(this.payload, { modeId: this.modeId, overrides: this.overrides, layoutCache: this.layoutCache });
    }
    return this.scene;
  }

  invalidate() {
    this.scene = null;
    this.sequenceScene = null;
  }

  // --- Views (flow | sequence) ----------------------------------------------
  /** The sequence view needs at least one step with highlightEdges in the scenario. */
  canSequence() {
    return hasSequence(this.payload, { scenarioIndex: this.scenarioIndex });
  }

  getView() {
    return this.view === 'sequence' && this.canSequence() ? 'sequence' : 'flow';
  }

  setView(view) {
    const next = view === 'sequence' ? 'sequence' : 'flow';
    if (next === this.view) return;
    this.view = next;
    this.sequenceScene = null;
    this.emit('viewChanged', this.getView());
  }

  cycleView() {
    if (this.canSequence()) this.setView(this.getView() === 'sequence' ? 'flow' : 'sequence');
  }

  moveNode(id, x, y) {
    this.overrides.set(id, { x, y });
    this.invalidate();
  }

  commitMoves() {
    this.writeOverrides();
  }

  resetLayout() {
    this.overrides.clear();
    this.writeOverrides();
    this.invalidate();
    this.emit('layoutReset');
  }

  hasCustomLayout() {
    return this.overrides.size > 0;
  }

  /** Payload with current positions written back (switches to manual layout). */
  exportPayload() {
    const out = JSON.parse(JSON.stringify(this.payload));
    if (!this.overrides.size) return out;
    const placed = new Map(this.getFlowScene().nodes.map((n) => [n.id, n]));
    out.meta = { ...out.meta, layout: { ...(out.meta?.layout || {}), mode: 'manual' } };
    for (const n of out.nodes || []) {
      const p = placed.get(n.id);
      if (p) {
        n.x = p.x;
        n.y = p.y;
      }
    }
    return out;
  }

  storageKey() {
    return layoutStorageKey(this.payload);
  }

  readOverrides() {
    try {
      const raw = localStorage.getItem(this.storageKey());
      return new Map(raw ? Object.entries(JSON.parse(raw)) : []);
    } catch {
      return new Map();
    }
  }

  writeOverrides() {
    try {
      if (this.overrides.size) localStorage.setItem(this.storageKey(), JSON.stringify(Object.fromEntries(this.overrides)));
      else localStorage.removeItem(this.storageKey());
    } catch {
      // storage unavailable (private mode, file:// restrictions) - layout stays in memory
    }
  }

  // --- Modes --------------------------------------------------------------
  getModes() {
    return this.model.modes;
  }

  getMode() {
    return getMode(this.model, this.modeId);
  }

  setMode(id) {
    if (id === this.modeId || !this.model.modes.some((m) => m.id === id)) return;
    this.modeId = id;
    this.selectedNodeId = null;
    this.invalidate();
    this.emit('modeChanged', this.getMode());
  }

  cycleMode() {
    const modes = this.model.modes;
    const i = modes.findIndex((m) => m.id === this.modeId);
    this.setMode(modes[(i + 1) % modes.length].id);
  }

  // --- Scenarios & steps --------------------------------------------------
  getScenarios() {
    return this.model.scenarios;
  }

  getScenario() {
    return this.model.scenarios[this.scenarioIndex];
  }

  setScenario(index) {
    if (index === this.scenarioIndex || index < 0 || index >= this.model.scenarios.length) return;
    const view = this.getView();
    this.scenarioIndex = index;
    this.stepIndex = 0;
    this.sequenceScene = null;
    if (view !== this.getView()) this.emit('viewChanged', this.getView());
    this.emit('scenarioChanged', this.getScenario());
    this.emit('stepChanged', this.getStep());
  }

  getSteps() {
    return this.getScenario()?.steps || [];
  }

  getStep() {
    return this.getSteps()[this.stepIndex] || null;
  }

  goToStep(index) {
    const steps = this.getSteps();
    if (index < 0 || index >= steps.length || index === this.stepIndex) return;
    this.stepIndex = index;
    this.emit('stepChanged', this.getStep());
    if (this.playing) this.schedule();
  }

  next() {
    this.goToStep(this.stepIndex + 1);
  }

  restart() {
    if (this.stepIndex === 0 && this.playing) this.schedule();
    this.goToStep(0);
  }

  isLastStep() {
    return this.stepIndex >= this.getSteps().length - 1;
  }

  prev() {
    this.goToStep(this.stepIndex - 1);
  }

  /** Highlight sets for the current step; empty when it is an overview. */
  getHighlight() {
    const step = this.getStep();
    const scene = this.getScene();
    const nodes = new Set(step?.highlightNodes || step?.activeNodes || []);
    const edges = new Set(step?.highlightEdges || step?.activeEdges || []);
    const visible = scene.nodes.filter((n) => nodes.has(n.id)).length;
    if (!nodes.size || visible === scene.nodes.length) return { nodes: new Set(), edges: new Set(), overview: true };
    return { nodes, edges, overview: false };
  }

  // --- Selection ----------------------------------------------------------
  selectNode(id) {
    if (!this.getScene().nodes.some((n) => n.id === id)) return;
    this.selectedNodeId = id;
    this.emit('selectionChanged', id);
  }

  clearSelection() {
    if (!this.selectedNodeId) return;
    this.selectedNodeId = null;
    this.emit('selectionChanged', null);
  }

  getSelected() {
    return this.getScene().nodes.find((n) => n.id === this.selectedNodeId) || null;
  }

  edgesOf(id) {
    return this.getFlowScene().edges.filter((e) => e.edge.source === id || e.edge.target === id);
  }

  nodeTitle(id) {
    return this.model.nodes.find((n) => n.id === id)?.data?.title || id;
  }

  // --- Autoplay -----------------------------------------------------------
  togglePlay() {
    if (this.playing) this.pause();
    else this.play();
  }

  /** Autoplay dwells playSpeed ms on each step and stops after the last one. */
  play() {
    if (this.playing || this.getSteps().length < 2) return;
    this.playing = true;
    this.emit('playChanged', true);
    if (this.isLastStep()) this.goToStep(0); // replay from the start
    else this.schedule();
  }

  pause() {
    if (!this.playing) return;
    this.playing = false;
    clearTimeout(this.timer);
    this.emit('playChanged', false);
  }

  schedule() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => (this.isLastStep() ? this.pause() : this.next()), this.playSpeed);
    this.emit('tick', this.playSpeed);
  }

  setSpeed(ms) {
    this.playSpeed = ms;
    if (this.playing) this.schedule();
  }

  validate() {
    return lint(this.payload);
  }

  // --- Events -------------------------------------------------------------
  on(event, fn) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event).add(fn);
    return () => this.listeners.get(event).delete(fn);
  }

  emit(event, data) {
    this.listeners.get(event)?.forEach((fn) => {
      try {
        fn(data);
      } catch (err) {
        console.error(`[yantra] "${event}" listener failed:`, err);
      }
    });
  }
}
