import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { normalizeConfig } from '../src/config.js';
import { selectScope } from '../src/scope.js';
import { temporary, board, execution } from './helpers.js';

test('default runtime uses current and no project is enabled implicitly', () => {
  const c = normalizeConfig({}, { XDG_DATA_HOME: '/fixture/data' });
  assert.equal(c.runtimeCli, '/fixture/data/blackboard/current/bin/blackboard.js');
  assert.deepEqual(c.projects, []);
  assert.ok(Object.isFrozen(c.projects));
});

for (const input of [null, [], { autoInit: true }, { projects: {} }, { runtimeCli: 'relative' }, { timeoutMs: 0 }, { maxOutputBytes: Infinity }, { projects: [{ workspace: '/x', typo: true }] }, { projects: [{ workspace: '/x' }, { workspace: '/x' }] }]) {
  test(`reject invalid configuration ${JSON.stringify(input)}`, () => assert.throws(() => normalizeConfig(input)));
}

test('Session is mandatory; there is no process cwd fallback', async () => {
  await assert.rejects(selectScope(normalizeConfig(), { signal: new AbortController().signal }), { code: 'SESSION_REQUIRED' });
});

test('empty configuration and uninitialized boards have no filesystem side effects', async (t) => {
  const root = await temporary(t);
  const project = path.join(root, 'empty');
  await fs.mkdir(project);
  await assert.rejects(selectScope(normalizeConfig(), execution(project)), { code: 'NOT_ENABLED' });
  await assert.rejects(selectScope(normalizeConfig({ projects: [{ workspace: project }] }), execution(project)), { code: 'BOARD_NOT_INITIALIZED' });
  assert.deepEqual(await fs.readdir(project), []);
});

test('original workspace anchors the board and each Session has its own identity', async (t) => {
  const root = await temporary(t), a = await board(root, 'a'), b = await board(root, 'b');
  const config = normalizeConfig({ projects: [{ workspace: a }, { workspace: b }] });
  const exec = execution(a);
  exec.agent.session.currentDirectory = b;
  assert.deepEqual(await selectScope(config, exec), { boardRoot: a, workspace: a, agentId: 'dsh:session-a' });
  assert.equal((await selectScope(config, execution(b, 'child'))).agentId, 'dsh:child');
});

test('nested project takes precedence; sibling prefix is not containment', async (t) => {
  const root = await temporary(t), parent = await board(root, 'repo'), nested = await board(parent, 'child'), sibling = await board(root, 'repo-extra');
  const config = normalizeConfig({ projects: [{ workspace: parent }, { workspace: nested }] });
  assert.equal((await selectScope(config, execution(nested))).boardRoot, nested);
  await assert.rejects(selectScope(config, execution(sibling)), { code: 'NOT_ENABLED' });
});

test('subdirectory Session finds only its explicit configured board, not a new child board', async (t) => {
  const root = await temporary(t), parent = await board(root), child = await board(parent, 'child');
  assert.equal((await selectScope(normalizeConfig({ projects: [{ workspace: parent }] }), execution(child))).boardRoot, parent);
});

test('symlink aliases cannot silently choose different boards', async (t) => {
  const root = await temporary(t), a = await board(root), alias = path.join(root, 'alias');
  await fs.symlink(a, alias);
  const c = normalizeConfig({ projects: [{ workspace: a }, { workspace: alias }] });
  await assert.rejects(selectScope(c, execution(a)), { code: 'AMBIGUOUS_PROJECT' });
});

test('explicit boardRoot and missing unrelated workspace are supported', async (t) => {
  const root = await temporary(t), a = await board(root, 'a'), b = await board(root, 'b');
  const config = normalizeConfig({ projects: [{ workspace: '/nonexistent-dsh-blackboard' }, { workspace: a, boardRoot: b }] });
  assert.equal((await selectScope(config, execution(a))).boardRoot, b);
});
