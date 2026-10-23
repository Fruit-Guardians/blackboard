import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { emptyGraph } from '../lib/model.js';
import { ensure, addNode, addCheckpoint, addEdge, replay, paths, stats } from '../lib/store.js';
import { buildAgentContext, renderAgentContext } from '../lib/context.js';
import { buildDigest } from '../lib/digest.js';
import { isConfirmedFact, isCurrentFinding, isExplicitlyConfirmed, isOpenThread } from '../lib/semantics.js';
import { evaluateRecovery, contextNodeIds } from '../scripts/evaluate-recovery.mjs';

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blackboard-recovery-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  ensure(dir);
  return dir;
}

test('recovery predicates preserve independent fields and never assume missing confidence', () => {
  const finding = { type: 'finding', status: 'confirmed' };
  const original = JSON.stringify(finding);
  assert.equal(isExplicitlyConfirmed(finding), false);
  assert.equal(isExplicitlyConfirmed({ ...finding, confidence: 'static-confirmed' }), false);
  assert.equal(isExplicitlyConfirmed({ ...finding, confidence: 'reproduced' }), true);
  assert.equal(isCurrentFinding({ ...finding, status: 'refuted', confidence: 'confirmed' }), false);
  assert.equal(isConfirmedFact({ type: 'observation', status: 'refuted', confidence: 'reproduced' }), false);
  assert.equal(isConfirmedFact({ type: 'result', status: 'done' }), false);
  assert.equal(isConfirmedFact({ type: 'fact', status: 'confirmed' }), true);
  assert.equal(isOpenThread({ type: 'action', status: 'blocked' }), true);
  assert.equal(JSON.stringify(finding), original);
});

test('every authored node is represented or explicitly counted as omitted, including custom types', () => {
  const graph = emptyGraph();
  const samples = [
    ['x1', 'experiment', 'open'], ['o1', 'observation', 'done'], ['hy1', 'hypothesis', 'refuted'],
    ['hy2', 'hypothesis', 'done'], ['g1', 'goal', 'superseded'], ['s1', 'start', 'deferred'],
  ];
  for (const [id, type, status] of samples) graph.nodes[id] = { id, type, status, title: id, ts: 1 };
  const packet = buildAgentContext(graph, { budgetTokens: 12000 });
  assert.deepEqual(contextNodeIds(packet), new Set(samples.map(([id]) => id)));
  assert.deepEqual(packet.confirmedFacts, []);
  assert.equal(packet.truncated, false);
  const limited = buildAgentContext(graph, { maxItems: 1 });
  const missing = samples.length - contextNodeIds(limited).size;
  assert.ok(missing > 0);
  assert.equal(Object.values(limited.omitted).reduce((sum, count) => sum + count, 0), missing);
});

test('Markdown retains checkpoint summaries, node evidence fields, authorship and explicit relation direction', (t) => {
  const dir = fixture(t);
  const target = addNode({ type: 'hypothesis', title: 'Question', status: 'active' }, dir).node;
  const source = addNode({ type: 'fact', title: 'Evidence', confidence: 'reproduced', detail: 'Literal observed response',
    at: 'sample.js:7', tags: ['recovery'], author: 'agent:a' }, dir).node;
  const relation = addEdge({ from: source.id, to: target.id, kind: 'supports' }, dir);
  const checkpoint = addCheckpoint({ summary: 'Resume from explicit evidence', agentId: 'agent:primary' }, dir);
  const before = fs.readFileSync(paths(dir).events, 'utf8');
  const packet = buildAgentContext(replay(dir));
  const markdown = renderAgentContext(packet);
  for (const field of ['confidence=reproduced', 'Literal observed response', 'sample.js', 'recovery', 'author=agent:a',
    checkpoint.summary, `[${source.id}] --supports--> [${target.id}]`, relation.id]) assert.ok(markdown.includes(field), field);
  assert.equal(fs.readFileSync(paths(dir).events, 'utf8'), before);
});

test('action openness agrees between digest, context and statistics', (t) => {
  const dir = fixture(t);
  const node = addNode({ type: 'action', title: 'Explicit pending experiment', status: 'blocked' }, dir).node;
  const graph = replay(dir);
  assert.equal(buildAgentContext(graph).openThreads.some((item) => item.id === node.id), true);
  const digest = buildDigest(graph, dir);
  assert.match(digest.slice(digest.indexOf('## 开放节点')), /Explicit pending experiment/);
  assert.equal(stats(graph).frontier, 1);
});

test('confirmed finding statistics require explicit confidence and exclude retired interpretations', (t) => {
  const dir = fixture(t);
  addNode({ type: 'finding', title: 'Unspecified', status: 'confirmed' }, dir);
  addNode({ type: 'finding', title: 'Static', confidence: 'static-confirmed' }, dir);
  addNode({ type: 'finding', title: 'Refuted', status: 'refuted', confidence: 'reproduced' }, dir);
  addNode({ type: 'finding', title: 'Reproduced', status: 'active', confidence: 'reproduced' }, dir);
  const summary = stats(replay(dir));
  assert.equal(summary.confirmed, 1);
  assert.equal(summary.candidates, 1);
});

test('deterministic recovery evaluation covers all seven interruption and handoff scenarios', () => {
  const result = evaluateRecovery();
  assert.equal(result.kind, 'deterministic-projection-evaluation');
  assert.equal(result.modelEvaluation, 'not-run');
  assert.equal(result.scenarios, 7);
  assert.equal(result.failed, 0, JSON.stringify(result.cases.filter((item) => !item.passed), null, 2));
  const lowBudget = result.cases.find((item) => item.name === 'low-budget');
  assert.ok(lowBudget.factCoverage.matched < lowBudget.factCoverage.required);
  assert.equal(lowBudget.omissionReported, true);
});
