import fs from 'node:fs/promises';
import path from 'node:path';
import { BlackboardError } from './config.js';

function contains(parent, child) {
  const rel = path.relative(parent, child);
  return !rel || (!path.isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${path.sep}`));
}

/** Real location of a path that may not exist yet: resolve its nearest existing ancestor. */
async function resolved(file) {
  const rest = [];
  for (let current = file; ;) {
    try { return path.join(await fs.realpath(current), ...rest); }
    catch (error) {
      const parent = path.dirname(current);
      if (error.code !== 'ENOENT' || parent === current) throw error;
      rest.unshift(path.basename(current));
      current = parent;
    }
  }
}

/** Where a declared write target really lands. Declarations are relative, '/'-separated and stay under the root. */
async function target(root, declared) {
  const parts = typeof declared === 'string' ? declared.split('/') : [];
  if (!parts.length || declared.includes('\0') || declared.startsWith('/') || parts.some((part) => !part || part === '.' || part === '..')) {
    throw new BlackboardError('WRITE_POLICY', 'The runtime declared a write target outside its board.');
  }
  const file = path.join(root, ...parts);
  try { return await fs.realpath(file); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  // realpath fails alike for a missing file and a dangling symlink; only a missing file may be created here.
  try {
    await fs.lstat(file);
    throw new BlackboardError('WRITE_POLICY', 'A blackboard write target is a dangling symlink.');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  return resolved(file);
}

/**
 * A custom CLI tool must not bypass the host's read-only/workspace-write file policy.
 * The files a write may touch come from the runtime's declared `writeTargets`, not from names known here.
 */
export function writeAuthorizer(ctx) {
  return async (scope, exec, runtime) => {
    const service = ctx.get('sandboxPolicy');
    if (!service) throw new BlackboardError('POLICY_REQUIRED', 'A host sandboxPolicy service is required for writes.');
    const declared = runtime?.capabilities?.writeTargets;
    if (!Array.isArray(declared)) throw new BlackboardError('RUNTIME_INCOMPATIBLE', 'The runtime did not declare its write targets.');
    const root = await fs.realpath(scope.boardRoot);
    const boundaries = [root, ...await Promise.all(declared.map((entry) => target(scope.boardRoot, entry?.path)))];
    const workspace = await fs.realpath(service.resolve({ session: exec.agent.session }).workspaceRoot);
    // Resolve again after filesystem awaits: use the latest mode, not a captured permission.
    const policy = service.resolve({ session: exec.agent.session });
    exec.signal?.throwIfAborted();
    if (policy.mode === 'danger-full-access') return;
    if (policy.mode === 'workspace-write' && boundaries.every((p) => contains(workspace, p))) return;
    throw new BlackboardError('WRITE_POLICY', 'Blackboard writes require a writable host mode and a board inside its workspace.');
  };
}
