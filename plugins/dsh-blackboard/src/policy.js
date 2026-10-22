import fs from 'node:fs/promises';
import path from 'node:path';
import { BlackboardError } from './config.js';

function contains(parent, child) {
  const rel = path.relative(parent, child);
  return !rel || (!path.isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${path.sep}`));
}

/** A custom CLI tool must not bypass the host's read-only/workspace-write file policy. */
export function writeAuthorizer(ctx) {
  return async (scope, exec) => {
    const service = ctx.get('sandboxPolicy');
    if (!service) throw new BlackboardError('POLICY_REQUIRED', 'A host sandboxPolicy service is required for writes.');
    const boundaries = await Promise.all([
      fs.realpath(scope.boardRoot),
      fs.realpath(path.join(scope.boardRoot, '.blackboard')),
      fs.realpath(path.join(scope.boardRoot, '.blackboard', 'events.jsonl')),
    ]);
    // The 0.6 runtime also creates a lock and atomically replaces its cache through this temp file.
    for (const name of ['state.json.tmp', 'lock']) {
      try {
        if ((await fs.lstat(path.join(scope.boardRoot, '.blackboard', name))).isSymbolicLink()) {
          throw new BlackboardError('WRITE_POLICY', 'Blackboard lock/cache write targets must not be symlinks.');
        }
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    const workspace = await fs.realpath(service.resolve({ session: exec.agent.session }).workspaceRoot);
    // Resolve again after filesystem awaits: use the latest mode, not a captured permission.
    const policy = service.resolve({ session: exec.agent.session });
    exec.signal?.throwIfAborted();
    if (policy.mode === 'danger-full-access') return;
    if (policy.mode === 'workspace-write' && boundaries.every((p) => contains(workspace, p))) return;
    throw new BlackboardError('WRITE_POLICY', 'Blackboard writes require a writable host mode and a board inside its workspace.');
  };
}
