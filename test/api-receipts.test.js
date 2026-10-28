import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import http from 'node:http';
import { ensure, paths, readEvents, addNode, getReceipt } from '../lib/store.js';
import { startServer } from '../lib/server.js';

function fixture(t) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'blackboard-api-receipts-'));
  ensure(cwd);
  t.after(() => fs.rmSync(cwd, { force: true, recursive: true }));
  return cwd;
}
const hash = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const count = (cwd) => readEvents(cwd).events.length;

async function serverFixture(t, cwd, readOnly = false) {
  const server = await startServer({ cwd, port: 0, readOnly });
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (method, suffix, body = {}, key = undefined, extraHeaders = {}) => {
    const headers = { Origin: base, 'Content-Type': 'application/json', ...extraHeaders };
    if (key !== undefined) headers['Idempotency-Key'] = key;
    const response = await fetch(`${base}${suffix}`, { method, headers, ...(method !== 'GET' ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, cache: response.headers.get('cache-control'), body: await response.json() };
  };
  return { server, base, request };
}

function rawRequest(port, suffix, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path: suffix, method, headers }, (res) => {
      let content = '';
      res.on('data', (chunk) => { content += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(content) }));
    }).on('error', reject);
    req.end(body);
  });
}

test('real HTTP mutation routes explicitly deduplicate creates, patches and removals', async (t) => {
  const cwd = fixture(t);
  const { request } = await serverFixture(t, cwd);
  async function repeat(method, suffix, body, key, expectedStatus) {
    const first = await request(method, suffix, body, key);
    const events = count(cwd);
    const second = await request(method, suffix, { ...body, requestId: key }, key);
    assert.equal(first.status, expectedStatus);
    assert.deepEqual(second, first, 'a matching retry returns the original status/body');
    assert.equal(count(cwd), events, 'a matching retry must append no events');
    const receipt = await request('GET', `/api/receipt?requestId=${encodeURIComponent(key)}`);
    assert.equal(receipt.status, 200);
    assert.equal(receipt.cache, 'no-store');
    assert.equal(receipt.body.readOnly, true);
    assert.equal(receipt.body.prescriptive, false);
    assert.equal(receipt.body.receipt.status, 'committed');
    assert.equal('_events' in receipt.body.receipt, false);
    assert.equal(count(cwd), events, 'receipt lookup appends no events');
    return first.body;
  }
  const a = await repeat('POST', '/api/nodes', { type: 'hypothesis', title: 'Original' }, 'api-create-a', 201);
  const b = await request('POST', '/api/nodes', { title: 'Second', requestId: 'api-create-b' });
  assert.equal(b.status, 201, 'body-only IDs work');
  await repeat('PATCH', `/api/nodes/${a.node.id}`, { title: 'Revised', expected: { title: 'Original' } }, 'api-patch-a', 200);
  const relation = await repeat('POST', '/api/edges', { from: a.node.id, to: b.body.node.id, kind: 'supports' }, 'api-link', 201);
  await repeat('DELETE', `/api/edges?id=${encodeURIComponent(relation.id)}`, {}, 'api-unlink', 200);
  await repeat('DELETE', `/api/nodes/${b.body.node.id}`, {}, 'api-remove-b', 200);
  const afterRemoval = count(cwd);
  const oldCreate = await request('POST', '/api/nodes', { title: 'Second', requestId: 'api-create-b' });
  assert.deepEqual(oldCreate.body, b.body, 'a create receipt remains usable after its node is removed');
  assert.equal(count(cwd), afterRemoval);
  const conflict = await request('POST', '/api/nodes', { title: 'Different' }, 'api-create-a');
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.code, 'request_id_conflict');
  assert.equal(count(cwd), afterRemoval);
  const otherOperation = await request('PATCH', `/api/nodes/${a.node.id}`, { title: 'Other' }, 'api-create-a');
  assert.equal(otherOperation.status, 409);
  assert.equal(otherOperation.body.code, 'request_id_conflict');
  assert.equal(count(cwd), afterRemoval);
});

test('a lost HTTP response can be resolved by receipt and retried without a duplicate node', async (t) => {
  const cwd = fixture(t);
  const { server, base, request } = await serverFixture(t, cwd);
  const payload = JSON.stringify({ title: 'Committed before response loss' });
  await new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port: server.address().port, path: '/api/nodes', method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json', 'Idempotency-Key': 'lost-response', 'Content-Length': Buffer.byteLength(payload) } }, (res) => {
      assert.equal(res.statusCode, 201);
      // The server committed before sending headers; the client discards the response body.
      res.destroy();
      resolve();
    }).on('error', reject);
    req.end(payload);
  });
  const events = count(cwd);
  const receipt = await request('GET', '/api/receipt?requestId=lost-response');
  assert.equal(receipt.status, 200);
  const retry = await request('POST', '/api/nodes', { title: 'Committed before response loss' }, 'lost-response');
  assert.equal(retry.body.node.id, receipt.body.receipt.result.node.id);
  assert.equal(retry.body.node.title, 'Committed before response loss');
  assert.equal(retry.body.node.confidence, null);
  assert.equal(Object.hasOwn(receipt.body.receipt.result.node, 'confidence'), false);
  assert.equal(count(cwd), events);
  assert.equal(readEvents(cwd).events.filter((ev) => ev.op === 'node').length, 1);
});

test('missing IDs retain ordinary writes and explicit invalid/mismatched IDs do not append', async (t) => {
  const cwd = fixture(t);
  const { request } = await serverFixture(t, cwd);
  const first = await request('POST', '/api/nodes', { title: 'No key' });
  const second = await request('POST', '/api/nodes', { title: 'No key' });
  assert.equal(first.status, 201);
  assert.equal(second.status, 201);
  assert.notEqual(first.body.node.id, second.body.node.id);
  assert.equal(readEvents(cwd).events.filter((ev) => ev.op === 'receipt').length, 0);
  const before = count(cwd);
  for (const [body, key] of [
    [{ title: 'Mismatch', requestId: 'other' }, 'header-key'],
    [{ title: 'Empty', requestId: '' }, undefined],
    [{ title: 'Null', requestId: null }, undefined],
    [{ title: 'Numeric', requestId: 7 }, undefined],
    [{ title: 'Whitespace', requestId: ' key ' }, undefined],
    [{ title: 'Control', requestId: 'key\n' }, undefined],
    [{ title: 'Too long' }, 'k'.repeat(201)],
  ]) assert.equal((await request('POST', '/api/nodes', body, key)).status, 400);
  const mismatch = await request('POST', '/api/nodes', { title: 'Mismatch', requestId: 'other' }, 'header-key');
  assert.equal(mismatch.body.error, 'request_id_mismatch');
  for (const [suffix, status, error] of [
    ['/api/receipt', 400, 'request_id_required'],
    ['/api/receipt?requestId=', 400, 'request_id_required'],
    ['/api/receipt?requestId=not-found', 404, 'receipt_not_found'],
  ]) {
    const response = await request('GET', suffix);
    assert.equal(response.status, status);
    assert.equal(response.body.error, error);
  }
  assert.equal((await request('GET', '/api/receipt?requestId=%20key%20')).status, 400);
  assert.equal(count(cwd), before);
});

test('receipt reads and retries preserve Host/Origin/JSON/read-only guards and byte-identical log', async (t) => {
  const cwd = fixture(t);
  addNode({ title: 'Existing', requestId: 'existing' }, cwd);
  const expected = getReceipt('existing', cwd);
  const { server, request } = await serverFixture(t, cwd, true);
  const before = { events: hash(paths(cwd).events), state: hash(paths(cwd).state) };
  const receipt = await request('GET', '/api/receipt?requestId=existing');
  assert.equal(receipt.status, 200);
  assert.deepEqual(receipt.body.receipt, expected);
  const retry = await request('POST', '/api/nodes', { title: 'Existing' }, 'existing');
  assert.equal(retry.status, 403);
  assert.equal(retry.body.error, 'read_only');
  const foreign = await rawRequest(server.address().port, '/api/receipt?requestId=existing', { headers: { Host: 'foreign.example' } });
  assert.equal(foreign.status, 403);
  assert.equal(foreign.body.error, 'host_not_allowed');
  assert.deepEqual({ events: hash(paths(cwd).events), state: hash(paths(cwd).state) }, before);

  const writable = await serverFixture(t, cwd);
  const crossOrigin = await writable.request('POST', '/api/nodes', { title: 'Denied' }, 'denied-origin', { Origin: 'https://foreign.example' });
  assert.equal(crossOrigin.status, 403);
  assert.equal(crossOrigin.body.error, 'cross_origin_write');
  const nonJson = await writable.request('POST', '/api/nodes', { title: 'Denied' }, 'denied-type', { 'Content-Type': 'text/plain' });
  assert.equal(nonJson.status, 415);
  assert.equal(nonJson.body.error, 'json_required');
  assert.equal(getReceipt('denied-origin', cwd), null);
  assert.equal(getReceipt('denied-type', cwd), null);
  const tooLarge = await writable.request('POST', '/api/nodes', { title: 'x'.repeat(256 * 1024) }, 'denied-size');
  assert.equal(tooLarge.status, 413);
  assert.equal(getReceipt('denied-size', cwd), null);
  const malformed = await rawRequest(writable.server.address().port, '/api/nodes', {
    method: 'POST', headers: { Origin: writable.base, 'Content-Type': 'application/json', 'Idempotency-Key': 'denied-json' }, body: '{bad-json',
  });
  assert.equal(malformed.status, 400);
  assert.equal(getReceipt('denied-json', cwd), null);
  assert.deepEqual({ events: hash(paths(cwd).events), state: hash(paths(cwd).state) }, before);
});

test('read-only receipt lookup reports an interrupted plan without completing it', async (t) => {
  const cwd = fixture(t);
  const source = addNode({ title: 'Source' }, cwd).node;
  addNode({ title: 'Interrupted', parent: source.id, enter: true, requestId: 'pending-http' }, cwd);
  const complete = fs.readFileSync(paths(cwd).events, 'utf8').trimEnd().split('\n');
  const firstPlan = complete.findIndex((line) => JSON.parse(line).request?.requestId === 'pending-http');
  assert.ok(firstPlan >= 0);
  // Emulate a crash after only the first complete line of a compound plan landed.
  fs.writeFileSync(paths(cwd).events, `${complete.slice(0, firstPlan + 1).join('\n')}\n`);
  const before = hash(paths(cwd).events);
  const { request } = await serverFixture(t, cwd, true);
  const result = await request('GET', '/api/receipt?requestId=pending-http');
  assert.equal(result.status, 200);
  assert.equal(result.body.receipt.status, 'pending');
  assert.equal(result.body.receipt.recoverable, true);
  assert.equal(result.body.receipt.committedEventIds.length, 1);
  assert.equal(result.body.receipt.eventIds.length, 3);
  assert.equal('_events' in result.body.receipt, false);
  assert.equal(hash(paths(cwd).events), before);
});
