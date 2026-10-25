import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { check, prepare } from '../scripts/recovery-experiment.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const SCRIPT = path.join(ROOT, 'scripts/recovery-experiment.mjs');

const node = (id, type, ts, extra = {}) => ({ op: 'node', node: { id, type, title: `${id} title`, ts, ...extra } });
const edge = (from, to, kind, ts) => ({ op: 'edge', edge: { id: `${from}-${kind}-${to}`, from, to, kind, ts } });
const checkpoint = (id, at, summary) => ({ op: 'checkpoint', checkpoint: { id, agentId: 'agent:primary', at, summary } });

function board() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-recovery-'));
  fs.mkdirSync(path.join(root, '.blackboard'));
  const events = [
    node('G1', 'goal', 1, { status: 'active' }),
    node('F1', 'fact', 2, { confidence: 'reproduced' }),
    node('H1', 'hypothesis', 3, { status: 'open', confidence: 'suspected' }),
    edge('F1', 'H1', 'supports', 4),
    { op: 'cursor', cursor: { agentId: 'agent:primary', from: null, to: 'H1', reason: 'check H1', at: 4 } },
    checkpoint('cp1', 5, 'Goal G1; F1 supports H1, not yet verified.'),
    node('F2', 'finding', 6, { confidence: 'confirmed' }),
    edge('F2', 'H1', 'contradicts', 7),
    checkpoint('cp2', 8, 'F2 contradicts H1.'),
    node('F3', 'finding', 9, { confidence: 'confirmed' }),
  ].map((ev, i) => ({ eventVersion: 1, eventId: `e${i}`, ...ev }));
  const file = path.join(root, '.blackboard/events.jsonl');
  fs.writeFileSync(file, events.map((ev) => JSON.stringify(ev)).join('\n') + '\n');
  return { root, file };
}

const read = (dir, name) => fs.readFileSync(path.join(dir, name), 'utf8');
const nodeIds = (packet) => [
  packet.currentFocus?.id,
  ...['objectives', 'openThreads', 'findings', 'confirmedFacts', 'notes', 'recentChanges'].flatMap((key) => packet[key].map((n) => n.id)),
  ...packet.neighborhood.map((item) => item.node.id),
].filter(Boolean).sort();

test('takeover materials stop at the cut and differ only in relations', () => {
  const { root, file } = board();
  const before = fs.readFileSync(file, 'utf8');
  const out = path.join(root, 'out');
  const manifest = prepare({ board: root, at: 'cp1', budget: 2000, out });

  assert.equal(manifest.mode, 'takeover');
  assert.equal(manifest.cut.atEvent, 6);
  assert.deepEqual(Object.keys(manifest.nodesAtCut).sort(), ['F1', 'G1', 'H1']);
  for (const name of ['A-summary.md', 'B-nodes.json', 'C-graph.json']) {
    assert.doesNotMatch(read(out, name), /F2|F3|contradicts/, `${name} leaks events after the cut`);
  }
  assert.match(read(out, 'A-summary.md'), /F1 supports H1/);

  const b = JSON.parse(read(out, 'B-nodes.json'));
  const c = JSON.parse(read(out, 'C-graph.json'));
  assert.equal(b.request.budgetTokens, c.request.budgetTokens);
  assert.deepEqual(nodeIds(b), nodeIds(c));
  assert.ok(c.neighborhood.length > 0, 'the focus neighbourhood is selected through relations');
  // Authored prose (checkpoint summaries) may mention relations; structure may not.
  assert.doesNotMatch(read(out, 'B-nodes.json'), /"(relation|direction|from|to)":/);
  assert.deepEqual(b.relations, []);
  assert.deepEqual(c.relations.map((r) => r.kind), ['supports']);
  assert.ok(manifest.arms.B.chars < manifest.arms.C.chars);
  assert.deepEqual(c.policy, { readOnly: true, prescriptive: false, nextStepSelection: 'agent-controlled' });
  assert.equal(manifest.arms.C.relations, 1);
  assert.deepEqual(manifest.cost, { nodeEvents: 3, edgeEvents: 1, patchEvents: 0, checkpointEvents: 1, authoredChars: manifest.cost.authoredChars });

  // Read-only: the log is untouched and no state cache appears.
  assert.equal(fs.readFileSync(file, 'utf8'), before);
  assert.deepEqual(fs.readdirSync(path.join(root, '.blackboard')), ['events.jsonl']);
});

test('resume materials keep the interrupted view and the delta apart', () => {
  const { root } = board();
  const out = path.join(root, 'out');
  const manifest = prepare({ board: root, at: 'cp2', since: 'cp1', budget: 2000, out });

  assert.equal(manifest.mode, 'resume');
  assert.equal(manifest.cut.sinceEvent, 6);
  const c = JSON.parse(read(out, 'C-graph.json'));
  assert.ok(!JSON.stringify(c.interrupted).includes('F2'));
  assert.deepEqual(c.since.recentChanges.map((n) => n.id), ['F2']);
  assert.deepEqual(c.since.changes.map((change) => change.relation), ['contradicts']);
  const b = JSON.parse(read(out, 'B-nodes.json'));
  assert.deepEqual(b.since.changes, []);
  assert.ok(!read(out, 'C-graph.json').includes('F3'));

  const summary = read(out, 'A-summary.md');
  assert.ok(summary.indexOf('F1 supports H1') < summary.indexOf('F2 contradicts H1'));
});

test('prepare refuses ambiguous cuts instead of guessing', () => {
  const { root } = board();
  const out = path.join(root, 'out');
  assert.throws(() => prepare({ board: root, at: 'cp9', out }), /not a checkpoint/);
  assert.throws(() => prepare({ board: root, at: 'cp1', since: 'cp2', out }), /not a checkpoint/);
  assert.throws(() => prepare({ board: root, at: 'cp1', since: 'cp1', out }), /earlier than/);
  assert.throws(() => prepare({ board: root, at: 'event:3', out }), /summary-file/);
  const summaryFile = path.join(root, 'handoff.md');
  fs.writeFileSync(summaryFile, 'Handoff written by the task agent.');
  assert.equal(prepare({ board: root, at: 'event:3', summaryFile, out }).arms.A.source, 'summary-file');
});

test('check tallies citations, unknowns and guesses mechanically per arm', () => {
  const { root } = board();
  const manifest = prepare({ board: root, at: 'cp1', out: path.join(root, 'out') });
  const questions = [
    { id: 'q1', text: 'What supports H1?', evidence: ['F1'] },
    { id: 'q2', text: 'Was H1 refuted?', expected: 'unknown' },
    { id: 'q3', text: 'Is H1 true?', evidence: ['H1'] },
  ];
  const answers = [
    { question: 'q1', arm: 'C', answer: 'F1', cites: ['F1'], stance: 'fact', correct: true },
    { question: 'q2', arm: 'C', answer: 'not recorded', cites: [], stance: 'unknown', correct: true },
    { question: 'q3', arm: 'C', answer: 'yes', cites: ['H1'], stance: 'fact', correct: false },
    { question: 'q1', arm: 'B', answer: 'F2', cites: ['F2'], stance: 'fact' },
    { question: 'q2', arm: 'B', answer: 'yes, by F2', cites: ['F2'], stance: 'fact' },
  ];
  const result = check({ manifest, questions, answers });

  assert.deepEqual(
    { ...result.arms.C, citesUnknownAtCut: undefined },
    {
      answered: 3, graded: 3, correct: 2, cites: 2, citesValid: 2, citesUnknownAtCut: undefined,
      evidenceQuestions: 2, evidenceHit: 2, unknownExpected: 1, unknownHandled: 1, missed: 0,
      guessAsFact: 1, factWithoutCitation: 0,
    },
  );
  assert.deepEqual(result.arms.B.citesUnknownAtCut, ['q1:F2', 'q2:F2']);
  assert.equal(result.arms.B.evidenceHit, 0);
  assert.equal(result.arms.B.unknownHandled, 0);
  assert.equal(result.arms.B.factWithoutCitation, 2);
  assert.deepEqual(result.unanswered, ['q3/B']);

  assert.throws(() => check({ manifest, questions, answers: [...answers, answers[0]] }), /duplicate answer/);
  assert.throws(() => check({ manifest, questions, answers: [{ question: 'q1', arm: 'C', cites: [] }] }), /stance/);
});

test('checkpoints recorded before the cut are valid, non-speculative citations', () => {
  const { root } = board();
  const takeover = prepare({ board: root, at: 'cp1', out: path.join(root, 'takeover') });
  const resume = prepare({ board: root, at: 'cp2', since: 'cp1', out: path.join(root, 'resume') });
  assert.deepEqual(takeover.checkpointsAtCut, ['cp1']);
  assert.deepEqual(resume.checkpointsAtCut, ['cp1', 'cp2']);

  const questions = [{ id: 'q1', text: 'Where were we?', evidence: ['cp1'] }];
  const answers = [
    { question: 'q1', arm: 'B', answer: 'cp1 says F1 supports H1', cites: ['cp1'], stance: 'fact' },
    { question: 'q1', arm: 'C', answer: 'cp2 says F2 contradicts H1', cites: ['cp2'], stance: 'fact' },
  ];
  const atCp1 = check({ manifest: takeover, questions, answers });
  assert.equal(atCp1.arms.B.citesValid, 1);
  assert.deepEqual(atCp1.arms.B.citesUnknownAtCut, []);
  assert.equal(atCp1.arms.B.evidenceHit, 1);
  assert.equal(atCp1.arms.B.guessAsFact, 0);
  assert.equal(atCp1.arms.B.factWithoutCitation, 0);
  // cp2 was written after the cp1 cut, so citing it there is still flagged.
  assert.deepEqual(atCp1.arms.C.citesUnknownAtCut, ['q1:cp2']);
  assert.equal(check({ manifest: resume, questions, answers }).arms.C.citesValid, 1);
});

test('only unsettled hypotheses and questions count as speculative', () => {
  const manifest = {
    schema: 'blackboard.recovery-experiment.v1',
    nodesAtCut: {
      open: { type: 'hypothesis', status: 'open', confidence: 'suspected' },
      refuted: { type: 'hypothesis', status: 'refuted', confidence: null },
      refutedSuspected: { type: 'hypothesis', status: 'refuted', confidence: 'suspected' },
      confirmed: { type: 'hypothesis', status: 'confirmed', confidence: null },
      question: { type: 'question', status: 'open', confidence: null },
      suspectedFinding: { type: 'finding', status: 'open', confidence: 'suspected' },
    },
    checkpointsAtCut: [],
  };
  const ids = Object.keys(manifest.nodesAtCut);
  const questions = ids.map((id) => ({ id, text: id }));
  const answers = ids.map((id) => ({ question: id, arm: 'B', answer: id, cites: [id], stance: 'fact' }));
  const flagged = (cites) => check({
    manifest, questions: [{ id: 'q', text: 'q' }], answers: [{ question: 'q', arm: 'B', answer: 'x', cites, stance: 'fact' }],
  }).arms.B.guessAsFact;

  assert.equal(check({ manifest, questions, answers }).arms.B.guessAsFact, 3);
  for (const id of ['open', 'question', 'suspectedFinding']) assert.equal(flagged([id]), 1, id);
  for (const id of ['refuted', 'refutedSuspected', 'confirmed']) assert.equal(flagged([id]), 0, id);
  assert.equal(flagged(['open', 'refuted']), 0, 'a settled citation backs the fact');
});

test('the command line prints a per-arm table and fails with usage on bad input', () => {
  const { root } = board();
  const out = path.join(root, 'out');
  const prep = spawnSync(process.execPath, [SCRIPT, 'prepare', '--board', root, '--at', 'cp1', '--out', out], { encoding: 'utf8' });
  assert.equal(prep.status, 0, prep.stderr);
  assert.match(prep.stdout, /takeover at cp1 \(6\/10 events\)/);

  fs.writeFileSync(path.join(root, 'q.json'), JSON.stringify([{ id: 'q1', text: 'x', expected: 'unknown' }]));
  fs.writeFileSync(path.join(root, 'a.json'), JSON.stringify([{ question: 'q1', arm: 'A', cites: [], stance: 'unknown' }]));
  const run = spawnSync(process.execPath, [SCRIPT, 'check', '--manifest', path.join(out, 'manifest.json'),
    '--questions', path.join(root, 'q.json'), '--answers', path.join(root, 'a.json')], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /\| 恰当回答未知 \| 1\/1 \| 0\/0 \| 0\/0 \|/);

  const bad = spawnSync(process.execPath, [SCRIPT, 'prepare', '--board', root], { encoding: 'utf8' });
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /--at is required[\s\S]*Usage:/);
});
