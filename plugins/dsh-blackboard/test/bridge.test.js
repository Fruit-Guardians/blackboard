import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { normalizeConfig } from '../src/config.js';
import { CliBridge, bound } from '../src/bridge.js';
import { temporary, board, fakeRuntime, capabilities } from './helpers.js';

async function fixture(t, overrides = {}) {
  const root = await temporary(t), cli = await fakeRuntime(root), project = await board(root);
  const bridge = new CliBridge(normalizeConfig({ runtimeCli: cli, ...overrides }));
  t.after(() => bridge.dispose());
  return { root, cli, bridge, scope: { boardRoot: project, agentId: 'dsh:test' } };
}

test('parallel calls have separate cwd and never mutate the host environment', async (t) => {
  const { root, bridge, scope } = await fixture(t);
  const other = { boardRoot: await board(root, 'other'), agentId: 'dsh:other' };
  const env = { ...process.env }, cwd = process.cwd();
  const [a, b] = await Promise.all([bridge.run(scope, ['echo', '--', '$(touch nothing); --enter']), bridge.run(other, ['echo'])]);
  assert.equal(a.data.cwd, scope.boardRoot); assert.equal(b.data.cwd, other.boardRoot);
  assert.equal(a.agentId, scope.agentId); assert.equal(b.agentId, other.agentId);
  assert.equal(a.data.args.at(-1), '$(touch nothing); --enter');
  assert.deepEqual({ ...process.env }, env); assert.equal(process.cwd(), cwd);
});

test('root and identity are flags; inherited BLACKBOARD_CWD and BLACKBOARD_AGENT never reach the CLI', async (t) => {
  const { root, bridge, scope } = await fixture(t);
  const saved = { cwd: process.env.BLACKBOARD_CWD, agent: process.env.BLACKBOARD_AGENT };
  t.after(() => {
    for (const [key, value] of [['BLACKBOARD_CWD', saved.cwd], ['BLACKBOARD_AGENT', saved.agent]]) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  process.env.BLACKBOARD_CWD = path.join(root, 'elsewhere'); process.env.BLACKBOARD_AGENT = 'host:inherited';
  const { data } = await bridge.run(scope, bound(['echo', '--json', '--', 'title'], scope, 'write'));
  assert.deepEqual(data.args, ['echo', `--cwd=${scope.boardRoot}`, '--agent=dsh:test', '--no-init', '--json', '--', 'title']);
  assert.equal(data.env.BLACKBOARD_CWD, undefined); assert.equal(data.env.BLACKBOARD_AGENT, undefined);
  assert.equal(data.env.BLACKBOARD_LOCK_TIMEOUT_MS, '3000');
  assert.deepEqual(bound(['show', '--json', '--', 'n1'], scope, 'path'), ['show', `--cwd=${scope.boardRoot}`, '--json', '--', 'n1']);
  assert.deepEqual(bound(['context'], scope, 'read', 'dsh:other'), ['context', `--cwd=${scope.boardRoot}`, '--agent=dsh:other']);
});

test('runtime facts come from capabilities --json, probed once per resolved CLI', async (t) => {
  const { cli, bridge } = await fixture(t);
  const first = await bridge.runtime();
  assert.equal(first.version, '9.9.9-fixture'); assert.equal(first.cli, cli);
  assert.equal(first.real, await fs.realpath(cli));
  assert.deepEqual(first.capabilities.writeTargets, capabilities().writeTargets);
  await fs.writeFile(path.join(path.dirname(cli), 'capabilities.json'), '{}');
  assert.equal((await bridge.runtime()).version, '9.9.9-fixture');
});

for (const [command, code] of [['bad-json', 'INVALID_JSON'], ['scalar', 'INVALID_JSON'], ['failure', 'CLI_FAILED'], ['flood', 'OUTPUT_LIMIT']]) {
  test(`CLI ${command} is diagnosed as ${code}`, async (t) => {
    const { bridge, scope } = await fixture(t, { maxOutputBytes: 1024 });
    await assert.rejects(bridge.run(scope, [command]), { code });
  });
}

test('stderr truncation notices remain visible in successful output', async (t) => {
  const { bridge, scope } = await fixture(t);
  assert.equal((await bridge.run(scope, ['warning'])).diagnostics, 'field truncated');
});

test('pre-spawn authorization failure prevents execution', async (t) => {
  const { bridge, scope } = await fixture(t);
  await assert.rejects(bridge.run(scope, ['echo'], undefined, () => { throw new Error('policy denial'); }), /policy denial/);
});

test('deadline terminates a child and does not retry', async (t) => {
  const { bridge, scope } = await fixture(t, { timeoutMs: 100 });
  await assert.rejects(bridge.run(scope, ['sleep']), { code: 'TIMEOUT' });
});

test('cancellation drains the process', async (t) => {
  const { bridge, scope } = await fixture(t);
  const controller = new AbortController(), task = bridge.run(scope, ['sleep'], controller.signal);
  setTimeout(() => controller.abort(), 80);
  await assert.rejects(task, { code: 'ABORTED' });
});

test('disposal drains active processes and rejects subsequent calls', async (t) => {
  const { bridge, scope } = await fixture(t);
  const task = bridge.run(scope, ['sleep']);
  const checked = assert.rejects(task, { code: 'DISPOSED' });
  await new Promise((resolve) => setTimeout(resolve, 80));
  await bridge.dispose(); await checked;
  await assert.rejects(bridge.run(scope, ['echo']));
});

test('missing runtime and spawn failure have distinct results', async (t) => {
  const { root, cli, scope } = await fixture(t);
  const missing = new CliBridge(normalizeConfig({ runtimeCli: path.join(root, 'missing/bin/blackboard.js') }));
  await assert.rejects(missing.run(scope, ['echo']), { code: 'RUNTIME_MISSING' });
  const bridge = new CliBridge(normalizeConfig({ runtimeCli: cli, nodeExecutable: '/nonexistent-dsh-blackboard-node' }));
  await assert.rejects(bridge.run(scope, ['echo']), { code: 'SPAWN_FAILED' });
});

const { features: _features, ...withoutFeatures } = capabilities();
for (const [label, declared, gap] of [
  ['another capabilities schema', capabilities({ schema: 'blackboard.capabilities.v2' }), /schema blackboard\.capabilities\.v1/],
  ['a missing feature', capabilities({ features: { writeAttribution: true, cwdFlag: true } }), /feature noInit/],
  ['no features at all', withoutFeatures, /feature writeAttribution/],
  ['a changed output schema', capabilities({ outputs: { ...capabilities().outputs, context: { shape: 'object', schema: 'blackboard.context.v3' } } }), /output blackboard\.context\.v2/],
  ['an old optional-node schema', capabilities({ outputs: { ...capabilities().outputs, context: { shape: 'object', schema: 'blackboard.context.v1' } } }), /output blackboard\.context\.v2/],
  ['a missing command', capabilities({ commands: ['status'] }), /command context/],
  ['no write targets', capabilities({ writeTargets: undefined }), /writeTargets/],
]) {
  test(`a runtime with ${label} is incompatible and nothing runs`, async (t) => {
    const root = await temporary(t), cli = await fakeRuntime(root, declared), project = await board(root);
    const bridge = new CliBridge(normalizeConfig({ runtimeCli: cli })); t.after(() => bridge.dispose());
    let authorized = false;
    await assert.rejects(bridge.run({ boardRoot: project, agentId: 'a' }, ['echo'], undefined, () => { authorized = true; }), (error) => error.code === 'RUNTIME_INCOMPATIBLE' && gap.test(error.message));
    assert.equal(authorized, false);
  });
}

test('a CLI without capabilities --json is incompatible, and a failed probe is retried', async (t) => {
  const { cli, bridge, scope } = await fixture(t);
  const declared = await fs.readFile(path.join(path.dirname(cli), 'capabilities.json'), 'utf8');
  await fs.writeFile(path.join(path.dirname(cli), 'capabilities.json'), 'not json');
  await assert.rejects(bridge.run(scope, ['echo']), { code: 'RUNTIME_INCOMPATIBLE' });
  await fs.writeFile(path.join(path.dirname(cli), 'capabilities.json'), declared);
  assert.equal((await bridge.run(scope, ['echo'])).data.cwd, scope.boardRoot);
});
