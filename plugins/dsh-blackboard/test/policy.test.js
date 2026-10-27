import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { writeAuthorizer } from '../src/policy.js';
import { temporary, board, execution, capabilities } from './helpers.js';

const runtime = (overrides) => ({ capabilities: capabilities(overrides) });

test('missing policy and read-only mode do not authorize a write', async (t) => {
  const root = await temporary(t), project = await board(root), scope = { boardRoot: project };
  await assert.rejects(writeAuthorizer({ get: () => undefined })(scope, execution(project), runtime()), { code: 'POLICY_REQUIRED' });
  await assert.rejects(writeAuthorizer({ get: () => ({ resolve: () => ({ mode: 'read-only', workspaceRoot: project }) }) })(scope, execution(project), runtime()), { code: 'WRITE_POLICY' });
});

test('workspace-write confines configured boards and follows realpath boundaries', async (t) => {
  const root = await temporary(t), project = await board(root, 'a'), outside = await board(root, 'b');
  const authorize = writeAuthorizer({ get: () => ({ resolve: () => ({ mode: 'workspace-write', workspaceRoot: project }) }) });
  await authorize({ boardRoot: project }, execution(project), runtime());
  await assert.rejects(authorize({ boardRoot: outside }, execution(project), runtime()), { code: 'WRITE_POLICY' });
  await fs.rm(path.join(project, '.blackboard'), { recursive: true });
  await fs.symlink(path.join(outside, '.blackboard'), path.join(project, '.blackboard'));
  await assert.rejects(authorize({ boardRoot: project }, execution(project), runtime()), { code: 'WRITE_POLICY' });
});

test('latest host policy is consulted again immediately before execution', async (t) => {
  const root = await temporary(t), project = await board(root);
  let reads = 0;
  const authorize = writeAuthorizer({ get: () => ({ resolve: () => ({ mode: ++reads === 1 ? 'workspace-write' : 'read-only', workspaceRoot: project }) }) });
  await assert.rejects(authorize({ boardRoot: project }, execution(project), runtime()), { code: 'WRITE_POLICY' });
  assert.equal(reads, 2);
});

const workspaceWrite = (project) => writeAuthorizer({ get: () => ({ resolve: () => ({ mode: 'workspace-write', workspaceRoot: project }) }) });

test('a declared target that is a dangling symlink is refused', async (t) => {
  const root = await temporary(t), project = await board(root), authorize = workspaceWrite(project);
  await fs.symlink(path.join(root, 'external'), path.join(project, '.blackboard/state.json.tmp'));
  await assert.rejects(authorize({ boardRoot: project }, execution(project), runtime()), { code: 'WRITE_POLICY' });
});

test('a declared target that resolves outside the workspace is refused, inside it is allowed', async (t) => {
  const root = await temporary(t), project = await board(root, 'a'), authorize = workspaceWrite(project);
  await fs.writeFile(path.join(root, 'outside.json'), '{}');
  await fs.writeFile(path.join(project, 'inside.json'), '{}');
  const state = path.join(project, '.blackboard/state.json');
  await fs.symlink(path.join(project, 'inside.json'), state);
  await authorize({ boardRoot: project }, execution(project), runtime());
  await fs.rm(state); await fs.symlink(path.join(root, 'outside.json'), state);
  await assert.rejects(authorize({ boardRoot: project }, execution(project), runtime()), { code: 'WRITE_POLICY' });
});

test('write targets follow the runtime declaration, not file names known to the adapter', async (t) => {
  const root = await temporary(t), project = await board(root), authorize = workspaceWrite(project);
  // A release that renames its lock and keeps its cache in another directory.
  const renamed = runtime({ writeTargets: [
    { path: '.blackboard/events.jsonl', role: 'log' }, { path: '.blackboard/mutex', role: 'lock' },
    { path: '.blackboard/cache/state.v2.json', role: 'cache' },
  ] });
  await fs.symlink(path.join(root, 'external'), path.join(project, '.blackboard/lock'));
  await authorize({ boardRoot: project }, execution(project), renamed);
  await fs.symlink(path.join(root, 'external'), path.join(project, '.blackboard/mutex'));
  await assert.rejects(authorize({ boardRoot: project }, execution(project), renamed), { code: 'WRITE_POLICY' });
  await fs.rm(path.join(project, '.blackboard/mutex'));
  await fs.mkdir(path.join(root, 'elsewhere'));
  await fs.symlink(path.join(root, 'elsewhere'), path.join(project, '.blackboard/cache'));
  await assert.rejects(authorize({ boardRoot: project }, execution(project), renamed), { code: 'WRITE_POLICY' });
});

test('declarations that escape the board or are missing are refused', async (t) => {
  const root = await temporary(t), project = await board(root), authorize = workspaceWrite(project);
  for (const bad of ['../events.jsonl', '/etc/passwd', '.blackboard//lock', '', undefined]) {
    await assert.rejects(authorize({ boardRoot: project }, execution(project), runtime({ writeTargets: [{ path: bad, role: 'log' }] })), { code: 'WRITE_POLICY' }, String(bad));
  }
  await assert.rejects(authorize({ boardRoot: project }, execution(project), undefined), { code: 'RUNTIME_INCOMPATIBLE' });
});
