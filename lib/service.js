import fs from 'node:fs';
import path from 'node:path';
import { paths, readConfig, withLock } from './store.js';

export const DEFAULT_PORT = 4333;

function validatePort(value, allowZero = false) {
  if ((typeof value !== 'number' && typeof value !== 'string')
    || (typeof value === 'string' && !/^\d+$/.test(value))
    || !Number.isInteger(Number(value))
    || Number(value) < (allowZero ? 0 : 1)
    || Number(value) > 65535) {
    throw new Error(`无效的端口: ${String(value)}；应为 ${allowZero ? '0' : '1'}–65535 的整数`);
  }
  return Number(value);
}

/** Explicit flags, BLACKBOARD_PORT, project config, then the default. */
export function resolvePort({ cwd = process.cwd(), port, env = process.env, allowZero = false } = {}) {
  let value = port !== undefined ? port : env.BLACKBOARD_PORT;
  if (value === undefined) value = readConfig(cwd).viewerPort;
  return validatePort(value === undefined ? DEFAULT_PORT : value, allowZero);
}

export function viewerUrl(port) {
  return `http://127.0.0.1:${validatePort(port)}`;
}

/** Store only the selected port alongside the existing project configuration. */
export function rememberViewerPort(cwd, port) {
  const viewerPort = validatePort(port);
  const file = paths(cwd).config;
  withLock(() => {
    const config = { ...readConfig(cwd), viewerPort };
    fs.writeFileSync(file, JSON.stringify(config, null, 2));
  }, cwd);
  return viewerPort;
}

/** A reachable HTTP listener is not necessarily this project's blackboard. */
export async function probeViewer({ cwd = process.cwd(), port } = {}) {
  port = resolvePort({ cwd, port });
  const viewer = { port, url: viewerUrl(port), state: 'offline', cwd: null, readOnly: null };
  let response;
  try {
    response = await fetch(`${viewer.url}/api/status`, {
      signal: AbortSignal.timeout(800), redirect: 'error',
    });
  } catch {
    return viewer;
  }
  viewer.state = 'unrecognized';
  try {
    if (!response.ok) return viewer;
    const status = await response.json();
    if (!status || typeof status.cwd !== 'string' || !path.isAbsolute(status.cwd)
      || typeof status.readOnly !== 'boolean') return viewer;
    const actual = fs.realpathSync(status.cwd);
    viewer.cwd = actual;
    viewer.readOnly = status.readOnly;
    viewer.state = actual === fs.realpathSync(cwd) ? 'online' : 'other-project';
  } catch {
    // Invalid JSON, an unknown identity, or a disappearing service stays unrecognized.
  }
  return viewer;
}
