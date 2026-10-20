/**
 * Deep hierarchies in one frame: how many fold levels a diagram has, which
 * ids to fold for "fold to depth n", which folds hide a group (so focusing it
 * can open them), a group's trail of ancestors, and breadcrumb truncation.
 * Pure functions shared by the viewer, the CLI, the MCP server and lint.
 */
import { normalize, visibleGraph, groupIndex } from './model.js';
import { isTreeAlgorithm, treeIndex } from './tree.js';

/** Levels "fold to depth" offers in the viewer (keys 1-6, the toolbar menu). */
export const DEPTH_KEYS = 6;

/**
 * Fold levels of a diagram (in a mode): `kind` is 'groups' (layered layout:
 * nested group boxes), 'tree' (tree and mind-map layouts: card subtrees) or
 * null when nothing folds; `levels` counts box levels (groups) or card levels
 * below the root (trees).
 */
export function foldLevels(payload, { modeId } = {}) {
  const model = normalize(payload);
  const { nodes, edges } = visibleGraph(model, modeId);
  const ids = nodes.map((n) => n.id);
  if (isTreeAlgorithm(model.layout.algorithm)) {
    const index = treeIndex(ids, edges);
    const depths = ids.filter((id) => (index.children.get(id) || []).length).map((id) => index.depth.get(id) + 1);
    return { kind: depths.length ? 'tree' : null, levels: Math.max(0, ...depths), index, model };
  }
  const gi = groupIndex(model.groups, new Set(ids));
  const live = gi.list.filter((g) => g.nodes.length && g.group?.kind !== 'region');
  return { kind: live.length ? 'groups' : null, levels: live.length ? Math.max(...live.map((g) => g.depth)) + 1 : 0, gi, live, model };
}

/**
 * Ids to fold so that `depth` levels stay open: every group box nested
 * `depth` or more deep becomes a summary card (0 folds even the outermost
 * boxes), or, in tree layouts, every card `depth` levels below the root that
 * has children folds its subtree (0 and 1 both leave only the roots).
 * Inner ids are listed too, so unfolding a box shows its children folded.
 * A depth of null / Infinity unfolds everything ([]).
 */
export function foldsForDepth(payload, depth, opts = {}) {
  if (depth === null || depth === undefined || depth === Infinity) return [];
  const d = Math.max(0, Math.floor(Number(depth)) || 0);
  const info = foldLevels(payload, opts);
  if (info.kind === 'tree') {
    const { index } = info;
    return [...index.depth.keys()].filter((id) => index.depth.get(id) >= Math.max(0, d - 1) && (index.children.get(id) || []).length);
  }
  if (info.kind === 'groups') return info.live.filter((g) => g.depth >= d).map((g) => g.id);
  return [];
}

/** The depth whose folds equal `collapsed` exactly (same ids), or null. */
export function depthOfFolds(payload, collapsed, opts = {}) {
  const want = new Set(collapsed || []);
  const info = foldLevels(payload, opts);
  if (!info.kind) return null;
  for (let d = 0; d <= info.levels; d++) {
    const ids = foldsForDepth(payload, d, opts);
    if (ids.length === want.size && ids.every((id) => want.has(id))) return d;
  }
  return null;
}

/** A group's ancestors, outermost first, ending with the group itself: [{ id, title }]. */
export function groupTrail(payload, id) {
  const model = normalize(payload);
  const gi = groupIndex(model.groups, new Set(model.nodes.map((n) => n.id)));
  if (!gi.byId.has(id)) return [];
  return gi.ancestors(id).map((a) => ({ id: a, title: gi.byId.get(a).title }));
}

/** Folded ids that hide a group (its folded ancestors) or turn it into a summary card (itself). */
export function foldsHidingGroup(payload, id, collapsed) {
  const want = collapsed instanceof Set ? collapsed : new Set(collapsed || []);
  return groupTrail(payload, id).map((g) => g.id).filter((g) => want.has(g));
}

/**
 * Breadcrumb items to show for a trail of `n` entries: every index when it is
 * short, otherwise the first, a gap (null: the hidden middle, offered as a
 * menu) and the last `tail` entries. `max` is the longest trail shown whole.
 */
export function crumbWindow(n, { max = 4, tail = 2 } = {}) {
  const all = Array.from({ length: n }, (_, i) => i);
  if (n <= max) return { shown: all, hidden: [] };
  return { shown: [0, null, ...all.slice(n - tail)], hidden: all.slice(1, n - tail) };
}
