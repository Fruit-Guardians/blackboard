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
// Confidence is independent from workflow status and severity. A candidate can
// be active, a reproduced issue can still be under remediation, and neither
// concept should be inferred from the node type.
export const CONFIDENCE_LEVELS = ['suspected', 'static-confirmed', 'reproduced', 'confirmed'];
export const CONFIDENCE_LABEL = {
  suspected: '待验证',
  'static-confirmed': '静态确认',
  reproduced: '已复现',
  confirmed: '已确认',
};

export function emptyGraph() {
  return {
    meta: {}, nodes: {}, edges: {}, cursors: {}, cursorTrail: [],
    activities: {}, checkpoints: {},
    // Events the log held but replay could not use; lint reports them.
    integrity: { corruptLines: 0, rejected: 0 },
  };
}

/** Replay one event onto the blackboard in place. Events are the source of truth. */
export function apply(g, ev) {
  if (!ev || typeof ev !== 'object') return g;
  switch (ev.op) {
    case 'node':
      if (ev.node && typeof ev.node.id === 'string' && ev.node.id && typeof ev.node.type === 'string') {
        g.nodes[ev.node.id] = ev.node;
      } else if (g.integrity) g.integrity.rejected++;
      break;
    case 'edge': {
      // An edge is only meaningful between two existing, distinct nodes; a
      // damaged or hand-edited log must not leave dangling edges in the graph.
      const e = ev.edge;
      if (e && typeof e.id === 'string' && e.id && e.from !== e.to && g.nodes[e.from] && g.nodes[e.to]) {
        g.edges[e.id] = e;
      } else if (g.integrity) g.integrity.rejected++;
      break;
    }
    case 'patch': {
      const n = g.nodes[ev.id];
      if (n && ev.set) {
        // A node's identity and creation time are fixed; everything else may change.
        const { id: _id, ts: _ts, ...rest } = ev.set;
        if (typeof rest.type !== 'string' || !rest.type) delete rest.type;
        Object.assign(n, rest);
      }
      break;
    }
    case 'remove': {
      // A human tidying the board. The log keeps the whole history; the graph just stops showing it.
      if (ev.kind === 'edge') delete g.edges[ev.id];
      else if (ev.kind === 'node' && g.nodes[ev.id]) {
        delete g.nodes[ev.id];
        for (const [id, e] of Object.entries(g.edges)) if (e.from === ev.id || e.to === ev.id) delete g.edges[id];
      }
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

/** Next short id for `prefix` ("n" → n1, n2…), derived from what already exists. */
export function nextShortId(existing, prefix) {
  const re = new RegExp(`^${prefix}(\\d+)$`);
  let max = 0;
  for (const id of Object.keys(existing)) {
    const m = re.exec(id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  let id = `${prefix}${max + 1}`;
  while (existing[id]) id = `${prefix}${Number(id.slice(prefix.length)) + 1}`;
  return id;
}

/**
 * Resolve what an Agent typed to a real id. Accepts the exact id, the form
 * copied out of a digest ("[n12]"), a case-insensitive match, or a unique prefix
 * (handy for older, long ids). Ambiguity is an error that lists the candidates.
 */
export function resolveRef(map, ref, label = 'node') {
  const raw = String(ref ?? '').trim();
  const clean = raw.replace(/^[[#@]+/, '').replace(/[\],.;:)]+$/, '');
  if (!clean) throw new Error(`no such ${label}: ${raw}`);
  if (map[clean]) return clean;
  const keys = Object.keys(map);
  const lower = clean.toLowerCase();
  const ci = keys.filter((k) => k.toLowerCase() === lower);
  if (ci.length === 1) return ci[0];
  const prefixed = keys.filter((k) => k.toLowerCase().startsWith(lower));
  if (prefixed.length === 1) return prefixed[0];
  if (prefixed.length > 1) {
    const shown = prefixed.slice(0, 5).join(', ');
    throw new Error(`ambiguous ${label} reference "${clean}": ${shown}${prefixed.length > 5 ? ', …' : ''}`);
  }
  throw new Error(`no such ${label}: ${clean}`);
}

export function edgeId(from, to, kind) {
  return `${from}->${to}:${kind}`;
}

export function currentCursor(g, agentId = 'agent:primary') {
  const id = g.cursors?.[agentId]?.to || (agentId === 'agent:primary' ? g.meta?.focus : null) || null;
  // A cursor on a node that has since been removed points at nothing.
  return id && g.nodes?.[id] ? id : null;
}
