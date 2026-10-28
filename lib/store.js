// Append-only blackboard event store. JSON Lines is the source of truth;
// state.json is a disposable compatibility cache.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  emptyGraph, applyAll, edgeId, inferEdgeKind, TYPE_PREFIX, NODE_TYPES,
  NODE_STATES, SEVERITIES, CONFIDENCE_LEVELS, currentCursor, nextShortId, resolveRef,
  EVENT_VERSION, isFutureEvent,
} from './model.js';
import { isOpenThread, isCurrentFinding, isExplicitlyConfirmed } from './semantics.js';
import { validateRequestId, requestFingerprint, withoutRequestId, projectReceipts } from './receipts.js';
import { withFileLock } from './storage/file-lock.js';
import { readEventBytes, repairTornTail } from './storage/event-file.js';

export const BLACKBOARD_DIR = '.blackboard';

export function paths(cwd = process.cwd()) {
  const root = path.join(cwd, BLACKBOARD_DIR);
  return {
    cwd, root,
    events: path.join(root, 'events.jsonl'),
    state: path.join(root, 'state.json'),
    config: path.join(root, 'config.json'),
    digest: path.join(root, 'digest.md'),
    lock: path.join(root, 'lock'),
  };
}

export function isInitialized(cwd = process.cwd()) {
  return fs.existsSync(paths(cwd).events);
}

/**
 * The board that owns `start`: the nearest directory at or above it holding
 * `.blackboard/events.jsonl`, like git finds its repository. Null when there is none.
 */
export function findRoot(start = process.cwd()) {
  let dir = path.resolve(start);
  for (;;) {
    if (isInitialized(dir)) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * The board holds raw agent text (and, with activity capture, tool output), so a
 * new one keeps itself out of version control until someone chooses otherwise.
 */
export function protectBoard(cwd = process.cwd()) {
  const file = path.join(paths(cwd).root, '.gitignore');
  if (fs.existsSync(file)) return false;
  fs.writeFileSync(file, '# blackboard data may contain sensitive text; remove this file to track it\n*\n');
  return true;
}

export function ensure(cwd = process.cwd()) {
  const p = paths(cwd);
  if (!fs.existsSync(p.root)) {
    fs.mkdirSync(p.root, { recursive: true });
    protectBoard(cwd);
  }
  if (!fs.existsSync(p.events)) fs.writeFileSync(p.events, '');
  if (!fs.existsSync(p.state)) fs.writeFileSync(p.state, JSON.stringify(defaultState(), null, 2));
  if (!fs.existsSync(p.config)) fs.writeFileSync(p.config, JSON.stringify(defaultConfig(), null, 2));
  return p;
}

export function defaultState() {
  const seq = {};
  for (const t of NODE_TYPES) seq[TYPE_PREFIX[t]] = 0;
  return {
    session: `session_${Date.now().toString(36)}`,
    title: '',
    started: new Date().toISOString(),
    focus: null,
    cursors: {},
    seq, // retained only so older installations remain readable
    hooks: true,
  };
}

export function defaultConfig() {
  return {
    // Only honored when optional hooks are explicitly installed. The normal
    // path remains direct Agent read/write calls.
    autoRecord: true,
    autoTools: ['Bash', 'WebFetch', 'WebSearch', 'Write', 'Edit', 'Read', 'Grep', 'Glob'],
    maxActivities: 4000,
    maxAutoFacts: 4000, // legacy alias
    detailLimit: 1200,
    redact: true,
    digest: {
      maxNeighbors: 16,
      maxTrail: 10,
      maxOpenNodes: 16,
      maxCheckpoints: 6,
    },
  };
}

function recoverState(cwd) {
  const state = defaultState();
  const { events } = readEvents(cwd, 0);
  for (const ev of events) {
    if (ev.op === 'reset') {
      const fresh = defaultState();
      Object.assign(state, fresh);
    } else if (ev.op === 'meta' && ev.set) {
      if (ev.set.title !== undefined) state.title = ev.set.title;
      if (ev.set.session !== undefined) state.session = ev.set.session;
      if (ev.set.focus !== undefined) state.focus = ev.set.focus;
    } else if (ev.op === 'cursor' && ev.cursor?.agentId) {
      state.cursors[ev.cursor.agentId] = ev.cursor.to || null;
      if (ev.cursor.agentId === 'agent:primary') state.focus = ev.cursor.to || null;
    }
  }
  return state;
}

export function readState(cwd = process.cwd()) {
  const p = paths(cwd);
  try {
    const parsed = JSON.parse(fs.readFileSync(p.state, 'utf8'));
    return { ...defaultState(), ...parsed, cursors: parsed.cursors || {} };
  } catch {
    return recoverState(cwd);
  }
}

export function writeState(state, cwd = process.cwd()) {
  const p = paths(cwd);
  const tmp = `${p.state}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, p.state);
  return state;
}

/**
 * state.json is a disposable cache. Once the event is appended the action has
 * happened, so a failed cache write must not surface as a failed command
 * (the caller would retry and duplicate the event); readState recovers instead.
 */
function saveState(state, cwd) {
  if (activeRequest?.cwd === cwd) {
    activeRequest.state = state;
    return;
  }
  try {
    writeState(state, cwd);
  } catch {
    try { fs.unlinkSync(paths(cwd).state); } catch {}
  }
}

export function readConfig(cwd = process.cwd()) {
  const defaults = defaultConfig();
  const p = paths(cwd);
  try {
    const parsed = JSON.parse(fs.readFileSync(p.config, 'utf8'));
    return { ...defaults, ...parsed, digest: { ...defaults.digest, ...(parsed.digest || {}) } };
  } catch {
    return defaults;
  }
}

/** Cross-process lock. A live lock is never deleted merely because we waited. */
export function withLock(fn, cwd = process.cwd(), timeoutMs = null, { readOnly = false } = {}) {
  const p = paths(cwd);
  if (!fs.existsSync(p.root)) fs.mkdirSync(p.root, { recursive: true });
  // Callers that must never hold up the Agent (hooks) pass a short limit.
  const waitMs = timeoutMs || Number(process.env.BLACKBOARD_LOCK_TIMEOUT_MS) || 10000;
  return withFileLock(p.lock, () => {
    // Every acquisition validates the source afresh while holding the lock.
    const log = readOnly ? undefined : assertWritableLog(cwd);
    return fn(log);
  }, waitMs);
}

/**
 * A release that skips newer events cannot see the ids they hold, so writing
 * next to them could hand out a duplicate id. Reading stays available.
 */
function assertWritableLog(cwd) {
  const log = readEvents(cwd, 0);
  const { future } = log;
  if (!future) return log;
  throw new Error(
    `事件日志里有 ${future} 条更新版本写入的事件（eventVersion > ${EVENT_VERSION}），当前版本无法完整回放；`
    + '为避免 ID 冲突已拒绝写入，读取不受影响。请切换到较新的版本：blackboard release ls / blackboard release use <版本>',
  );
}

function uniqueId(prefix) {
  const time = Date.now().toString(36);
  const pid = process.pid.toString(36);
  const random = crypto.randomBytes(4).toString('hex');
  return `${prefix}_${time}_${pid}${random}`;
}

// Only synchronous mutation callbacks run here, under the cross-process lock.
// Buffering lets the first ordinary event carry a complete recovery plan while
// preserving the old event operations for older readers.
let activeRequest = null;

function eventRecord(ev) {
  return { eventVersion: ev.eventVersion || EVENT_VERSION, eventId: ev.eventId || uniqueId('event'), ...ev };
}

function appendRecords(records, cwd) {
  const p = paths(cwd);
  if (!fs.existsSync(p.root)) fs.mkdirSync(p.root, { recursive: true });
  if (!fs.existsSync(p.events)) fs.writeFileSync(p.events, '');
  repairTornTail(p.events);
  fs.appendFileSync(p.events, records.map((record) => `${JSON.stringify(record)}\n`).join(''));
}

export function appendEvent(ev, cwd = process.cwd()) {
  const record = eventRecord(ev);
  if (activeRequest?.cwd === cwd) activeRequest.events.push(record);
  else appendRecords([record], cwd);
  return record;
}

function publicReceipt(receipt) {
  if (!receipt) return null;
  const { _events, ...result } = receipt;
  return result;
}

/** A query never completes or otherwise changes an interrupted request. */
export function getReceipt(requestId, cwd = process.cwd()) {
  const id = validateRequestId(requestId);
  if (!id) throw new Error('requestId is required');
  return publicReceipt(projectReceipts(readEvents(cwd).events).get(id));
}

function receiptMarker(request) {
  return eventRecord({
    op: 'receipt', requestId: request.requestId, command: request.command,
    fingerprint: request.fingerprint, eventIds: request.eventIds || request.events.map((ev) => ev.eventId),
    at: Date.now(),
  });
}

/**
 * A requested mutation is a recoverable complete-line prefix, not a filesystem
 * transaction: the node, relation and cursor retain their ordinary operations.
 * Its first event embeds the exact plan/result. A commit marker means the whole
 * plan landed. A matching explicit retry resumes a partial plan; unrelated new
 * mutations stop until it is resolved. IDs stay deduplicated across reset.
 */
function withMutation(command, payload, requestId, fn, cwd, timeoutMs = null) {
  const id = validateRequestId(requestId);
  const fingerprint = id ? requestFingerprint(command, payload) : null;
  return withLock((log) => {
    const receipts = projectReceipts(log.events);
    const previous = id ? receipts.get(id) : null;
    if (previous) {
      if (previous.command !== command || previous.fingerprint !== fingerprint) {
        throw Object.assign(new Error(`request_id_conflict: ${id} was used for a different command or payload`), { code: 'request_id_conflict', status: 409 });
      }
      if (previous.status === 'pending') {
        if (!previous.recoverable) {
          throw Object.assign(new Error(`request_recovery_conflict: ${id} has later unrelated events; inspect the receipt before recovery`), { code: 'request_recovery_conflict', status: 409 });
        }
        const committed = new Set(previous.committedEventIds);
        appendRecords([...previous._events.filter((ev) => !committed.has(ev.eventId)), receiptMarker(previous)], cwd);
        saveState(recoverState(cwd), cwd);
      }
      return previous.result;
    }
    const pending = [...receipts.values()].find((receipt) => receipt.status === 'pending');
    if (pending) {
      throw Object.assign(new Error(`pending_request: ${pending.requestId}; retry that exact request before a new mutation`), { code: 'pending_request', status: 409, requestId: pending.requestId });
    }
    if (!id) return fn();
    const transaction = { cwd, events: [], state: null };
    activeRequest = transaction;
    let result;
    try { result = fn(); } finally { activeRequest = null; }
    if (!transaction.events.length) throw new Error('requested mutation did not produce an event');
    // Clone through JSON so a later caller mutation cannot alter the result
    // preserved in the log, and return exactly what a future retry will read.
    const storedResult = JSON.parse(JSON.stringify(result));
    const request = { requestId: id, command, fingerprint, result: storedResult, events: transaction.events, at: Date.now() };
    const records = transaction.events.map((ev, index) => index === 0 ? { ...ev, request } : ev);
    try {
      appendRecords([...records, receiptMarker(request)], cwd);
    } catch (error) {
      // A failed/ambiguous append may have committed a cursor. Never leave a
      // pre-commit cache that conceals that log state from recovery.
      try { fs.unlinkSync(paths(cwd).state); } catch {}
      throw error;
    }
    if (transaction.state) saveState(transaction.state, cwd);
    return storedResult;
  }, cwd, timeoutMs);
}

export function readEvents(cwd = process.cwd(), fromByte = 0) {
  const p = paths(cwd);
  let buf;
  try {
    const { bytes, size } = readEventBytes(p.events, fromByte);
    if (bytes === null) {
      return { events: [], corrupt: 0, future: 0, offset: size, truncated: false };
    }
    buf = bytes;
  } catch {
    return { events: [], corrupt: 0, future: 0, offset: fromByte, truncated: false };
  }
  const text = buf.toString('utf8');
  const lastNl = text.lastIndexOf('\n');
  const complete = lastNl === -1 ? '' : text.slice(0, lastNl + 1);
  const events = [];
  let corrupt = 0;
  let future = 0;
  for (const line of complete.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    let ev;
    try { ev = JSON.parse(t); } catch { corrupt++; continue; }
    // Filtered here so every projection (replay, context deltas, state
    // recovery, the live server) skips the same events.
    if (isFutureEvent(ev)) future++;
    else events.push(ev);
  }
  return {
    events, corrupt, future,
    offset: fromByte + Buffer.byteLength(complete, 'utf8'),
    truncated: lastNl === -1,
  };
}

export function replay(cwd = process.cwd()) {
  const { events, corrupt, future } = readEvents(cwd, 0);
  const g = applyAll(emptyGraph(), events);
  g.integrity.corruptLines = corrupt;
  g.integrity.futureEvents = future;
  g.meta.count = Object.keys(g.nodes).length;
  return g;
}

/** "src/api/auth.js:142" or "src/api/auth.js" → { path, line } */
export function parseLocation(s) {
  const t = String(s || '').trim();
  if (!t) return null;
  const m = t.match(/^(.*?):(\d+)(?::\d+)?$/);
  if (m) return { path: m[1], line: Number(m[2]) };
  const base = t.split('/').pop() || '';
  if (base && base.includes('.') && !base.startsWith('.')) return { path: t };
  return null;
}

export const LIMITS = { title: 500, detail: 20000, label: 500, summary: 12000 };

// Input loss is event data, not a warning cache: a later reader must be able
// to tell that an earlier writer supplied more text than was retained.
function inspectInputLengths(values, rejectTruncation = false) {
  const losses = {};
  for (const [field, value] of Object.entries(values)) {
    const length = String(value || '').length;
    if (length > LIMITS[field]) losses[field] = { originalLength: length, storedLength: LIMITS[field] };
  }
  const fields = Object.keys(losses);
  if (rejectTruncation === true && fields.length) {
    const lengths = fields.map((field) => `${field} (${losses[field].originalLength} > ${losses[field].storedLength})`).join(', ');
    throw Object.assign(new Error(`input too long: ${lengths}; no text was saved`), {
      status: 422, code: 'input_too_long', fields, limits: losses,
    });
  }
  return losses;
}

// Omitted/false protection keeps precisely the pre-option receipt identity.
// Explicit strict writes do include the option, so modes cannot be mixed on
// a single request ID after an ambiguous result.
function inputPayload(input) {
  const payload = withoutRequestId(input);
  if (payload.rejectTruncation !== true) delete payload.rejectTruncation;
  return payload;
}

/** Cut `value` to the field limit and record the field name, so the caller can say so. */
function clipField(value, field, notes) {
  const text = String(value || '');
  if (text.length <= LIMITS[field]) return text;
  notes.push(field);
  return text.slice(0, LIMITS[field]);
}

/** Short ids (n12, hy3) are what an Agent has to type; they are derived from the log inside the write lock. */
function nodeId(g, type) {
  return nextShortId(g.nodes, TYPE_PREFIX[type] || 'n', g.retiredIds);
}

/** Who writes by default: BLACKBOARD_AGENT keeps parallel Agents from sharing one cursor. */
export function defaultAgentId(env = process.env) {
  const raw = String(env.BLACKBOARD_AGENT || '').trim();
  if (!raw) return 'agent:primary';
  return raw.includes(':') ? raw : `agent:${raw}`;
}

function cursorRecord({ from = null, to = null, reason = '', agentId = 'agent:primary', sessionId }) {
  const cursor = {
    id: uniqueId('cursor'), agentId, from, to, at: Date.now(), sessionId,
  };
  if (reason) cursor.reason = String(reason).slice(0, 500);
  return cursor;
}

/** Add a logic node. Linking and entering are explicit, independent options. */
export function addNode(input, cwd = process.cwd()) {
  const {
    type = 'note', title = '', detail = '', parent = null, status = null,
    severity = null, confidence = null, tags = [], auto = false, session = null, extra = null,
    at = null, enter = false, relateHere = false, relation = null, target = null, label = '',
    agentId = 'agent:primary', reason = '', author = null,
  } = input;

  if (status && !NODE_STATES.includes(status)) throw new Error(`invalid node state: ${status}`);
  if (severity && !SEVERITIES.includes(severity)) throw new Error(`invalid severity: ${severity}`);
  if (confidence && !CONFIDENCE_LEVELS.includes(confidence)) throw new Error(`invalid confidence: ${confidence}`);
  // Targets share one relation; with a source as well, the direction would be ambiguous.
  const targets = target == null ? [] : [].concat(target);
  if (targets.some((ref) => typeof ref !== 'string' || !ref)) throw new Error('target must be a node id');
  if (targets.length && (parent || relateHere)) throw new Error('target cannot be combined with parent or relateHere; use link for more relations');
  if (label && !targets.length && !parent && !relateHere) throw new Error('label describes the relation; pass target, parent or relateHere');
  // Checked together so a strict write names every field that is too long.
  const { label: labelLoss, ...inputTruncation } = inspectInputLengths({ title, detail, label }, input.rejectTruncation);

  return withMutation('addNode', inputPayload(input), input.requestId, () => {
    const state = readState(cwd);
    const g = replay(cwd);
    const truncated = [];
    const node = {
      id: nodeId(g, type), type, title: clipField(title, 'title', truncated),
      ts: Date.now(), session: session || state.session,
    };
    if (detail) node.detail = clipField(detail, 'detail', truncated);
    if (tags && tags.length) node.tags = [...new Set(tags.map(String))];
    if (auto) node.auto = true;
    if (author) node.author = String(author).slice(0, 80);
    if (status) node.status = status;
    else if (['intent', 'hypothesis', 'question'].includes(type)) node.status = 'open';
    // Severity is never inferred from the type: an unrated candidate stays unrated.
    if (severity) node.severity = severity;
    if (confidence) node.confidence = confidence;
    if (extra && typeof extra === 'object') {
      Object.assign(node, extra);
      // Legacy extensions may replace text after the primary field was
      // clipped. That replacement was not clipped, so the earlier length
      // warning no longer describes the value actually written to the log.
      for (const field of ['title', 'detail']) {
        if (Object.prototype.propertyIsEnumerable.call(extra, field)) delete inputTruncation[field];
      }
    }
    // Extensions cannot forge or erase store-owned input integrity metadata.
    delete node.inputTruncation;
    if (Object.keys(inputTruncation).length) node.inputTruncation = inputTruncation;
    if (input.rejectTruncation === true) inspectInputLengths({ title: node.title, detail: node.detail }, true);
    if (at) {
      const loc = parseLocation(at);
      if (loc) node.loc = loc;
    }

    let sourceId = parent ? resolveRef(g.nodes, parent, 'source node') : null;
    if (!sourceId && relateHere) sourceId = currentCursor(g, agentId);
    if (sourceId && !g.nodes[sourceId]) throw new Error(`no such source node: ${sourceId}`);
    if (sourceId && parent) node.parent = sourceId; // legacy projection only
    // Resolved before anything is written, so an unknown target leaves the log untouched.
    const targetIds = [...new Set(targets.map((ref) => resolveRef(g.nodes, ref, 'target node')))];
    // relateHere without a cursor creates no relation, so there is nothing for the label to describe.
    if (label && !sourceId && !targetIds.length) throw new Error('label describes the relation, but there is no cursor to relate to');

    appendEvent({ op: 'node', node }, cwd);

    // The new node reads "<new> <relation> <target>"; a source reads "<source> <relation> <new>".
    const pairs = targetIds.length ? targetIds.map((id) => [node.id, id]) : sourceId ? [[sourceId, node.id]] : [];
    const typeOf = (id) => (id === node.id ? type : g.nodes[id]?.type);
    const clippedLabel = label ? clipField(label, 'label', truncated) : '';
    const edges = pairs.map(([from, to]) => {
      const kind = relation || inferEdgeKind(typeOf(from), typeOf(to));
      const edge = { id: edgeId(from, to, kind), from, to, kind, ts: node.ts };
      if (node.author) edge.author = node.author;
      if (clippedLabel) edge.label = clippedLabel;
      if (labelLoss) edge.inputTruncation = { label: labelLoss };
      appendEvent({ op: 'edge', edge }, cwd);
      return edge;
    });
    const edge = edges[0] || null;

    let cursor = null;
    if (enter) {
      const from = currentCursor(g, agentId);
      cursor = cursorRecord({ from, to: node.id, reason, agentId, sessionId: state.session });
      appendEvent({ op: 'cursor', cursor }, cwd);
      state.cursors[agentId] = node.id;
      if (agentId === 'agent:primary') state.focus = node.id;
    }
    saveState(state, cwd);
    return truncated.length ? { node, edge, edges, cursor, truncated } : { node, edge, edges, cursor };
  }, cwd);
}

export function patchNode(ref, set, cwd = process.cwd(), { by = null, expected = null, requestId = null, rejectTruncation = false } = {}) {
  if (Object.hasOwn(set, 'inputTruncation')) throw new Error('inputTruncation is managed by the store');
  const textFields = Object.fromEntries(['title', 'detail'].filter((field) => typeof set[field] === 'string').map((field) => [field, set[field]]));
  const inputTruncation = inspectInputLengths(textFields, rejectTruncation);
  const payload = { ref, set, by, expected, ...(rejectTruncation === true ? { rejectTruncation: true } : {}) };
  return withMutation('patchNode', payload, requestId, () => {
    const g = replay(cwd);
    const id = resolveRef(g.nodes, ref);
    if (expected) {
      const fields = Object.keys(expected).filter((key) => (g.nodes[id][key] ?? '') !== expected[key]);
      if (fields.length) {
        throw Object.assign(new Error('node_conflict'), { status: 409, fields });
      }
    }
    if ('id' in set || 'ts' in set) throw new Error('a node\'s id and creation time cannot be changed');
    if (set.status && !NODE_STATES.includes(set.status)) throw new Error(`invalid node state: ${set.status}`);
    if (set.severity && !SEVERITIES.includes(set.severity)) throw new Error(`invalid severity: ${set.severity}`);
    if (set.confidence && !CONFIDENCE_LEVELS.includes(set.confidence)) throw new Error(`invalid confidence: ${set.confidence}`);
    const truncated = [];
    const updated = { ...set, updated: Date.now() };
    if (by) updated.updatedBy = String(by).slice(0, 80);
    if (typeof updated.title === 'string') updated.title = clipField(updated.title, 'title', truncated);
    if (typeof updated.detail === 'string') updated.detail = clipField(updated.detail, 'detail', truncated);
    const previous = g.nodes[id].inputTruncation;
    const remaining = previous && typeof previous === 'object' && !Array.isArray(previous) ? { ...previous } : {};
    for (const field of Object.keys(textFields)) {
      delete remaining[field];
      if (inputTruncation[field]) remaining[field] = inputTruncation[field];
    }
    if (Object.keys(inputTruncation).length || (previous && Object.keys(textFields).length)) {
      // A null is explicit in the patch event, so replay also clears the last
      // warning. Editing another dimension never erases a text warning.
      updated.inputTruncation = Object.keys(remaining).length ? remaining : null;
    }
    appendEvent({ op: 'patch', id, set: updated }, cwd);
    const node = { ...g.nodes[id], ...updated };
    return truncated.length ? { ...node, truncated } : node;
  }, cwd);
}

export function addEdge(input, cwd = process.cwd()) {
  const { kind = 'related-to', label = '', author = null } = input;
  const inputTruncation = inspectInputLengths({ label }, input.rejectTruncation);
  return withMutation('addEdge', inputPayload(input), input.requestId, () => {
    const g = replay(cwd);
    const from = resolveRef(g.nodes, input.from);
    const to = resolveRef(g.nodes, input.to);
    if (from === to) throw new Error('a logic edge cannot link a node to itself');
    const edge = { id: edgeId(from, to, kind), from, to, kind, ts: Date.now() };
    if (author) edge.author = String(author).slice(0, 80);
    const truncated = [];
    if (label) edge.label = clipField(label, 'label', truncated);
    if (Object.keys(inputTruncation).length) edge.inputTruncation = inputTruncation;
    appendEvent({ op: 'edge', edge }, cwd);
    return truncated.length ? { ...edge, truncated } : edge;
  }, cwd);
}

/** Take a node, with its relations, off the board. The log still holds everything that was ever written. */
export function removeNode(ref, { by = null, reason = '', requestId = null } = {}, cwd = process.cwd()) {
  return withMutation('removeNode', { ref, by, reason }, requestId, () => {
    const g = replay(cwd);
    const id = resolveRef(g.nodes, ref);
    const edges = Object.values(g.edges).filter((e) => e.from === id || e.to === id).map((e) => e.id);
    appendEvent({ op: 'remove', kind: 'node', id, by: by || undefined, reason: reason ? String(reason).slice(0, 500) : undefined, at: Date.now() }, cwd);
    return { id, edges };
  }, cwd);
}

/** Cut one relation. `ref` is an edge id, or pass `from`, `to` and optionally `kind` to find it. */
export function removeEdge({ id = null, from = null, to = null, kind = null } = {}, { by = null, requestId = null } = {}, cwd = process.cwd()) {
  return withMutation('removeEdge', { id, from, to, kind, by }, requestId, () => {
    const g = replay(cwd);
    let edge = id ? g.edges[id] : null;
    if (!edge && from && to) {
      const a = resolveRef(g.nodes, from, 'source node');
      const b = resolveRef(g.nodes, to, 'target node');
      const found = Object.values(g.edges).filter((e) => e.from === a && e.to === b && (!kind || e.kind === kind));
      if (found.length > 1) throw new Error(`more than one relation links ${a} → ${b}; pass the kind (${found.map((e) => e.kind).join(', ')})`);
      edge = found[0] || null;
    }
    if (!edge) throw new Error(`no such relation: ${id || `${from} → ${to}`}`);
    appendEvent({ op: 'remove', kind: 'edge', id: edge.id, by: by || undefined, at: Date.now() }, cwd);
    return edge;
  }, cwd);
}

export function moveCursor(ref, { reason = '', agentId = 'agent:primary', requestId = null } = {}, cwd = process.cwd()) {
  return withMutation('moveCursor', { ref, reason, agentId }, requestId, () => {
    const g = replay(cwd);
    const id = ref ? resolveRef(g.nodes, ref) : null;
    const state = readState(cwd);
    const cursor = cursorRecord({
      from: currentCursor(g, agentId), to: id || null, reason, agentId,
      sessionId: state.session,
    });
    appendEvent({ op: 'cursor', cursor }, cwd);
    state.cursors[agentId] = id || null;
    if (agentId === 'agent:primary') state.focus = id || null;
    saveState(state, cwd);
    return cursor;
  }, cwd);
}

/** Backward-compatible alias. */
export function setFocus(id, cwd = process.cwd()) {
  return moveCursor(id, {}, cwd);
}

export function addActivity(input, cwd = process.cwd(), { lockTimeoutMs = null, requestId = null } = {}) {
  return withMutation('addActivity', withoutRequestId(input), input.requestId ?? requestId, () => {
    const state = readState(cwd);
    const g = replay(cwd);
    const activity = {
      id: nextShortId(g.activities, 'act'),
      tool: String(input.tool || 'tool'),
      summary: String(input.summary || '').slice(0, 500),
      status: input.status || 'success',
      agentId: input.agentId || 'agent:primary',
      at: Date.now(),
      sessionId: state.session,
    };
    if (input.input) activity.input = String(input.input).slice(0, 4000);
    if (input.output) activity.output = String(input.output).slice(0, 20000);
    if (input.location) activity.location = input.location;
    const cursorId = currentCursor(g, activity.agentId);
    if (cursorId) activity.linkedNodeIds = [cursorId];
    appendEvent({ op: 'activity', activity }, cwd);
    return activity;
  }, cwd, lockTimeoutMs);
}

export function addCheckpoint(input = {}, cwd = process.cwd(), { lockTimeoutMs = null, requestId = null } = {}) {
  const inputTruncation = inspectInputLengths({ summary: input.summary }, input.rejectTruncation);
  return withMutation('addCheckpoint', inputPayload(input), input.requestId ?? requestId, () => {
    const state = readState(cwd);
    const g = replay(cwd);
    const agentId = input.agentId || 'agent:primary';
    const truncated = [];
    const checkpoint = {
      id: nextShortId(g.checkpoints, 'cp'), agentId, at: Date.now(), sessionId: state.session,
      cursorNodeId: currentCursor(g, agentId),
      summary: clipField(input.summary, 'summary', truncated),
      trigger: input.trigger || 'manual',
    };
    if (Object.keys(inputTruncation).length) checkpoint.inputTruncation = inputTruncation;
    appendEvent({ op: 'checkpoint', checkpoint }, cwd);
    return truncated.length ? { ...checkpoint, truncated } : checkpoint;
  }, cwd, lockTimeoutMs);
}

export function setMeta(set, cwd = process.cwd(), { requestId = null } = {}) {
  return withMutation('setMeta', set, requestId, () => {
    const state = readState(cwd);
    if (set.title !== undefined) state.title = set.title;
    if (set.session !== undefined) state.session = set.session;
    appendEvent({ op: 'meta', set }, cwd);
    saveState(state, cwd);
    return state;
  }, cwd);
}

export function reset(cwd = process.cwd(), { by = null, requestId = null } = {}) {
  return withMutation('reset', by ? { by } : {}, requestId, () => {
    appendEvent({ op: 'reset', by: by || undefined }, cwd);
    const state = defaultState();
    saveState(state, cwd);
    return state;
  }, cwd);
}

export function stats(g) {
  const byType = {};
  const intents = { open: 0, active: 0, done: 0, blocked: 0, dead: 0 };
  const vulns = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  const confidence = { suspected: 0, 'static-confirmed': 0, reproduced: 0, confirmed: 0, unspecified: 0 };
  for (const n of Object.values(g.nodes)) {
    byType[n.type] = (byType[n.type] || 0) + 1;
    if (n.type === 'intent') intents[n.status || 'open'] = (intents[n.status || 'open'] || 0) + 1;
    if (isCurrentFinding(n) && n.severity) {
      vulns[n.severity] = (vulns[n.severity] || 0) + 1;
      const level = n.confidence || 'unspecified';
      confidence[level] = (confidence[level] || 0) + 1;
    }
  }
  const openNodes = Object.values(g.nodes).filter(isOpenThread);
  return {
    total: Object.keys(g.nodes).length,
    edges: Object.keys(g.edges).length,
    activities: Object.keys(g.activities || {}).length,
    checkpoints: Object.keys(g.checkpoints || {}).length,
    cursors: Object.keys(g.cursors || {}).length,
    byType, intents, vulns, confidence,
    frontier: openNodes.length,
    confirmed: Object.values(g.nodes).filter((n) => isCurrentFinding(n) && isExplicitlyConfirmed(n)).length,
    candidates: Object.values(g.nodes).filter((n) =>
      isCurrentFinding(n) && ['suspected', 'static-confirmed'].includes(n.confidence)).length,
  };
}
