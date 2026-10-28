// Agent-facing context projection. This module is deliberately read-only:
// it compresses authored blackboard data but never infers, writes, ranks, or
// chooses the Agent's next action.

import { currentCursor, projectNode } from './model.js';
import { stats } from './store.js';
import { isOpenThread, isRetiredInterpretation, isCurrentFinding, isConfirmedFact } from './semantics.js';
import { OUTPUTS } from './contracts.js';

const CLOSED_STATES = new Set(['done', 'dead', 'refuted', 'superseded']);

function newest(a, b) {
  return (b.updated || b.ts || b.at || 0) - (a.updated || a.ts || a.at || 0);
}

function recordedInputTruncation(record) {
  const value = record.inputTruncation;
  return value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length ? value : null;
}

function compactInputTruncation(record) {
  const value = recordedInputTruncation(record);
  return value ? { inputTruncation: structuredClone(value) } : {};
}

function inputTruncationMarkdown(record) {
  const value = recordedInputTruncation(record);
  return value ? [`  - Note: input was truncated at write time: ${JSON.stringify(value)}`] : [];
}

// Project authored records without shortening or rewriting their claims.
// Budget selection below admits a whole record or explicitly omits it; a
// condition at the end of a detail/summary is just as much data as its opening.
function compactNode(node) {
  if (!node) return null;
  const result = {
    id: node.id,
    type: node.type,
    title: node.title ?? '',
    status: node.status,
    severity: node.severity,
    confidence: node.confidence,
    ...compactInputTruncation(node),
  };
  if (node.tags?.length) result.tags = [...node.tags];
  if (node.detail) result.detail = node.detail;
  if (node.loc) result.location = node.loc;
  if (node.author) result.author = node.author;
  if (node.updatedBy) result.updatedBy = node.updatedBy;
  if (node.updated || node.ts) result.at = node.updated || node.ts;
  return projectNode(result);
}

function compactCheckpoint(checkpoint) {
  return {
    id: checkpoint.id,
    at: checkpoint.at,
    agentId: checkpoint.agentId || null,
    cursorNodeId: checkpoint.cursorNodeId || null,
    summary: checkpoint.summary ?? '',
    ...compactInputTruncation(checkpoint),
  };
}

function compactActivity(activity) {
  return {
    id: activity.id,
    tool: activity.tool || null,
    status: activity.status || null,
    summary: activity.summary ?? '',
    at: activity.at || null,
    linkedNodeIds: [...(activity.linkedNodeIds || [])],
  };
}

function resolveSince(g, since) {
  if (since === undefined || since === null || since === '') return { value: null, source: null };
  if (typeof since === 'number' || /^\d+$/.test(String(since))) {
    const value = Number(since);
    if (!Number.isSafeInteger(value) || value < 0) throw new Error('since must be a non-negative timestamp or an existing checkpoint');
    return { value, source: 'timestamp' };
  }
  const checkpoint = g.checkpoints?.[String(since)];
  if (!checkpoint) throw new Error(`no such checkpoint: ${since}`);
  return { value: checkpoint.at || 0, source: `checkpoint:${checkpoint.id}` };
}

// A checkpoint is an event boundary, not just a clock reading: writes later in
// the same millisecond still belong to the delta. Timestamps remain exclusive.
function contextDelta(g, since, events) {
  if (since.value === null) return { nodes: [], changes: [] };
  if (!Array.isArray(events)) throw new Error('events are required for incremental context');
  let start = 0;
  if (since.source.startsWith('checkpoint:')) {
    const id = since.source.slice('checkpoint:'.length);
    start = -1;
    for (let i = events.length - 1; i >= 0; i--) {
      if (events[i].op === 'checkpoint' && events[i].checkpoint?.id === id) { start = i + 1; break; }
    }
    if (start < 0) throw new Error(`checkpoint is missing from the event log: ${id}`);
  }
  const changedIds = new Set();
  const changes = [];
  for (let i = start; i < events.length; i++) {
    const ev = events[i];
    const at = ev.node?.ts ?? ev.set?.updated ?? ev.edge?.ts ?? ev.at;
    if (since.source === 'timestamp' && !(at > since.value)) continue;
    if (ev.op === 'node' && ev.node?.id) changedIds.add(ev.node.id);
    if (ev.op === 'patch' && ev.id) changedIds.add(ev.id);
    if (ev.op === 'edge' && ev.edge?.id) {
      const edge = ev.edge;
      changes.push({
        kind: 'relation-added', id: edge.id, from: edge.from, to: edge.to,
        relation: edge.kind, ...(edge.label ? { label: edge.label } : {}),
        ...compactInputTruncation(edge),
        at, eventId: ev.eventId,
      });
    }
    if (ev.op === 'remove' && ev.id && ['node', 'edge'].includes(ev.kind)) {
      changes.push({
        kind: ev.kind === 'node' ? 'node-removed' : 'relation-removed',
        id: ev.id, at, eventId: ev.eventId,
      });
    }
  }
  return {
    nodes: [...changedIds].map((id) => g.nodes[id]).filter(Boolean).sort(newest).map(compactNode),
    changes: changes.reverse(),
  };
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

// ASCII text averages ~4 characters per token in modern tokenizers, but CJK
// and other non-ASCII text is closer to ~1.3 tokens per character. Dividing
// every character by 4 underestimates Chinese-heavy boards several-fold and
// silently overfills `budgetTokens`. Exported for trial tooling reuse.
const NON_ASCII_TOKENS_PER_CHAR = 1.3;

export function estimateTokensText(text) {
  let ascii = 0;
  let other = 0;
  for (const ch of String(text)) {
    if (ch.charCodeAt(0) <= 0x7f) ascii += 1;
    else other += 1;
  }
  return ascii / 4 + other * NON_ASCII_TOKENS_PER_CHAR;
}

// Integer units represent both estimator weights exactly (0.25 and 1.3).
// This keeps budget accounting additive without repeatedly serializing the
// entire growing packet or accumulating fractional rounding errors.
const TOKEN_UNITS = 20;
const COMMA_UNITS = 5;
function tokenUnits(value) {
  return Math.round(estimateTokensText(JSON.stringify(value)) * TOKEN_UNITS);
}
function estimateTokens(value) {
  return Math.ceil(tokenUnits(value) / TOKEN_UNITS);
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
  const delta = contextDelta(g, since, options.events);

  const candidates = {
    objectives: nodes.filter((node) => node.type === 'goal' && !CLOSED_STATES.has(node.status)).map(compactNode),
    neighborhood: neighborhood(g, focusId, depth),
    openThreads: nodes.filter(isOpenThread).map(compactNode),
    findings: nodes.filter(isCurrentFinding).map(compactNode),
    confirmedFacts: nodes.filter(isConfirmedFact).map(compactNode),
    retiredNodes: nodes.filter(isRetiredInterpretation).map(compactNode),
    notes: nodes.filter((node) => ['note', 'hint', 'summary'].includes(node.type) && !isRetiredInterpretation(node)).map(compactNode),
    recentChanges: delta.nodes,
    changes: delta.changes,
    checkpoints: checkpoints.map(compactCheckpoint),
    recentActivity: activities.map(compactActivity),
  };

  // Every authored node belongs to at least one reported collection. Custom
  // types, unconfirmed observations, and completed threads are not discarded
  // just because this release does not assign them a semantic category.
  const classifiedIds = new Set(['objectives', 'openThreads', 'findings', 'confirmedFacts', 'retiredNodes', 'notes']
    .flatMap((key) => candidates[key].map((node) => node.id)));
  candidates.otherNodes = nodes.filter((node) => !classifiedIds.has(node.id)).map(compactNode);

  const packet = {
    schema: OUTPUTS.context.schema,
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
    currentFocus: null,
    objectives: [],
    neighborhood: [],
    openThreads: [],
    findings: [],
    confirmedFacts: [],
    retiredNodes: [],
    notes: [],
    otherNodes: [],
    recentChanges: [],
    changes: [],
    checkpoints: [],
    recentActivity: [],
    relations: [],
    omitted: {},
    truncated: false,
    // Reserve enough digits for the final self-describing estimate.
    estimatedTokens: budgetTokens,
  };

  // Reserve omission metadata before spending the budget. Counts describe
  // collection entries (including duplicate views), not unique missing nodes.
  for (const [key, items] of Object.entries(candidates)) {
    if (items.length) packet.omitted[key] = items.length;
  }
  if (focus) packet.omitted.currentFocus = 1;
  const edges = Object.values(g.edges || {}).sort(newest);
  if (edges.length) packet.omitted.relations = edges.length;
  packet.truncated = Object.keys(packet.omitted).length > 0;
  let used = tokenUnits(packet);

  function include(key, item) {
    const count = packet.omitted[key];
    const wasTruncated = packet.truncated;
    const before = tokenUnits(packet.omitted) + tokenUnits(wasTruncated);
    if (count > 1) packet.omitted[key] = count - 1;
    else delete packet.omitted[key];
    packet.truncated = Object.keys(packet.omitted).length > 0;
    const metadata = tokenUnits(packet.omitted) + tokenUnits(packet.truncated) - before;
    const content = key === 'currentFocus'
      ? tokenUnits(item) - tokenUnits(null)
      : tokenUnits(item) + (packet[key].length ? COMMA_UNITS : 0);
    if (used + content + metadata > budgetTokens * TOKEN_UNITS) {
      packet.omitted[key] = count;
      packet.truncated = wasTruncated;
      return false;
    }
    if (key === 'currentFocus') packet.currentFocus = item;
    else packet[key].push(item);
    used += content + metadata;
    return true;
  }

  // Even an explicitly focused body obeys the budget. Its stable ID remains
  // in request.focus when omitted; it is never replaced with half a claim.
  if (focus) include('currentFocus', compactNode(focus));
  const priorities = [
    // Explicit deltas precede background collections; omitted changes are reported.
    ...(since.value === null ? [] : [['changes', maxItems], ['recentChanges', maxItems]]),
    // A handoff summary is recovery data, not an instruction to the Agent.
    ['checkpoints', Math.min(8, maxItems)],
    ['objectives', maxItems],
    ['neighborhood', maxItems],
    ['openThreads', maxItems],
    ['findings', maxItems],
    ['confirmedFacts', maxItems],
    ['retiredNodes', maxItems],
    ['notes', Math.min(8, maxItems)],
    ['otherNodes', maxItems],
    ...(since.value === null ? [['recentChanges', maxItems]] : []),
    ['recentActivity', Math.min(8, maxItems)],
  ];

  for (const [key, limit] of priorities) {
    const source = candidates[key];
    // The limit bounds the candidate window, not a quota to backfill. A whole
    // record that does not fit stays omitted, but must not hide later records
    // inside that same window which can still fit without clipping.
    for (const item of source.slice(0, limit)) {
      include(key, item);
    }
  }

  const selectedIds = new Set();
  if (packet.currentFocus?.id) selectedIds.add(packet.currentFocus.id);
  for (const key of ['objectives', 'openThreads', 'findings', 'confirmedFacts', 'retiredNodes', 'notes', 'otherNodes', 'recentChanges']) {
    for (const node of packet[key]) selectedIds.add(node.id);
  }
  for (const item of packet.neighborhood) if (item.node?.id) selectedIds.add(item.node.id);
  for (const edge of edges) {
    if (!selectedIds.has(edge.from) || !selectedIds.has(edge.to)) {
      continue;
    }
    const compact = { id: edge.id, from: edge.from, to: edge.to, kind: edge.kind, label: edge.label || null,
      ...compactInputTruncation(edge) };
    include('relations', compact);
  }

  // Account for the estimate's own digit count as well.
  let previous;
  do {
    previous = packet.estimatedTokens;
    packet.estimatedTokens = estimateTokens(packet);
  } while (packet.estimatedTokens !== previous);
  return packet;
}

function nodeMarkdown(item) {
  const fields = ['status', 'severity', 'confidence', 'author', 'updatedBy', 'at']
    .filter((key) => item[key] !== undefined)
    .map((key) => `${key}=${item[key]}`);
  const lines = [`- [${item.id}] ${item.type}: ${item.title}${fields.length ? ` (${fields.join('; ')})` : ''}`];
  lines.push(...inputTruncationMarkdown(item));
  if (item.detail) lines.push(`  - Detail: ${item.detail}`);
  if (item.location) lines.push(`  - Location: ${JSON.stringify(item.location)}`);
  if (item.tags?.length) lines.push(`  - Tags: ${item.tags.join(', ')}`);
  return lines;
}

export function renderAgentContext(packet) {
  const lines = [];
  lines.push(`# Agent Context${packet.board.title ? ` — ${packet.board.title}` : ''}`);
  lines.push('');
  lines.push(`- Agent: ${packet.request.agentId}`);
  lines.push(`- Focus: ${packet.currentFocus?.id || packet.request.focus || 'none'}`);
  if (packet.omitted.currentFocus) {
    lines.push(`- Focus body omitted (budget); source: blackboard show ${packet.request.focus} --json`);
  }
  if (packet.request.cursorReason) lines.push(`- Cursor reason: ${packet.request.cursorReason}`);
  if (packet.request.sinceSource) lines.push(`- Since: ${packet.request.sinceSource}`);
  lines.push(`- Budget: ~${packet.estimatedTokens}/${packet.request.budgetTokens} tokens`);
  lines.push(`- Policy: read-only, non-prescriptive, next step selected by Agent`);
  const sections = [
    ['Objectives', packet.objectives],
    ['Open threads', packet.openThreads],
    ['Findings (authored claims; see confidence)', packet.findings],
    ['Confirmed facts', packet.confirmedFacts],
    ['Retired / refuted nodes (not current facts)', packet.retiredNodes || []],
    ['Notes', packet.notes],
    ['Other authored nodes (not classified as confirmed facts)', packet.otherNodes || []],
    ['Recent changes', packet.recentChanges],
  ];
  if (packet.currentFocus) sections.splice(1, 0, ['Current focus', [packet.currentFocus]]);
  for (const [title, items] of sections) {
    lines.push('', `## ${title}`);
    if (!items.length) lines.push('_none_');
    else for (const item of items) lines.push(...nodeMarkdown(item));
  }
  lines.push('', '## Current neighborhood');
  if (!packet.neighborhood.length) lines.push('_none_');
  for (const item of packet.neighborhood) {
    lines.push(...nodeMarkdown(item.node));
    lines.push(`  - Traversal: depth=${item.depth}; direction=${item.direction}; relation=${item.relation}`);
  }
  lines.push('', '## Relations (explicit direction)');
  if (!packet.relations.length) lines.push('_none_');
  for (const relation of packet.relations) {
    lines.push(`- [${relation.id}] [${relation.from}] --${relation.kind}--> [${relation.to}]${relation.label ? `: ${relation.label}` : ''}`);
    lines.push(...inputTruncationMarkdown(relation));
  }
  lines.push('', '## Structural changes');
  if (!packet.changes.length) lines.push('_none_');
  for (const change of packet.changes) {
    lines.push(`- ${change.kind} [${change.id}]${change.kind === 'relation-added' ? `: ${change.from} ${change.relation} ${change.to}` : ''}${change.eventId ? ` (event=${change.eventId})` : ''}`);
    lines.push(...inputTruncationMarkdown(change));
  }
  lines.push('', '## Checkpoints');
  if (!packet.checkpoints.length) lines.push('_none_');
  for (const checkpoint of packet.checkpoints) {
    lines.push(`- [${checkpoint.id}] agent=${checkpoint.agentId || packet.request.agentId}; at=${checkpoint.at}; cursor=${checkpoint.cursorNodeId || 'none'}: ${checkpoint.summary}`);
    lines.push(...inputTruncationMarkdown(checkpoint));
  }
  lines.push('', '## Recent activity');
  if (!packet.recentActivity.length) lines.push('_none_');
  for (const activity of packet.recentActivity) {
    lines.push(`- [${activity.id}] tool=${activity.tool || 'none'}; status=${activity.status || 'unspecified'}; at=${activity.at}: ${activity.summary}`);
    if (activity.linkedNodeIds.length) lines.push(`  - Linked nodes: ${activity.linkedNodeIds.join(', ')}`);
  }
  if (packet.truncated) lines.push('', `Truncated: ${JSON.stringify(packet.omitted)}`);
  return lines.join('\n');
}
