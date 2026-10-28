// Contract for parallel writers: every write says who made it, every command
// can name its board explicitly, and a writer can refuse to create a board.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { addActivity, addEdge, ensure, readEvents, replay } from '../lib/store.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(HERE, '..', 'bin', 'blackboard.js');

function tmp(t, prefix = 'blackboard-contract-') {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function board(t) {
  const dir = tmp(t);
  ensure(dir);
  return dir;
}

/** Run the CLI with no inherited BLACKBOARD_* settings unless `env` passes them. */
function run(t, args, { cwd, env = {} } = {}) {
  const base = { ...process.env };
  for (const key of Object.keys(base)) if (key.startsWith('BLACKBOARD_')) delete base[key];
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: cwd || tmp(t, 'blackboard-elsewhere-'),
    env: { ...base, HOME: tmp(t, 'blackboard-home-'), BLACKBOARD_QUIET: '1', ...env },
    encoding: 'utf8',
  });
}

function ok(t, args, options) {
  const r = run(t, args, options);
  assert.equal(r.status, 0, `${args.join(' ')}\n${r.stderr}`);
  return r.stdout.trim() ? JSON.parse(r.stdout) : null;
}

const events = (dir) => readEvents(dir).events;
const lastEvent = (dir, op) => events(dir).filter((e) => e.op === op).at(-1);

// Every command that appends to the log. Each must accept --agent, --cwd and --no-init.
const WRITE_COMMANDS = [
  ['node', 'add', 'note', 'x'], ['start', 'x'], ['goal', 'x'], ['intent', 'x'], ['fact', 'x'],
  ['vuln', 'x'], ['hint', 'x'],
  ['checkpoint', '--summary', 's'], ['compact', '--summary', 's'],
  ['cursor', 'none'], ['focus', 'none'],
  ['promote', 'act1'],
  ['done', 'g1'], ['block', 'g1'], ['revive', 'g1'],
  ['edit', 'g1', '--title', 't'],
  ['link', 'g1', 'g2'], ['unlink', 'g1', 'g2'],
  ['remove', 'g1'], ['rm', 'g1'],
  ['reset', '--yes'],
];

test('every write command accepts --agent, --cwd and --no-init, and --no-init never creates a board', (t) => {
  const parent = tmp(t);
  const missing = path.join(parent, 'typo', 'project');
  const elsewhere = tmp(t, 'blackboard-elsewhere-');
  for (const args of WRITE_COMMANDS) {
    const r = run(t, [...args, '--agent', 'w', '--cwd', missing, '--no-init'], { cwd: elsewhere });
    assert.equal(r.status, 1, `${args[0]} should refuse: ${r.stderr}`);
    assert.doesNotMatch(r.stderr, /未知选项/, `${args[0]}: ${r.stderr}`);
    assert.match(r.stderr, /--no-init/, `${args[0]} should say why it refused: ${r.stderr}`);
    assert.match(r.stderr, new RegExp(missing.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.equal(fs.existsSync(path.join(parent, 'typo')), false, `${args[0]} created the missing path`);
    assert.equal(fs.existsSync(path.join(elsewhere, '.blackboard')), false, `${args[0]} fell back to the process cwd`);
  }
});

test('--no-init refuses an existing directory without a board, and is a no-op on an existing board', (t) => {
  const empty = tmp(t);
  const refused = run(t, ['goal', 'G', '--cwd', empty, '--no-init']);
  assert.equal(refused.status, 1);
  assert.equal(fs.existsSync(path.join(empty, '.blackboard')), false);

  const dir = board(t);
  const result = ok(t, ['goal', 'G', '--cwd', dir, '--no-init', '--json']);
  assert.equal(result.node.id, 'g1');
});

test('without --no-init, a write still initializes a missing board (unchanged default)', (t) => {
  const dir = tmp(t);
  const r = run(t, ['goal', 'G'], { cwd: dir });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(fs.existsSync(path.join(dir, '.blackboard', 'events.jsonl')), true);
});

test('--cwd beats BLACKBOARD_CWD and the process directory, for writes and reads', (t) => {
  const a = board(t);
  const b = board(t);
  ok(t, ['goal', 'in B', '--cwd', b], { cwd: a, env: { BLACKBOARD_CWD: a } });
  assert.deepEqual(Object.keys(replay(a).nodes), []);
  assert.deepEqual(Object.values(replay(b).nodes).map((n) => n.title), ['in B']);

  const listed = ok(t, ['ls', '--cwd', b, '--json'], { cwd: a, env: { BLACKBOARD_CWD: a } });
  assert.deepEqual(listed.map((n) => n.title), ['in B']);
  const context = ok(t, ['context', '--cwd', b, '--json'], { cwd: a });
  assert.equal(context.schema, 'blackboard.context.v2');

  // A relative --cwd resolves against the process directory, like any path argument.
  ok(t, ['goal', 'relative', '--cwd', path.relative(a, b)], { cwd: a });
  assert.equal(Object.keys(replay(b).nodes).length, 2);
});

test('nodes record their author: --agent beats BLACKBOARD_AGENT, which beats agent:primary', (t) => {
  const dir = board(t);
  const flag = ok(t, ['goal', 'flag', '--agent', 'qs', '--json'], { env: { BLACKBOARD_CWD: dir, BLACKBOARD_AGENT: 'env' } });
  assert.equal(flag.node.author, 'agent:qs');
  const env = ok(t, ['goal', 'env', '--json'], { env: { BLACKBOARD_CWD: dir, BLACKBOARD_AGENT: 'env' } });
  assert.equal(env.node.author, 'agent:env');
  const plain = ok(t, ['goal', 'plain', '--json'], { env: { BLACKBOARD_CWD: dir } });
  assert.equal(plain.node.author, 'agent:primary');
  assert.equal(replay(dir).nodes.g1.author, 'agent:qs');
});

test('relations record their author, whether made on create or with link', (t) => {
  const dir = board(t);
  const env = { BLACKBOARD_CWD: dir };
  ok(t, ['goal', 'G'], { env });
  const created = ok(t, ['fact', 'F', '--to', 'g1', '--rel', 'supports', '--agent', 'qs', '--json'], { env });
  assert.equal(created.edge.author, 'agent:qs');
  ok(t, ['goal', 'H'], { env });
  const linked = ok(t, ['link', 'g2', 'g1', '--agent', 'json5', '--json'], { env });
  assert.equal(linked.author, 'agent:json5');
  assert.equal(replay(dir).edges[linked.id].author, 'agent:json5');
  assert.equal(lastEvent(dir, 'edge').edge.author, 'agent:json5');
});

test('edits and state changes record who made them', (t) => {
  const dir = board(t);
  const env = { BLACKBOARD_CWD: dir };
  ok(t, ['intent', 'I'], { env });
  for (const [cmd, extra] of [['edit', ['--title', 'renamed']], ['done', []], ['block', []], ['revive', []]]) {
    const result = ok(t, [cmd, 'i1', ...extra, '--agent', `by-${cmd}`, '--json'], { env });
    assert.equal(result.updatedBy, `agent:by-${cmd}`, cmd);
    assert.equal(lastEvent(dir, 'patch').set.updatedBy, `agent:by-${cmd}`, cmd);
  }
  const fromEnv = ok(t, ['done', 'i1', '--json'], { env: { ...env, BLACKBOARD_AGENT: 'env' } });
  assert.equal(fromEnv.updatedBy, 'agent:env');
});

test('promote, remove, unlink and reset record who made them', (t) => {
  const dir = board(t);
  const env = { BLACKBOARD_CWD: dir };
  addActivity({ tool: 'Read', summary: 'read parse.js' }, dir);
  const promoted = ok(t, ['promote', 'act1', '--agent', 'qs', '--json'], { env });
  assert.equal(promoted.node.author, 'agent:qs');

  ok(t, ['goal', 'G'], { env });
  ok(t, ['link', promoted.node.id, 'g1'], { env });
  ok(t, ['unlink', promoted.node.id, 'g1', '--agent', 'cut'], { env });
  assert.equal(lastEvent(dir, 'remove').by, 'agent:cut');
  ok(t, ['remove', 'g1', '--agent', 'gone'], { env });
  assert.equal(lastEvent(dir, 'remove').by, 'agent:gone');
  ok(t, ['reset', '--yes', '--agent', 'wipe', '--json'], { env });
  assert.equal(lastEvent(dir, 'reset').by, 'agent:wipe');
});

test('history attributes relation events to their author', (t) => {
  const dir = board(t);
  const env = { BLACKBOARD_CWD: dir };
  ok(t, ['goal', 'G'], { env });
  const fact = ok(t, ['fact', 'F', '--json'], { env }).node.id;
  ok(t, ['link', fact, 'g1', '--rel', 'supports', '--agent', 'qs'], { env });
  const history = ok(t, ['history', 'g1', '--json'], { env });
  const edgeEntry = history.entries.find((e) => e.op === 'edge');
  assert.ok(edgeEntry, JSON.stringify(history.entries));
  assert.equal(edgeEntry.by, 'agent:qs');
});

test('store: addEdge keeps an explicit author and records none when not given', (t) => {
  const dir = board(t);
  ensure(dir);
  const env = { BLACKBOARD_CWD: dir };
  ok(t, ['goal', 'A'], { env });
  ok(t, ['goal', 'B'], { env });
  assert.equal(addEdge({ from: 'g1', to: 'g2', author: 'human' }, dir).author, 'human');
  assert.equal('author' in addEdge({ from: 'g2', to: 'g1' }, dir), false);
});

test('capabilities advertise attribution, --cwd and --no-init so adapters can feature-detect', (t) => {
  const caps = ok(t, ['capabilities', '--json']);
  assert.equal(caps.features.writeAttribution, true);
  assert.equal(caps.features.cwdFlag, true);
  assert.equal(caps.features.noInit, true);
  // The negotiation entry point accepts the same --cwd an adapter passes everywhere else.
  assert.deepEqual(ok(t, ['capabilities', '--cwd', tmp(t), '--json']), caps);
});

test('repeated --to links one new node to every target with the same relation, all or nothing', (t) => {
  const dir = board(t);
  const env = { BLACKBOARD_CWD: dir };
  ok(t, ['goal', 'G'], { env });
  ok(t, ['node', 'add', 'hypothesis', 'H'], { env });
  const created = ok(t, ['node', 'add', 'observation', 'E', '--to', 'g1', '--to', 'hy1', '--to', 'g1', '--rel', 'supports', '--agent', 'ev', '--json'], { env });
  assert.deepEqual(created.edges.map((edge) => [edge.from, edge.kind, edge.to, edge.author]),
    [['o1', 'supports', 'g1', 'agent:ev'], ['o1', 'supports', 'hy1', 'agent:ev']]);
  assert.deepEqual(created.edge, created.edges[0], 'single-edge readers still see the first relation');
  assert.equal(Object.keys(replay(dir).edges).length, 2, 'a repeated target is linked once');

  const single = ok(t, ['node', 'add', 'note', 'N', '--to', 'g1', '--json'], { env });
  assert.deepEqual(single.edges, [single.edge]);
  const unlinked = ok(t, ['node', 'add', 'note', 'Alone', '--json'], { env });
  assert.deepEqual([unlinked.edge, unlinked.edges], [null, []]);

  const log = fs.readFileSync(path.join(dir, '.blackboard', 'events.jsonl'));
  assert.equal(run(t, ['node', 'add', 'note', 'X', '--to', 'g1', '--to', 'missing'], { env }).status, 1);
  assert.deepEqual(fs.readFileSync(path.join(dir, '.blackboard', 'events.jsonl')), log, 'an unknown target writes neither the node nor any relation');
  assert.equal(run(t, ['node', 'add', 'note', 'X', '--to', 'g1', '--relate-here'], { env }).status, 1);
});

test('checkpoint reports what changed since the same identity\'s previous checkpoint, up to itself', (t) => {
  const dir = board(t);
  const env = { BLACKBOARD_CWD: dir };
  ok(t, ['goal', 'G'], { env });
  assert.equal(ok(t, ['checkpoint', '--summary', 'first', '--json'], { env }).sincePrevious, null);
  const idle = ok(t, ['checkpoint', '--summary', 'nothing new', '--json'], { env }).sincePrevious;
  assert.deepEqual([idle.checkpointId, idle.nodes, idle.edges], ['cp1', { added: 0, updated: 0, removed: 0 }, { added: 0, removed: 0 }]);

  ok(t, ['node', 'add', 'note', 'N', '--to', 'g1'], { env });
  ok(t, ['edit', 'g1', '--title', 'G2'], { env });
  assert.equal(ok(t, ['checkpoint', '--summary', 'other', '--agent', 'review', '--json'], { env }).sincePrevious, null,
    'another identity has its own sequence');
  const busy = ok(t, ['checkpoint', '--summary', 'after work', '--request-id', 'cp-retry', '--json'], { env });
  assert.deepEqual([busy.sincePrevious.checkpointId, busy.sincePrevious.nodes, busy.sincePrevious.edges],
    ['cp2', { added: 1, updated: 1, removed: 0 }, { added: 1, removed: 0 }]);

  // A retried checkpoint reports the interval it closed, not writes made after it.
  ok(t, ['node', 'add', 'note', 'Later'], { env });
  const retried = ok(t, ['checkpoint', '--summary', 'after work', '--request-id', 'cp-retry', '--json'], { env });
  assert.equal(retried.id, busy.id);
  assert.deepEqual(retried.sincePrevious, busy.sincePrevious);
});
