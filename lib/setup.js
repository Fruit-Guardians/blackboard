// One-shot project onboarding. This is deliberately infrastructure-only: it
// prepares storage, Claude integration and the viewer, but never chooses work
// for the Agent or writes semantic nodes on its behalf.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ensure, protectBoard, readConfig, setMeta, withLock } from './store.js';
import {
  installHooks, installLauncher, installSkill, resolveNodeBinary,
} from './hooks.js';
import { resolvePort, viewerUrl, rememberViewerPort, probeViewer } from './service.js';

export const WORKSPACE_SERVICE_LABEL = 'com.fruitguardians.blackboard.workspace';

function xml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

/** POSIX single-quote escaping, for commands printed to the user. */
function sh(value) {
  return `'${String(value).replaceAll("'", `'\\''`)}'`;
}

export function renderLaunchAgent({ cwd, cli, node = resolveNodeBinary(), port }) {
  port = resolvePort({ cwd, port });
  const log = path.join(os.tmpdir(), 'blackboard-workspace.log');
  const err = path.join(os.tmpdir(), 'blackboard-workspace.err.log');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${WORKSPACE_SERVICE_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xml(node)}</string>
    <string>${xml(cli)}</string>
    <string>serve</string>
    <string>--port</string>
    <string>${Number(port)}</string>
  </array>
  <key>WorkingDirectory</key><string>${xml(cwd)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>BLACKBOARD_CWD</key><string>${xml(cwd)}</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${xml(log)}</string>
  <key>StandardErrorPath</key><string>${xml(err)}</string>
</dict>
</plist>
`;
}

function launchctl(args) {
  try {
    return execFileSync('launchctl', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    const message = error.stderr?.toString().trim() || error.message;
    const failure = new Error(`launchctl ${args[0]} 失败: ${message}`);
    failure.status = error.status;
    throw failure;
  }
}

function workspaceServiceFile() {
  return path.join(os.homedir(), 'Library', 'LaunchAgents', `${WORKSPACE_SERVICE_LABEL}.plist`);
}

function plistString(raw, key) {
  const value = new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`).exec(raw)?.[1];
  return value === undefined ? null : value.replace(/&(amp|lt|gt|quot|apos);/g, (_, entity) =>
    ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" })[entity]);
}

/** The single shared service can belong to a different project than the caller. */
export function workspaceServiceStatus({ cwd = process.cwd() } = {}) {
  if (process.platform !== 'darwin') {
    return { mode: 'unsupported', state: 'unsupported', managed: false, cwd: null, currentProject: false,
      message: '此平台不管理持久服务；请手动运行 blackboard serve，停止其前台进程即可。' };
  }
  const file = workspaceServiceFile();
  const exists = fs.existsSync(file);
  const raw = exists ? fs.readFileSync(file, 'utf8') : '';
  const owner = plistString(raw, 'WorkingDirectory');
  const managed = exists && plistString(raw, 'Label') === WORKSPACE_SERVICE_LABEL
    && /<string>[^<]*\/bin\/blackboard\.js<\/string>/.test(raw)
    && raw.includes('<string>serve</string>') && !!owner;
  let loaded = false;
  let running = false;
  try {
    const output = launchctl(['print', `gui/${process.getuid()}/${WORKSPACE_SERVICE_LABEL}`]);
    loaded = true;
    running = /^\s*state\s*=\s*running\s*$/m.test(output);
  } catch (error) {
    if (error.status !== 113 && error.status !== 3) throw error;
  }
  return {
    mode: 'launchd', label: WORKSPACE_SERVICE_LABEL, file, configured: exists, managed, loaded, running,
    state: (exists || loaded) && !managed ? 'unmanaged' : running ? 'running' : loaded ? 'waiting' : exists ? 'stopped' : 'not-installed',
    cwd: managed ? owner : null,
    currentProject: managed && path.resolve(owner) === path.resolve(cwd),
  };
}

/** Stop leaves registration on disk; uninstall removes only our fixed managed plist. */
export function stopWorkspaceService({ cwd = process.cwd(), uninstall = false } = {}) {
  const before = workspaceServiceStatus({ cwd });
  if (before.mode === 'unsupported') return before;
  if (before.state === 'unmanaged') throw new Error(`拒绝修改非本工具受管服务: ${before.file}`);
  if (before.loaded) launchctl(['bootout', `gui/${process.getuid()}/${WORKSPACE_SERVICE_LABEL}`]);
  if (uninstall && before.managed) fs.unlinkSync(before.file);
  return {
    ...before, loaded: false, running: false, state: uninstall || !before.configured ? 'not-installed' : 'stopped',
    configured: uninstall ? false : before.configured,
    managed: uninstall ? false : before.managed,
    removed: uninstall && before.managed,
    message: uninstall ? '受管服务已卸载；黑板数据保持不变。' : '服务已停止；配置和黑板数据保持不变，可用 setup 重新启动。',
  };
}

async function waitForGraph({ cwd, port }, timeoutMs = 6000) {
  const url = viewerUrl(port);
  const deadline = Date.now() + timeoutMs;
  let last = '服务没有响应';
  while (Date.now() < deadline) {
    try {
      const viewer = await probeViewer({ cwd, port });
      if (viewer.state === 'online') {
        const response = await fetch(`${url}/api/graph`, { signal: AbortSignal.timeout(800) });
        if (response.ok) {
          const graph = await response.json();
          return { ok: true, nodes: Object.keys(graph.nodes || {}).length };
        }
        last = `HTTP ${response.status}`;
      } else {
        last = viewer.state === 'other-project'
          ? `端口 ${port} 正在服务其他项目: ${viewer.cwd}`
          : viewer.state;
      }
    } catch (error) {
      last = error.message;
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  throw new Error(`blackboard 服务启动后校验失败: ${last}`);
}

export async function installWorkspaceService({ cwd, cli, port }) {
  port = resolvePort({ cwd, port });
  const url = viewerUrl(port);
  if (process.platform !== 'darwin') {
    return {
      mode: 'manual', url, verified: false,
      // Single quotes survive POSIX shells verbatim; JSON double quotes would
      // still let $var, `cmd`, and $(…) expand inside printed paths.
      command: `BLACKBOARD_CWD=${sh(cwd)} ${sh(resolveNodeBinary())} ${sh(cli)} serve --port ${port}`,
    };
  }

  const previous = workspaceServiceStatus({ cwd });
  if (previous.state === 'unmanaged') throw new Error(`拒绝覆盖非本工具受管服务: ${previous.file}`);
  const file = workspaceServiceFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (previous.loaded) launchctl(['bootout', `gui/${process.getuid()}/${WORKSPACE_SERVICE_LABEL}`]);
  fs.writeFileSync(file, renderLaunchAgent({ cwd, cli, port }));
  // launchd can briefly retain the previous job after bootout and return EIO
  // when the replacement is bootstrapped immediately. Retry the same idempotent
  // registration instead of leaving the viewer offline.
  let bootstrapError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (attempt) await new Promise((resolve) => setTimeout(resolve, 150 * attempt));
    try {
      launchctl(['bootstrap', `gui/${process.getuid()}`, file]);
      bootstrapError = null;
      break;
    } catch (error) {
      bootstrapError = error;
    }
  }
  if (bootstrapError) throw bootstrapError;
  const check = await waitForGraph({ cwd, port });
  return {
    mode: 'launchd', file, label: WORKSPACE_SERVICE_LABEL, url, verified: true, ...check,
    previousCwd: previous.cwd, cwd: path.resolve(cwd),
    switched: !!previous.cwd && path.resolve(previous.cwd) !== path.resolve(cwd),
  };
}

/**
 * Point the existing shared service at `cli` without changing its project or
 * port. A running service restarts so it serves the new code; a stopped one
 * stays stopped.
 */
export async function refreshWorkspaceService({ cli }) {
  const status = workspaceServiceStatus();
  if (status.mode !== 'launchd' || !status.managed) return { ...status, refreshed: false };
  if (!fs.existsSync(status.cwd)) {
    return { ...status, refreshed: false, warning: `服务归属的项目目录已不存在: ${status.cwd}；请在目标项目重新运行 blackboard setup。` };
  }
  if (!status.loaded) {
    fs.writeFileSync(status.file, renderLaunchAgent({ cwd: status.cwd, cli }));
    return { ...status, refreshed: true, restarted: false };
  }
  const result = await installWorkspaceService({ cwd: status.cwd, cli });
  return { ...result, refreshed: true, restarted: true };
}

export async function setupProject({
  cwd,
  cli,
  title = path.basename(cwd),
  port,
  hooks = true,
  skill = true,
  serve = true,
}) {
  const target = path.resolve(cwd);
  if (!fs.statSync(target).isDirectory()) throw new Error(`项目目录不存在: ${target}`);
  port = resolvePort({ cwd: target, port });
  const board = ensure(target);
  protectBoard(target);
  if (title) setMeta({ title: String(title) }, target);

  // Semantic writes remain manual. Recovery hooks do not record tool activity.
  withLock(() => {
    const config = { ...readConfig(target), autoRecord: false };
    fs.writeFileSync(board.config, JSON.stringify(config, null, 2));
  }, target);

  const launcher = installLauncher({ cli, scope: 'user' });
  const skillResult = skill ? installSkill({ cwd: target, cli, scope: 'project', agent: 'claude' }) : null;
  const hooksResult = hooks
    ? installHooks({ cwd: target, write: true, cli, scope: 'project', withActivity: false })
    : null;
  const service = serve ? await installWorkspaceService({ cwd: target, cli, port }) : null;
  rememberViewerPort(target, port);

  return {
    cwd: target,
    title: String(title || ''),
    board: board.root,
    autoRecord: false,
    launcher,
    skill: skillResult,
    hooks: hooksResult ? { file: hooksResult.file, activityCapture: false } : null,
    service,
  };
}
