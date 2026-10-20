// Shared blackboard model. Imported by the CLI, server, and browser viewer.
// Keep this file free of Node-only APIs.

export const NODE_TYPES = [
  'start', 'goal', 'intent', 'observation', 'fact', 'hypothesis', 'question',
  'action', 'result', 'finding', 'vuln', 'hint', 'summary', 'note',
  // Legacy node type. New compaction events use checkpoints instead.
  'compact',
];

export const EDGE_KINDS = [
  'related-to', 'derived-from', 'supports', 'contradicts', 'depends-on',
  'proves', 'caused-by', 'refines', 'duplicates', 'supersedes', 'resolves',
  // Legacy relations remain readable.
  'derive', 'intent-chain', 'produce', 'prove',
];

export const TYPE_PREFIX = {
  start: 's', goal: 'g', intent: 'i', observation: 'o', fact: 'f',
  hypothesis: 'hy', question: 'q', action: 'a', result: 'r', finding: 'fd',
  vuln: 'v', hint: 'h', summary: 'sm', note: 'n', compact: 'c',
};

export const TYPE_LABEL = {
  start: '起点', goal: '目标', intent: '意图', observation: '观察', fact: '事实',
  hypothesis: '猜测', question: '问题', action: '行动', result: '结果',
  finding: '发现', vuln: '漏洞', hint: '提示', summary: '摘要', note: '记录',
  compact: '压缩',
};

export const EDGE_LABEL = {
  'related-to': '相关', 'derived-from': '派生自', supports: '支持',
  contradicts: '反驳', 'depends-on': '依赖', proves: '证明',
  'caused-by': '由…导致', refines: '细化', duplicates: '重复',
  supersedes: '取代', resolves: '解决',
  derive: '派生', 'intent-chain': '意图链', produce: '产出', prove: '证明',
};

export const NODE_STATES = [
  'open', 'active', 'done', 'blocked', 'dead', 'confirmed', 'refuted', 'deferred',
  'superseded',
];
export const INTENT_STATUS = NODE_STATES;
export const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'];

export function emptyGraph() {
  return {
    meta: {}, nodes: {}, edges: {}, cursors: {}, cursorTrail: [],
    activities: {}, checkpoints: {},
  };
}

/** Replay one event onto the blackboard in place. Events are the source of truth. */
export function apply(g, ev) {
  if (!ev || typeof ev !== 'object') return g;
  switch (ev.op) {
    case 'node':
      if (ev.node && typeof ev.node.id === 'string' && ev.node.id && typeof ev.node.type === 'string') {
        g.nodes[ev.node.id] = ev.node;
      }
      break;
    case 'edge': {
      // An edge is only meaningful between two existing, distinct nodes; a
      // damaged or hand-edited log must not leave dangling edges in the graph.
      const e = ev.edge;
      if (e && typeof e.id === 'string' && e.id && e.from !== e.to && g.nodes[e.from] && g.nodes[e.to]) {
        g.edges[e.id] = e;
      }
      break;
    }
    case 'patch': {
      const n = g.nodes[ev.id];
      if (n && ev.set) Object.assign(n, ev.set);
      break;
    }
    case 'cursor': {
      const c = ev.cursor;
      if (!c || !c.agentId) break;
      g.cursors[c.agentId] = c;
      g.cursorTrail.push(c);
      // Legacy projection for old viewers and exports.
      if (c.agentId === 'agent:primary') g.meta.focus = c.to || null;
      break;
    }
    case 'activity':
      if (ev.activity && ev.activity.id) g.activities[ev.activity.id] = ev.activity;
      break;
    case 'checkpoint':
      if (ev.checkpoint && ev.checkpoint.id) g.checkpoints[ev.checkpoint.id] = ev.checkpoint;
      break;
    case 'meta':
      if (ev.set) Object.assign(g.meta, ev.set);
      break;
    case 'reset':
      return emptyGraph();
    default:
      break;
  }
  return g;
}

export function applyAll(g, events) {
  // `apply` returns a fresh graph for `reset`, so its result must be kept.
  for (const ev of events) g = apply(g, ev);
  return g;
}

/** The default relation is deliberately weak; semantic links are Agent decisions. */
export function inferEdgeKind() {
  return 'related-to';
}

export function edgeId(from, to, kind) {
  return `${from}->${to}:${kind}`;
}

export function currentCursor(g, agentId = 'agent:primary') {
  return g.cursors?.[agentId]?.to || (agentId === 'agent:primary' ? g.meta?.focus : null) || null;
}
