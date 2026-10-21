import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile, execFileSync, spawn, spawnSync } from 'node:child_process';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import {
  addCheckpoint,
  addEdge,
  addNode,
  ensure,
  findRoot,
  isInitialized,
  moveCursor,
  patchNode,
  removeEdge,
  removeNode,
  defaultAgentId,
  paths,
  replay,
  reset,
  setMeta,
  stats,
  withLock,
} from '../lib/store.js';
import { currentCursor, apply, emptyGraph, resolveRef } from '../lib/model.js';
import { buildDigest, tail } from '../lib/digest.js';
import { installHooks, installSkill, redactSensitive, runHook, uninstallHooks } from '../lib/hooks.js';
import { renderLaunchAgent } from '../lib/setup.js';
import { renderExport } from '../lib/export.js';
import { startServer } from '../lib/server.js';
import { lintGraph } from '../lib/lint.js';
import { buildAgentContext } from '../lib/context.js';
import { resolvePort } from '../lib/service.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(HERE, '..', 'bin', 'blackboard.js');

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blackboard-test-'));
  ensure(dir);
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const execFileAsync = promisify(execFile);

function cliEnv(t, cwd) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith('BLACKBOARD_') || key.startsWith('FLOW_')) delete env[key];
  }
  return { ...env, HOME: bare(t), BLACKBOARD_CWD: cwd, BLACKBOARD_QUIET: '1' };
}

async function statusJson(env, ...args) {
  const { stdout } = await execFileAsync(process.execPath, [CLI, 'status', '--json', ...args], {
    env, encoding: 'utf8', timeout: 10000,
  });
  return JSON.parse(stdout);
}

test('init and setup help leave both the project and user installation untouched', (t) => {
  const dir = bare(t);
  const env = cliEnv(t, dir);
  for (const command of ['init', 'setup']) {
    for (const flag of ['--help', '-h']) {
      const result = spawnSync(process.execPath, [CLI, command, flag], {
        cwd: dir, env, encoding: 'utf8',
      });
      assert.equal(result.status, 0, result.stderr);
      assert.ok(result.stdout.trim());
      assert.deepEqual(fs.readdirSync(dir), []);
      assert.deepEqual(fs.readdirSync(env.HOME), []);
    }
  }
});

test('digest and tail use the requested Agent focus instead of the primary cursor', (t) => {
  const dir = fixture(t);
  const env = cliEnv(t, dir);
  const primary = addNode({ type: 'note', title: 'primary focus' }, dir).node;
  const review = addNode({ type: 'note', title: 'review focus' }, dir).node;
  moveCursor(primary.id, { agentId: 'agent:primary' }, dir);
  moveCursor(review.id, { agentId: 'agent:review' }, dir);
  const graph = replay(dir);
  for (const [command, render] of [['digest', buildDigest], ['tail', tail]]) {
    const expected = command === 'digest'
      ? render(graph, dir, 'agent:review') : render(graph, 'agent:review');
    const primaryOutput = command === 'digest'
      ? render(graph, dir, 'agent:primary') : render(graph, 'agent:primary');
    assert.notEqual(expected, primaryOutput);
    for (const [agentEnv, flags] of [
      [{ ...env, BLACKBOARD_AGENT: 'primary' }, ['--agent', 'agent:review']],
      [{ ...env, BLACKBOARD_AGENT: 'review' }, []],
    ]) {
      const raw = execFileSync(process.execPath, [CLI, command, '--json', ...flags], {
        env: agentEnv, encoding: 'utf8',
      });
      assert.equal(JSON.parse(raw)[command], expected);
    }
  }
  assert.equal(currentCursor(replay(dir), 'agent:primary'), primary.id);
  assert.equal(currentCursor(replay(dir), 'agent:review'), review.id);
});

test('Agent context is read-only, bounded, and follows only explicit relations', (t) => {
  const dir = fixture(t);
  const goal = addNode({ type: 'goal', title: '审计授权边界', enter: true }, dir).node;
  const hypothesis = addNode({ type: 'hypothesis', title: '对象所有权校验可能缺失', status: 'active' }, dir).node;
  const evidence = addNode({ type: 'fact', title: '跨账号读取返回 200', status: 'confirmed' }, dir).node;
  const isolated = addNode({ type: 'note', title: '与当前方向无关的记录' }, dir).node;
  addEdge({ from: goal.id, to: hypothesis.id, kind: 'derived-from' }, dir);
  addEdge({ from: evidence.id, to: hypothesis.id, kind: 'supports' }, dir);
  moveCursor(hypothesis.id, { agentId: 'agent:primary', reason: '验证假设' }, dir);
  const before = fs.readFileSync(paths(dir).events, 'utf8');

  const packet = buildAgentContext(replay(dir), { depth: 1, budgetTokens: 4000 });

  assert.equal(packet.schema, 'blackboard.context.v1');
  assert.equal(packet.policy.readOnly, true);
  assert.equal(packet.policy.prescriptive, false);
  assert.equal(packet.policy.nextStepSelection, 'agent-controlled');
  assert.equal(packet.currentFocus.id, hypothesis.id);
  assert.deepEqual(new Set(packet.neighborhood.map((item) => item.node.id)), new Set([goal.id, evidence.id]));
  assert.equal(packet.neighborhood.some((item) => item.node.id === isolated.id), false);
  assert.equal(Object.hasOwn(packet, 'suggestedNext'), false);
  assert.equal(fs.readFileSync(paths(dir).events, 'utf8'), before);
});

test('Agent context honors checkpoint deltas and reports budget truncation', (t) => {
  const dir = fixture(t);
  addNode({ type: 'goal', title: '目标' }, dir);
  for (let i = 0; i < 20; i += 1) {
    addNode({ type: 'note', title: `很长的上下文记录 ${i} ${'x'.repeat(180)}` }, dir);
  }
  const checkpoint = addCheckpoint({ summary: '阶段一完成', agentId: 'agent:primary' }, dir);
  while (Date.now() <= checkpoint.at) { /* preserve strict after-checkpoint ordering */ }
  const changed = addNode({ type: 'fact', title: '检查点后的确认事实', status: 'confirmed' }, dir).node;

  const packet = buildAgentContext(replay(dir), {
    since: checkpoint.id,
    budgetTokens: 800,
    maxItems: 50,
  });

  assert.equal(packet.request.sinceSource, `checkpoint:${checkpoint.id}`);
  assert.equal(packet.recentChanges.some((node) => node.id === changed.id), true);
  assert.equal(packet.truncated, true);
  assert.ok(Object.keys(packet.omitted).length > 0);
  assert.ok(packet.estimatedTokens < 1000);
});

test('confidence stays independent from severity/status and improves Agent recovery', (t) => {
  const dir = fixture(t);
  const fact = addNode({ type: 'fact', title: '端到端复现返回 200', confidence: 'reproduced' }, dir).node;
  const candidate = addNode({
    type: 'vuln', title: 'Windows 前缀绕过候选', severity: 'high',
    confidence: 'static-confirmed', status: 'active', enter: true,
  }, dir).node;
  addEdge({ from: fact.id, to: candidate.id, kind: 'supports' }, dir);
  moveCursor(candidate.id, { reason: '等待 Windows 环境复现' }, dir);

  const packet = buildAgentContext(replay(dir));
  assert.equal(packet.currentFocus.confidence, 'static-confirmed');
  assert.equal(packet.request.cursorReason, '等待 Windows 环境复现');
  assert.equal(packet.confirmedFacts.some((node) => node.id === fact.id), true);
  assert.equal(stats(replay(dir)).candidates, 1);
  assert.equal(stats(replay(dir)).confirmed, 0);

  patchNode(candidate.id, { confidence: 'reproduced', status: 'confirmed' }, dir);
  assert.equal(stats(replay(dir)).candidates, 0);
  assert.equal(stats(replay(dir)).confirmed, 1);
  assert.throws(() => addNode({ type: 'vuln', title: 'bad', confidence: 'guessed' }, dir), /invalid confidence/);
});

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

test('offline export is one file: the layout worker is inlined, not fetched by URL', (t) => {
  const html = renderExport({ cwd: fixture(t) });
  assert.doesNotMatch(html, /\/assets\/elk-worker/);
  assert.match(html, /URL\.createObjectURL\(new Blob\(/);
  assert.doesNotMatch(html, /<script[^>]*\ssrc=/);
});

test('CLI accumulates repeated tags and keeps legacy intent off the cursor', (t) => {
  const dir = fixture(t);
  const env = cliEnv(t, dir);
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
  const env = cliEnv(t, dir);
  const raw = execFileSync(process.execPath, [
    CLI, 'promote', activity.id, '--kind', 'observation', '--title', '发现鉴权挂载点', '--json',
  ], { env, encoding: 'utf8' });
  const result = JSON.parse(raw);

  assert.equal(result.node.type, 'observation');
  assert.equal(result.node.activityId, activity.id);
  assert.equal(currentCursor(replay(dir)), null);
});

test('old data directories are ignored without moving or rewriting their logs', (t) => {
  const dir = bare(t);
  const oldDir = path.join(dir, '.flow');
  const oldEvents = path.join(oldDir, 'events.jsonl');
  const original = '{"op":"node","node":{"id":"n1","type":"note","title":"old board"}}\n';
  fs.mkdirSync(oldDir);
  fs.writeFileSync(oldEvents, original);
  const sub = path.join(dir, 'nested');
  fs.mkdirSync(sub);

  assert.equal(isInitialized(dir), false);
  assert.equal(findRoot(sub), null);
  const result = spawnSync(process.execPath, [CLI, 'status', '--json'], {
    cwd: sub, env: cliEnv(t, sub), encoding: 'utf8',
  });
  assert.notEqual(result.status, 0);
  assert.equal(fs.existsSync(path.join(dir, '.blackboard')), false);
  assert.equal(fs.existsSync(path.join(sub, '.blackboard')), false);
  assert.deepEqual(fs.readdirSync(oldDir), ['events.jsonl']);
  assert.equal(fs.readFileSync(oldEvents, 'utf8'), original);
});

test('CLI ignores old environment variables while BLACKBOARD variables select the board and Agent', (t) => {
  const dir = fixture(t);
  const ignored = fixture(t);
  const env = cliEnv(t, dir);
  delete env.BLACKBOARD_CWD;
  delete env.BLACKBOARD_QUIET;
  Object.assign(env, {
    FLOW_CWD: ignored, FLOW_AGENT: 'old-agent', FLOW_QUIET: '1', FLOW_PORT: 'invalid',
  });
  const run = (args, overrides = {}) => execFileSync(process.execPath, [CLI, ...args], {
    cwd: dir, env: { ...env, ...overrides }, encoding: 'utf8',
  });
  run(['node', 'add', 'note', 'actual cwd', '--enter', '--json']);
  assert.equal(Object.values(replay(dir).nodes)[0].title, 'actual cwd');
  assert.equal(currentCursor(replay(dir), 'agent:primary'), 'n1');
  assert.equal(currentCursor(replay(dir), 'agent:old-agent'), null);
  assert.deepEqual(Object.values(replay(ignored).nodes), []);

  const visible = run(['cursor', 'n1']);
  const quiet = run(['cursor', 'n1'], { BLACKBOARD_QUIET: '1' });
  assert.ok(visible.trim());
  assert.equal(quiet, '');
  run(['node', 'add', 'note', 'selected board', '--enter', '--json'], {
    BLACKBOARD_CWD: ignored, BLACKBOARD_AGENT: 'review', BLACKBOARD_QUIET: '1',
  });
  assert.equal(currentCursor(replay(ignored), 'agent:review'), 'n1');
  assert.equal(Object.values(replay(dir).nodes).length, 1);
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
  execFileSync(process.execPath, [CLI, 'edit', oldNode.id, '--status', 'superseded'], { env });
  execFileSync(process.execPath, [CLI, 'link', newNode.id, oldNode.id, '--rel', 'supersedes'], { env });
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
  installHooks({ cwd: dir, write: true, cli: CLI, scope: 'project' });
  uninstallHooks({ cwd: dir, write: true, scope: 'project' });
  const updated = JSON.parse(fs.readFileSync(settings, 'utf8'));

  assert.match(JSON.stringify(updated), /echo unrelated/);
  assert.doesNotMatch(JSON.stringify(updated), /\.blackboard\/events\.jsonl/);
});

test('Codex skill installs project-locally without installing Claude integration', (t) => {
  const dir = fixture(t);
  installSkill({ cwd: dir, cli: CLI, agent: 'codex' });
  assert.equal(fs.existsSync(path.join(dir, '.agents', 'skills', 'blackboard', 'SKILL.md')), true);
  assert.equal(fs.existsSync(path.join(dir, '.claude', 'skills', 'blackboard', 'SKILL.md')), false);
});

test('setup configures a project idempotently without activity capture', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blackboard-setup-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const env = cliEnv(t, dir);
  const args = [CLI, 'setup', '--target', dir, '--title', 'one shot', '--no-serve', '--json'];
  const first = JSON.parse(execFileSync(process.execPath, args, { env, encoding: 'utf8' }));
  const second = JSON.parse(execFileSync(process.execPath, args, { env, encoding: 'utf8' }));
  const config = JSON.parse(fs.readFileSync(path.join(dir, '.blackboard', 'config.json'), 'utf8'));
  const settings = JSON.parse(fs.readFileSync(path.join(dir, '.claude', 'settings.json'), 'utf8'));

  assert.equal(first.cwd, dir);
  assert.equal(second.cwd, dir);
  assert.equal(config.autoRecord, false);
  assert.deepEqual(Object.keys(settings.hooks).sort(), ['PreCompact', 'SessionStart']);
  assert.equal(fs.existsSync(path.join(dir, '.claude', 'skills', 'blackboard', 'SKILL.md')), true);
  assert.equal(fs.statSync(path.join(env.HOME, '.local', 'bin', 'blackboard')).mode & 0o111, 0o111);
});

test('setup without a viewer remembers its selected port for later status', async (t) => {
  const dir = bare(t);
  const env = cliEnv(t, dir);
  const port = 48763;
  execFileSync(process.execPath, [
    CLI, 'setup', '--target', dir, '--port', String(port), '--no-serve', '--json',
  ], { env, encoding: 'utf8' });
  const before = fs.readFileSync(path.join(dir, '.blackboard', 'config.json'), 'utf8');
  const result = await statusJson(env);
  assert.equal(JSON.parse(before).viewerPort, port);
  assert.equal(result.viewer.port, port);
  assert.equal(result.viewer.url, `http://127.0.0.1:${port}`);
  assert.equal(fs.readFileSync(path.join(dir, '.blackboard', 'config.json'), 'utf8'), before);
  assert.equal(fs.existsSync(path.join(env.HOME, 'Library', 'LaunchAgents')), false);
  assert.equal(result.integration.claude.skill.project, true);
  assert.deepEqual(result.integration.claude.hooks.project.slice().sort(), ['PreCompact', 'SessionStart']);
});

test('port selection honors explicit, BLACKBOARD env, saved configuration, then default', (t) => {
  const dir = fixture(t);
  fs.writeFileSync(path.join(dir, '.blackboard', 'config.json'), JSON.stringify({ viewerPort: 48761 }));
  const env = { BLACKBOARD_PORT: '48762', FLOW_PORT: '48763' };
  assert.equal(resolvePort({ cwd: dir, port: '48764', env }), 48764);
  assert.equal(resolvePort({ cwd: dir, env }), 48762);
  assert.equal(resolvePort({ cwd: dir, env: { FLOW_PORT: 'invalid' } }), 48761);
  assert.equal(resolvePort({ cwd: dir, env: {} }), 48761);
  assert.equal(resolvePort({ cwd: bare(t), env: { FLOW_PORT: '48763' } }), 4333);
});

test('invalid ports fail before setup installs or initializes anything', (t) => {
  const dir = bare(t);
  const env = cliEnv(t, dir);
  for (const port of ['', '0', '-1', '1.5', '65536', 'not-a-port']) {
    assert.throws(() => resolvePort({ cwd: dir, port, env: {} }));
    assert.throws(() => resolvePort({ cwd: dir, env: { BLACKBOARD_PORT: port } }));
  }
  const result = spawnSync(process.execPath, [
    CLI, 'setup', '--target', dir, '--port', '65536', '--no-serve', '--json',
  ], { env, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.deepEqual(fs.readdirSync(dir), []);
  assert.deepEqual(fs.readdirSync(env.HOME), []);
});

test('status identifies the current viewer, another project, offline and unrelated services without writing', async (t) => {
  const dir = fixture(t);
  const other = fixture(t);
  const env = cliEnv(t, dir);
  const otherEnv = cliEnv(t, other);
  const server = await startServer({ cwd: dir, port: 0, readOnly: true });
  const close = (instance) => new Promise((resolve, reject) => {
    if (!instance.listening) return resolve();
    instance.closeAllConnections?.();
    instance.close((error) => error ? reject(error) : resolve());
  });
  t.after(() => close(server));
  const port = String(server.address().port);
  const before = fs.readFileSync(paths(dir).events, 'utf8');
  const otherBefore = fs.readFileSync(paths(other).events, 'utf8');
  const online = await statusJson(env, '--port', port);
  assert.deepEqual(online.viewer, {
    port: Number(port), url: `http://127.0.0.1:${port}`, state: 'online',
    cwd: fs.realpathSync(dir), readOnly: true,
  });
  assert.deepEqual(online.integration, {
    claude: { skill: { project: false, user: false }, hooks: { project: [], user: [] } },
    codex: { skill: { project: false, user: false } },
    errors: [],
  });
  const foreign = await statusJson(otherEnv, '--port', port);
  assert.equal(foreign.viewer.state, 'other-project');
  assert.equal(foreign.viewer.cwd, fs.realpathSync(dir));
  assert.equal(fs.readFileSync(paths(other).events, 'utf8'), otherBefore);
  assert.equal(fs.readFileSync(paths(dir).events, 'utf8'), before);
  await close(server);
  assert.equal((await statusJson(env, '--port', port)).viewer.state, 'offline');

  const unrelated = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ nodes: {}, edges: {} }));
  });
  t.after(() => close(unrelated));
  await new Promise((resolve) => unrelated.listen(0, '127.0.0.1', resolve));
  assert.equal((await statusJson(env, '--port', String(unrelated.address().port))).viewer.state, 'unrecognized');
});

test('launchd service definition pins the project and local-only viewer port', () => {
  const plist = renderLaunchAgent({
    cwd: '/tmp/a & b', cli: '/tmp/blackboard.js', node: '/usr/bin/node', port: 4333,
  });
  assert.match(plist, /com\.fruitguardians\.blackboard\.workspace/);
  assert.match(plist, /<string>\/tmp\/a &amp; b<\/string>/);
  assert.match(plist, /<key>BLACKBOARD_CWD<\/key>/);
  assert.match(plist, /<string>4333<\/string>/);
});


test('offline viewer preserves deferred module startup and the board title', (t) => {
  const dir = fixture(t);
  setMeta({ title: 'Offline <board>' }, dir);
  const html = renderExport({ cwd: dir });
  assert.match(html, /<script type="module">/);
  assert.match(html, /<div id="root"><\/div>/);
  assert.match(html, /<title>Offline &lt;board&gt; — 思考工作台<\/title>/);
  assert.doesNotMatch(html, /<script[^>]+src=/);
  assert.doesNotMatch(html, /<link[^>]+href="\/assets\//);
});

test('reset clears the replayed graph', (t) => {
  const dir = fixture(t);
  const a = addNode({ type: 'goal', title: 'old', enter: true }, dir).node;
  addNode({ type: 'note', title: 'older', parent: a.id }, dir);
  reset(dir);
  let g = replay(dir);
  assert.deepEqual([Object.keys(g.nodes).length, Object.keys(g.edges).length, g.cursorTrail.length], [0, 0, 0]);
  addNode({ type: 'goal', title: 'new' }, dir);
  g = replay(dir);
  assert.deepEqual(Object.values(g.nodes).map((n) => n.title), ['new']);
});

test('replay ignores malformed nodes and edges that do not connect two existing nodes', () => {
  const g = emptyGraph();
  apply(g, { op: 'node', node: { id: 'a', type: 'note', title: 'A' } });
  apply(g, { op: 'node', node: { id: 'b', type: 'note', title: 'B' } });
  apply(g, { op: 'node', node: { type: 'note', title: 'no id' } });
  apply(g, { op: 'node', node: { id: 'c', title: 'no type' } });
  apply(g, { op: 'edge', edge: { id: 'ok', from: 'a', to: 'b', kind: 'related-to' } });
  apply(g, { op: 'edge', edge: { id: 'dangling', from: 'a', to: 'missing', kind: 'related-to' } });
  apply(g, { op: 'edge', edge: { id: 'loop', from: 'a', to: 'a', kind: 'related-to' } });
  assert.deepEqual(Object.keys(g.nodes).sort(), ['a', 'b']);
  assert.deepEqual(Object.keys(g.edges), ['ok']);
});

test('concurrent writer processes never lose or duplicate a node', async (t) => {
  const dir = fixture(t);
  const store = path.resolve(HERE, '..', 'lib', 'store.js');
  const code = `import(${JSON.stringify(store)}).then(({addNode})=>{for(let i=0;i<15;i++)addNode({type:'note',title:process.argv[1]+'-'+i},${JSON.stringify(dir)})})`;
  const run = (id) => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['-e', code, id], { stdio: 'pipe' });
    let err = '';
    child.stderr.on('data', (d) => { err += d; });
    child.on('exit', (c) => (c === 0 ? resolve() : reject(new Error(err))));
  });
  await Promise.all(Array.from({ length: 6 }, (_, i) => run(`w${i}`)));
  const nodes = Object.values(replay(dir).nodes);
  assert.equal(nodes.length, 90);
  assert.equal(new Set(nodes.map((n) => n.id)).size, 90);
});

test('a live lock owner is never evicted, a dead owner is', (t) => {
  const dir = fixture(t);
  const lock = paths(dir).lock;
  // A live owner whose lock looks ancient must be respected.
  process.env.BLACKBOARD_LOCK_TIMEOUT_MS = '400';
  t.after(() => { delete process.env.BLACKBOARD_LOCK_TIMEOUT_MS; });
  const holder = spawn(process.execPath, ['-e', 'setTimeout(()=>{},60000)']);
  t.after(() => holder.kill());
  fs.writeFileSync(lock, `${holder.pid}\n1\n`);
  fs.utimesSync(lock, new Date(0), new Date(0));
  assert.throws(() => addNode({ type: 'note', title: 'blocked' }, dir), /lock timeout/);
  assert.equal(Object.keys(replay(dir).nodes).length, 0);
  // Once the owner dies, the stale lock is reclaimed.
  holder.kill();
  return new Promise((resolve) => holder.on('exit', resolve)).then(() => {
    addNode({ type: 'note', title: 'after' }, dir);
    assert.equal(Object.keys(replay(dir).nodes).length, 1);
  });
});

test('releasing the lock leaves a lock taken over by someone else alone', (t) => {
  const dir = fixture(t);
  const lock = paths(dir).lock;
  withLock(() => {
    fs.writeFileSync(lock, 'someone-else\n');
  }, dir);
  assert.equal(fs.readFileSync(lock, 'utf8'), 'someone-else\n');
});

test('a failing state cache write does not fail an already-recorded node', (t) => {
  const dir = fixture(t);
  const { state } = paths(dir);
  fs.rmSync(state);
  fs.mkdirSync(state); // writeState's rename onto a directory fails
  const { node } = addNode({ type: 'goal', title: 'kept', enter: true }, dir);
  assert.equal(replay(dir).nodes[node.id].title, 'kept');
  assert.equal(currentCursor(replay(dir)), node.id);
});

test('node ids are short, sequential per type, and not reused', (t) => {
  const dir = fixture(t);
  const ids = [
    addNode({ type: 'note', title: 'a' }, dir).node.id,
    addNode({ type: 'note', title: 'b' }, dir).node.id,
    addNode({ type: 'hypothesis', title: 'c' }, dir).node.id,
    addNode({ type: 'custom-kind', title: 'd' }, dir).node.id,
  ];
  assert.deepEqual(ids, ['n1', 'n2', 'hy1', 'n3']);
  assert.match(addCheckpoint({ summary: 'x' }, dir).id, /^cp\d+$/);
});

test('references accept brackets, case, and unique prefixes, and reject ambiguity', (t) => {
  const dir = fixture(t);
  const a = addNode({ type: 'hypothesis', title: 'a' }, dir).node;
  const b = addNode({ type: 'note', title: 'b' }, dir).node;
  const c = addNode({ type: 'note', title: 'c' }, dir).node;
  assert.equal(addEdge({ from: `[${a.id}]`, to: b.id.toUpperCase(), kind: 'supports' }, dir).to, b.id);
  assert.equal(moveCursor('hy', {}, dir).to, a.id); // unique prefix
  assert.throws(() => moveCursor('n', {}, dir), /ambiguous node reference "n": n1, n2/);
  assert.throws(() => moveCursor('zzz', {}, dir), /no such node: zzz/);
  const long = { 'hy_mvgo0cq2_ut150b8add7': 1, 'hy_mvgo0cq3_aa': 1 };
  assert.equal(resolveRef(long, 'hy_mvgo0cq2'), 'hy_mvgo0cq2_ut150b8add7');
  assert.ok(c);
});

test('a node cannot be given a new id or creation time', (t) => {
  const dir = fixture(t);
  const a = addNode({ type: 'note', title: 'a' }, dir).node;
  assert.throws(() => patchNode(a.id, { id: 'hacked' }, dir), /cannot be changed/);
  assert.throws(() => patchNode(a.id, { ts: 1 }, dir), /cannot be changed/);
  // Logs that already contain such a patch are replayed safely too.
  const g = emptyGraph();
  apply(g, { op: 'node', node: { id: 'x', type: 'note', title: 'x', ts: 5 } });
  apply(g, { op: 'patch', id: 'x', set: { id: 'y', ts: 9, title: 'renamed' } });
  assert.deepEqual([g.nodes.x.id, g.nodes.x.ts, g.nodes.x.title], ['x', 5, 'renamed']);
});

test('hook writers give up quickly when another writer holds the lock', (t) => {
  const dir = fixture(t);
  const holder = spawn(process.execPath, ['-e', 'setTimeout(()=>{},60000)']);
  t.after(() => holder.kill());
  fs.writeFileSync(paths(dir).lock, `${holder.pid}\n1\n`);
  const started = Date.now();
  assert.throws(() => runHook({
    event: 'PostToolUse',
    payload: { tool_name: 'Bash', tool_input: { command: 'ls' }, tool_response: 'ok' },
    cwd: dir,
  }), /lock timeout/);
  assert.ok(Date.now() - started < 3000, `hook waited ${Date.now() - started}ms`);
  assert.equal(Object.keys(replay(dir).activities).length, 0);
});

test('digest without a cursor still shows recent active nodes, detail and relations', (t) => {
  const dir = fixture(t);
  const a = addNode({ type: 'hypothesis', title: '接口缺少鉴权', detail: '读接口匿名返回 200' }, dir).node;
  const b = addNode({ type: 'observation', title: '匿名请求成功' }, dir).node;
  addEdge({ from: b.id, to: a.id, kind: 'supports' }, dir);
  const md = buildDigest(replay(dir), dir);
  assert.match(md, /尚未设置游标/);
  assert.match(md, /## 最近活跃节点/);
  assert.match(md, /读接口匿名返回 200/);
  assert.match(md, new RegExp(`\\[${b.id}\\] --支持--> \\[${a.id}\\]`));
  assert.doesNotMatch(md, /## 当前邻域/);
  moveCursor(a.id, {}, dir);
  const withCursor = buildDigest(replay(dir), dir);
  assert.match(withCursor, /读接口匿名返回 200/);
  assert.match(withCursor, /## 当前邻域/);
  assert.doesNotMatch(withCursor, /## 最近活跃节点/);
});

test('CLI accepts short, bracketed and prefixed ids and lists candidates when ambiguous', (t) => {
  const dir = fixture(t);
  const env = { ...process.env, BLACKBOARD_CWD: dir };
  const run = (...args) => execFileSync(process.execPath, [CLI, ...args], { env, encoding: 'utf8' });
  run('node', 'add', 'hypothesis', 'H');
  run('node', 'add', 'note', 'N1');
  run('node', 'add', 'note', 'N2');
  assert.match(run('link', '[n1]', 'hy1', '--rel', 'supports'), /n1.*hy1/);
  assert.match(run('cursor', 'hy'), /hy1/);
  assert.match(run('show', 'HY1'), /hy1/);
  assert.throws(() => run('cursor', 'n'), /ambiguous node reference/);
});

function hookSettings(dir) {
  const file = path.join(dir, '.claude', 'settings.json');
  return { file, read: () => JSON.parse(fs.readFileSync(file, 'utf8')) };
}

test('hooks install only the recovery hooks unless activity capture is requested', (t) => {
  const dir = fixture(t);
  const settings = hookSettings(dir);
  const res = installHooks({ cwd: dir, write: true, cli: CLI });
  assert.deepEqual(Object.keys(settings.read().hooks).sort(), ['PreCompact', 'SessionStart']);
  assert.deepEqual(res.removed, []);

  installHooks({ cwd: dir, write: true, cli: CLI, withActivity: true });
  assert.deepEqual(Object.keys(settings.read().hooks).sort(), ['PostToolUse', 'PreCompact', 'SessionStart']);
  // Installing again does not duplicate entries.
  installHooks({ cwd: dir, write: true, cli: CLI, withActivity: true });
  assert.equal(settings.read().hooks.PostToolUse.length, 1);

  uninstallHooks({ cwd: dir, write: true });
  assert.deepEqual(settings.read().hooks, {});
});

test('a plain install retires an earlier default activity hook but keeps unrelated ones', (t) => {
  const dir = fixture(t);
  const settings = hookSettings(dir);
  installHooks({ cwd: dir, write: true, cli: CLI, withActivity: true });
  const withForeign = settings.read();
  withForeign.hooks.PostToolUse.push({ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo unrelated' }] });
  fs.writeFileSync(settings.file, JSON.stringify(withForeign));

  const res = installHooks({ cwd: dir, write: true, cli: CLI });
  assert.deepEqual(res.removed, ['PostToolUse']);
  const hooks = settings.read().hooks;
  assert.equal(hooks.PostToolUse.length, 1);
  assert.match(JSON.stringify(hooks.PostToolUse), /echo unrelated/);
  assert.doesNotMatch(JSON.stringify(hooks.PostToolUse), /\.blackboard\/events\.jsonl/);
});

test('activity capture skips blackboard CLI calls and never stores written file contents', (t) => {
  const dir = fixture(t);
  const post = (tool_name, tool_input, tool_response = '') =>
    runHook({ event: 'PostToolUse', cwd: dir, payload: { tool_name, tool_input, tool_response } });
  for (const command of [
    'blackboard node add note "x"',
    'BLACKBOARD_CWD=/p blackboard link a b',
    'node /x/bin/blackboard.js digest',
  ]) post('Bash', { command });
  post('Bash', { command: 'cd /p && flow status' });
  post('Bash', { command: 'grep flow README.md' });
  post('Write', { file_path: '/p/.env', content: 'TOKEN=abc' });
  const activities = Object.values(replay(dir).activities);
  assert.deepEqual(activities.map((a) => a.summary), ['$ cd /p && flow status', '$ grep flow README.md', 'Write .env']);
  assert.equal(activities[2].input, '{"file_path":"/p/.env"}');
});

test('redaction covers connection strings, key-like names, JSON, tokens and private keys', () => {
  const cases = {
    'postgres://admin:hunter2@db/prod': 'postgres://admin:[REDACTED]@db/prod',
    'AWS_SECRET_ACCESS_KEY=abcd1234': 'AWS_SECRET_ACCESS_KEY=[REDACTED]',
    '{"password":"hunter2","user":"bob"}': '{"password":"[REDACTED]","user":"bob"}',
    'Authorization: Bearer abc.def': 'Authorization: Bearer [REDACTED]',
    'x ghp_abcdefghijklmnopqrstuvwxyz0123456789 y': 'x [REDACTED] y',
    'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig': '[REDACTED JWT]',
    'https://x/?access_token=abc&n=1': 'https://x/?access_token=[REDACTED]&n=1',
    'ls -la token_count is fine': 'ls -la token_count is fine',
  };
  for (const [input, expected] of Object.entries(cases)) assert.equal(redactSensitive(input), expected, input);
  assert.equal(
    redactSensitive('a\n-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END OPENSSH PRIVATE KEY-----\nb'),
    'a\n[REDACTED PRIVATE KEY]\nb',
  );
});

function bare(t) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'blackboard-bare-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('commands run from a subdirectory use the nearest parent board; init guards against a second one', (t) => {
  const root = bare(t);
  const sub = path.join(root, 'a', 'b');
  fs.mkdirSync(sub, { recursive: true });
  const env = cliEnv(t, root);
  delete env.BLACKBOARD_CWD;
  const run = (cwd, ...args) => execFileSync(process.execPath, [CLI, ...args], { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

  run(root, 'init');
  run(sub, 'fact', 'from sub');
  assert.equal(fs.existsSync(path.join(sub, '.blackboard')), false);
  assert.equal(Object.values(replay(root).nodes).some((n) => n.title === 'from sub'), true);

  assert.throws(() => run(sub, 'init'), /--here/);
  assert.equal(fs.existsSync(path.join(sub, '.blackboard')), false);
  run(sub, 'init', '--here');
  assert.equal(fs.existsSync(path.join(sub, '.blackboard', 'events.jsonl')), true);
});

test('a new board ignores itself in git', (t) => {
  const dir = bare(t);
  ensure(dir);
  assert.equal(fs.readFileSync(path.join(dir, '.blackboard', '.gitignore'), 'utf8').split('\n').filter((l) => l && !l.startsWith('#')).join('\n'), '*');
});

test('lint reports corrupt log lines and rejected events instead of hiding them', (t) => {
  const dir = fixture(t);
  addNode({ type: 'note', title: 'ok' }, dir);
  fs.appendFileSync(paths(dir).events, '{not json\n');
  fs.appendFileSync(paths(dir).events, JSON.stringify({ t: 'edge', from: 'ghost', to: 'ghost2' }) + '\n');
  const g = replay(dir);
  assert.equal(g.integrity.corruptLines, 1);
  const issue = lintGraph(g).issues.find((i) => i.code === 'log-integrity');
  assert.ok(issue, 'log-integrity issue expected');
  assert.equal(issue.corruptLines, 1);
});

test('over-long fields are truncated loudly, not silently', (t) => {
  const dir = fixture(t);
  const r = addNode({ type: 'note', title: 'x'.repeat(600), detail: 'y'.repeat(25000) }, dir);
  assert.ok(r.truncated && r.truncated.length >= 2);
  const env = cliEnv(t, dir);
  const res = spawnSyncCli(env, ['fact', 'z'.repeat(600)]);
  assert.match(res.stderr, /500/);
});

function spawnSyncCli(env, args) {
  return spawnSync(process.execPath, [CLI, ...args], { env, encoding: 'utf8' });
}

test('lint evidence follows "from <kind> to": derived-from outgoing counts, incoming caused-by does not', (t) => {
  const dir = fixture(t);
  const obs = addNode({ type: 'observation', title: 'obs' }, dir).node;
  const f1 = addNode({ type: 'finding', title: 'derived finding' }, dir).node;
  const f2 = addNode({ type: 'finding', title: 'cause-only finding' }, dir).node;
  addEdge({ from: f1.id, to: obs.id, kind: 'derived-from' }, dir);
  addEdge({ from: obs.id, to: f2.id, kind: 'caused-by' }, dir);
  const unsupported = lintGraph(replay(dir)).issues.find((i) => i.code === 'unsupported-conclusions');
  assert.deepEqual(unsupported.nodeIds, [f2.id]);
});

test('lint exposes audit handoff drift without changing the graph', (t) => {
  const dir = fixture(t);
  addNode({ type: 'goal', title: '全面审计' }, dir);
  const evidence = addNode({ type: 'fact', title: '静态链路成立', confidence: 'static-confirmed' }, dir).node;
  const finding = addNode({ type: 'vuln', title: '候选问题', confidence: 'static-confirmed', enter: true }, dir).node;
  addEdge({ from: evidence.id, to: finding.id, kind: 'supports' }, dir);
  addNode({
    type: 'question', title: '剩余覆盖',
    detail: '(1) 并发资源；(2) 多 vhost；(3) 别名边界',
  }, dir);
  const before = fs.readFileSync(paths(dir).events, 'utf8');
  const codes = lintGraph(replay(dir)).issues.map((item) => item.code);

  assert.equal(codes.includes('unscoped-findings'), true);
  assert.equal(codes.includes('compound-open-threads'), true);
  assert.equal(codes.includes('missing-confidence'), false);
  assert.equal(fs.readFileSync(paths(dir).events, 'utf8'), before);
});

test('removing a node takes its relations with it, keeps the log, and clears cursors that pointed at it', (t) => {
  const dir = fixture(t);
  const a = addNode({ type: 'fact', title: 'A', enter: true }, dir).node;
  const b = addNode({ type: 'fact', title: 'B', parent: a.id, relation: 'supports' }, dir).node;
  const c = addNode({ type: 'fact', title: 'C', parent: b.id, relation: 'supports' }, dir).node;
  const removed = removeNode(a.id, { by: 'human' }, dir);
  assert.deepEqual(removed.edges, [`${a.id}->${b.id}:supports`]);
  const g = replay(dir);
  assert.deepEqual(Object.keys(g.nodes).sort(), [b.id, c.id].sort());
  assert.deepEqual(Object.keys(g.edges), [`${b.id}->${c.id}:supports`]);
  assert.equal(currentCursor(g), null);
  // The cursor no longer points at the removed card, so a relation "from here" simply has no source.
  assert.equal(addNode({ type: 'note', title: 'after', relateHere: true }, dir).edge, null);
  assert.match(fs.readFileSync(paths(dir).events, 'utf8'), /"op":"remove","kind":"node"/);
  // An edge can be cut by id or by its ends, and re-linking afterwards works.
  assert.throws(() => removeEdge({ from: b.id, to: c.id, kind: 'refines' }, {}, dir), /no such relation/);
  removeEdge({ from: b.id, to: c.id }, { by: 'human' }, dir);
  assert.deepEqual(replay(dir).edges, {});
  addEdge({ from: b.id, to: c.id, kind: 'supports' }, dir);
  assert.equal(Object.keys(replay(dir).edges).length, 1);
});

test('BLACKBOARD_AGENT gives parallel Agents their own cursor', (t) => {
  assert.equal(defaultAgentId({}), 'agent:primary');
  assert.equal(defaultAgentId({ BLACKBOARD_AGENT: 'research' }), 'agent:research');
  assert.equal(defaultAgentId({ FLOW_AGENT: 'agent:review' }), 'agent:primary');
  const dir = fixture(t);
  const env = cliEnv(t, dir);
  const run = (agent, ...args) => execFileSync(process.execPath, [CLI, ...args, '--json'], { env: { ...env, BLACKBOARD_AGENT: agent }, encoding: 'utf8' });
  const one = JSON.parse(run('one', 'fact', 'from one', '--enter')).node;
  const two = JSON.parse(run('two', 'fact', 'from two', '--enter')).node;
  const g = replay(dir);
  assert.equal(currentCursor(g, 'agent:one'), one.id);
  assert.equal(currentCursor(g, 'agent:two'), two.id);
  assert.equal(currentCursor(g, 'agent:primary'), null);
});

async function serve(t, options = {}) {
  const dir = fixture(t);
  const server = await startServer({ cwd: dir, port: 0, ...options });
  t.after(() => new Promise((resolve) => { server.closeAllConnections?.(); server.close(resolve); }));
  const { port } = server.address();
  const origin = `http://127.0.0.1:${port}`;
  const call = (method, route, { body, headers = {} } = {}) => fetch(origin + route, {
    method,
    headers: { 'content-type': 'application/json', origin, ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { dir, origin, port, call };
}

test('viewer writes: a person adds, edits, links and removes cards, each stamped with who did it', async (t) => {
  const { dir, call } = await serve(t);
  const added = await call('POST', '/api/nodes', { body: { type: 'hypothesis', title: '  先验证授权  ', detail: '读 /admin' } });
  assert.equal(added.status, 201);
  const node = (await added.json()).node;
  assert.equal(node.title, '先验证授权');
  assert.equal(node.author, 'human');
  const child = (await (await call('POST', '/api/nodes', { body: { type: 'fact', title: '返回 200', parent: node.id, relation: 'supports' } })).json());
  assert.equal(child.edge.kind, 'supports');
  const patched = await call('PATCH', `/api/nodes/${node.id}`, { body: { status: 'active', title: '先验证授权边界', id: 'x' } });
  assert.equal(patched.status, 200);
  assert.equal((await patched.json()).updatedBy, 'human');
  assert.equal(replay(dir).nodes[node.id].id, node.id);
  const bad = await call('PATCH', `/api/nodes/${node.id}`, { body: { status: 'nonsense' } });
  assert.equal(bad.status, 400);
  assert.equal((await call('POST', '/api/edges', { body: { from: child.node.id, to: node.id, kind: 'bogus' } })).status, 400);
  const edge = await (await call('POST', '/api/edges', { body: { from: node.id, to: child.node.id, kind: 'related-to' } })).json();
  assert.equal((await call('DELETE', `/api/edges?id=${encodeURIComponent(edge.id)}`, {})).status, 200);
  assert.equal((await call('DELETE', `/api/nodes/${child.node.id}`, {})).status, 200);
  const g = replay(dir);
  assert.deepEqual(Object.keys(g.nodes), [node.id]);
  assert.equal(Object.keys(g.edges).length, 0);
  assert.equal((await call('POST', '/api/nodes', { body: { type: 'fact' } })).status, 400);
  assert.equal((await call('POST', '/api/nodes', { body: { type: 'banana', title: 'x' } })).status, 400);
});

test('the viewer server refuses foreign hosts, cross-site writes and non-JSON bodies', async (t) => {
  const { dir, port, origin, call } = await serve(t);
  const body = { type: 'note', title: 'planted' };
  const count = () => Object.keys(replay(dir).nodes).length;
  // DNS rebinding: the request arrives with an attacker's host name.
  const rebound = await new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port, path: '/api/graph', headers: { host: `evil.example:${port}` } }, (res) => { res.resume(); resolve(res.statusCode); });
    req.end();
  });
  assert.equal(rebound, 403);
  assert.equal((await call('POST', '/api/nodes', { body, headers: { origin: 'https://evil.example' } })).status, 403);
  assert.equal((await call('POST', '/api/nodes', { body, headers: { 'sec-fetch-site': 'cross-site' } })).status, 403);
  // A form post from another site cannot set a JSON content type or this origin.
  assert.equal((await fetch(origin + '/api/nodes', { method: 'POST', headers: { 'content-type': 'text/plain', origin }, body: JSON.stringify(body) })).status, 415);
  assert.equal((await fetch(origin + '/api/nodes', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).status, 403);
  assert.equal((await call('POST', '/api/nodes', { body: 'x'.repeat(300 * 1024) })).status, 413);
  assert.equal(count(), 0);
  // The same-origin request is fine, and a read never needs an Origin.
  assert.equal((await call('POST', '/api/nodes', { body })).status, 201);
  assert.equal((await fetch(origin + '/api/graph')).status, 200);
});

test('--read-only serves the board but takes no writes, and says so in the snapshot', async (t) => {
  const { dir, origin, call } = await serve(t, { readOnly: true });
  assert.equal((await call('POST', '/api/nodes', { body: { type: 'note', title: 'nope' } })).status, 403);
  assert.equal(Object.keys(replay(dir).nodes).length, 0);
  assert.equal((await (await fetch(origin + '/api/graph')).json()).meta.writable, undefined);
  const open = await serve(t);
  assert.equal((await (await fetch(open.origin + '/api/graph')).json()).meta.writable, true);
});
