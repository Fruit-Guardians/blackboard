import os from 'node:os';
import path from 'node:path';

export class BlackboardError extends Error {
  constructor(code, message, options) {
    super(`[${code}] ${message}`, options);
    this.name = 'BlackboardError';
    this.code = code;
  }
}

function absolute(value, label) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || value.includes('\0')) {
    throw new TypeError(`${label} must be an absolute path`);
  }
  return path.resolve(value);
}

function integer(value, fallback, min, max, label) {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < min || result > max) {
    throw new TypeError(`${label} must be an integer in ${min}..${max}`);
  }
  return result;
}

export function normalizeConfig(input = {}, env = process.env) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('config must be an object');
  const allowed = new Set(['runtimeCli', 'nodeExecutable', 'projects', 'timeoutMs', 'maxOutputBytes']);
  for (const key of Object.keys(input)) if (!allowed.has(key)) throw new TypeError(`unknown config field: ${key}`);
  const projects = input.projects ?? [];
  if (!Array.isArray(projects)) throw new TypeError('projects must be an array');
  const seen = new Set();
  const rows = projects.map((row) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new TypeError('project must be an object');
    for (const key of Object.keys(row)) if (!['workspace', 'boardRoot'].includes(key)) throw new TypeError(`unknown project field: ${key}`);
    const workspace = absolute(row.workspace, 'workspace');
    const boardRoot = absolute(row.boardRoot ?? workspace, 'boardRoot');
    if (seen.has(workspace)) throw new TypeError(`duplicate workspace: ${workspace}`);
    seen.add(workspace);
    return Object.freeze({ workspace, boardRoot });
  });
  const dataHome = env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
  return Object.freeze({
    runtimeCli: absolute(input.runtimeCli ?? path.join(dataHome, 'blackboard', 'current', 'bin', 'blackboard.js'), 'runtimeCli'),
    nodeExecutable: absolute(input.nodeExecutable ?? process.execPath, 'nodeExecutable'),
    projects: Object.freeze(rows),
    timeoutMs: integer(input.timeoutMs, 10_000, 50, 120_000, 'timeoutMs'),
    maxOutputBytes: integer(input.maxOutputBytes, 1_048_576, 1024, 16_777_216, 'maxOutputBytes'),
  });
}

/** Read live Cordis fields once per operation; plain configuration remains supported. */
export function snapshotConfig(input = {}) {
  return normalizeConfig(Object.fromEntries(Object.entries(input).map(([key, value]) => [
    key, value && typeof value.get === 'function' ? value.get() : value,
  ])));
}
