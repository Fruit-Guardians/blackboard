import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { normalizeConfig } from '../src/config.js';
import { CliBridge } from '../src/bridge.js';
import { temporary, board, fakeRuntime } from './helpers.js';

async function fixture(t, overrides = {}) {
  const root = await temporary(t), cli = await fakeRuntime(root), project = await board(root);
  const bridge = new CliBridge(normalizeConfig({ runtimeCli: cli, ...overrides }));
  t.after(() => bridge.dispose());
  return { root, cli, bridge, scope: { boardRoot: project, agentId: 'dsh:test' } };
}

test('parallel calls have separate cwd/identity and never mutate the host environment', async (t) => {
  const { root, bridge, scope } = await fixture(t);
  const other = { boardRoot: await board(root, 'other'), agentId: 'dsh:other' };
  const env = { ...process.env }, cwd = process.cwd();
  const [a, b] = await Promise.all([bridge.run(scope, ['echo', '--', '$(touch nothing); --enter']), bridge.run(other, ['echo'])]);
  assert.equal(a.data.agent, scope.agentId); assert.equal(b.data.agent, other.agentId);
  assert.equal(a.data.cwd, scope.boardRoot); assert.equal(b.data.cwd, other.boardRoot);
  assert.equal(a.data.args.at(-1), '$(touch nothing); --enter');
  assert.deepEqual({ ...process.env }, env); assert.equal(process.cwd(), cwd);
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

test('missing runtime, incompatible version, and spawn failure have distinct results', async (t) => {
  const { root, cli, scope } = await fixture(t);
  const missing = new CliBridge(normalizeConfig({ runtimeCli: path.join(root, 'missing/bin/blackboard.js') }));
  await assert.rejects(missing.run(scope, ['echo']), { code: 'RUNTIME_MISSING' });
  const bridge = new CliBridge(normalizeConfig({ runtimeCli: cli, nodeExecutable: '/nonexistent-dsh-blackboard-node' }));
  await assert.rejects(bridge.run(scope, ['echo']), { code: 'SPAWN_FAILED' });
  await fs.writeFile(path.join(root, 'runtime/package.json'), '{"name":"blackboard","version":"99.0.0"}');
  await assert.rejects(bridge.run(scope, ['echo']), { code: 'RUNTIME_VERSION' });
});
