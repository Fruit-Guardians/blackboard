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
async function inspectViewer({ cwd = process.cwd(), port } = {}) {
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
    if (Number.isSafeInteger(status.pid) && status.pid > 1) viewer.pid = status.pid;
    viewer.state = actual === fs.realpathSync(cwd) ? 'online' : 'other-project';
  } catch {
    // Invalid JSON, an unknown identity, or a disappearing service stays unrecognized.
  }
  return viewer;
}

export async function probeViewer(options) {
  const { pid: _pid, ...viewer } = await inspectViewer(options);
  return viewer;
}

/** Stop this project's viewer; a listener that does not identify as this project is left alone. */
export async function stopViewer({ cwd = process.cwd(), port, timeoutMs = 5000 } = {}) {
  const { pid, ...viewer } = await inspectViewer({ cwd, port });
  const result = { via: null, port: viewer.port, url: viewer.url };
  if (viewer.state === 'offline') return { ...result, state: 'not-running' };
  if (viewer.state === 'other-project') {
    throw new Error(`端口 ${viewer.port} 服务的是其他项目 ${viewer.cwd}，未停止；要停止它请运行 blackboard stop --cwd "${viewer.cwd}" --port ${viewer.port}`);
  }
  if (viewer.state === 'unrecognized') throw new Error(`端口 ${viewer.port} 上不是可识别的 blackboard 服务，未停止`);
  if (!pid) throw new Error('该查看器由不支持 stop 的旧版本启动，未报告进程号；请在它的终端按 Ctrl+C');
  try {
    process.kill(pid, 'SIGTERM');
  } catch (error) {
    if (error.code !== 'ESRCH') throw new Error(`无法停止进程 ${pid}: ${error.code || error.message}`);
  }
  const deadline = Date.now() + timeoutMs;
  while ((await probeViewer({ cwd, port: viewer.port })).state === 'online') {
    if (Date.now() >= deadline) {
      throw new Error(`已向进程 ${pid} 发送停止信号，但服务仍然在线；若由 launchd 托管，请运行 blackboard service stop`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return { ...result, state: 'stopped', via: 'process' };
}
