import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Compile pure viewer modules without requiring a DOM or a specific Node TS loader.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blackboard-presenter-'));
after(() => fs.rmSync(dir, { recursive: true, force: true }));
const root = fileURLToPath(new URL('../', import.meta.url));
execFileSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '--target', 'ES2022', '--module', 'ESNext', '--moduleResolution', 'Bundler', '--skipLibCheck', '--outDir', dir, path.join(root, 'web/src/presentation.ts'), path.join(root, 'web/src/api.ts'), path.join(root, 'web/src/workspace/selectors.ts')], { cwd: dir });
function resolveModuleExtensions(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const p = path.join(directory, entry.name);
    if (entry.isDirectory()) resolveModuleExtensions(p);
    else if (entry.name.endsWith('.js')) fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace(/from '(\.\.?\/[^']+)'/g, (_all, name) => `from '${name}.js'`));
  }
}
resolveModuleExtensions(dir);
fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ type: 'module' }));
const modulePath = path.join(dir, 'presentation.js');
const { confidenceLabel, presentNode, nodeStateSummary, matchesNode, statusLabel, severityLabel, typeLabel } = await import(pathToFileURL(modulePath).href);
const { changeDraft, EMPTY_EDIT, existingLink, sourceLocation, historyValue } = await import(pathToFileURL(path.join(dir, 'research-state.js')).href);
const api = await import(pathToFileURL(path.join(dir, 'api.js')).href);
const { selectWorkspaceSnapshot, selectWorkspaceAgent } = await import(pathToFileURL(path.join(dir, 'workspace/selectors.js')).href);
const node = { id: 'node-7', type: 'hypothesis', title: 'Gateway policy。Verify middleware next.', detail: 'Session boundary', status: 'open', severity: 'high', confidence: 'static-confirmed' };

test('node presenter splits a heading from evidence without rewriting it', () => {
  assert.deepEqual(presentNode(node), { headline: 'Gateway policy', summary: 'Verify middleware next.', detail: 'Session boundary' });
});
test('node presenter preserves route names and decimal punctuation', () => {
  assert.equal(presentNode({ title: '4.1.8 branchEmpList.do uses a route' }).headline, '4.1.8 branchEmpList.do uses a route');
});
test('node presenter uses explicit detail when the title is one sentence', () => {
  assert.equal(presentNode({ title: 'A short finding', detail: 'Evidence' }).summary, 'Evidence');
});
test('node presenter handles multiline and blank authored titles', () => {
  assert.equal(presentNode({ title: 'Heading\nBody' }).summary, 'Body');
  assert.equal(presentNode({ title: '  ' }).headline, '未命名节点');
});
test('board search matches id, detail and localized type/confidence, case-insensitively', () => {
  for (const query of ['NODE-7', 'session boundary', '猜测', '待验证', '高危', '静态确认']) assert.equal(matchesNode(node, query), true, query);
});
test('board search applies all terms and rejects unrelated text', () => {
  assert.equal(matchesNode(node, 'gateway session'), true);
  assert.equal(matchesNode(node, 'gateway missing'), false);
  assert.equal(matchesNode(node, '   '), true);
});
test('unknown states and custom types keep their authored labels', () => {
  assert.equal(statusLabel('custom'), 'custom');
  assert.equal(typeLabel('decision'), 'decision');
  assert.equal(severityLabel('custom'), 'custom');
  assert.equal(confidenceLabel('custom'), 'custom');
});
test('missing states are represented explicitly instead of a false status', () => {
  assert.equal(statusLabel(), '未设置');
  assert.equal(severityLabel(), '未评估');
  assert.equal(confidenceLabel(), '未声明');
});


test('source locations are rendered as inert text and searchable with tags and author', () => {
  const sourced = { ...node, loc: { path: 'src/auth.ts', line: 42, column: 3 }, tags: ['session-boundary'], author: 'agent:review' };
  assert.equal(sourceLocation(sourced), 'src/auth.ts:42:3');
  for (const query of ['auth.ts:42', 'session-boundary', 'agent:review']) assert.equal(matchesNode(sourced, query), true);
  assert.equal(sourceLocation({ ...node, loc: 'javascript:alert(1)' }), 'javascript:alert(1)');
  assert.equal(sourceLocation({ ...node, loc: { path: 42 } }), '');
});
test('edit drafts preserve the first baseline across live updates and only patch changed fields', () => {
  const initial = { ...EMPTY_EDIT, editing: true };
  const draft = changeDraft(initial, node, 'title', 'New title');
  const live = { ...node, title: 'Agent title', detail: 'New evidence', status: 'done' };
  const next = changeDraft(draft, live, 'title', 'Another title');
  assert.deepEqual(next.fields, { title: 'Another title' });
  assert.deepEqual(next.expected, { title: node.title });
  assert.deepEqual(initial.fields, {}, 'draft helper does not mutate its input');
  const undone = changeDraft(next, live, 'title', node.title);
  assert.deepEqual(undone.fields, {});
  assert.deepEqual(undone.expected, {});
});
test('status, risk, and confidence edits remain orthogonal and retain conflict drafts', () => {
  let draft = { ...EMPTY_EDIT, editing: true, conflict: true };
  draft = changeDraft(draft, node, 'severity', 'low');
  assert.deepEqual(draft.fields, { severity: 'low' });
  assert.deepEqual(draft.expected, { severity: 'high' });
  draft = changeDraft(draft, node, 'confidence', 'suspected');
  assert.deepEqual(draft.fields, { severity: 'low', confidence: 'suspected' });
  assert.equal(draft.conflict, true, 'editing never clears an unresolved conflict');
  assert.equal('status' in draft.fields, false);
  assert.equal(node.status, 'open');
});
test('previously unset fields use the empty-string API baseline without inventing other states', () => {
  const draft = changeDraft(EMPTY_EDIT, { id: 'n', type: 'custom', title: 'N' }, 'confidence', 'confirmed');
  assert.deepEqual(draft.fields, { confidence: 'confirmed' });
  assert.deepEqual(draft.expected, { confidence: '' });
});
test('existing-node links default to weak semantics and preview exactly the submitted direction', () => {
  assert.deepEqual(existingLink('a', 'b', 'outgoing'), { from: 'a', to: 'b', kind: 'related-to' });
  assert.deepEqual(existingLink('a', 'b', 'incoming', 'contradicts'), { from: 'b', to: 'a', kind: 'contradicts' });
  assert.equal(existingLink('a', '', 'outgoing'), null);
  assert.equal(existingLink('a', 'a', 'outgoing'), null);
});
test('history values distinguish absent, empty, and structured data', () => {
  assert.equal(historyValue(null), '∅'); assert.equal(historyValue(undefined), '∅');
  assert.equal(historyValue(''), '""');
  assert.equal(historyValue({ status: 'refuted' }), '{"status":"refuted"}');
});
test('history reads encode exact identities and only perform same-origin GET requests', async () => {
  const previous = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => { calls.push({ url, init }); return { ok: true, json: async () => ({ readOnly: true }) }; };
  try {
    await api.getNodeHistory('a/b?x'); await api.getCheckpointChanges('cp#1');
    assert.deepEqual(calls.map(({ url }) => url), ['/api/history?node=a%2Fb%3Fx', '/api/changes?since=cp%231']);
    assert.ok(calls.every(({ init }) => init.method === 'GET' && init.body === undefined));
  } finally { globalThis.fetch = previous; }
});
test('API conflicts preserve structured conflicting fields instead of treating the write as success', async () => {
  const previous = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ error: 'node_conflict', fields: ['severity', null, 7] }), { status: 409 });
  try {
    await assert.rejects(api.patchNode('n', { severity: 'low', expected: { severity: 'high' } }), (error) => {
      assert.ok(error instanceof api.NodeConflict);
      assert.deepEqual(error.fields, ['severity']);
      return true;
    });
  } finally { globalThis.fetch = previous; }
});

test('invalid successful API responses reject with their HTTP status and an unconfirmed-outcome code', async () => {
  const previous = globalThis.fetch;
  const responses = [
    new Response('{', { status: 200 }),
    new Response('', { status: 201 }),
    new Response('null', { status: 200 }),
    new Response('[]', { status: 200 }),
    new Response('true', { status: 200 }),
    new Response(new ReadableStream({ start(controller) { controller.error(new Error('Interrupted body')); } }), { status: 200 }),
  ];
  let requests = 0;
  try {
    for (const response of responses) {
      globalThis.fetch = async () => { requests++; return response; };
      await assert.rejects(api.patchNode('n', { title: 'Draft title' }), (error) => {
        assert.ok(error instanceof Error);
        assert.equal(error.code, 'invalid_response');
        assert.equal(error.status, response.status);
        assert.ok(error.message.length > 0);
        assert.ok(error.message.includes(String(response.status)), 'the displayed diagnostic includes the HTTP status');
        return true;
      });
    }
    assert.equal(requests, responses.length, 'an uncertain write must not be retried automatically');
  } finally { globalThis.fetch = previous; }
});

test('unstructured HTTP failures retain their status without exposing parse or envelope errors', async () => {
  const previous = globalThis.fetch;
  const bodies = ['<html>Bad gateway</html>', 'null', '[]', '42', '{"error":{"message":"upstream failed"}}', '{"error":7}'];
  try {
    for (const body of bodies) {
      globalThis.fetch = async () => new Response(body, { status: 502 });
      await assert.rejects(api.patchNode('n', { title: 'Draft title' }), (error) => {
        assert.ok(error instanceof Error);
        assert.ok(!(error instanceof TypeError));
        assert.equal(error.status, 502);
        assert.ok(error.message.includes('502'));
        assert.doesNotMatch(error.message, /\[object Object\]/);
        return true;
      });
    }
  } finally { globalThis.fetch = previous; }
});

test('well-formed API responses return their JSON result', async () => {
  const previous = globalThis.fetch;
  globalThis.fetch = async () => new Response('{"node":{"id":"created-node"}}', { status: 201 });
  try { assert.deepEqual(await api.addNode({ type: 'note', title: 'A note' }), { node: { id: 'created-node' } }); }
  finally { globalThis.fetch = previous; }
});

test('viewer writes opt into rejecting truncated input while preserving the submitted fields and baselines', async () => {
  const previous = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); return { ok: true, json: async () => ({ node: { id: 'n1' } }) }; };
  const create = { type: 'finding', title: 'Authored title', detail: 'Authored detail' };
  const patch = { detail: 'Changed detail', expected: { detail: 'Authored detail' } };
  try {
    await api.addNode(create); await api.patchNode('n/1', patch);
    assert.deepEqual(calls, [
      { url: '/api/nodes', body: { ...create, rejectTruncation: true } },
      { url: '/api/nodes/n%2F1', body: { ...patch, rejectTruncation: true } },
    ]);
    assert.equal('rejectTruncation' in create, false, 'sending must not mutate the creation draft');
    assert.equal('rejectTruncation' in patch, false, 'sending must not mutate the edit draft');
  } finally { globalThis.fetch = previous; }
});

test('viewer length rejection explains that nothing was saved rather than treating the write as success', async () => {
  const previous = globalThis.fetch;
  // Match the server's error envelope: the stable code is separate from its readable message.
  const responses = [
    { error: 'input too long: detail (20001 > 20000); no text was saved', code: 'input_too_long', fields: ['detail'], limits: { detail: { originalLength: 20001, storedLength: 20000 } } },
    { error: 'input_too_long', fields: ['detail'] },
  ];
  try {
    for (const response of responses) {
      globalThis.fetch = async () => ({ ok: false, status: 422, json: async () => response });
      await assert.rejects(api.patchNode('n', { detail: 'x'.repeat(20001) }), /未保存.*详情/);
    }
  }
  finally { globalThis.fetch = previous; }
});


test('canvas state summary never hides a refuted status behind a reproduced confidence', () => {
  assert.equal(nodeStateSummary({ status: 'refuted', severity: 'high', confidence: 'reproduced' }), '已反驳 · 高危 · 已复现');
  assert.equal(nodeStateSummary({ confidence: 'confirmed' }), '已确认');
  assert.equal(nodeStateSummary({}), '');
});

test('workspace catalogues preserve authored order, stable severity ties and open-thread semantics', () => {
  const nodes = Object.freeze([
    { id: 'a', type: 'finding', title: 'Critical finding', severity: 'critical', status: 'open', ts: 5 },
    { id: 'b', type: 'vuln', title: 'First high finding', severity: 'high', ts: 10 },
    { id: 'c', type: 'finding', title: 'Second high finding', severity: 'high', status: 'confirmed', confidence: 'static-confirmed', ts: 10 },
    { id: 'd', type: 'finding', title: 'Custom risk', severity: 'custom', ts: 0 },
    { id: 's', type: 'finding', title: 'Superseded finding', severity: 'critical', status: 'superseded', ts: 99 },
    { id: 'h', type: 'hypothesis', title: 'Unset status is open', status: null, ts: 20 },
    { id: 'q', type: 'question', title: 'Blocked thread', status: 'blocked', ts: 1 },
    { id: 'i', type: 'intent', title: 'Deferred thread', status: 'deferred', ts: 2 },
    { id: 'n', type: 'custom', title: 'Unlinked note', ts: 0 },
  ]);
  const edges = Object.freeze([
    { id: 'e1', from: 'a', to: 'h', kind: 'supports' },
    { id: 'e2', from: 'b', to: 'absent', kind: 'related-to' },
  ]);
  const activities = Object.freeze([{ id: 'old', at: 1 }, { id: 'new', at: 2 }, { id: 'tie', at: 2 }]);
  const snapshot = { meta: {}, nodes, edges, activities, stats: { vulns: { critical: 1, high: 2 }, frontier: 7, candidates: 2 } };
  const board = selectWorkspaceSnapshot(snapshot);
  assert.deepEqual(board.findings.map((item) => item.id), ['a', 'b', 'c', 'd']);
  assert.deepEqual(board.openItems.map((item) => item.id), ['q', 'h']);
  assert.deepEqual(board.inbox.map((item) => item.id), ['n', 'i', 'q', 's', 'd', 'c']);
  assert.deepEqual(board.paletteNodes.map((item) => item.id), ['s', 'h', 'b', 'c', 'a', 'i', 'q', 'd', 'n']);
  assert.deepEqual(board.activities.map((item) => item.id), ['new', 'tie', 'old']);
  assert.deepEqual(activities.map((item) => item.id), ['old', 'new', 'tie'], 'sorting must leave the streamed snapshot untouched');
  assert.equal(board.byId.get('c'), nodes[2], 'inspector and catalogues share the original node objects');
  assert.deepEqual(board.counts, { nodes: 9, edges: 2, risk: 3, open: 7, candidates: 2 });
  assert.equal(board.filterOptions.riskCount, 4, 'risk facets include superseded nodes independently of sidebar grouping');
  assert.deepEqual(board.filterOptions.types.map(({ value, count }) => [value, count]), [
    ['finding', 4], ['vuln', 1], ['hypothesis', 1], ['question', 1], ['intent', 1], ['custom', 1],
  ]);
  assert.deepEqual(board.filterOptions.statuses.map(({ value, count }) => [value, count]), [
    ['', 4], ['open', 1], ['confirmed', 1], ['superseded', 1], ['blocked', 1], ['deferred', 1],
  ]);
  assert.deepEqual(board.filterOptions.confidences, [{ value: '', count: 8 }, { value: 'static-confirmed', count: 1 }]);
  const records = selectWorkspaceSnapshot({ ...snapshot, nodes: Object.fromEntries(nodes.map((item) => [item.id, item])), edges: Object.fromEntries(edges.map((item) => [item.id, item])), activities: Object.fromEntries(activities.map((item) => [item.id, item])) });
  assert.deepEqual(records, board, 'record and array snapshots present the same catalogues');
});

test('workspace Agent perspectives preserve explicit identities and isolate cursor and digest fallbacks', () => {
  const primary = { id: 'p', type: 'finding', title: 'Primary focus', severity: 'high' };
  const review = { id: 'r', type: 'hypothesis', title: 'Review focus', status: 'blocked' };
  const snapshot = {
    meta: { focus: primary.id }, nodes: [primary, review], edges: [],
    cursors: {
      'agent:primary': { id: 'cp', agentId: 'agent:primary', to: primary.id },
      'agent:review': { id: 'cr', agentId: 'agent:review', to: review.id },
      'agent:ghost': { id: 'cg', agentId: 'agent:ghost', to: 'removed' },
    },
    checkpoints: { archive: { agentId: 'agent:archive' }, review: { agentId: 'agent:review' } },
    digest: 'Legacy primary digest', digests: { 'agent:review': 'Review digest' },
  };
  const before = structuredClone(snapshot);
  const board = selectWorkspaceSnapshot(snapshot);
  const main = selectWorkspaceAgent(snapshot, board, 'agent:primary');
  const reviewer = selectWorkspaceAgent(snapshot, board, 'agent:review');
  const unknown = selectWorkspaceAgent(snapshot, board, 'agent:pending');
  assert.equal(main.current, primary);
  assert.equal(main.digest, 'Legacy primary digest');
  assert.deepEqual(main.findings, []);
  assert.deepEqual(main.openItems, [review]);
  assert.equal(reviewer.currentId, review.id);
  assert.equal(reviewer.current, review);
  assert.equal(reviewer.digest, 'Review digest');
  assert.deepEqual(reviewer.findings, [primary]);
  assert.deepEqual(reviewer.openItems, []);
  assert.deepEqual(unknown.agentIds, ['agent:primary', 'agent:archive', 'agent:ghost', 'agent:pending', 'agent:review']);
  assert.equal(unknown.currentId, null);
  assert.equal(unknown.current, null);
  assert.equal(unknown.digest, '');
  assert.equal(selectWorkspaceAgent(snapshot, board, 'agent:ghost').current, null);
  assert.equal(selectWorkspaceAgent({ ...snapshot, digests: { 'agent:primary': '' } }, board, 'agent:primary').digest, '', 'an explicit empty digest never falls back to the legacy digest');
  assert.equal(selectWorkspaceAgent({ ...snapshot, cursors: {} }, board, 'agent:primary').current, primary, 'legacy focus belongs only to primary');
  assert.deepEqual(snapshot, before, 'reading another perspective cannot move a cursor or rewrite the snapshot');
});

test('workspace catalogues are usable while the first snapshot is still loading', () => {
  const board = selectWorkspaceSnapshot(null);
  const agent = selectWorkspaceAgent(null, board, 'agent:waiting');
  assert.deepEqual(board.allNodes, []);
  assert.deepEqual(board.allEdges, []);
  assert.deepEqual(board.filterOptions, { types: [], statuses: [], confidences: [], riskCount: 0 });
  assert.deepEqual(board.counts, { nodes: 0, edges: 0, risk: 0, open: 0, candidates: 0 });
  assert.deepEqual(agent.agentIds, ['agent:primary', 'agent:waiting']);
  assert.equal(agent.current, null);
  assert.equal(agent.digest, '');
});
