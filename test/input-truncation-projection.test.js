import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { emptyGraph, applyAll } from '../lib/model.js';
import { buildAgentContext, renderAgentContext, estimateTokensText } from '../lib/context.js';
import { buildDigest } from '../lib/digest.js';
import { lintGraph } from '../lib/lint.js';

const CLI = fileURLToPath(new URL('../bin/blackboard.js', import.meta.url));
const nodeMarker = { detail: { originalLength: 85, storedLength: 12 } };
const edgeMarker = { label: { originalLength: 60, storedLength: 11 } };
const checkpointMarker = { summary: { originalLength: 90, storedLength: 13 } };
const events = () => [
  { op: 'node', node: { id: 'f1', type: 'fact', title: 'Conditional evidence', detail: 'Saved prefix', confidence: 'static-confirmed',
    author: 'agent:observer', inputTruncation: structuredClone(nodeMarker), ts: 1 } },
  { op: 'node', node: { id: 'hy1', type: 'hypothesis', title: 'Unverified claim', confidence: 'suspected', status: 'blocked', ts: 1 } },
  { op: 'cursor', cursor: { agentId: 'agent:primary', from: null, to: 'hy1', at: 1 } },
  { op: 'checkpoint', checkpoint: { id: 'cp1', agentId: 'agent:primary', at: 1, summary: 'Saved handoff', inputTruncation: structuredClone(checkpointMarker) } },
  { op: 'edge', edge: { id: 'e1', from: 'f1', to: 'hy1', kind: 'supports', label: 'Saved label', inputTruncation: structuredClone(edgeMarker), ts: 2 } },
  { op: 'patch', id: 'f1', set: { updated: 2 } },
];
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function fixture(t, log = events()) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blackboard-input-projection-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, '.blackboard'));
  const file = path.join(root, '.blackboard/events.jsonl');
  fs.writeFileSync(file, log.map(event => JSON.stringify(event)).join('\n') + '\n');
  return { root, file, graph: applyAll(emptyGraph(), structuredClone(log)) };
}

test('context retains recorded input truncation metadata in nodes, checkpoints, relations and deltas', () => {
  const log = events();
  const graph = applyAll(emptyGraph(), structuredClone(log));
  const before = structuredClone(graph);
  const packet = buildAgentContext(graph, { since: 'cp1', events: log, budgetTokens: 12000 });
  assert.deepEqual(packet.confirmedFacts.find(node => node.id === 'f1').inputTruncation, nodeMarker);
  assert.deepEqual(packet.neighborhood.find(item => item.node.id === 'f1').node.inputTruncation, nodeMarker);
  assert.deepEqual(packet.recentChanges.find(node => node.id === 'f1').inputTruncation, nodeMarker);
  assert.deepEqual(packet.checkpoints[0].inputTruncation, checkpointMarker);
  assert.deepEqual(packet.relations[0].inputTruncation, edgeMarker);
  assert.deepEqual(packet.changes[0].inputTruncation, edgeMarker);
  assert.equal(packet.truncated, false, 'projection omissions remain separate from recorded input loss');
  assert.equal(packet.estimatedTokens, Math.ceil(estimateTokensText(JSON.stringify(packet))));
  assert.deepEqual(packet.policy, { readOnly: true, prescriptive: false, nextStepSelection: 'agent-controlled' });
  assert.deepEqual(graph, before);
  const markdown = renderAgentContext(packet);
  assert.match(markdown, /input was truncated.*detail.*85.*12/);
  assert.match(markdown, /input was truncated.*summary.*90.*13/);
  assert.match(markdown, /input was truncated.*label.*60.*11/);
  assert.equal(packet.confirmedFacts[0].confidence, 'static-confirmed');
});

test('digest marks recorded input loss in both cursor and cursor-free previews', t => {
  const { root, graph } = fixture(t);
  const before = structuredClone(graph);
  for (const view of [graph, { ...graph, cursors: {}, meta: {} }]) {
    const digest = buildDigest(view, root);
    assert.match(digest, /input was truncated.*detail.*85.*12/);
    assert.match(digest, /input was truncated.*summary.*90.*13/);
    assert.match(digest, /input was truncated.*label.*60.*11/);
  }
  assert.deepEqual(graph, before);
});

test('lint reports explicit node, relation and checkpoint input loss without changing the graph or blocking CLI', t => {
  const { root, file, graph } = fixture(t);
  const before = structuredClone(graph);
  const result = lintGraph(graph);
  const warning = result.issues.find(issue => issue.code === 'input-truncated-records');
  assert.ok(warning);
  assert.equal(warning.level, 'warn');
  assert.equal(warning.count, 3);
  assert.deepEqual(warning.nodeIds, ['f1']);
  assert.deepEqual(warning.edgeIds, ['e1']);
  assert.deepEqual(warning.checkpointIds, ['cp1']);
  assert.deepEqual(warning.records.map(record => [record.kind, record.id]), [['node', 'f1'], ['edge', 'e1'], ['checkpoint', 'cp1']]);
  assert.deepEqual(warning.records[0].inputTruncation, nodeMarker);
  assert.deepEqual(graph, before);
  const beforeHash = hash(file);
  const cli = spawnSync(process.execPath, [CLI, 'lint', '--cwd', root, '--json'], { encoding: 'utf8' });
  assert.equal(cli.status, 0, cli.stderr);
  assert.ok(JSON.parse(cli.stdout).issues.some(issue => issue.code === 'input-truncated-records'));
  assert.equal(hash(file), beforeHash);
});

test('legacy unmarked records and explicit null clears do not acquire inferred input loss', t => {
  const log = events();
  for (const event of log) {
    for (const key of ['node', 'edge', 'checkpoint']) if (event[key]) delete event[key].inputTruncation;
  }
  log[0].node.detail = 'x'.repeat(20000);
  const { root, graph } = fixture(t, log);
  const before = structuredClone(graph);
  const packet = buildAgentContext(graph, { events: log, budgetTokens: 64000 });
  assert.equal(Object.hasOwn(packet.confirmedFacts[0], 'inputTruncation'), false);
  assert.equal(Object.hasOwn(packet.checkpoints[0], 'inputTruncation'), false);
  assert.equal(Object.hasOwn(packet.relations[0], 'inputTruncation'), false);
  assert.doesNotMatch(renderAgentContext(packet), /input was truncated/);
  assert.doesNotMatch(buildDigest(graph, root), /input was truncated/);
  assert.equal(lintGraph(graph).issues.some(issue => issue.code === 'input-truncated-records'), false);
  assert.deepEqual(graph, before);

  const cleared = events();
  cleared.push({ op: 'patch', id: 'f1', set: { detail: 'Complete replacement.', inputTruncation: null, updated: 3 } });
  const cleanGraph = applyAll(emptyGraph(), cleared);
  const cleanPacket = buildAgentContext(cleanGraph, { budgetTokens: 12000 });
  assert.equal(Object.hasOwn(cleanPacket.confirmedFacts[0], 'inputTruncation'), false);
  assert.equal(lintGraph(cleanGraph).issues.some(issue => issue.code === 'input-truncated-records' && issue.nodeIds.includes('f1')), false);
});
