import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { writeAuthorizer } from '../src/policy.js';
import { temporary, board, execution } from './helpers.js';

test('missing policy and read-only mode do not authorize a write', async (t) => {
  const root = await temporary(t), project = await board(root), scope = { boardRoot: project };
  await assert.rejects(writeAuthorizer({ get: () => undefined })(scope, execution(project)), { code: 'POLICY_REQUIRED' });
  await assert.rejects(writeAuthorizer({ get: () => ({ resolve: () => ({ mode: 'read-only', workspaceRoot: project }) }) })(scope, execution(project)), { code: 'WRITE_POLICY' });
});

test('workspace-write confines configured boards and follows realpath boundaries', async (t) => {
  const root = await temporary(t), project = await board(root, 'a'), outside = await board(root, 'b');
  const authorize = writeAuthorizer({ get: () => ({ resolve: () => ({ mode: 'workspace-write', workspaceRoot: project }) }) });
  await authorize({ boardRoot: project }, execution(project));
  await assert.rejects(authorize({ boardRoot: outside }, execution(project)), { code: 'WRITE_POLICY' });
  await fs.rm(path.join(project, '.blackboard'), { recursive: true });
  await fs.symlink(path.join(outside, '.blackboard'), path.join(project, '.blackboard'));
  await assert.rejects(authorize({ boardRoot: project }, execution(project)), { code: 'WRITE_POLICY' });
});

test('latest host policy is consulted again immediately before execution', async (t) => {
  const root = await temporary(t), project = await board(root);
  let reads = 0;
  const authorize = writeAuthorizer({ get: () => ({ resolve: () => ({ mode: ++reads === 1 ? 'workspace-write' : 'read-only', workspaceRoot: project }) }) });
  await assert.rejects(authorize({ boardRoot: project }, execution(project)), { code: 'WRITE_POLICY' });
  assert.equal(reads, 2);
});

test('pre-existing lock/cache temp symlinks do not become subprocess write targets', async (t) => {
  const root = await temporary(t), project = await board(root);
  const authorize = writeAuthorizer({ get: () => ({ resolve: () => ({ mode: 'workspace-write', workspaceRoot: project }) }) });
  await fs.symlink(path.join(root, 'external'), path.join(project, '.blackboard/state.json.tmp'));
  await assert.rejects(authorize({ boardRoot: project }, execution(project)), { code: 'WRITE_POLICY' });
});
