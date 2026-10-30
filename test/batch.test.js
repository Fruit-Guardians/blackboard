// `batch` writes a related set of records in one request: all lines or none,
// ordinary events only, explicit identity per line, no cursor movement.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { ensure, readEvents, replay } from '../lib/store.js';

const CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'blackboard.js');

function board(t) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'blackboard-batch-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  ensure(dir);
  return dir;
}

function run(dir, args, input) {
  const env = { ...process.env, BLACKBOARD_QUIET: '1' };
  for (const key of Object.keys(env)) if (key.startsWith('BLACKBOARD_') && key !== 'BLACKBOARD_QUIET') delete env[key];
  return spawnSync(process.execPath, [CLI, ...args, '--cwd', dir], { env, input, encoding: 'utf8' });
}

function ok(dir, args, input) {
  const r = run(dir, args, input);
  assert.equal(r.status, 0, `${args.join(' ')}\n${r.stderr}`);
  return r.stdout.trim() ? JSON.parse(r.stdout) : null;
}

const jsonl = (...lines) => lines.map((line) => JSON.stringify(line)).join('\n') + '\n';
const log = (dir) => fs.readFileSync(path.join(dir, '.blackboard', 'events.jsonl'));

function seeded(t) {
  const dir = board(t);
  ok(dir, ['goal', 'Audit synthetic-lib@1.0.0', '--json']);
  ok(dir, ['node', 'add', 'hypothesis', 'Old reading', '--json']);
  ok(dir, ['cursor', 'g1']);
  return dir;
}

test('one batch writes nodes, relations and edits with batch-local references and per-line authors', (t) => {
  const dir = seeded(t);
  const out = ok(dir, ['batch', '--request-id', 'wave-1', '--agent', 'coordinator', '--json'], jsonl(
    { op: 'node', ref: 'h', type: 'hypothesis', title: 'Tenant filter missing', confidence: 'suspected', to: 'g1', agent: 'audit-a1' },
    { op: 'node', type: 'observation', title: 'Handler trusts tenantId', at: 'src/export.ts:42', to: ['$h', 'g1'], rel: 'supports', agent: 'audit-a1' },
    { op: 'link', from: 'hy1', to: '$h', rel: 'contradicts', label: 'older reading' },
    { op: 'edit', id: 'hy1', status: 'refuted', agent: 'audit-a2' },
  ));

  assert.equal(out.schema, 'blackboard.batch.v1');
  assert.equal(out.requestId, 'wave-1');
  assert.deepEqual(out.counts, { nodes: 2, edges: 4, edits: 1 });
  assert.deepEqual(out.results.map((result) => [result.line, result.op]), [[1, 'node'], [2, 'node'], [3, 'link'], [4, 'edit']]);

  const [hypothesis, evidence, link, edit] = out.results;
  assert.equal(hypothesis.ref, 'h');
  assert.deepEqual([hypothesis.node.status, hypothesis.node.severity, hypothesis.node.confidence], ['open', null, 'suspected']);
  const h = hypothesis.node.id;
  assert.deepEqual(evidence.edges.map((edge) => [edge.from, edge.kind, edge.to]), [[evidence.node.id, 'supports', h], [evidence.node.id, 'supports', 'g1']]);
  assert.deepEqual([link.edge.from, link.edge.kind, link.edge.to, link.edge.label], ['hy1', 'contradicts', h, 'older reading']);
  assert.equal(edit.node.status, 'refuted');

  const g = replay(dir);
  assert.equal(g.nodes[h].author, 'agent:audit-a1');
  assert.equal(g.nodes.hy1.updatedBy, 'agent:audit-a2');
  assert.equal(g.edges[link.edge.id].author, 'agent:coordinator', 'lines without agent use the batch identity');
  assert.equal(g.nodes[evidence.node.id].loc.path, 'src/export.ts');
});

test('a batch never moves a cursor and produces only ordinary events plus one receipt', (t) => {
  const dir = seeded(t);
  const before = readEvents(dir).events.length;
  const cursors = structuredClone(replay(dir).cursors);
  ok(dir, ['batch', '--request-id', 'wave-1', '--json'], jsonl(
    { op: 'node', type: 'note', title: 'A', agent: 'audit-a1' },
    { op: 'node', type: 'note', title: 'B', to: 'g1' },
  ));
  assert.deepEqual(replay(dir).cursors, cursors);
  const added = readEvents(dir).events.slice(before);
  assert.deepEqual(added.map((ev) => ev.op), ['node', 'node', 'edge', 'receipt']);
  assert.equal(added[0].request.command, 'batch');
});

test('any invalid line rejects the whole batch, names the line, and leaves the log byte-identical', (t) => {
  const dir = seeded(t);
  const valid = { op: 'node', type: 'note', title: 'Fine' };
  const cases = [
    ['{not json', /第 2 行/],
    [JSON.stringify({ op: 'node', type: 'note', title: 'Bad', to: 'nope' }), /第 2 行.*nope/],
    [JSON.stringify({ op: 'node', type: 'note', title: 'Typo', confidance: 'suspected' }), /第 2 行.*confidance/],
    [JSON.stringify({ op: 'node', type: 'note', title: 'Forward', to: '$later' }), /第 2 行.*\$later/],
    [JSON.stringify({ op: 'node', type: 'note', title: 'Bad state', status: 'needs_validation' }), /第 2 行/],
    [JSON.stringify({ op: 'node', type: 'note', title: '' }), /第 2 行/],
    [JSON.stringify({ op: 'remove', id: 'hy1' }), /第 2 行.*remove/],
    [JSON.stringify({ op: 'node', type: 'note', title: 'Enter', enter: true }), /第 2 行.*enter/],
    [JSON.stringify({ op: 'edit', id: 'hy1' }), /第 2 行/],
    [JSON.stringify({ op: 'toString' }), /第 2 行.*toString/],
    [JSON.stringify({ op: 'edit', id: 'hy1', status: '' }), /第 2 行.*status/],
    [JSON.stringify({ op: 'edit', id: 'hy1', tags: [] }), /第 2 行.*tags/],
    [JSON.stringify({ op: 'node', type: 'note', title: 'No target', rel: 'supports' }), /第 2 行.*rel/],
  ];
  for (const [index, [line, message]] of cases.entries()) {
    const before = log(dir);
    const r = run(dir, ['batch', '--request-id', `bad-${index}`], `${JSON.stringify(valid)}\n${line}\n`);
    assert.equal(r.status, 1, line);
    assert.equal(r.stdout, '', 'failures print nothing on stdout');
    assert.match(r.stderr, message, line);
    assert.deepEqual(log(dir), before, `${line} must not write the earlier valid line`);
  }

  const before = log(dir);
  const duplicate = run(dir, ['batch', '--request-id', 'dup'], jsonl(
    { op: 'node', ref: 'x', type: 'note', title: 'One' },
    { op: 'node', ref: 'x', type: 'note', title: 'Two' },
  ));
  assert.equal(duplicate.status, 1);
  assert.match(duplicate.stderr, /第 2 行.*x/);
  assert.deepEqual(log(dir), before);
});

test('a later edit in the same batch never rewrites the node event or result written before it', (t) => {
  const dir = seeded(t);
  const out = ok(dir, ['batch', '--request-id', 'wave-1', '--json'], `\uFEFF${jsonl(
    { op: 'node', ref: 'h', type: 'hypothesis', title: 'As first written', tags: ['x'] },
    { op: 'edit', id: '$h', title: 'Revised', status: 'refuted', tags: ['y'] },
  )}`);
  const [created, edited] = out.results;
  assert.deepEqual([created.node.title, created.node.status, created.node.tags], ['As first written', 'open', ['x']]);
  assert.deepEqual([edited.node.title, edited.node.status, edited.node.tags], ['Revised', 'refuted', ['y']]);

  const events = readEvents(dir).events;
  const node = events.find((event) => event.op === 'node' && event.node.id === created.node.id).node;
  assert.deepEqual([node.title, node.status, node.tags, 'updated' in node], ['As first written', 'open', ['x'], false]);
  assert.deepEqual([replay(dir).nodes[created.node.id].title, replay(dir).nodes[created.node.id].status], ['Revised', 'refuted']);
});

test('a batch requires a request id, and the same id replays the original result without writing', (t) => {
  const dir = seeded(t);
  const input = jsonl({ op: 'node', type: 'note', title: 'Once', to: 'g1' });
  const missing = run(dir, ['batch'], input);
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /--request-id/);

  const first = ok(dir, ['batch', '--request-id', 'wave-1', '--json'], input);
  const committed = log(dir);
  const retried = ok(dir, ['batch', '--request-id', 'wave-1', '--json'], input);
  assert.deepEqual(retried, first);
  assert.deepEqual(log(dir), committed, 'a retry appends nothing');

  const changed = run(dir, ['batch', '--request-id', 'wave-1'], jsonl({ op: 'node', type: 'note', title: 'Different' }));
  assert.equal(changed.status, 1);
  assert.match(changed.stderr, /request_id_conflict/);
  const receipt = ok(dir, ['receipt', 'wave-1', '--json']);
  assert.deepEqual([receipt.command, receipt.status], ['batch', 'committed']);
});

test('a batch interrupted mid-append is completed exactly by retrying the same request id', (t) => {
  const dir = seeded(t);
  const input = jsonl(
    { op: 'node', ref: 'h', type: 'hypothesis', title: 'Interrupted claim', to: 'g1' },
    { op: 'node', type: 'observation', title: 'Interrupted evidence', to: '$h', rel: 'supports' },
  );
  const file = path.join(dir, '.blackboard', 'events.jsonl');
  const before = fs.readFileSync(file, 'utf8');
  const complete = ok(dir, ['batch', '--request-id', 'wave-crash', '--json'], input);
  const appended = fs.readFileSync(file, 'utf8').slice(before.length).split('\n').filter(Boolean);
  // Keep only the first two complete lines: the request plan is on disk, its receipt marker is not.
  fs.writeFileSync(file, before + appended.slice(0, 2).join('\n') + '\n');
  fs.rmSync(path.join(dir, '.blackboard', 'state.json'), { force: true });

  const blocked = run(dir, ['node', 'add', 'note', 'Unrelated']);
  assert.equal(blocked.status, 1, 'a half-written batch blocks new writes until it is resolved');
  assert.match(blocked.stderr, /wave-crash/);
  assert.equal(ok(dir, ['receipt', 'wave-crash', '--json']).status, 'pending');

  const recovered = ok(dir, ['batch', '--request-id', 'wave-crash', '--json'], input);
  assert.deepEqual(recovered, complete);
  assert.equal(fs.readFileSync(file, 'utf8').slice(before.length).split('\n').filter(Boolean).length, appended.length);
  const g = replay(dir);
  assert.deepEqual(Object.values(g.edges).map((edge) => [edge.from, edge.kind, edge.to]).sort(),
    [[complete.results[0].node.id, 'related-to', 'g1'], [complete.results[1].node.id, 'supports', complete.results[0].node.id]].sort());
});

test('--file reads the same records as stdin', (t) => {
  const dir = seeded(t);
  const file = path.join(dir, 'wave.jsonl');
  fs.writeFileSync(file, jsonl({ op: 'node', type: 'note', title: 'From file' }));
  const out = ok(dir, ['batch', '--request-id', 'wave-file', '--file', file, '--json']);
  assert.equal(out.results[0].node.title, 'From file');
});

test('text limits follow single writes, and --no-truncate rejects the whole batch', (t) => {
  const dir = seeded(t);
  const long = 'x'.repeat(600);
  const before = log(dir);
  const strict = run(dir, ['batch', '--request-id', 'strict', '--no-truncate'], jsonl(
    { op: 'node', type: 'note', title: 'Short' },
    { op: 'node', type: 'note', title: long },
  ));
  assert.equal(strict.status, 1);
  assert.deepEqual(log(dir), before);

  const clipped = ok(dir, ['batch', '--request-id', 'lenient', '--json'], jsonl({ op: 'node', type: 'note', title: long }));
  const node = replay(dir).nodes[clipped.results[0].node.id];
  assert.ok(node.title.length < long.length);
  assert.equal(node.inputTruncation.title.originalLength, long.length);
});

test('oversized batches are rejected before anything is written', (t) => {
  const dir = seeded(t);
  const { limits } = JSON.parse(spawnSync(process.execPath, [CLI, 'capabilities', '--json'], { encoding: 'utf8' }).stdout);
  const lines = Array.from({ length: limits.batchMaxOps + 1 }, (_, index) => ({ op: 'node', type: 'note', title: `n${index}` }));
  const before = log(dir);
  const r = run(dir, ['batch', '--request-id', 'huge'], jsonl(...lines));
  assert.equal(r.status, 1);
  assert.match(r.stderr, new RegExp(String(limits.batchMaxOps)));
  assert.deepEqual(log(dir), before);
});

test('capabilities advertise batch with its output schema and limits', () => {
  const caps = JSON.parse(spawnSync(process.execPath, [CLI, 'capabilities', '--json'], { encoding: 'utf8' }).stdout);
  assert.equal(caps.features.batch, true);
  assert.deepEqual(caps.outputs.batch, { shape: 'object', schema: 'blackboard.batch.v1' });
  assert.ok(Number.isInteger(caps.limits.batchMaxOps) && caps.limits.batchMaxOps > 0);
  assert.ok(Number.isInteger(caps.limits.batchMaxBytes) && caps.limits.batchMaxBytes > 0);
  assert.ok(caps.commands.includes('batch'));
});
