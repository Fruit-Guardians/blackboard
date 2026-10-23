#!/usr/bin/env node
// Deterministic projection evaluation. No model, API, or real board is used.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { emptyGraph, applyAll } from '../lib/model.js';
import { buildAgentContext, renderAgentContext } from '../lib/context.js';

const at = 1000;
const node = (id, type, extra = {}) => ({ op: 'node', node: { id, type, title: id, ts: at, ...extra } });
const edge = (id, from, to, kind = 'supports') => ({ op: 'edge', edge: { id, from, to, kind, ts: at } });
const checkpoint = (id, agentId = 'agent:primary', summary = 'Explicit handoff summary') =>
  ({ op: 'checkpoint', checkpoint: { id, agentId, at, summary } });

export function recoveryScenarios() {
  return [
    {
      name: 'interruption',
      events: [node('g1', 'goal'), node('hy1', 'hypothesis', { status: 'active' }),
        node('f1', 'fact', { confidence: 'reproduced', detail: 'Observed input/output', loc: { path: 'sample.js', line: 7 } }),
        edge('e1', 'f1', 'hy1'), { op: 'cursor', cursor: { agentId: 'agent:primary', to: 'hy1', at, reason: 'Interrupted during explicit validation' } }, checkpoint('cp1')],
      requiredNodes: ['g1', 'hy1', 'f1'], requiredFacts: ['f1'], requiredEvidence: ['e1'],
      expectedFocus: 'hy1', expectedCheckpoints: ['cp1'],
    },
    {
      name: 'refuted',
      events: [node('hy1', 'hypothesis', { status: 'refuted' }),
        node('o1', 'observation', { status: 'refuted', confidence: 'reproduced' }),
        node('fd1', 'finding', { status: 'active' }), node('fd2', 'finding', { confidence: 'suspected' }),
        edge('e1', 'o1', 'hy1', 'contradicts')],
      requiredNodes: ['hy1', 'o1', 'fd1', 'fd2'], requiredFacts: [], requiredEvidence: ['e1'],
      expectedConfirmedFindings: 0,
    },
    {
      name: 'supersession',
      events: [node('f1', 'fact', { status: 'superseded', confidence: 'confirmed' }),
        node('f2', 'fact', { confidence: 'reproduced' }), edge('e1', 'f2', 'f1', 'supersedes')],
      requiredNodes: ['f1', 'f2'], requiredFacts: ['f2'], requiredEvidence: ['e1'],
    },
    {
      name: 'multi-agent-handoff',
      events: [node('hy1', 'hypothesis'), node('hy2', 'hypothesis'),
        { op: 'cursor', cursor: { agentId: 'agent:a', to: 'hy1', at } },
        { op: 'cursor', cursor: { agentId: 'agent:b', to: 'hy2', at } },
        checkpoint('cp-a', 'agent:a', 'Agent A handoff'), checkpoint('cp-b', 'agent:b', 'Agent B handoff')],
      options: { agentId: 'agent:b' }, requiredNodes: ['hy1', 'hy2'], requiredFacts: [], requiredEvidence: [],
      expectedFocus: 'hy2', expectedCheckpoints: ['cp-b'], forbiddenCheckpoints: ['cp-a'],
    },
    {
      name: 'no-cursor-custom-types',
      events: [node('x1', 'custom-experiment', { detail: 'Authored custom semantics' }),
        node('o1', 'observation', { status: 'done' }), node('a1', 'action', { status: 'blocked' })],
      requiredNodes: ['x1', 'o1', 'a1'], requiredFacts: [], requiredEvidence: [], expectedFocus: null,
    },
    {
      name: 'low-budget',
      events: [checkpoint('cp-low'), ...Array.from({ length: 12 }, (_, i) => node(`f${i + 1}`, 'fact', {
        title: `Observed evidence ${i + 1} ${'x'.repeat(120)}`, confidence: 'reproduced', detail: 'y'.repeat(240),
      }))],
      options: { budgetTokens: 512, maxItems: 24 },
      requiredNodes: Array.from({ length: 12 }, (_, i) => `f${i + 1}`),
      requiredFacts: Array.from({ length: 12 }, (_, i) => `f${i + 1}`), requiredEvidence: [],
      allowOmissions: true, expectedCheckpoints: ['cp-low'],
    },
    {
      name: 'checkpoint-removed-relation',
      events: [node('hy1', 'hypothesis'), node('f1', 'fact', { confidence: 'reproduced' }),
        edge('old-support', 'f1', 'hy1'), checkpoint('cp1'),
        { op: 'remove', kind: 'edge', id: 'old-support', at, eventId: 'remove-1' },
        node('f2', 'fact', { confidence: 'confirmed' }), edge('counterevidence', 'f2', 'hy1', 'contradicts'),
        { op: 'patch', id: 'hy1', set: { status: 'refuted', updated: at } }],
      options: { since: 'cp1' }, requiredNodes: ['hy1', 'f1', 'f2'], requiredFacts: ['f1', 'f2'],
      requiredEvidence: ['counterevidence'], expectedRemovedRelations: ['old-support'],
    },
  ];
}

export function contextNodeIds(packet) {
  return new Set([
    ...(packet.currentFocus ? [packet.currentFocus.id] : []),
    ...['objectives', 'openThreads', 'findings', 'confirmedFacts', 'retiredNodes', 'notes', 'otherNodes', 'recentChanges']
      .flatMap((key) => (packet[key] || []).map((item) => item.id)),
    ...packet.neighborhood.map((item) => item.node.id),
  ]);
}

const coverage = (actual, required) => ({ matched: required.filter((id) => actual.has(id)).length, required: required.length });
const fullCoverage = (metric) => metric.matched === metric.required;

export function evaluateRecovery() {
  const cases = recoveryScenarios().map((scenario) => {
    const events = structuredClone(scenario.events);
    const graph = applyAll(emptyGraph(), events);
    const before = JSON.stringify(graph);
    const packet = buildAgentContext(graph, { budgetTokens: 12000, ...scenario.options, events });
    const markdown = renderAgentContext(packet);
    const nodes = contextNodeIds(packet);
    const facts = new Set(packet.confirmedFacts.map((item) => item.id));
    const relations = new Set(packet.relations.map((item) => item.id));
    const checkpoints = new Set(packet.checkpoints.map((item) => item.id));
    const expectedFacts = new Set(scenario.requiredFacts);
    const falseConfirmedFacts = [...facts].filter((id) => !expectedFacts.has(id));
    const authoredNodeCoverage = coverage(nodes, scenario.requiredNodes);
    const factCoverage = coverage(facts, scenario.requiredFacts);
    const evidenceCoverage = coverage(relations, scenario.requiredEvidence);
    const errors = [];
    if (!scenario.allowOmissions && !fullCoverage(authoredNodeCoverage)) errors.push('missing-authored-nodes');
    if (!scenario.allowOmissions && !fullCoverage(factCoverage)) errors.push('missing-facts');
    if (!scenario.allowOmissions && !fullCoverage(evidenceCoverage)) errors.push('missing-evidence');
    if (falseConfirmedFacts.length) errors.push('false-confirmed-facts');
    if (scenario.expectedConfirmedFindings !== undefined && packet.board.stats.confirmed !== scenario.expectedConfirmedFindings) errors.push('false-confirmed-finding-count');
    if (Object.hasOwn(scenario, 'expectedFocus') && (packet.currentFocus?.id || null) !== scenario.expectedFocus) errors.push('wrong-agent-focus');
    for (const id of scenario.expectedCheckpoints || []) {
      if (!checkpoints.has(id)) errors.push(`missing-checkpoint:${id}`);
      if (!markdown.includes(graph.checkpoints[id].summary)) errors.push(`markdown-missing-checkpoint:${id}`);
    }
    for (const id of scenario.forbiddenCheckpoints || []) if (checkpoints.has(id)) errors.push(`wrong-agent-checkpoint:${id}`);
    for (const id of scenario.expectedRemovedRelations || []) {
      if (!packet.changes.some((item) => item.kind === 'relation-removed' && item.id === id)) errors.push(`missing-relation-removal:${id}`);
      if (relations.has(id)) errors.push(`stale-current-relation:${id}`);
    }
    const omissionReported = fullCoverage(authoredNodeCoverage) || (packet.truncated && Object.keys(packet.omitted).length > 0);
    if (!omissionReported) errors.push('silent-omission');
    if (JSON.stringify(graph) !== before) errors.push('projection-mutated-graph');
    if (!packet.policy.readOnly || packet.policy.prescriptive || packet.policy.nextStepSelection !== 'agent-controlled') errors.push('policy-contract');
    return { name: scenario.name, passed: errors.length === 0, authoredNodeCoverage, factCoverage, evidenceCoverage,
      falseConfirmedFacts, omissionReported, truncated: packet.truncated, omitted: packet.omitted, errors };
  });
  return { kind: 'deterministic-projection-evaluation', modelEvaluation: 'not-run', scenarios: cases.length,
    passed: cases.filter((item) => item.passed).length, failed: cases.filter((item) => !item.passed).length, cases };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = evaluateRecovery();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = result.failed ? 1 : 0;
}
