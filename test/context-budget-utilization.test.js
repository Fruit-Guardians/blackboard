import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyGraph } from '../lib/model.js';
import { buildAgentContext, estimateTokensText } from '../lib/context.js';

const POLICY = { readOnly: true, prescriptive: false, nextStepSelection: 'agent-controlled' };
const graphWith = (...nodes) => {
  const graph = emptyGraph();
  graph.nodes = Object.fromEntries(nodes.map(node => [node.id, node]));
  return graph;
};

function assertBudget(packet, budget) {
  assert.ok(packet.estimatedTokens <= budget, `${packet.estimatedTokens}/${budget}`);
  assert.equal(packet.estimatedTokens, Math.ceil(estimateTokensText(JSON.stringify(packet))));
  assert.equal(packet.truncated, Object.keys(packet.omitted).length > 0);
  assert.equal(packet.schema, 'blackboard.context.v1');
  assert.deepEqual(packet.policy, POLICY);
}

test('an oversized first finding does not hide later complete findings that fit', () => {
  const large = { id: 'fd3', type: 'finding', title: 'Large authored finding', detail: 'x'.repeat(8000), ts: 3 };
  const middle = { id: 'fd2', type: 'finding', title: 'Later candidate', detail: 'Not yet reproduced.', confidence: 'suspected', ts: 2 };
  const oldest = { id: 'fd1', type: 'finding', title: 'Earlier candidate', detail: 'Only one input was checked.', confidence: 'static-confirmed', ts: 1 };
  const graph = graphWith(oldest, middle, large);
  const before = JSON.stringify(graph);
  const packet = buildAgentContext(graph, { budgetTokens: 1000 });
  assert.deepEqual(packet.findings.map(node => node.id), ['fd2', 'fd1']);
  assert.equal(packet.omitted.findings, 1);
  assert.equal(packet.findings[0].detail, middle.detail);
  assert.equal(packet.findings[1].detail, oldest.detail);
  assert.equal(JSON.stringify(packet).includes(large.detail), false);
  assertBudget(packet, 1000);
  assert.equal(JSON.stringify(graph), before);
});

test('Chinese records keep all conditions and attribution after an oversized candidate is skipped', () => {
  const detail = '观察范围仅限测试输入。\n\n限制：真实部署尚未验证。\n';
  const short = { id: 'f1', type: 'fact', title: '已保存的局部观察', detail, confidence: 'static-confirmed',
    status: 'blocked', severity: 'low', author: 'agent:observer', updatedBy: 'agent:reviewer', ts: 1 };
  const graph = graphWith(short, { id: 'f2', type: 'fact', title: '较长的原始观察', detail: '原文'.repeat(3000), confidence: 'confirmed', ts: 2 });
  const before = structuredClone(graph);
  const packet = buildAgentContext(graph, { budgetTokens: 1000 });
  assert.deepEqual(packet.confirmedFacts.map(node => node.id), ['f1']);
  for (const field of ['title', 'detail', 'confidence', 'status', 'severity', 'author', 'updatedBy']) {
    assert.equal(packet.confirmedFacts[0][field], short[field], field);
  }
  assert.equal(packet.omitted.confirmedFacts, 1);
  assertBudget(packet, 1000);
  assert.deepEqual(graph, before);
});

test('the same whole-record scan applies to checkpoints and activities', () => {
  const graph = emptyGraph();
  for (const key of ['checkpoints', 'activities']) {
    graph[key].long = { id: `${key}-long`, agentId: 'agent:primary', at: 2, summary: 'x'.repeat(8000) };
    graph[key].short = { id: `${key}-short`, agentId: 'agent:primary', at: 1, summary: 'Only a partial observation; validation remains open.' };
  }
  const packet = buildAgentContext(graph, { budgetTokens: 1000 });
  assert.deepEqual(packet.checkpoints.map(item => item.id), ['checkpoints-short']);
  assert.deepEqual(packet.recentActivity.map(item => item.id), ['activities-short']);
  assert.equal(packet.omitted.checkpoints, 1);
  assert.equal(packet.omitted.recentActivity, 1);
  assertBudget(packet, 1000);
});

test('all oversized candidates remain whole omissions without leaking partial claims', () => {
  const graph = graphWith(...Array.from({ length: 5 }, (_, i) => ({
    id: `fd${i}`, type: 'finding', title: `Conditional finding ${i}`, detail: 'unverified scope '.repeat(1000), ts: i,
  })));
  const packet = buildAgentContext(graph, { budgetTokens: 1000 });
  assert.deepEqual(packet.findings, []);
  assert.equal(packet.omitted.findings, 5);
  assert.equal(JSON.stringify(packet).includes('Conditional finding'), false);
  assertBudget(packet, 1000);
});

test('maxItems still bounds candidates examined rather than backfilling from outside that window', () => {
  const graph = graphWith(
    { id: 'fd1', type: 'finding', title: 'Short candidate', ts: 1 },
    { id: 'fd2', type: 'finding', title: 'Large candidate', detail: 'x'.repeat(8000), ts: 2 },
  );
  const limited = buildAgentContext(graph, { budgetTokens: 1000, maxItems: 1 });
  assert.deepEqual(limited.findings, []);
  assert.equal(limited.omitted.findings, 2);
  const expanded = buildAgentContext(graph, { budgetTokens: 1000, maxItems: 2 });
  assert.deepEqual(expanded.findings.map(node => node.id), ['fd1']);
  assert.equal(expanded.omitted.findings, 1);
  assertBudget(limited, 1000);
  assertBudget(expanded, 1000);
});

test('mixed-size scans remain deterministic, read-only and exactly accounted across budgets', () => {
  const graph = graphWith(...Array.from({ length: 18 }, (_, i) => ({
    id: `fd${i}`, type: 'finding', title: `Authored record ${i}`, detail: i % 3 === 0 ? '限制'.repeat(1500) : `Full scope ${i}.\nNot reproduced.`,
    confidence: i % 2 ? 'suspected' : 'static-confirmed', author: `agent:writer-${i % 2}`, ts: i,
  })));
  const before = structuredClone(graph);
  for (const budgetTokens of [400, 512, 700, 1000, 1600, 4000]) {
    const options = { budgetTokens, maxItems: 18 };
    const packet = buildAgentContext(graph, options);
    assertBudget(packet, budgetTokens);
    assert.deepEqual(packet, buildAgentContext(graph, options));
    assert.equal(packet.findings.length + (packet.omitted.findings || 0), 18);
    for (const node of packet.findings) {
      for (const field of ['title', 'detail', 'confidence', 'author']) assert.equal(node[field], graph.nodes[node.id][field], field);
    }
    assert.deepEqual(graph, before);
  }
});
