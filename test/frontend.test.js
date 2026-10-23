import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Compile only the pure presenter, without requiring a DOM or a specific Node TS loader.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blackboard-presenter-'));
after(() => fs.rmSync(dir, { recursive: true, force: true }));
const root = fileURLToPath(new URL('../', import.meta.url));
execFileSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '--target', 'ES2022', '--module', 'ESNext', '--moduleResolution', 'Bundler', '--skipLibCheck', '--outDir', dir, path.join(root, 'web/src/presentation.ts'), path.join(root, 'web/src/api.ts')], { cwd: dir });
for (const file of fs.readdirSync(dir).filter((name) => name.endsWith('.js'))) {
  const p = path.join(dir, file);
  fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace(/from '(\.\/[^']+)'/g, (_all, name) => `from '${name}.js'`));
}
fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ type: 'module' }));
const modulePath = path.join(dir, 'presentation.js');
const { confidenceLabel, presentNode, nodeStateSummary, matchesNode, statusLabel, severityLabel, typeLabel } = await import(pathToFileURL(modulePath).href);
const { changeDraft, EMPTY_EDIT, existingLink, sourceLocation, historyValue } = await import(pathToFileURL(path.join(dir, 'research-state.js')).href);
const api = await import(pathToFileURL(path.join(dir, 'api.js')).href);
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
test('API conflicts preserve the conflicting fields instead of treating the write as success', async () => {
  const previous = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 409, json: async () => ({ error: 'node_conflict', fields: ['severity'] }) });
  try { await assert.rejects(api.patchNode('n', { severity: 'low', expected: { severity: 'high' } }), (error) => error instanceof api.NodeConflict && error.fields[0] === 'severity'); }
  finally { globalThis.fetch = previous; }
});


test('canvas state summary never hides a refuted status behind a reproduced confidence', () => {
  assert.equal(nodeStateSummary({ status: 'refuted', severity: 'high', confidence: 'reproduced' }), '已反驳 · 高危 · 已复现');
  assert.equal(nodeStateSummary({ confidence: 'confirmed' }), '已确认');
  assert.equal(nodeStateSummary({}), '');
});
