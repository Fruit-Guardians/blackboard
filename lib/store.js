// Append-only blackboard event store. JSON Lines is the source of truth;
// state.json is a disposable compatibility cache.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  emptyGraph, applyAll, edgeId, inferEdgeKind, TYPE_PREFIX, NODE_TYPES,
  NODE_STATES, SEVERITIES, CONFIDENCE_LEVELS, currentCursor, nextShortId, resolveRef,
} from './model.js';

export const FLOW_DIR = '.flow';

export function paths(cwd = process.cwd()) {
  const root = path.join(cwd, FLOW_DIR);
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
 * `.flow/events.jsonl`, like git finds its repository. Null when there is none.
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

const sleepBuf = new Int32Array(new SharedArrayBuffer(4));
function sleepSync(ms) {
  Atomics.wait(sleepBuf, 0, 0, ms);
}

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}

/** A lock is stale only when its owner is gone; a slow but live writer keeps it. */
function lockIsStale(file) {
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch { return false; }
  const pid = Number(raw.split('\n')[0]);
  if (Number.isInteger(pid) && pid > 0) return !pidAlive(pid);
  // Unreadable owner (crash between create and write): fall back to age.
  try { return Date.now() - fs.statSync(file).mtimeMs > 30000; } catch { return false; }
}

/** Cross-process lock. A live lock is never deleted merely because we waited. */
export function withLock(fn, cwd = process.cwd(), timeoutMs = null) {
  const p = paths(cwd);
  if (!fs.existsSync(p.root)) fs.mkdirSync(p.root, { recursive: true });
  // Callers that must never hold up the Agent (hooks) pass a short limit.
  const deadline = Date.now() + (timeoutMs || Number(process.env.BLACKBOARD_LOCK_TIMEOUT_MS) || 10000);
  const token = `${process.pid}\n${Date.now()}\n${crypto.randomBytes(6).toString('hex')}\n`;
  let fd = null;
  for (;;) {
    try {
      fd = fs.openSync(p.lock, 'wx');
      fs.writeFileSync(fd, token);
      break;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      if (lockIsStale(p.lock)) {
        try { fs.unlinkSync(p.lock); } catch {}
        continue;
      }
      if (Date.now() > deadline) throw new Error('blackboard lock timeout: another writer is still active');
      sleepSync(8);
    }
  }
  try {
    return fn();
  } finally {
    try { fs.closeSync(fd); } catch {}
    // Only remove the lock if it is still ours.
    try {
      if (fs.readFileSync(p.lock, 'utf8') === token) fs.unlinkSync(p.lock);
    } catch {}
  }
}

function uniqueId(prefix) {
  const time = Date.now().toString(36);
  const pid = process.pid.toString(36);
  const random = crypto.randomBytes(4).toString('hex');
  return `${prefix}_${time}_${pid}${random}`;
}

function repairTornTail(file) {
  if (!fs.existsSync(file)) return;
  const fd = fs.openSync(file, 'r+');
  try {
    const size = fs.fstatSync(fd).size;
    if (!size) return;
    const last = Buffer.alloc(1);
    fs.readSync(fd, last, 0, 1, size - 1);
    if (last[0] === 0x0a) return;
    const readSize = Math.min(size, 1024 * 1024);
    const tail = Buffer.alloc(readSize);
    fs.readSync(fd, tail, 0, readSize, size - readSize);
    const nl = tail.lastIndexOf(0x0a);
    fs.ftruncateSync(fd, nl === -1 ? 0 : size - readSize + nl + 1);
  } finally {
    fs.closeSync(fd);
  }
}

export function appendEvent(ev, cwd = process.cwd()) {
  const p = paths(cwd);
  if (!fs.existsSync(p.root)) fs.mkdirSync(p.root, { recursive: true });
  if (!fs.existsSync(p.events)) fs.writeFileSync(p.events, '');
  repairTornTail(p.events);
  const record = {
    eventVersion: ev.eventVersion || 1,
    eventId: ev.eventId || uniqueId('event'),
    ...ev,
  };
  fs.appendFileSync(p.events, `${JSON.stringify(record)}\n`);
  return record;
}

export function readEvents(cwd = process.cwd(), fromByte = 0) {
  const p = paths(cwd);
  let buf;
  try {
    const fd = fs.openSync(p.events, 'r');
    const size = fs.fstatSync(fd).size;
    if (size <= fromByte) {
      fs.closeSync(fd);
      return { events: [], corrupt: 0, offset: size, truncated: false };
    }
    buf = Buffer.alloc(size - fromByte);
    fs.readSync(fd, buf, 0, buf.length, fromByte);
    fs.closeSync(fd);
  } catch {
    return { events: [], corrupt: 0, offset: fromByte, truncated: false };
  }
  const text = buf.toString('utf8');
  const lastNl = text.lastIndexOf('\n');
  const complete = lastNl === -1 ? '' : text.slice(0, lastNl + 1);
  const events = [];
  let corrupt = 0;
  for (const line of complete.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try { events.push(JSON.parse(t)); } catch { corrupt++; }
  }
  return {
    events, corrupt,
    offset: fromByte + Buffer.byteLength(complete, 'utf8'),
    truncated: lastNl === -1,
  };
}

export function replay(cwd = process.cwd()) {
  const { events, corrupt } = readEvents(cwd, 0);
  const g = applyAll(emptyGraph(), events);
  g.integrity.corruptLines = corrupt;
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

/** Cut `value` to the field limit and record the field name, so the caller can say so. */
function clipField(value, field, notes) {
  const text = String(value || '');
  if (text.length <= LIMITS[field]) return text;
  notes.push(field);
  return text.slice(0, LIMITS[field]);
}

/** Short ids (n12, hy3) are what an Agent has to type; they are derived from the log inside the write lock. */
function nodeId(g, type) {
  return nextShortId(g.nodes, TYPE_PREFIX[type] || 'n');
}

/** Who writes by default: BLACKBOARD_AGENT keeps parallel Agents from sharing one cursor. */
export function defaultAgentId(env = process.env) {
  const raw = String(env.BLACKBOARD_AGENT || env.FLOW_AGENT || '').trim();
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
    at = null, enter = false, relateHere = false, relation = null,
    agentId = 'agent:primary', reason = '', author = null,
  } = input;

  if (status && !NODE_STATES.includes(status)) throw new Error(`invalid node state: ${status}`);
  if (severity && !SEVERITIES.includes(severity)) throw new Error(`invalid severity: ${severity}`);
  if (confidence && !CONFIDENCE_LEVELS.includes(confidence)) throw new Error(`invalid confidence: ${confidence}`);

  return withLock(() => {
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
    if (severity) node.severity = severity;
    else if (type === 'vuln') node.severity = 'medium';
    if (confidence) node.confidence = confidence;
    if (extra && typeof extra === 'object') Object.assign(node, extra);
    if (at) {
      const loc = parseLocation(at);
      if (loc) node.loc = loc;
    }

    let sourceId = parent ? resolveRef(g.nodes, parent, 'source node') : null;
    if (!sourceId && relateHere) sourceId = currentCursor(g, agentId);
    if (sourceId && !g.nodes[sourceId]) throw new Error(`no such source node: ${sourceId}`);
    if (sourceId && parent) node.parent = sourceId; // legacy projection only

    appendEvent({ op: 'node', node }, cwd);

    let edge = null;
    if (sourceId) {
      const kind = relation || inferEdgeKind(g.nodes[sourceId]?.type, type);
      edge = {
        id: edgeId(sourceId, node.id, kind), from: sourceId, to: node.id,
        kind, ts: node.ts,
      };
      appendEvent({ op: 'edge', edge }, cwd);
    }

    let cursor = null;
    if (enter) {
      const from = currentCursor(g, agentId);
      cursor = cursorRecord({ from, to: node.id, reason, agentId, sessionId: state.session });
      appendEvent({ op: 'cursor', cursor }, cwd);
      state.cursors[agentId] = node.id;
      if (agentId === 'agent:primary') state.focus = node.id;
    }
    saveState(state, cwd);
    return truncated.length ? { node, edge, cursor, truncated } : { node, edge, cursor };
  }, cwd);
}

export function patchNode(ref, set, cwd = process.cwd(), { by = null } = {}) {
  return withLock(() => {
    const g = replay(cwd);
    const id = resolveRef(g.nodes, ref);
    if ('id' in set || 'ts' in set) throw new Error('a node\'s id and creation time cannot be changed');
    if (set.status && !NODE_STATES.includes(set.status)) throw new Error(`invalid node state: ${set.status}`);
    if (set.severity && !SEVERITIES.includes(set.severity)) throw new Error(`invalid severity: ${set.severity}`);
    if (set.confidence && !CONFIDENCE_LEVELS.includes(set.confidence)) throw new Error(`invalid confidence: ${set.confidence}`);
    const truncated = [];
    const updated = { ...set, updated: Date.now() };
    if (by) updated.updatedBy = String(by).slice(0, 80);
    if (typeof updated.title === 'string') updated.title = clipField(updated.title, 'title', truncated);
    if (typeof updated.detail === 'string') updated.detail = clipField(updated.detail, 'detail', truncated);
    appendEvent({ op: 'patch', id, set: updated }, cwd);
    const node = { ...g.nodes[id], ...updated };
    return truncated.length ? { ...node, truncated } : node;
  }, cwd);
}

export function addEdge(input, cwd = process.cwd()) {
  const { kind = 'related-to', label = '' } = input;
  return withLock(() => {
    const g = replay(cwd);
    const from = resolveRef(g.nodes, input.from);
    const to = resolveRef(g.nodes, input.to);
    if (from === to) throw new Error('a logic edge cannot link a node to itself');
    const edge = { id: edgeId(from, to, kind), from, to, kind, ts: Date.now() };
    const truncated = [];
    if (label) edge.label = clipField(label, 'label', truncated);
    appendEvent({ op: 'edge', edge }, cwd);
    return truncated.length ? { ...edge, truncated } : edge;
  }, cwd);
}

/** Take a node, with its relations, off the board. The log still holds everything that was ever written. */
export function removeNode(ref, { by = null, reason = '' } = {}, cwd = process.cwd()) {
  return withLock(() => {
    const g = replay(cwd);
    const id = resolveRef(g.nodes, ref);
    const edges = Object.values(g.edges).filter((e) => e.from === id || e.to === id).map((e) => e.id);
    appendEvent({ op: 'remove', kind: 'node', id, by: by || undefined, reason: reason ? String(reason).slice(0, 500) : undefined, at: Date.now() }, cwd);
    return { id, edges };
  }, cwd);
}

/** Cut one relation. `ref` is an edge id, or pass `from`, `to` and optionally `kind` to find it. */
export function removeEdge({ id = null, from = null, to = null, kind = null } = {}, { by = null } = {}, cwd = process.cwd()) {
  return withLock(() => {
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

export function moveCursor(ref, { reason = '', agentId = 'agent:primary' } = {}, cwd = process.cwd()) {
  return withLock(() => {
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

export function addActivity(input, cwd = process.cwd(), { lockTimeoutMs = null } = {}) {
  return withLock(() => {
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

export function addCheckpoint(input = {}, cwd = process.cwd(), { lockTimeoutMs = null } = {}) {
  return withLock(() => {
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
    appendEvent({ op: 'checkpoint', checkpoint }, cwd);
    return truncated.length ? { ...checkpoint, truncated } : checkpoint;
  }, cwd, lockTimeoutMs);
}

export function setMeta(set, cwd = process.cwd()) {
  return withLock(() => {
    const state = readState(cwd);
    if (set.title !== undefined) state.title = set.title;
    if (set.session !== undefined) state.session = set.session;
    appendEvent({ op: 'meta', set }, cwd);
    saveState(state, cwd);
    return state;
  }, cwd);
}

export function reset(cwd = process.cwd()) {
  return withLock(() => {
    appendEvent({ op: 'reset' }, cwd);
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
    if (['vuln', 'finding'].includes(n.type) && n.severity && n.status !== 'superseded') {
      vulns[n.severity] = (vulns[n.severity] || 0) + 1;
      const level = n.confidence || 'unspecified';
      confidence[level] = (confidence[level] || 0) + 1;
    }
  }
  const openNodes = Object.values(g.nodes).filter((n) =>
    ['intent', 'hypothesis', 'question'].includes(n.type) &&
    ['open', 'active', 'blocked'].includes(n.status || 'open'));
  return {
    total: Object.keys(g.nodes).length,
    edges: Object.keys(g.edges).length,
    activities: Object.keys(g.activities || {}).length,
    checkpoints: Object.keys(g.checkpoints || {}).length,
    cursors: Object.keys(g.cursors || {}).length,
    byType, intents, vulns, confidence,
    frontier: openNodes.length,
    confirmed: Object.values(g.nodes).filter((n) =>
      ['vuln', 'finding'].includes(n.type) && n.status !== 'superseded' &&
      (!n.confidence || ['reproduced', 'confirmed'].includes(n.confidence))).length,
    candidates: Object.values(g.nodes).filter((n) =>
      ['vuln', 'finding'].includes(n.type) && n.status !== 'superseded' &&
      ['suspected', 'static-confirmed'].includes(n.confidence)).length,
  };
}
