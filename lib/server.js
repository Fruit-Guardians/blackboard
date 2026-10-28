// Live server: serves the viewer, the graph snapshot, and an SSE stream that
// ticks whenever the event log grows.

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { paths, isInitialized, replay, readEvents, readState, stats, addNode, patchNode, addEdge, removeNode, removeEdge, getReceipt } from './store.js';
import { NODE_TYPES, projectNode, projectNodeMap } from './model.js';
import { buildAgentDigests } from './digest.js';
import { buildAgentContext } from './context.js';
import { buildNodeHistory, buildCheckpointChanges } from './history.js';
import { resolvePort, viewerUrl } from './service.js';
import { validateRequestId } from './receipts.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(HERE, '..', 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

function snapshot(cwd, writable = false) {
  const g = replay(cwd);
  const state = readState(cwd);
  const digests = buildAgentDigests(g, cwd);
  return {
    schema: 'blackboard.graph.v2',
    meta: {
      ...g.meta,
      title: g.meta.title || state.title,
      focus: [g.meta.focus, state.focus].find((id) => id && g.nodes[id]) || null,
      session: state.session,
      // The viewer only offers editing when the server accepts it.
      writable: writable ? true : undefined,
    },
    nodes: projectNodeMap(g.nodes),
    edges: g.edges,
    cursors: g.cursors,
    cursorTrail: g.cursorTrail.slice(-100),
    activities: g.activities,
    checkpoints: g.checkpoints,
    stats: stats(g),
    digest: digests['agent:primary'],
    digests,
  };
}

const MAX_BODY = 256 * 1024;
const PATCHABLE = ['title', 'detail', 'status', 'severity', 'confidence'];

const json = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        // Answer first; the connection is closed once the 413 has been sent.
        if (size - chunk.length <= MAX_BODY) reject(Object.assign(new Error('body too large'), { status: 413 }));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
      catch { reject(Object.assign(new Error('body is not valid JSON'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

/**
 * The board is only ever served on the loopback interface, but a web page the user happens to have
 * open can still reach it (DNS rebinding, or a plain cross-site request). Every request must name
 * a loopback host, and anything that writes must also come from this very page.
 */
export function requestGuard(req, port) {
  const hosts = [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`];
  const host = String(req.headers.host || '').toLowerCase();
  if (!hosts.includes(host)) return { ok: false, status: 403, error: 'host_not_allowed' };
  if (['GET', 'HEAD'].includes(req.method)) return { ok: true };
  const origin = req.headers.origin;
  if (!origin || origin.toLowerCase() !== `http://${host}`) return { ok: false, status: 403, error: 'cross_origin_write' };
  const site = req.headers['sec-fetch-site'];
  if (site && !['same-origin', 'none'].includes(site)) return { ok: false, status: 403, error: 'cross_origin_write' };
  if (!String(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) {
    return { ok: false, status: 415, error: 'json_required' };
  }
  return { ok: true };
}

/** What a person can do from the viewer. Every write is stamped with who made it. */
async function handleWrite(req, res, url, cwd, author) {
  const p = url.pathname;
  const body = await readBody(req);
  if (!body || typeof body !== 'object' || Array.isArray(body)) return json(res, 400, { error: 'body must be a JSON object' });
  if (Object.hasOwn(body, 'rejectTruncation') && typeof body.rejectTruncation !== 'boolean') {
    return json(res, 400, { error: 'rejectTruncation must be a boolean' });
  }
  // Opt-in input protection: older clients retain their original bounded-write contract.
  const inputProtection = body.rejectTruncation === true ? { rejectTruncation: true } : {};
  const headerId = req.headers['idempotency-key'];
  const bodyHasId = Object.hasOwn(body, 'requestId');
  const headerHasId = headerId !== undefined;
  let requestId;
  if (headerHasId || bodyHasId) {
    // Explicit IDs are validated, not trimmed, generated, or silently ignored.
    if ((headerHasId && !validateRequestId(headerId)) || (bodyHasId && !validateRequestId(body.requestId))) {
      return json(res, 400, { error: 'requestId must be a non-empty string' });
    }
    if (headerHasId && bodyHasId && headerId !== body.requestId) return json(res, 400, { error: 'request_id_mismatch' });
    requestId = headerHasId ? headerId : body.requestId;
  }
  const take = (value) => (typeof value === 'string' ? value : undefined);
  if (req.method === 'POST' && p === '/api/nodes') {
    const type = take(body.type) || 'note';
    if (!NODE_TYPES.includes(type)) return json(res, 400, { error: `unknown node type: ${type}` });
    if (!take(body.title)?.trim()) return json(res, 400, { error: 'title is required' });
    // Relation names are conventions, not a closed list: like the CLI, any non-empty name is saved as written.
    const relation = take(body.relation);
    const result = addNode({
      type, title: body.title.trim(), detail: take(body.detail) || '', parent: take(body.parent) || null,
      relation: relation || null, status: take(body.status) || null, author, requestId, ...inputProtection,
    }, cwd);
    return json(res, 201, { schema: 'blackboard.node-add.v2', ...result, node: projectNode(result.node) });
  }
  const nodeMatch = /^\/api\/nodes\/([^/]+)$/.exec(p);
  if (nodeMatch) {
    const ref = decodeURIComponent(nodeMatch[1]);
    if (req.method === 'PATCH') {
      const set = {};
      for (const key of PATCHABLE) if (key in body) set[key] = body[key] === null ? '' : take(body[key]);
      if (Object.values(set).some((v) => v === undefined)) return json(res, 400, { error: 'fields must be strings' });
      if (!Object.keys(set).length) return json(res, 400, { error: `nothing to change; allowed: ${PATCHABLE.join(', ')}` });
      for (const key of ['status', 'severity', 'confidence']) if (set[key] === '') delete set[key];
      const expected = body.expected;
      if (expected !== undefined && (!expected || typeof expected !== 'object' || Array.isArray(expected) ||
        Object.entries(expected).some(([key, value]) => !Object.hasOwn(set, key) || typeof value !== 'string'))) {
        return json(res, 400, { error: 'expected must contain original string values for patched fields' });
      }
      const result = patchNode(ref, set, cwd, { by: author, expected, requestId, ...inputProtection });
      return json(res, 200, { ...projectNode(result), schema: 'blackboard.node.v2' });
    }
    if (req.method === 'DELETE') return json(res, 200, removeNode(ref, { by: author, requestId }, cwd));
  }
  if (req.method === 'POST' && p === '/api/edges') {
    // Same rule as /api/nodes and the CLI: any non-empty relation name; empty falls back to related-to.
    const kind = take(body.kind) || 'related-to';
    if (!take(body.from) || !take(body.to)) return json(res, 400, { error: 'from and to are required' });
    return json(res, 201, addEdge({ from: body.from, to: body.to, kind, author, requestId, ...inputProtection }, cwd));
  }
  if (req.method === 'DELETE' && p === '/api/edges') {
    const id = url.searchParams.get('id');
    if (!id) return json(res, 400, { error: 'id is required' });
    return json(res, 200, removeEdge({ id }, { by: author, requestId }, cwd));
  }
  return json(res, 404, { error: 'not_found' });
}

export function startServer({ cwd = process.cwd(), port, open = false, readOnly = false, author = 'human' } = {}) {
  port = resolvePort({ cwd, port, allowZero: port !== undefined });
  if (!isInitialized(cwd)) {
    throw new Error('当前目录没有 .blackboard/，先运行 blackboard init');
  }
  cwd = fs.realpathSync(cwd);
  const clients = new Set();
  let lastMtime = 0;
  let lastSize = 0;

  const tick = () => {
    try {
      const p = paths(cwd);
      const st = fs.statSync(p.events);
      if (st.mtimeMs === lastMtime && st.size === lastSize) return;
      lastMtime = st.mtimeMs;
      lastSize = st.size;
      const data = JSON.stringify(snapshot(cwd, !readOnly));
      for (const res of clients) {
        res.write(`event: graph\ndata: ${data}\n\n`);
      }
    } catch {}
  };

  const timer = setInterval(tick, 250);

  const server = http.createServer((req, res) => {
    const guard = requestGuard(req, server.address().port);
    if (!guard.ok) return json(res, guard.status, { error: guard.error });
    const url = new URL(req.url, `http://${req.headers.host}`);
    const p = url.pathname;

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      if (!p.startsWith('/api/')) return json(res, 404, { error: 'not_found' });
      if (readOnly) return json(res, 403, { error: 'read_only' });
      handleWrite(req, res, url, cwd, author).catch((e) => {
        if (res.headersSent) return;
        if (e.status === 413) {
          res.setHeader('Connection', 'close');
          res.once('finish', () => req.socket.destroy());
        }
        json(res, e.status || 400, { error: e.message || String(e), ...(e.fields ? { fields: e.fields } : {}), ...(e.limits ? { limits: e.limits } : {}), ...(e.code ? { code: e.code } : {}), ...(e.requestId ? { requestId: e.requestId } : {}) });
      });
      return;
    }

    if (p === '/api/status') {
      return json(res, 200, { cwd, readOnly });
    }

    if (p === '/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      res.write(`event: graph\ndata: ${JSON.stringify(snapshot(cwd, !readOnly))}\n\n`);
      clients.add(res);
      const ping = setInterval(() => res.write(': ping\n\n'), 15000);
      req.on('close', () => {
        clearInterval(ping);
        clients.delete(res);
      });
      return;
    }

    if (p === '/api/receipt') {
      const requestId = url.searchParams.get('requestId');
      if (requestId === null || requestId === '') return json(res, 400, { error: 'request_id_required' });
      try {
        const receipt = getReceipt(requestId, cwd);
        if (!receipt) return json(res, 404, { error: 'receipt_not_found', requestId });
        return json(res, 200, { schema: 'blackboard.receipt-response.v1', readOnly: true, prescriptive: false, receipt });
      } catch (error) {
        return json(res, error.status || 400, { error: error.message });
      }
    }

    if (p === '/api/history' || p === '/api/changes') {
      const key = p === '/api/history' ? 'node' : 'since';
      const value = url.searchParams.get(key)?.trim();
      if (!value) return json(res, 400, { error: `${key}_required` });
      try {
        const source = readEvents(cwd);
        const project = p === '/api/history' ? buildNodeHistory : buildCheckpointChanges;
        return json(res, 200, project(source.events, value, source));
      } catch (error) {
        const details = p === '/api/history' ? { nodeId: value } : { since: value };
        return json(res, error.status || 400, { error: error.message, ...details });
      }
    }

    if (p === '/api/context') {
      const g = replay(cwd);
      const focus = url.searchParams.get('focus') || null;
      if (focus && !g.nodes[focus]) {
        res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        return res.end(JSON.stringify({ error: 'focus_not_found', focus }));
      }
      try {
        return json(res, 200, buildAgentContext(g, {
          agentId: url.searchParams.get('agent') || 'agent:primary',
          focus,
          depth: url.searchParams.get('depth') ?? 2,
          budgetTokens: url.searchParams.get('budget') ?? 4000,
          since: url.searchParams.get('since') ?? undefined,
          events: url.searchParams.has('since') ? readEvents(cwd).events : undefined,
          maxItems: url.searchParams.get('limit') ?? undefined,
        }));
      } catch (error) {
        return json(res, 400, { error: error.message });
      }
    }

    if (p === '/api/graph' || p === '/api/digest') {
      const snap = snapshot(cwd, !readOnly);
      const body = p === '/api/digest' ? JSON.stringify({ digest: snap.digest }) : JSON.stringify(snap);
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      return res.end(body);
    }

    let file = p === '/' ? '/index.html' : p;
    const abs = path.join(PUBLIC_DIR, path.normalize(file).replace(/^(\.\.[/\\])+/, ''));
    if (!abs.startsWith(PUBLIC_DIR)) {
      res.writeHead(403);
      return res.end('forbidden');
    }
    let st;
    try {
      st = fs.statSync(abs);
    } catch {
      st = null;
    }
    if (!st || !st.isFile()) {
      res.writeHead(404);
      return res.end('not found');
    }
    const ext = path.extname(abs);
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    // A vanished or unreadable file must answer 404/500, never kill the server.
    fs.createReadStream(abs).on('error', () => {
      if (!res.headersSent) res.writeHead(500);
      res.end('read error');
    }).pipe(res);
  });

  server.on('close', () => { clearInterval(timer); for (const res of clients) res.end(); });

  return new Promise((resolve, reject) => {
    server.once('error', (error) => {
      clearInterval(timer);
      reject(error);
    });
    server.listen(port, '127.0.0.1', () => {
      const addr = viewerUrl(server.address().port);
      console.log(`blackboard 服务已启动  ${addr}`);
      if (readOnly) console.log('  只读模式：查看器不能修改黑板');
      console.log(`  图快照 ${addr}/api/graph · Agent 上下文 ${addr}/api/context · 摘要 ${addr}/api/digest · SSE ${addr}/events`);
      if (open) {
        import('node:child_process').then(({ exec }) => {
          const cmd =
            process.platform === 'darwin'
              ? `open "${addr}"`
              : process.platform === 'win32'
              ? `start "" "${addr}"`
              : `xdg-open "${addr}"`;
          exec(cmd);
        });
      }
      resolve(server);
    });
  });
}
