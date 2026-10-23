import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  addNode, addEdge, patchNode, removeNode, removeEdge, moveCursor,
  addCheckpoint, addActivity, setMeta, reset, ensure, paths, readEvents,
  replay, getReceipt, withLock, appendEvent, readState,
} from '../lib/store.js';
import { applyAll, emptyGraph } from '../lib/model.js';

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blackboard-receipts-'));
  ensure(dir);
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
const log = (dir) => fs.readFileSync(paths(dir).events, 'utf8');

function appendFault(t, dir, behavior) {
  const original = fs.appendFileSync;
  fs.appendFileSync = function(file, content, ...options) {
    if (file === paths(dir).events) return behavior(original, file, content, options);
    return original.call(this, file, content, ...options);
  };
  const restore = () => { fs.appendFileSync = original; };
  t.after(restore);
  return restore;
}

test('1000 same-ID retries return the original compound result and append once', (t) => {
  const dir = fixture(t);
  const parent = addNode({ type: 'goal', title: 'research' }, dir).node;
  const input = { requestId: 'compound-1000', type: 'observation', title: 'response', parent: parent.id, relation: 'supports', enter: true };
  const first = addNode(input, dir);
  const before = log(dir);
  for (let i = 0; i < 1000; i++) assert.deepEqual(addNode(input, dir), first);
  assert.equal(log(dir), before);
  const events = readEvents(dir).events;
  assert.deepEqual(events.map((ev) => ev.op), ['node', 'node', 'edge', 'cursor', 'receipt']);
  const receipt = getReceipt(input.requestId, dir);
  assert.equal(receipt.status, 'committed');
  assert.deepEqual(receipt.result, first);
  assert.equal(receipt.eventIds.length, 3);
  assert.equal(replay(dir).integrity.unknownOps, 0);
  // An old projection ignoring the additive marker still receives every
  // ordinary graph/cursor event, not an opaque transaction operation.
  const legacy = applyAll(emptyGraph(), events.filter((ev) => ev.op !== 'receipt'));
  assert.deepEqual(replay(dir).nodes, legacy.nodes);
  assert.deepEqual(replay(dir).edges, legacy.edges);
  assert.deepEqual(replay(dir).cursors, legacy.cursors);
});

test('lost response after commit resolves from the log even after cache loss', (t) => {
  const dir = fixture(t);
  const input = { requestId: 'response-lost', type: 'note', title: 'committed', enter: true };
  const restore = appendFault(t, dir, (append, file, content, options) => {
    append(file, content, ...options);
    throw new Error('injected response lost after append');
  });
  assert.throws(() => addNode(input, dir), /injected response lost/);
  restore();
  const before = log(dir);
  const receipt = getReceipt(input.requestId, dir);
  assert.equal(receipt.status, 'committed');
  assert.deepEqual(addNode(input, dir), receipt.result);
  assert.equal(log(dir), before);
  assert.equal(Object.keys(replay(dir).nodes).length, 1);
  assert.equal(readState(dir).focus, receipt.result.node.id);
});

test('failure before append leaves no receipt or graph action', (t) => {
  const dir = fixture(t);
  const input = { requestId: 'pre-commit', title: 'not committed yet' };
  const restore = appendFault(t, dir, () => { throw new Error('injected before append'); });
  assert.throws(() => addNode(input, dir), /injected before append/);
  restore();
  assert.equal(getReceipt(input.requestId, dir), null);
  assert.equal(Object.keys(replay(dir).nodes).length, 0);
  assert.equal(addNode(input, dir).node.id, 'n1');
});

test('partial compound prefix is query-only until its exact retry completes it', (t) => {
  const dir = fixture(t);
  const parent = addNode({ title: 'parent' }, dir).node;
  const input = { requestId: 'partial-compound', title: 'child', parent: parent.id, enter: true };
  const restore = appendFault(t, dir, (append, file, content, options) => {
    // node and edge survive; cursor is a torn incomplete line, marker absent.
    const lines = content.trimEnd().split('\n');
    append(file, `${lines.slice(0, 2).join('\n')}\n${lines[2].slice(0, 30)}`, ...options);
    throw new Error('injected partial append');
  });
  assert.throws(() => addNode(input, dir), /injected partial append/);
  restore();
  const before = log(dir);
  const receipt = getReceipt(input.requestId, dir);
  assert.equal(receipt.status, 'pending');
  assert.equal(receipt.recoverable, true);
  assert.equal(receipt.committedEventIds.length, 2);
  assert.equal(log(dir), before, 'receipt query must not repair the tail or append');
  assert.throws(() => addNode({ title: 'unrelated' }, dir), /pending_request/);
  assert.equal(log(dir), before);
  assert.deepEqual(addNode(input, dir), receipt.result);
  assert.equal(getReceipt(input.requestId, dir).status, 'committed');
  const g = replay(dir);
  assert.equal(Object.keys(g.nodes).length, 2);
  assert.equal(Object.keys(g.edges).length, 1);
  assert.equal(g.cursors['agent:primary'].to, receipt.result.node.id);
  assert.equal(readEvents(dir).events.filter((ev) => ev.op === 'cursor').length, 1);
});

test('pending recovery never silently reorders an older writer later action', (t) => {
  const dir = fixture(t);
  const input = { requestId: 'older-writer-interference', title: 'node', enter: true };
  const restore = appendFault(t, dir, (append, file, content, options) => {
    append(file, `${content.split('\n')[0]}\n`, ...options);
    throw new Error('prefix only');
  });
  assert.throws(() => addNode(input, dir), /prefix only/);
  restore();
  // Simulate an older version that doesn't understand receipt metadata.
  withLock(() => appendEvent({ op: 'meta', set: { title: 'later action' } }, dir), dir);
  const before = log(dir);
  assert.equal(getReceipt(input.requestId, dir).recoverable, false);
  assert.throws(() => addNode(input, dir), /request_recovery_conflict/);
  assert.equal(log(dir), before);
});

test('payload or command mismatch rejects without appending; key order does not matter', (t) => {
  const dir = fixture(t);
  const first = addNode({ title: 'same', type: 'note', requestId: 'same-id' }, dir);
  const before = log(dir);
  assert.deepEqual(addNode({ requestId: 'same-id', type: 'note', title: 'same' }, dir), first);
  assert.throws(() => addNode({ requestId: 'same-id', title: 'different', type: 'note' }, dir), /request_id_conflict/);
  assert.throws(() => addCheckpoint({ requestId: 'same-id', summary: 'same' }, dir), /request_id_conflict/);
  assert.equal(log(dir), before);
});

test('retry resolves before stale object or expected-field validation', (t) => {
  const dir = fixture(t);
  const a = addNode({ title: 'a' }, dir).node;
  const b = addNode({ title: 'b' }, dir).node;
  const edgeInput = { from: a.id, to: b.id, requestId: 'edge' };
  const edge = addEdge(edgeInput, dir);
  const patch = { title: 'changed' };
  const options = { requestId: 'patch', expected: { title: 'a' } };
  const updated = patchNode(a.id, patch, dir, options);
  const removed = removeNode(a.id, { requestId: 'remove' }, dir);
  const before = log(dir);
  assert.deepEqual(addEdge(edgeInput, dir), edge);
  assert.deepEqual(patchNode(a.id, patch, dir, options), updated);
  assert.deepEqual(removeNode(a.id, { requestId: 'remove' }, dir), removed);
  assert.equal(log(dir), before);
});

test('all mutation entry points use the same request namespace and stored result', (t) => {
  const dir = fixture(t);
  const a = addNode({ title: 'a' }, dir).node;
  const b = addNode({ title: 'b' }, dir).node;
  const edge = addEdge({ from: a.id, to: b.id }, dir);
  const calls = [
    () => moveCursor(a.id, { requestId: 'cursor' }, dir),
    () => addActivity({ tool: 'test', summary: 'test', requestId: 'activity' }, dir),
    () => addCheckpoint({ summary: 'handoff', requestId: 'checkpoint' }, dir),
    () => removeEdge({ id: edge.id }, { requestId: 'unlink' }, dir),
    () => setMeta({ title: 'board' }, dir, { requestId: 'meta' }),
  ];
  for (const call of calls) {
    const first = call();
    const before = log(dir);
    assert.deepEqual(call(), first);
    assert.equal(log(dir), before);
  }
});

test('request namespace spans reset; retrying reset does not clear newer work', (t) => {
  const dir = fixture(t);
  const beforeReset = addNode({ requestId: 'old-node', title: 'old' }, dir);
  const resetResult = reset(dir, { requestId: 'reset-once' });
  const current = addNode({ title: 'new' }, dir);
  const before = log(dir);
  assert.deepEqual(reset(dir, { requestId: 'reset-once' }), resetResult);
  assert.deepEqual(addNode({ requestId: 'old-node', title: 'old' }, dir), beforeReset);
  assert.equal(log(dir), before);
  assert.deepEqual(Object.keys(replay(dir).nodes), [current.node.id]);
  assert.throws(() => addNode({ requestId: 'old-node', title: 'new payload' }, dir), /request_id_conflict/);
});

test('a failed disposable state-cache write does not invalidate a committed receipt', (t) => {
  const dir = fixture(t);
  fs.rmSync(paths(dir).state);
  fs.mkdirSync(paths(dir).state);
  const input = { title: 'survives cache failure', enter: true, requestId: 'cache-failure' };
  const first = addNode(input, dir);
  const before = log(dir);
  assert.equal(getReceipt(input.requestId, dir).status, 'committed');
  assert.deepEqual(addNode(input, dir), first);
  assert.equal(log(dir), before);
  assert.equal(readState(dir).focus, first.node.id);
});

test('request IDs are validated and receipt misses are read-only', (t) => {
  const dir = fixture(t);
  const before = log(dir);
  for (const requestId of ['', ' ', ' id', 'id ', 'line\nbreak', 'x'.repeat(201), 12, {}, []]) {
    assert.throws(() => addNode({ title: 'bad ID', requestId }, dir), /requestId/);
  }
  assert.equal(getReceipt('missing', dir), null);
  assert.equal(log(dir), before);
});

test('concurrent same-ID requests in separate processes create one compound action', async (t) => {
  const dir = fixture(t);
  const parent = addNode({ title: 'parent' }, dir).node;
  const storeUrl = new URL('../lib/store.js', import.meta.url).href;
  const input = { type: 'note', title: 'concurrent', parent: parent.id, enter: true, requestId: 'shared-concurrent' };
  const source = `import {addNode} from ${JSON.stringify(storeUrl)}; process.stdout.write(JSON.stringify(addNode(${JSON.stringify(input)},${JSON.stringify(dir)})));`;
  const run = promisify(execFile);
  const results = await Promise.all(Array.from({ length: 8 }, () => run(process.execPath, ['--input-type=module', '-e', source], { encoding: 'utf8', timeout: 20000 })));
  const first = JSON.parse(results[0].stdout);
  for (const result of results) assert.deepEqual(JSON.parse(result.stdout), first);
  const g = replay(dir);
  assert.equal(Object.keys(g.nodes).length, 2);
  assert.equal(Object.keys(g.edges).length, 1);
  assert.equal(g.cursorTrail.length, 1);
  assert.equal(readEvents(dir).events.filter((ev) => ev.op === 'receipt').length, 1);
});

test('1000 independent request receipts project in one pass and survive cache loss', async (t) => {
  const dir = fixture(t);
  const { projectReceipts } = await import('../lib/receipts.js');
  const results = [];
  for (let index = 0; index < 1000; index++) {
    results.push(addNode({ title: `independent ${index}`, requestId: `independent-${index}` }, dir));
  }
  fs.rmSync(paths(dir).state, { force: true });
  const before = log(dir);
  const receipts = projectReceipts(readEvents(dir).events);
  assert.equal(receipts.size, 1000);
  for (let index = 0; index < 1000; index++) {
    const receipt = receipts.get(`independent-${index}`);
    assert.equal(receipt.status, 'committed');
    assert.deepEqual(receipt.result, results[index]);
    assert.deepEqual(receipt.eventIds, receipt.committedEventIds);
  }
  for (const index of [0, 499, 999]) {
    assert.deepEqual(getReceipt(`independent-${index}`, dir).result, results[index]);
    assert.deepEqual(addNode({ title: `independent ${index}`, requestId: `independent-${index}` }, dir), results[index]);
  }
  assert.equal(log(dir), before);
  assert.equal(Object.keys(replay(dir).nodes).length, 1000);
});
