import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateTokensText, buildAgentContext } from '../lib/context.js';
import { emptyGraph } from '../lib/model.js';

test('ASCII token estimates keep the characters-per-4 convention', () => {
  const text = 'Observed anonymous request returning 200';
  assert.ok(Math.abs(estimateTokensText(text) - text.length / 4) < 1e-9);
});

test('CJK text is weighted per character instead of per 4 characters', () => {
  const text = '恢复长期任务上下文记录关键判断';
  assert.ok(estimateTokensText(text) >= text.length * 1.3 - 1e-9);
  assert.ok(estimateTokensText(text) > (text.length / 4) * 3);
});

test('mixed text sums both weights', () => {
  const ascii = 'GET /api/admin ';
  const cjk = '匿名请求返回200';
  const mixed = ascii + cjk;
  const expected = estimateTokensText(ascii) + estimateTokensText(cjk);
  assert.ok(Math.abs(estimateTokensText(mixed) - expected) < 1e-9);
});

test('Chinese-heavy boards hit the budget and report omissions earlier', () => {
  const graph = emptyGraph();
  for (let i = 1; i <= 20; i += 1) {
    graph.nodes[`f${i}`] = {
      id: `f${i}`, type: 'fact', confidence: 'reproduced', ts: i,
      title: `第${i}条已确认的观察结论，包含较长的中文标题用于消耗预算`,
      detail: '细节'.repeat(40),
    };
  }
  const packet = buildAgentContext(graph, { budgetTokens: 1200, maxItems: 24 });
  assert.ok(packet.estimatedTokens <= 1200, `estimated ${packet.estimatedTokens}`);
  assert.equal(packet.truncated, true);
  assert.ok(packet.omitted.confirmedFacts > 0);
  // The old length/4 estimator would have packed every node well under budget.
  assert.ok(packet.confirmedFacts.length < 20);
});
