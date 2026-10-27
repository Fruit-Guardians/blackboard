import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  ensure, paths, replay, readEvents, readState, addNode, addEdge, addCheckpoint,
  patchNode, getReceipt, LIMITS,
} from '../lib/store.js';
import { requestFingerprint, withoutRequestId } from '../lib/receipts.js';

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blackboard-input-integrity-'));
  ensure(dir);
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
const log = (dir) => fs.readFileSync(paths(dir).events, 'utf8');
const tooLong = (field) => `${'x'.repeat(LIMITS[field])}未验证`;
const loss = (field) => ({ originalLength: LIMITS[field] + 3, storedLength: LIMITS[field] });
function assertInputError(action, fields) {
  assert.throws(action, (error) => {
    assert.equal(error.status, 422);
    assert.equal(error.code, 'input_too_long');
    assert.deepEqual(error.fields, fields);
    assert.deepEqual(error.limits, Object.fromEntries(fields.map((field) => [field, loss(field)])));
    assert.doesNotMatch(error.message, /未验证|xxxx/);
    return true;
  });
}

test('legacy node clipping persists field lengths in the event without keeping dropped text', (t) => {
  const dir = fixture(t);
  const result = addNode({ type: 'finding', title: tooLong('title'), detail: tooLong('detail'), confidence: 'suspected' }, dir);
  assert.deepEqual(result.truncated, ['title', 'detail']);
  const expected = { title: loss('title'), detail: loss('detail') };
  assert.deepEqual(result.node.inputTruncation, expected);
  assert.deepEqual(replay(dir).nodes[result.node.id].inputTruncation, expected);
  assert.deepEqual(readEvents(dir).events[0].node.inputTruncation, expected);
  assert.equal(result.node.title.length, LIMITS.title);
  assert.equal(result.node.detail.length, LIMITS.detail);
  assert.doesNotMatch(log(dir), /未验证/);
  assert.equal(result.node.confidence, 'suspected');
});

test('strict compound node writes reject all oversized fields before any event or cursor change', (t) => {
  for (const requestId of [undefined, 'strict-compound']) {
    const dir = fixture(t);
    const target = addNode({ type: 'goal', title: 'A synthetic target' }, dir).node;
    const before = log(dir);
    const state = readState(dir);
    assertInputError(() => addNode({ type: 'finding', title: tooLong('title'), detail: tooLong('detail'),
      target: target.id, relation: 'supports', enter: true, rejectTruncation: true, requestId }, dir), ['title', 'detail']);
    assert.equal(log(dir), before);
    assert.deepEqual(readState(dir), state);
    assert.deepEqual(Object.keys(replay(dir).nodes), [target.id]);
    assert.deepEqual(replay(dir).edges, {});
    assert.deepEqual(replay(dir).cursors, {});
    if (requestId) assert.equal(getReceipt(requestId, dir), null);
  }
});

test('legacy edge labels retain input-loss metadata and strict edges leave the log unchanged', (t) => {
  const dir = fixture(t);
  const from = addNode({ title: 'Source' }, dir).node.id;
  const to = addNode({ title: 'Claim' }, dir).node.id;
  const edge = addEdge({ from, to, kind: 'supports', label: tooLong('label') }, dir);
  assert.deepEqual(edge.truncated, ['label']);
  assert.deepEqual(edge.inputTruncation, { label: loss('label') });
  assert.deepEqual(replay(dir).edges[edge.id].inputTruncation, { label: loss('label') });
  const before = log(dir);
  assertInputError(() => addEdge({ from, to, kind: 'contradicts', label: tooLong('label'), rejectTruncation: true, requestId: 'strict-edge' }, dir), ['label']);
  assert.equal(log(dir), before);
  assert.equal(getReceipt('strict-edge', dir), null);
});

test('legacy checkpoint summaries retain input-loss metadata and strict checkpoints append nothing', (t) => {
  const dir = fixture(t);
  const checkpoint = addCheckpoint({ summary: tooLong('summary') }, dir);
  assert.deepEqual(checkpoint.truncated, ['summary']);
  assert.deepEqual(checkpoint.inputTruncation, { summary: loss('summary') });
  assert.deepEqual(replay(dir).checkpoints[checkpoint.id].inputTruncation, { summary: loss('summary') });
  const before = log(dir);
  assertInputError(() => addCheckpoint({ summary: tooLong('summary'), rejectTruncation: true, requestId: 'strict-checkpoint' }, dir), ['summary']);
  assert.equal(log(dir), before);
  assert.equal(getReceipt('strict-checkpoint', dir), null);
});

test('patches preserve unrelated input-loss metadata and clear only explicitly corrected fields', (t) => {
  const dir = fixture(t);
  const node = addNode({ title: tooLong('title'), detail: tooLong('detail') }, dir).node;
  patchNode(node.id, { confidence: 'reproduced', severity: 'low' }, dir);
  assert.deepEqual(replay(dir).nodes[node.id].inputTruncation, { title: loss('title'), detail: loss('detail') });
  const fixedTitle = patchNode(node.id, { title: 'A complete title' }, dir, { rejectTruncation: true });
  assert.deepEqual(fixedTitle.inputTruncation, { detail: loss('detail') });
  assert.deepEqual(replay(dir).nodes[node.id].inputTruncation, { detail: loss('detail') });
  const fixedDetail = patchNode(node.id, { detail: 'Observed only locally.\nLimit: not verified remotely.' }, dir, { rejectTruncation: true });
  assert.equal(fixedDetail.inputTruncation, null);
  assert.equal(replay(dir).nodes[node.id].inputTruncation, null);
  assert.equal(replay(dir).nodes[node.id].confidence, 'reproduced');
  assert.equal(readEvents(dir).events.at(-1).set.inputTruncation, null, 'clearing must be replayable, not a transient delete');
  patchNode(node.id, { title: tooLong('title') }, dir);
  assert.deepEqual(replay(dir).nodes[node.id].inputTruncation, { title: loss('title') });
});

test('strict patches cannot partially persist valid fields beside an oversized field', (t) => {
  const dir = fixture(t);
  const node = addNode({ title: 'Original', detail: 'Original details' }, dir).node;
  const before = log(dir);
  assertInputError(() => patchNode(node.id, { title: 'Changed', detail: tooLong('detail'), confidence: 'reproduced' }, dir,
    { rejectTruncation: true, requestId: 'strict-patch' }), ['detail']);
  assert.equal(log(dir), before);
  assert.deepEqual(replay(dir).nodes[node.id], node);
  assert.equal(getReceipt('strict-patch', dir), null);
});

test('managed metadata cannot be forged by patches or extra node properties', (t) => {
  const dir = fixture(t);
  const clean = addNode({ title: 'Complete', extra: { inputTruncation: { detail: loss('detail') }, activityId: 'a1' } }, dir).node;
  assert.equal(clean.inputTruncation, undefined);
  assert.equal(clean.activityId, 'a1');
  const clipped = addNode({ title: tooLong('title'), extra: { inputTruncation: null } }, dir).node;
  assert.deepEqual(clipped.inputTruncation, { title: loss('title') });
  const before = log(dir);
  assert.throws(() => patchNode(clipped.id, { inputTruncation: null }, dir), /inputTruncation/);
  assert.equal(log(dir), before);
  assert.deepEqual(replay(dir).nodes[clipped.id].inputTruncation, { title: loss('title') });
});

test('explicit legacy extra overrides do not persist loss metadata for replaced text', (t) => {
  const dir = fixture(t);
  const titleOverridden = addNode({ title: tooLong('title'), detail: tooLong('detail'), extra: { title: 'Short' } }, dir);
  assert.equal(titleOverridden.node.title, 'Short');
  assert.deepEqual(titleOverridden.truncated, ['title', 'detail'], 'the legacy immediate clipping receipt remains compatible');
  assert.deepEqual(titleOverridden.node.inputTruncation, { detail: loss('detail') });
  assert.deepEqual(replay(dir).nodes[titleOverridden.node.id].inputTruncation, { detail: loss('detail') });

  const detailOverridden = addNode({ title: tooLong('title'), detail: tooLong('detail'), extra: { detail: 'Complete replacement' } }, dir);
  assert.equal(detailOverridden.node.detail, 'Complete replacement');
  assert.deepEqual(detailOverridden.node.inputTruncation, { title: loss('title') });

  const bothOverridden = addNode({ title: tooLong('title'), detail: tooLong('detail'), extra: { title: 'Short', detail: 'Complete replacement' } }, dir);
  assert.equal(bothOverridden.node.inputTruncation, undefined);
  assert.equal(replay(dir).nodes[bothOverridden.node.id].inputTruncation, undefined);

  const notCopied = Object.defineProperty({}, 'title', { value: 'Invisible replacement', enumerable: false });
  const stillClipped = addNode({ title: tooLong('title'), extra: notCopied }, dir).node;
  assert.equal(stillClipped.title.length, LIMITS.title);
  assert.deepEqual(stillClipped.inputTruncation, { title: loss('title') }, 'non-enumerable extensions do not override stored fields');
});

test('strict extensions still reject oversized final text before any event', (t) => {
  const dir = fixture(t);
  for (const field of ['title', 'detail']) {
    const before = log(dir);
    assertInputError(() => addNode({ title: 'Short primary input', extra: { [field]: tooLong(field) },
      rejectTruncation: true, requestId: `strict-extra-${field}` }, dir), [field]);
    assert.equal(log(dir), before);
    assert.equal(getReceipt(`strict-extra-${field}`, dir), null);
  }
});

test('default and explicit-false writes retain the pre-option request fingerprints', (t) => {
  const dir = fixture(t);
  const firstInput = { title: 'Legacy identity', requestId: 'legacy-node' };
  const first = addNode(firstInput, dir);
  assert.equal(getReceipt(firstInput.requestId, dir).fingerprint, requestFingerprint('addNode', withoutRequestId(firstInput)));
  let before = log(dir);
  assert.deepEqual(addNode({ ...firstInput, rejectTruncation: false }, dir), first);
  assert.equal(log(dir), before);

  const set = { detail: 'A complete legacy edit' };
  const patched = patchNode(first.node.id, set, dir, { requestId: 'legacy-patch' });
  assert.equal(getReceipt('legacy-patch', dir).fingerprint, requestFingerprint('patchNode', { ref: first.node.id, set, by: null, expected: null }));
  before = log(dir);
  assert.deepEqual(patchNode(first.node.id, set, dir, { requestId: 'legacy-patch', rejectTruncation: false }), patched);
  assert.equal(log(dir), before);

  const other = addNode({ title: 'Second node' }, dir).node;
  const edgeInput = { from: first.node.id, to: other.id, requestId: 'legacy-edge' };
  const edge = addEdge(edgeInput, dir);
  assert.equal(getReceipt(edgeInput.requestId, dir).fingerprint, requestFingerprint('addEdge', withoutRequestId(edgeInput)));
  before = log(dir);
  assert.deepEqual(addEdge({ ...edgeInput, rejectTruncation: false }, dir), edge);
  assert.equal(log(dir), before);

  const checkpointInput = { summary: 'Legacy handoff', requestId: 'legacy-checkpoint' };
  const checkpoint = addCheckpoint(checkpointInput, dir);
  assert.equal(getReceipt(checkpointInput.requestId, dir).fingerprint, requestFingerprint('addCheckpoint', withoutRequestId(checkpointInput)));
  before = log(dir);
  assert.deepEqual(addCheckpoint({ ...checkpointInput, rejectTruncation: false }, dir), checkpoint);
  assert.equal(log(dir), before);
});

test('explicit strict request retries are idempotent and different modes conflict', (t) => {
  const dir = fixture(t);
  const input = { title: 'Strict identity', rejectTruncation: true, requestId: 'strict-retry' };
  const first = addNode(input, dir);
  const before = log(dir);
  assert.deepEqual(addNode(input, dir), first);
  assert.equal(log(dir), before);
  assert.throws(() => addNode({ ...input, rejectTruncation: false }, dir), /request_id_conflict/);
  assert.equal(log(dir), before);
});

test('strict edge, checkpoint, and patch retries preserve results and distinguish the mode', (t) => {
  const dir = fixture(t);
  const from = addNode({ title: 'Evidence' }, dir).node.id;
  const to = addNode({ title: 'Claim' }, dir).node.id;
  const actions = [
    (rejectTruncation) => addEdge({ from, to, label: 'Explicit support', rejectTruncation, requestId: 'strict-edge-retry' }, dir),
    (rejectTruncation) => addCheckpoint({ summary: 'A complete handoff', rejectTruncation, requestId: 'strict-checkpoint-retry' }, dir),
    (rejectTruncation) => patchNode(to, { detail: 'Complete evidence and limits' }, dir, { rejectTruncation, requestId: 'strict-patch-retry' }),
  ];
  for (const action of actions) {
    const first = action(true);
    const before = log(dir);
    assert.deepEqual(action(true), first);
    assert.equal(log(dir), before);
    assert.throws(() => action(false), /request_id_conflict/);
    assert.equal(log(dir), before);
  }
});

test('rejected strict input does not reserve a request ID and exact limits remain intact', (t) => {
  const dir = fixture(t);
  assertInputError(() => addNode({ title: tooLong('title'), rejectTruncation: true, requestId: 'corrected-request' }, dir), ['title']);
  assert.equal(log(dir), '');
  assert.equal(getReceipt('corrected-request', dir), null);
  const node = addNode({ title: 'x'.repeat(LIMITS.title), detail: '中'.repeat(LIMITS.detail), rejectTruncation: true, requestId: 'corrected-request' }, dir).node;
  assert.equal(node.title.length, LIMITS.title);
  assert.equal(node.detail.length, LIMITS.detail);
  assert.equal(node.inputTruncation, undefined);
  assert.equal(getReceipt('corrected-request', dir).status, 'committed');
});

test('exact edge and checkpoint limits save without loss, and clearing a detail is replayable', (t) => {
  const dir = fixture(t);
  const from = addNode({ title: 'Evidence', detail: tooLong('detail') }, dir).node.id;
  const to = addNode({ title: 'Claim' }, dir).node.id;
  const edge = addEdge({ from, to, label: '中'.repeat(LIMITS.label), rejectTruncation: true }, dir);
  assert.equal(edge.label.length, LIMITS.label);
  assert.equal(edge.inputTruncation, undefined);
  const checkpoint = addCheckpoint({ summary: '中'.repeat(LIMITS.summary), rejectTruncation: true }, dir);
  assert.equal(checkpoint.summary.length, LIMITS.summary);
  assert.equal(checkpoint.inputTruncation, undefined);
  patchNode(from, { detail: '' }, dir, { rejectTruncation: true });
  assert.equal(replay(dir).nodes[from].detail, '');
  assert.equal(replay(dir).nodes[from].inputTruncation, null);
});
