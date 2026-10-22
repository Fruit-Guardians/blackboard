import fs from 'node:fs/promises';
import path from 'node:path';
import { BlackboardError } from './config.js';

function inside(parent, child) {
  const rel = path.relative(parent, child);
  return rel === '' || (!path.isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${path.sep}`));
}

async function directory(value) {
  const real = await fs.realpath(value);
  if (!(await fs.stat(real)).isDirectory()) throw new Error(`not a directory: ${value}`);
  return real;
}

/** Bind to the original Session workspace, never the process cwd or an arbitrary model path. */
export async function selectScope(config, exec) {
  exec.signal?.throwIfAborted();
  const session = exec.agent?.session;
  if (!session || typeof session.id !== 'string' || !session.id.trim()
    || typeof session.header?.cwd !== 'string' || !path.isAbsolute(session.header.cwd)) {
    throw new BlackboardError('SESSION_REQUIRED', 'A Session with an absolute original workspace and stable id is required.');
  }
  let original;
  try { original = await directory(session.header.cwd); }
  catch (cause) { throw new BlackboardError('WORKSPACE_MISSING', 'The original Session workspace is unavailable.', { cause }); }
  const candidates = [];
  for (const row of config.projects) {
    // Missing unrelated workspaces do not disable working ones.
    let workspace;
    try { workspace = await directory(row.workspace); } catch { continue; }
    if (inside(workspace, original)) candidates.push({ ...row, workspace });
  }
  candidates.sort((a, b) => b.workspace.length - a.workspace.length);
  if (!candidates.length) throw new BlackboardError('NOT_ENABLED', 'This Session workspace has no configured blackboard project.');
  if (candidates[1]?.workspace === candidates[0].workspace) {
    throw new BlackboardError('AMBIGUOUS_PROJECT', 'Two configured workspaces resolve to the same directory.');
  }
  const row = candidates[0];
  let boardRoot;
  try {
    boardRoot = await directory(row.boardRoot);
    if (!(await fs.stat(path.join(boardRoot, '.blackboard', 'events.jsonl'))).isFile()) throw new Error('events.jsonl is not a file');
  } catch (cause) {
    throw new BlackboardError('BOARD_NOT_INITIALIZED', 'Initialize the configured board explicitly with blackboard init; the plugin does not initialize projects.', { cause });
  }
  exec.signal?.throwIfAborted();
  return { boardRoot, workspace: row.workspace, agentId: `dsh:${session.id}` };
}
