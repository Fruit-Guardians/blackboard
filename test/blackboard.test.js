import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  addCheckpoint,
  addEdge,
  addNode,
  ensure,
  moveCursor,
  paths,
  replay,
  setMeta,
} from '../lib/store.js';
import { currentCursor } from '../lib/model.js';
import { buildDigest } from '../lib/digest.js';
import { installHooks, runHook, uninstallHooks } from '../lib/hooks.js';
import { renderExport } from '../lib/export.js';
import { lintGraph } from '../lib/lint.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(HERE, '..', 'bin', 'flow.js');
const PRIMARY_CLI = path.resolve(HERE, '..', 'bin', 'blackboard.js');

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-blackboard-test-'));
  ensure(dir);
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('creating a node neither moves the cursor nor creates an implicit edge', (t) => {
  const dir = fixture(t);
  const a = addNode({ type: 'goal', title: 'A', enter: true }, dir).node;
  const b = addNode({ type: 'hypothesis', title: 'B' }, dir).node;
  const g = replay(dir);

  assert.equal(currentCursor(g), a.id);
  assert.equal(Object.keys(g.edges).length, 0);
  assert.equal(g.nodes[b.id].parent, undefined);
});

test('relate-here creates a logic edge without moving the cursor', (t) => {
  const dir = fixture(t);
  const a = addNode({ type: 'observation', title: 'A', enter: true }, dir).node;
  const result = addNode({
    type: 'hypothesis', title: 'B', relateHere: true, relation: 'supports',
  }, dir);
  const g = replay(dir);

  assert.equal(result.edge.from, a.id);
  assert.equal(result.edge.to, result.node.id);
  assert.equal(result.edge.kind, 'supports');
  assert.equal(currentCursor(g), a.id);
});

test('cursor trail is independent from logic edges and supports multiple agents', (t) => {
  const dir = fixture(t);
  const a = addNode({ type: 'note', title: 'A' }, dir).node;
  const b = addNode({ type: 'note', title: 'B' }, dir).node;
  moveCursor(a.id, { reason: 'primary starts' }, dir);
  moveCursor(b.id, { reason: 'primary moves' }, dir);
  moveCursor(a.id, { agentId: 'agent:review' }, dir);
  const g = replay(dir);

  assert.equal(currentCursor(g), b.id);
  assert.equal(currentCursor(g, 'agent:review'), a.id);
  assert.equal(g.cursorTrail.length, 3);
  assert.equal(Object.keys(g.edges).length, 0);
});

test('custom node kinds and relations remain open for extension', (t) => {
  const dir = fixture(t);
  const a = addNode({ type: 'decision', title: 'A' }, dir).node;
  const b = addNode({ type: 'counterexample', title: 'B' }, dir).node;
  const edge = addEdge({ from: a.id, to: b.id, kind: 'inspired-by' }, dir);
  const g = replay(dir);

  assert.equal(g.nodes[a.id].type, 'decision');
  assert.equal(g.edges[edge.id].kind, 'inspired-by');
});

test('corrupt state cache does not cause duplicate node ids or lose title/cursor', (t) => {
  const dir = fixture(t);
  setMeta({ title: 'recoverable' }, dir);
  const first = addNode({ type: 'fact', title: 'first', enter: true }, dir).node;
  fs.writeFileSync(paths(dir).state, '{broken');
  const second = addNode({ type: 'fact', title: 'second' }, dir).node;
  const g = replay(dir);

  assert.notEqual(first.id, second.id);
  assert.equal(Object.keys(g.nodes).length, 2);
  assert.equal(g.meta.title, 'recoverable');
  assert.equal(currentCursor(g), first.id);
});

test('checkpoint is immediately visible in the digest', (t) => {
  const dir = fixture(t);
  const n = addNode({ type: 'goal', title: 'restore me', enter: true }, dir).node;
  const checkpoint = addCheckpoint({ summary: 'checkpoint summary' }, dir);
  const digest = buildDigest(replay(dir), dir);

  assert.equal(checkpoint.cursorNodeId, n.id);
  assert.match(digest, /checkpoint summary/);
  assert.match(digest, /最近检查点/);
});

test('tool hooks write redacted activity rather than semantic fact nodes', (t) => {
  const dir = fixture(t);
  runHook({
    event: 'PostToolUse',
    cwd: dir,
    payload: {
      tool_name: 'Bash',
      tool_input: { command: 'curl -H "Authorization: Bearer secret-token" /api' },
      tool_response: { stdout: 'password=hunter2 token=abc123' },
    },
  });
  const g = replay(dir);
  const activity = Object.values(g.activities)[0];

  assert.equal(Object.keys(g.nodes).length, 0);
  assert.equal(Object.keys(g.activities).length, 1);
  assert.doesNotMatch(JSON.stringify(activity), /secret-token|hunter2|abc123/);
  assert.match(JSON.stringify(activity), /REDACTED/);
});

test('offline export excludes raw activity input and output', (t) => {
  const dir = fixture(t);
  runHook({
    event: 'PostToolUse',
    cwd: dir,
    payload: {
      tool_name: 'Bash',
      tool_input: { command: 'printf private-command-body' },
      tool_response: { stdout: 'private-output-body' },
    },
  });
  const html = renderExport({ cwd: dir });
  assert.doesNotMatch(html, /private-command-body|private-output-body/);
  assert.match(html, /Bash/);
});

test('CLI accumulates repeated tags and keeps legacy intent off the cursor', (t) => {
  const dir = fixture(t);
  const env = { ...process.env, FLOW_CWD: dir, FLOW_QUIET: '1' };
  const raw = execFileSync(process.execPath, [
    CLI, 'intent', 'inspect', '--tag', 'auth', '-t', 'api', '--json',
  ], { env, encoding: 'utf8' });
  const result = JSON.parse(raw);
  const g = replay(dir);

  assert.deepEqual(result.node.tags, ['auth', 'api']);
  assert.equal(currentCursor(g), null);
});

test('CLI can promote raw activity into an explicit logic node', (t) => {
  const dir = fixture(t);
  runHook({
    event: 'PostToolUse',
    cwd: dir,
    payload: {
      tool_name: 'Grep',
      tool_input: { pattern: 'requireAuth', path: 'src' },
      tool_response: { output: 'src/api.js:12: requireAuth' },
    },
  });
  const activity = Object.values(replay(dir).activities)[0];
  const env = { ...process.env, FLOW_CWD: dir, FLOW_QUIET: '1' };
  const raw = execFileSync(process.execPath, [
    CLI, 'promote', activity.id, '--kind', 'observation', '--title', '发现鉴权挂载点', '--json',
  ], { env, encoding: 'utf8' });
  const result = JSON.parse(raw);

  assert.equal(result.node.type, 'observation');
  assert.equal(result.node.activityId, activity.id);
  assert.equal(currentCursor(replay(dir)), null);
});

test('blackboard is the primary brand while the flow CLI and data directory stay compatible', (t) => {
  const dir = fixture(t);
  const env = { ...process.env, BLACKBOARD_CWD: dir, BLACKBOARD_QUIET: '1' };
  const version = execFileSync(process.execPath, [PRIMARY_CLI, '--version'], { env, encoding: 'utf8' });
  const raw = execFileSync(process.execPath, [
    PRIMARY_CLI, 'node', 'add', 'goal', 'brand check', '--enter', '--json',
  ], { env, encoding: 'utf8' });
  const result = JSON.parse(raw);
  const legacyStatus = execFileSync(process.execPath, [CLI, 'status', '--json'], {
    env: { ...process.env, FLOW_CWD: dir, FLOW_QUIET: '1' },
    encoding: 'utf8',
  });

  assert.equal(version.trim(), 'blackboard 0.4.0');
  assert.equal(result.node.title, 'brand check');
  assert.equal(JSON.parse(legacyStatus).cursor.id, result.node.id);
  assert.ok(fs.existsSync(path.join(dir, '.flow', 'events.jsonl')));
});

test('lint is read-only and reports context quality without blocking writes', (t) => {
  const dir = fixture(t);
  const long = addNode({ type: 'vuln', title: '很长的标题'.repeat(30) }, dir).node;
  const before = fs.readFileSync(paths(dir).events, 'utf8');
  const result = lintGraph(replay(dir), { maxTitleLength: 40 });
  const after = fs.readFileSync(paths(dir).events, 'utf8');

  assert.equal(before, after);
  assert.ok(result.issues.some((x) => x.code === 'long-titles' && x.nodeIds.includes(long.id)));
  assert.ok(result.issues.some((x) => x.code === 'isolated-nodes'));
  assert.ok(result.issues.some((x) => x.code === 'unsupported-conclusions'));
});

test('a newer conclusion can supersede an older one without deleting history', (t) => {
  const dir = fixture(t);
  const oldNode = addNode({ type: 'finding', title: '旧结论' }, dir).node;
  const newNode = addNode({ type: 'finding', title: '新结论' }, dir).node;
  const env = { ...process.env, BLACKBOARD_CWD: dir, BLACKBOARD_QUIET: '1' };
  execFileSync(process.execPath, [PRIMARY_CLI, 'edit', oldNode.id, '--status', 'superseded'], { env });
  execFileSync(process.execPath, [PRIMARY_CLI, 'link', newNode.id, oldNode.id, '--rel', 'supersedes'], { env });
  const g = replay(dir);

  assert.equal(g.nodes[oldNode.id].status, 'superseded');
  assert.equal(Object.values(g.edges)[0].kind, 'supersedes');
  assert.equal(g.nodes[newNode.id].title, '新结论');
});

test('optional blackboard hooks can be removed without touching unrelated hooks', (t) => {
  const dir = fixture(t);
  const settings = path.join(dir, '.claude', 'settings.json');
  fs.mkdirSync(path.dirname(settings), { recursive: true });
  fs.writeFileSync(settings, JSON.stringify({ hooks: { SessionStart: [
    { hooks: [{ type: 'command', command: 'echo unrelated' }] },
  ] } }));
  installHooks({ cwd: dir, write: true, cli: PRIMARY_CLI, scope: 'project' });
  uninstallHooks({ cwd: dir, write: true, scope: 'project' });
  const updated = JSON.parse(fs.readFileSync(settings, 'utf8'));

  assert.match(JSON.stringify(updated), /echo unrelated/);
  assert.doesNotMatch(JSON.stringify(updated), /\.flow\/events\.jsonl/);
});
