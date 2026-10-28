import { addNode, patchNode, addEdge, removeNode, removeEdge } from '../store.js';
import { NODE_TYPES, projectNode } from '../model.js';
import { validateRequestId } from '../receipts.js';
import { OUTPUTS } from '../contracts.js';
import { json, readBody } from './request.js';

const PATCHABLE = ['title', 'detail', 'status', 'severity', 'confidence'];

/** What a person can do from the viewer. Every write is stamped with who made it. */
export async function handleWrite(req, res, url, cwd, author) {
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
    return json(res, 201, { schema: OUTPUTS.node.schema, ...result, node: projectNode(result.node) });
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
      return json(res, 200, { ...projectNode(result), schema: OUTPUTS.edit.schema });
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
