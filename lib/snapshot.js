// One graph projection for live HTTP/SSE and read-only offline exports.
import { replay, readState, stats } from './store.js';
import { projectNodeMap } from './model.js';
import { buildAgentDigests } from './digest.js';
import { GRAPH_SCHEMA } from './contracts.js';

export function buildGraphSnapshot(cwd, { writable = false, includeActivityDetails = true } = {}) {
  const graph = replay(cwd);
  const state = readState(cwd);
  const digests = buildAgentDigests(graph, cwd);
  return {
    schema: GRAPH_SCHEMA,
    meta: {
      ...graph.meta,
      title: graph.meta.title || state.title,
      focus: [graph.meta.focus, state.focus].find((id) => id && graph.nodes[id]) || null,
      session: state.session,
      writable: writable ? true : undefined,
    },
    nodes: projectNodeMap(graph.nodes),
    edges: graph.edges,
    cursors: graph.cursors,
    cursorTrail: graph.cursorTrail.slice(-100),
    // Raw tool material belongs in the live local viewer, never a shared HTML file.
    activities: includeActivityDetails ? graph.activities : Object.fromEntries(
      Object.values(graph.activities).map((activity) => [activity.id, {
        id: activity.id,
        tool: activity.tool,
        status: activity.status,
        at: activity.at,
        linkedNodeIds: activity.linkedNodeIds,
      }]),
    ),
    checkpoints: graph.checkpoints,
    stats: stats(graph),
    digest: digests['agent:primary'],
    digests,
  };
}
