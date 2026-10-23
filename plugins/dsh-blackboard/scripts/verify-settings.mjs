// Exercise the real Host settings service, persistence, revision fencing and live tools.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { normalizeConfig } from '../src/config.js';
const exec = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
const fixture = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-blackboard-settings-'));
const project = path.join(fixture, 'project');
const runtimeCli = normalizeConfig({ runtimeCli: process.env.BLACKBOARD_TEST_CLI }).runtimeCli;
const env = { ...process.env, DSH_HOME: path.join(fixture, 'home'), DSH_TELEMETRY_DISABLED: '1' };
const dsh = process.env.DSH_BIN || 'dsh';
const run = (command, args, extra = {}) => exec(command, args, { cwd: root, env: { ...env, ...extra }, timeout: 60_000, maxBuffer: 2_097_152 });
try {
  await fs.mkdir(project);
  await fs.writeFile(path.join(project, '.git'), 'gitdir: fixture\n');
  await run(process.execPath, [runtimeCli, 'init', '--here', '--json'], { BLACKBOARD_CWD: project });
  const before = await fs.readFile(path.join(project, '.blackboard/events.jsonl'));
  const observer = path.join(fixture, 'observer.mjs');
  await fs.writeFile(observer, `
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
export const name = 'blackboard-settings-probe';
export const inject = ['tools', 'skills', 'settings', 'configEditor', 'agentLoop', 'appReady', 'appExit'];
export function apply(ctx, config) {
  ctx.effect(() => ctx.appReady.onReady(() => {
    (async () => {
      const descriptor = () => ctx.settings.describe().find(item => item.ns === 'blackboard');
      let current = descriptor();
      const fiber = () => ctx.configEditor.configuration().find(item => item.entry.options.id === 'blackboard').entry.fiber;
      const originalFiber = fiber();
      assert.ok(current, 'blackboard settings form must be exposed');
      const agent = await ctx.agentLoop.create('settings-probe-' + process.env.BLACKBOARD_SETTINGS_PHASE, {}, { cwd: config.project });
      agent.session.append('sandbox/mode', { mode: 'read-only' });
      let serial = 0;
      const call = () => ctx.tools.execute({ callId: 'diagnose-' + ++serial, name: 'blackboard_diagnose', arguments: {}, agent, signal: new AbortController().signal });
      if (process.env.BLACKBOARD_SETTINGS_PHASE === 'write') {
        const unconfigured = await call();
        assert.ok(!unconfigured.isError, JSON.stringify(unconfigured));
        assert.equal(unconfigured.value.readyToRead, false);
        assert.ok(unconfigured.value.checks.some(c => c.code === 'NOT_ENABLED'));
        await ctx.settings.update('blackboard', { projects: [{ workspace: config.project }], runtimeCli: config.runtimeCli, timeoutMs: 12000 }, current.revision);
        current = descriptor();
        assert.equal(fiber(), originalFiber, 'volatile edit must retain the plugin instance');
        assert.equal(current.value.timeoutMs, 12000);
        const patch = await fs.readFile(ctx.settings.documentPath, 'utf8');
        for (const bad of [{ timeoutMs: 1 }, { timeoutMs: 1.5 }, { runtimeCli: 'relative' }, { projects: [{ workspace: config.project }, { workspace: config.project }] }]) {
          await assert.rejects(ctx.settings.update('blackboard', bad, current.revision));
          assert.equal(await fs.readFile(ctx.settings.documentPath, 'utf8'), patch);
        }
        await assert.rejects(ctx.settings.update('blackboard', { timeoutMs: 9000 }, current.revision - 1), { code: 'SETTINGS_CONFLICT' });
        assert.equal(await fs.readFile(ctx.settings.documentPath, 'utf8'), patch);
      }
      const result = await call();
      assert.ok(!result.isError, JSON.stringify(result));
      assert.equal(result.value.readyToRead, true);
      assert.equal(result.value.readyToWrite, false);
      assert.ok(result.value.checks.some(c => c.code === 'WRITE_POLICY'));
      assert.equal(result.meta.blackboard.schema, 'blackboard.card.v1');
      assert.equal(result.meta.blackboard.readyToRead, true);
      assert.equal(descriptor().value.timeoutMs, 12000);
      console.log('DSH_SETTINGS_' + process.env.BLACKBOARD_SETTINGS_PHASE.toUpperCase() + ': form, revision fence, validation, live diagnosis and persisted config PASS');
      ctx.appExit(0);
    })().catch(error => { console.error(error); ctx.appExit(1); });
  }));
}
`);
  const patch = path.join(fixture, 'probe.patch.yml');
  await fs.writeFile(patch, JSON.stringify([{ insert: [{ id: 'settings-probe', name: observer, config: { project, runtimeCli } }] }]));
  const profile = 'blackboard-settings';
  await run(dsh, ['plugin', '--profile', profile, 'add', process.env.DSH_PLUGIN_PACKAGE || root, '--ignore-scripts', '--config.auto-install-peers=false']);
  for (const phase of ['write', 'restart']) {
    const result = await run(dsh, ['--profile', profile, '--patch', patch], { BLACKBOARD_SETTINGS_PHASE: phase });
    assert.match(result.stdout, /DSH_SETTINGS_.* PASS/); process.stdout.write(result.stdout);
  }
  assert.deepEqual(await fs.readFile(path.join(project, '.blackboard/events.jsonl')), before);
  console.log('DSH_SETTINGS: save, next-call update, invalid/stale refusal, restart recovery; events unchanged PASS');
} finally { await fs.rm(fixture, { recursive: true, force: true }); }
