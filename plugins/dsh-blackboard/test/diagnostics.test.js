import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { normalizeConfig, snapshotConfig } from '../src/config.js';
import { diagnose } from '../src/diagnostics.js';
import { toolSpecifications } from '../src/tools.js';
import { CliBridge } from '../src/bridge.js';
import { temporary, board, execution, fakeRuntime } from './helpers.js';

const bridge = { runtime: async () => ({ version: '0.6.0' }), run: async () => ({ diagnostics: '' }) };
test('diagnosis works before enablement and never initializes or launches an unbound CLI', async t => {
  const dir = await temporary(t); let launched = false;
  const result = await diagnose(normalizeConfig(), { ...bridge, run: async () => { launched = true; } }, execution(dir));
  assert.equal(result.readOnly, true); assert.equal(result.readyToRead, false);
  assert.equal(result.checks.find(c => c.id === 'project').code, 'NOT_ENABLED');
  assert.match(result.checks.find(c => c.id === 'project').remedy, /配置页/);
  assert.equal(launched, false); assert.deepEqual(await fs.readdir(dir), []);
});
test('diagnosis separates runtime, missing board and missing session failures', async t => {
  const dir = await temporary(t);
  const unavailable = { runtime: async () => { throw Object.assign(new Error('missing'), { code: 'RUNTIME_MISSING' }); } };
  const result = await diagnose(normalizeConfig({ projects: [{ workspace: dir }] }), unavailable, execution(dir));
  assert.deepEqual(result.checks.map(c => c.code), ['RUNTIME_MISSING', 'BOARD_NOT_INITIALIZED']);
  assert.deepEqual(await fs.readdir(dir), []);
  const session = await diagnose(normalizeConfig(), unavailable, { signal: new AbortController().signal });
  assert.equal(session.checks[1].code, 'SESSION_REQUIRED');
});
test('read-only policy is an actionable diagnostic, not a failed read or permission change', async t => {
  const dir = await temporary(t), project = await board(dir);
  const config = normalizeConfig({ projects: [{ workspace: project }] });
  const deny = async () => { throw Object.assign(new Error('read-only'), { code: 'WRITE_POLICY' }); };
  const result = await diagnose(config, bridge, execution(project), deny);
  assert.equal(result.readyToRead, true); assert.equal(result.readyToWrite, false);
  assert.equal(result.checks.at(-1).code, 'WRITE_POLICY');
  assert.equal(await fs.readFile(path.join(project, '.blackboard/events.jsonl'), 'utf8'), '');
  assert.equal((await diagnose(config, bridge, execution(project), async () => {})).readyToWrite, true);
});
test('diagnosis propagates cancellation and missing host policy remains explicit', async t => {
  const dir = await temporary(t), project = await board(dir), signal = AbortSignal.abort();
  await assert.rejects(diagnose(normalizeConfig(), bridge, execution(project, 'a', signal)), { name: 'AbortError' });
  const result = await diagnose(normalizeConfig({ projects: [{ workspace: project }] }), bridge, execution(project));
  assert.equal(result.checks.at(-1).code, 'POLICY_REQUIRED');
});
test('each tool call takes one live config snapshot; changed projects affect the next call', async t => {
  const dir = await temporary(t), a = await board(dir, 'a'), b = await board(dir, 'b');
  let live = [{ workspace: a }], reads = 0;
  const input = { projects: { get: () => { reads++; return live; } } };
  const calls = [];
  const tools = toolSpecifications(() => snapshotConfig(input), { run: async (scope, _args, _signal, _authorize, captured) => { calls.push({ scope, captured }); return { data: {} }; } });
  const status = tools.find(s => s.name === 'blackboard_status');
  await status.execute({}, execution(a));
  live = [{ workspace: b }];
  await status.execute({}, execution(b));
  await assert.rejects(status.execute({}, execution(a)), { code: 'NOT_ENABLED' });
  assert.equal(reads, 3); assert.deepEqual(calls.map(c => c.scope.boardRoot), [a, b]);
  assert.equal(calls[0].captured.projects[0].workspace, a);
});
test('CLI launch retains the captured runtime settings across an in-flight update', async t => {
  const dir = await temporary(t), cli = await fakeRuntime(dir), project = await board(dir);
  let current = normalizeConfig({ runtimeCli: cli, timeoutMs: 1000 });
  const active = new CliBridge(() => current); t.after(() => active.dispose());
  const snapshot = current;
  const pending = active.run({ boardRoot: project, agentId: 'a' }, ['warning'], undefined, async () => {
    current = normalizeConfig({ runtimeCli: '/missing/bin/blackboard.js', timeoutMs: 50 });
  }, snapshot);
  assert.equal((await pending).diagnostics, 'field truncated');
  await assert.rejects(active.runtime(), { code: 'RUNTIME_MISSING' });
});
