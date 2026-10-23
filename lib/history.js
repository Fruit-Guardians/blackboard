// Read-only event projections. The event log remains the only source of truth.
import { apply, emptyGraph, isFutureEvent } from './model.js';

const copy = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
function same(a, b) {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length &&
    keys.every((key) => Object.hasOwn(b, key) && same(a[key], b[key]));
}
const absent = (value) => value === undefined ? null : copy(value);

function changedFields(before, after) {
  return [...new Set([...Object.keys(before || {}), ...Object.keys(after || {})])]
    .filter((key) => !same(before?.[key], after?.[key])).sort();
}

function diffNodes(before, after, ids = new Set([...Object.keys(before), ...Object.keys(after)])) {
  const result = { added: [], updated: [], removed: [] };
  for (const id of ids) {
    const a = before[id];
    const b = after[id];
    if (!a && b) result.added.push(copy(b));
    else if (a && !b) result.removed.push(copy(a));
    else if (a && b && !same(a, b)) {
      result.updated.push({ id, before: copy(a), after: copy(b), fields: changedFields(a, b) });
    }
  }
  return result;
}

function diffEdges(before, after, ids = new Set([...Object.keys(before), ...Object.keys(after)])) {
  const result = { added: [], removed: [] };
  for (const id of ids) {
    const a = before[id];
    const b = after[id];
    // Same identity but a changed payload is a replacement, not an invisible edit.
    if (a && !same(a, b)) result.removed.push(copy(a));
    if (b && !same(a, b)) result.added.push(copy(b));
  }
  return result;
}

function eventMetadata(ev, index) {
  return {
    index,
    eventId: ev?.eventId ?? null,
    op: ev?.op ?? null,
    at: ev?.at ?? ev?.node?.ts ?? ev?.edge?.ts ?? ev?.set?.updated ?? null,
    by: ev?.by ?? ev?.node?.author ?? ev?.set?.updatedBy ?? null,
    reason: ev?.reason ?? ev?.node?.reason ?? ev?.set?.reason ?? null,
  };
}

function anyChanges(delta) {
  return delta.nodes.added.length || delta.nodes.updated.length || delta.nodes.removed.length ||
    delta.edges.added.length || delta.edges.removed.length;
}

/** Replay without mutating caller-owned events or creating cache files. */
function walk(events, options, onStep) {
  let graph = emptyGraph();
  const integrity = {
    corruptLines: options.corrupt ?? options.corruptLines ?? 0,
    futureEvents: options.future ?? options.futureEvents ?? 0,
    unknownOps: 0,
    rejected: 0,
  };
  let index = 0;
  for (const input of events) {
    if (isFutureEvent(input)) { integrity.futureEvents++; continue; }
    const ev = copy(input);
    const nodeIds = new Set();
    const edgeIds = new Set();
    if (ev?.op === 'node' && typeof ev.node?.id === 'string') nodeIds.add(ev.node.id);
    else if (ev?.op === 'patch') nodeIds.add(ev.id);
    else if (ev?.op === 'edge' && typeof ev.edge?.id === 'string') edgeIds.add(ev.edge.id);
    else if (ev?.op === 'remove') {
      if (ev.kind === 'edge') edgeIds.add(ev.id);
      else if (ev.kind === 'node') {
        nodeIds.add(ev.id);
        for (const edge of Object.values(graph.edges)) {
          if (edge.from === ev.id || edge.to === ev.id) edgeIds.add(edge.id);
        }
      }
    } else if (ev?.op === 'reset') {
      for (const id of Object.keys(graph.nodes)) nodeIds.add(id);
      for (const id of Object.keys(graph.edges)) edgeIds.add(id);
    }
    const beforeNodes = Object.fromEntries([...nodeIds].map((id) => [id, copy(graph.nodes[id])]));
    const beforeEdges = Object.fromEntries([...edgeIds].map((id) => [id, copy(graph.edges[id])]));
    const oldRejected = graph.integrity.rejected;
    const oldUnknown = graph.integrity.unknownOps;
    graph = apply(graph, ev);
    integrity.rejected += Math.max(0, graph.integrity.rejected - oldRejected);
    integrity.unknownOps += Math.max(0, graph.integrity.unknownOps - oldUnknown);
    const delta = {
      ...eventMetadata(ev, index),
      nodes: diffNodes(beforeNodes, graph.nodes, nodeIds),
      edges: diffEdges(beforeEdges, graph.edges, edgeIds),
    };
    onStep({ ev, index, graph, delta });
    index++;
  }
  return { graph, integrity };
}

function notFound(error, properties) {
  return Object.assign(new Error(error), { status: 404, ...properties });
}

/** Includes removed nodes and relation changes, but never guesses missing provenance. */
export function buildNodeHistory(events, nodeId, options = {}) {
  const entries = [];
  let found = false;
  const { integrity } = walk(events, options, ({ graph, delta }) => {
    if (graph.nodes[nodeId]) found = true;
    const added = delta.nodes.added.find((node) => node.id === nodeId);
    const removed = delta.nodes.removed.find((node) => node.id === nodeId);
    const updated = delta.nodes.updated.find((node) => node.id === nodeId);
    const edges = {
      added: delta.edges.added.filter((edge) => edge.from === nodeId || edge.to === nodeId),
      removed: delta.edges.removed.filter((edge) => edge.from === nodeId || edge.to === nodeId),
    };
    if (!added && !removed && !updated && !edges.added.length && !edges.removed.length) return;
    const changes = {};
    if (added || removed) changes.$node = { before: removed || null, after: added || null };
    if (updated) {
      for (const field of updated.fields) {
        changes[field] = { before: absent(updated.before[field]), after: absent(updated.after[field]) };
      }
    }
    const { nodes: _nodes, edges: _edges, ...metadata } = delta;
    entries.push({ ...metadata, changes, edges });
  });
  if (!found) throw notFound('node_not_found', { nodeId });
  return { schema: 'blackboard.history.v1', readOnly: true, prescriptive: false, nodeId, entries, integrity };
}

/** Compare after the last matching checkpoint event, never by wall-clock time. */
export function buildCheckpointChanges(events, checkpointId, options = {}) {
  let baseline = null;
  let since = null;
  const changes = [];
  const { graph, integrity } = walk(events, options, ({ ev, index, graph: current, delta }) => {
    if (ev?.op === 'checkpoint' && ev.checkpoint?.id === checkpointId && current.checkpoints[checkpointId]) {
      baseline = { nodes: copy(current.nodes), edges: copy(current.edges) };
      since = {
        id: checkpointId,
        at: ev.checkpoint.at ?? null,
        index,
        summary: ev.checkpoint.summary ?? '',
      };
      changes.length = 0;
    } else if (baseline && anyChanges(delta)) changes.push(delta);
  });
  if (!baseline) throw notFound('checkpoint_not_found', { since: checkpointId });
  return {
    schema: 'blackboard.changes.v1',
    readOnly: true,
    prescriptive: false,
    since,
    nodes: diffNodes(baseline.nodes, graph.nodes),
    edges: diffEdges(baseline.edges, graph.edges),
    events: changes,
    integrity,
  };
}
