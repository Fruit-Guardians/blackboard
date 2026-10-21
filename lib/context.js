// Agent-facing context projection. This module is deliberately read-only:
// it compresses authored blackboard data but never infers, writes, ranks, or
// chooses the Agent's next action.

import { currentCursor } from './model.js';
import { stats } from './store.js';

const OPEN_STATES = new Set(['open', 'active', 'blocked']);
const CLOSED_STATES = new Set(['done', 'dead', 'refuted', 'superseded']);

function newest(a, b) {
  return (b.updated || b.ts || b.at || 0) - (a.updated || a.ts || a.at || 0);
}

function clip(value, limit) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

function compactNode(node) {
  if (!node) return null;
  const result = {
    id: node.id,
    type: node.type,
    title: clip(node.title, 240),
  };
  if (node.status) result.status = node.status;
  if (node.severity) result.severity = node.severity;
  if (node.confidence) result.confidence = node.confidence;
  if (node.tags?.length) result.tags = node.tags.slice(0, 12);
  if (node.detail) result.detail = clip(node.detail, 480);
  if (node.loc) result.location = node.loc;
  if (node.updated || node.ts) result.at = node.updated || node.ts;
  return result;
}

function compactCheckpoint(checkpoint) {
  return {
    id: checkpoint.id,
    at: checkpoint.at,
    cursorNodeId: checkpoint.cursorNodeId || null,
    summary: clip(checkpoint.summary, 360),
  };
}

function compactActivity(activity) {
  return {
    id: activity.id,
    tool: activity.tool || null,
    status: activity.status || null,
    summary: clip(activity.summary, 220),
    at: activity.at || null,
    linkedNodeIds: (activity.linkedNodeIds || []).slice(0, 12),
  };
}

function resolveSince(g, since) {
  if (since === undefined || since === null || since === '') return { value: null, source: null };
  if (typeof since === 'number' || /^\d+$/.test(String(since))) {
    return { value: Number(since), source: 'timestamp' };
  }
  const checkpoint = g.checkpoints?.[String(since)];
  return checkpoint
    ? { value: checkpoint.at || 0, source: `checkpoint:${checkpoint.id}` }
    : { value: null, source: `unresolved:${since}` };
}

function neighborhood(g, focusId, depth) {
  if (!focusId || !g.nodes[focusId] || depth < 1) return [];
  const adjacency = new Map(Object.keys(g.nodes).map((id) => [id, []]));
  for (const edge of Object.values(g.edges)) {
    adjacency.get(edge.from)?.push({ nodeId: edge.to, edge, direction: 'out' });
    adjacency.get(edge.to)?.push({ nodeId: edge.from, edge, direction: 'in' });
  }
  const result = [];
  const seen = new Set([focusId]);
  let wave = [focusId];
  for (let level = 1; level <= depth; level += 1) {
    const next = [];
    for (const id of wave) {
      for (const link of adjacency.get(id) || []) {
        if (seen.has(link.nodeId)) continue;
        seen.add(link.nodeId);
        next.push(link.nodeId);
        result.push({
          depth: level,
          direction: link.direction,
          relation: link.edge.kind,
          node: compactNode(g.nodes[link.nodeId]),
        });
      }
    }
    wave = next;
  }
  return result;
}

function estimateTokens(value) {
  return Math.ceil(JSON.stringify(value).length / 4);
}

/**
 * Build a bounded, deterministic context packet for an Agent.
 * `budgetTokens` is a best-effort JSON-size budget, not a tokenizer promise.
 */
export function buildAgentContext(g, options = {}) {
  const agentId = options.agentId || 'agent:primary';
  const depth = Math.max(0, Math.min(5, Number(options.depth ?? 2) || 0));
  const budgetTokens = Math.max(256, Math.min(64_000, Number(options.budgetTokens ?? 4000) || 4000));
  const maxItems = Math.max(1, Math.min(200, Number(options.maxItems ?? 24) || 24));
  const requestedFocus = options.focus || null;
  const focusId = requestedFocus || currentCursor(g, agentId);
  const focus = focusId ? g.nodes[focusId] || null : null;
  const cursor = g.cursors?.[agentId] || null;
  const since = resolveSince(g, options.since);
  const nodes = Object.values(g.nodes || {}).sort(newest);
  const checkpoints = Object.values(g.checkpoints || {}).filter((item) => item.agentId === agentId).sort(newest);
  const activities = Object.values(g.activities || {}).filter((item) => !item.agentId || item.agentId === agentId).sort(newest);

  const candidates = {
    objectives: nodes.filter((node) => node.type === 'goal' && !CLOSED_STATES.has(node.status)).map(compactNode),
    neighborhood: neighborhood(g, focusId, depth),
    openThreads: nodes.filter((node) =>
      ['intent', 'hypothesis', 'question', 'action'].includes(node.type) &&
      OPEN_STATES.has(node.status || 'open')).map(compactNode),
    findings: nodes.filter((node) =>
      ['finding', 'vuln'].includes(node.type) && node.status !== 'superseded').map(compactNode),
    confirmedFacts: nodes.filter((node) =>
      ['fact', 'observation', 'result'].includes(node.type) &&
      (['confirmed', 'done'].includes(node.status) ||
        ['static-confirmed', 'reproduced', 'confirmed'].includes(node.confidence))).map(compactNode),
    notes: nodes.filter((node) => ['note', 'hint', 'summary'].includes(node.type) && node.status !== 'superseded').map(compactNode),
    recentChanges: since.value === null ? [] : nodes
      .filter((node) => (node.updated || node.ts || 0) > since.value)
      .map(compactNode),
    checkpoints: checkpoints.map(compactCheckpoint),
    recentActivity: activities.map(compactActivity),
  };

  const packet = {
    schema: 'blackboard.context.v1',
    policy: {
      readOnly: true,
      prescriptive: false,
      nextStepSelection: 'agent-controlled',
    },
    board: {
      title: g.meta?.title || null,
      stats: stats(g),
    },
    request: {
      agentId,
      focus: focusId || null,
      requestedFocus,
      cursorReason: cursor?.reason || null,
      cursorAt: cursor?.at || null,
      depth,
      budgetTokens,
      since: options.since ?? null,
      sinceAt: since.value,
      sinceSource: since.source,
    },
    currentFocus: compactNode(focus),
    objectives: [],
    neighborhood: [],
    openThreads: [],
    findings: [],
    confirmedFacts: [],
    notes: [],
    recentChanges: [],
    checkpoints: [],
    recentActivity: [],
    relations: [],
    omitted: {},
    truncated: false,
    estimatedTokens: 0,
  };

  let used = estimateTokens(packet);
  const priorities = [
    ['objectives', maxItems],
    ['neighborhood', maxItems],
    // When a caller explicitly asks for a delta, preserve that delta before
    // filling the packet with the board's general background collections.
    ...(since.value === null ? [] : [['recentChanges', maxItems]]),
    ['openThreads', maxItems],
    ['findings', maxItems],
    ['confirmedFacts', maxItems],
    ['notes', Math.min(8, maxItems)],
    ...(since.value === null ? [['recentChanges', maxItems]] : []),
    ['checkpoints', Math.min(8, maxItems)],
    ['recentActivity', Math.min(8, maxItems)],
  ];

  for (const [key, limit] of priorities) {
    const source = candidates[key];
    for (const item of source.slice(0, limit)) {
      const cost = estimateTokens(item) + 2;
      if (used + cost > budgetTokens) break;
      packet[key].push(item);
      used += cost;
    }
    const omitted = source.length - packet[key].length;
    if (omitted > 0) packet.omitted[key] = omitted;
  }

  const selectedIds = new Set();
  if (packet.currentFocus?.id) selectedIds.add(packet.currentFocus.id);
  for (const key of ['objectives', 'openThreads', 'findings', 'confirmedFacts', 'notes', 'recentChanges']) {
    for (const node of packet[key]) selectedIds.add(node.id);
  }
  for (const item of packet.neighborhood) if (item.node?.id) selectedIds.add(item.node.id);
  for (const edge of Object.values(g.edges || {}).sort(newest)) {
    if (!selectedIds.has(edge.from) || !selectedIds.has(edge.to)) continue;
    const compact = { id: edge.id, from: edge.from, to: edge.to, kind: edge.kind, label: edge.label || null };
    const cost = estimateTokens(compact) + 2;
    if (used + cost > budgetTokens) {
      packet.omitted.relations = (packet.omitted.relations || 0) + 1;
      continue;
    }
    packet.relations.push(compact);
    used += cost;
  }

  packet.truncated = Object.keys(packet.omitted).length > 0;
  packet.estimatedTokens = estimateTokens(packet);
  return packet;
}

export function renderAgentContext(packet) {
  const lines = [];
  lines.push(`# Agent Context${packet.board.title ? ` — ${packet.board.title}` : ''}`);
  lines.push('');
  lines.push(`- Agent: ${packet.request.agentId}`);
  lines.push(`- Focus: ${packet.currentFocus?.id || 'none'}`);
  lines.push(`- Budget: ~${packet.estimatedTokens}/${packet.request.budgetTokens} tokens`);
  lines.push(`- Policy: read-only, non-prescriptive, next step selected by Agent`);
  const sections = [
    ['Objectives', packet.objectives],
    ['Current neighborhood', packet.neighborhood.map((item) => item.node)],
    ['Open threads', packet.openThreads],
    ['Findings', packet.findings],
    ['Confirmed facts', packet.confirmedFacts],
    ['Notes', packet.notes],
    ['Recent changes', packet.recentChanges],
  ];
  if (packet.currentFocus) sections.splice(1, 0, ['Current focus', [packet.currentFocus]]);
  for (const [title, items] of sections) {
    lines.push('', `## ${title}`);
    if (!items.length) lines.push('_none_');
    else for (const item of items) lines.push(`- [${item.id}] ${item.type}: ${item.title}`);
  }
  if (packet.truncated) lines.push('', `Truncated: ${JSON.stringify(packet.omitted)}`);
  return lines.join('\n');
}
