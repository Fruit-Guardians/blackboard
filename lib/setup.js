// One-shot project onboarding. This is deliberately infrastructure-only: it
// prepares storage, Claude integration and the viewer, but never chooses work
// for the Agent or writes semantic nodes on its behalf.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ensure, protectBoard, readConfig, setMeta } from './store.js';
import {
  installHooks, installLauncher, installSkill, resolveNodeBinary,
} from './hooks.js';

export const WORKSPACE_SERVICE_LABEL = 'com.fruitguardians.blackboard.workspace';

function xml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

export function renderLaunchAgent({ cwd, cli, node = resolveNodeBinary(), port = 4333 }) {
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

function launchctl(args, { ignore = false } = {}) {
  try {
    return execFileSync('launchctl', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    if (ignore) return '';
    const message = error.stderr?.toString().trim() || error.message;
    throw new Error(`launchctl ${args[0]} 失败: ${message}`);
  }
}

/**
 * Retire older target-specific services installed by earlier prototypes. Their
 * plist is renamed, not deleted, so an operator can recover it if needed.
 */
function retireLegacyLaunchAgents({ cli, keep }) {
  const dir = path.join(os.homedir(), 'Library', 'LaunchAgents');
  const retired = [];
  if (!fs.existsSync(dir)) return retired;
  for (const name of fs.readdirSync(dir)) {
    if (!name.startsWith('com.fruitguardians.blackboard.') || !name.endsWith('.plist')) continue;
    const file = path.join(dir, name);
    if (file === keep) continue;
    let raw = '';
    try { raw = fs.readFileSync(file, 'utf8'); } catch { continue; }
    if (!raw.includes(cli) || !raw.includes('<string>serve</string>')) continue;
    const label = name.slice(0, -'.plist'.length);
    launchctl(['bootout', `gui/${process.getuid()}/${label}`], { ignore: true });
    const backup = `${file}.retired-${Date.now()}`;
    fs.renameSync(file, backup);
    retired.push(backup);
  }
  return retired;
}

async function waitForGraph(url, timeoutMs = 6000) {
  const deadline = Date.now() + timeoutMs;
  let last = '服务没有响应';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${url}/api/graph`, { signal: AbortSignal.timeout(800) });
      if (response.ok) {
        const graph = await response.json();
        return { ok: true, nodes: Object.keys(graph.nodes || {}).length };
      }
      last = `HTTP ${response.status}`;
    } catch (error) {
      last = error.message;
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  throw new Error(`blackboard 服务启动后校验失败: ${last}`);
}

export async function installWorkspaceService({ cwd, cli, port = 4333 }) {
  const url = `http://127.0.0.1:${port}`;
  if (process.platform !== 'darwin') {
    return {
      mode: 'manual', url, verified: false,
      command: `BLACKBOARD_CWD=${JSON.stringify(cwd)} ${JSON.stringify(resolveNodeBinary())} ${JSON.stringify(cli)} serve --port ${port}`,
    };
  }

  const dir = path.join(os.homedir(), 'Library', 'LaunchAgents');
  const file = path.join(dir, `${WORKSPACE_SERVICE_LABEL}.plist`);
  fs.mkdirSync(dir, { recursive: true });
  launchctl(['bootout', `gui/${process.getuid()}/${WORKSPACE_SERVICE_LABEL}`], { ignore: true });
  const retired = retireLegacyLaunchAgents({ cli, keep: file });
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
  const check = await waitForGraph(url);
  return { mode: 'launchd', file, label: WORKSPACE_SERVICE_LABEL, url, verified: true, ...check, retired };
}

export async function setupProject({
  cwd,
  cli,
  title = path.basename(cwd),
  port = 4333,
  hooks = true,
  skill = true,
  serve = true,
}) {
  const target = path.resolve(cwd);
  const board = ensure(target);
  protectBoard(target);
  if (title) setMeta({ title: String(title) }, target);

  // Semantic writes remain manual. Recovery hooks do not record tool activity.
  const config = { ...readConfig(target), autoRecord: false };
  fs.writeFileSync(board.config, JSON.stringify(config, null, 2));

  const launcher = installLauncher({ cli, scope: 'user' });
  const skillResult = skill ? installSkill({ cwd: target, cli, scope: 'project', agent: 'claude' }) : null;
  const hooksResult = hooks
    ? installHooks({ cwd: target, write: true, cli, scope: 'project', withActivity: false })
    : null;
  const service = serve ? await installWorkspaceService({ cwd: target, cli, port }) : null;

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
