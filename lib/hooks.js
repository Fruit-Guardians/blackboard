// Claude Code integration. Hooks write raw activity; the Agent writes semantic
// logic nodes. Keeping those layers separate prevents the blackboard from
// becoming a terminal transcript.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  paths, isInitialized, addActivity, addCheckpoint, readConfig, replay,
} from './store.js';
import { buildDigest } from './digest.js';

/** A hook must never hold up the Agent: if another writer has the lock this long, give up. */
const HOOK_LOCK_MS = 1000;

/** Recovery hooks, installed by default: re-inject the digest and checkpoint before compaction. */
export const HOOK_EVENTS = ['SessionStart', 'PreCompact'];
/** Raw tool-call capture is opt-in (`hooks install --with-activity`): it records tool input and output. */
export const ACTIVITY_HOOK_EVENT = 'PostToolUse';
const ALL_HOOK_EVENTS = [...HOOK_EVENTS, ACTIVITY_HOOK_EVENT];

function isOurHook(entry, ev) {
  const raw = JSON.stringify(entry);
  return raw.includes(`hook ${ev}`) && raw.includes('.flow/events.jsonl');
}

/** Tools whose calls become raw activity events. Keep in sync with summarizeTool. */
const TOOL_MATCHER = 'Bash|WebFetch|WebSearch|Write|Edit|Read|Grep|Glob';

function nodeBinary() {
  // fnm exposes the running node through a per-shell "fnm_multishells" path that
  // disappears with the shell. Only in that case swap in fnm's stable "default"
  // alias; every other install keeps the interpreter we are actually running under.
  if (!process.execPath.includes('fnm_multishells')) return process.execPath;
  const base = process.env.FNM_DIR
    || path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'fnm');
  const stable = path.join(base, 'aliases', 'default', 'bin', 'node');
  try {
    if (fs.existsSync(stable)) return stable;
  } catch {}
  return process.execPath;
}

function hookCommand(cli, event) {
  // Two guards, both deliberate:
  //  - hooks run through a shell with a narrower PATH than an interactive one
  //    (node here comes from fnm), so pin the interpreter we are running under;
  //  - a globally installed hook fires in every project, so exit in the shell
  //    when this project has no graph, instead of paying node startup each tool call.
  const dir = '"${CLAUDE_PROJECT_DIR:-$PWD}"';
  return (
    `dir=${dir}; [ -f "$dir/.flow/events.jsonl" ] && ` +
    `BLACKBOARD_CWD="$dir" FLOW_CWD="$dir" exec "${nodeBinary()}" "${cli}" hook ${event} || true`
  );
}

function settingsPathFor({ scope, cwd }) {
  return scope === 'user'
    ? path.join(os.homedir(), '.claude', 'settings.json')
    : path.join(cwd, '.claude', 'settings.json');
}

function skillDirFor({ scope, cwd }) {
  return scope === 'user'
    ? path.join(os.homedir(), '.claude', 'skills', 'blackboard')
    : path.join(cwd, '.claude', 'skills', 'blackboard');
}

export function installHooks({ cwd = process.cwd(), write = false, cli, scope = 'project', withActivity = false }) {
  const settingsPath = settingsPathFor({ scope, cwd });
  let settings = {};
  if (fs.existsSync(settingsPath)) {
    try {
      settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    } catch (e) {
      throw new Error(`无法解析现有设置 ${settingsPath}: ${e.message}`);
    }
  }
  settings.hooks = settings.hooks || {};
  for (const ev of withActivity ? ALL_HOOK_EVENTS : HOOK_EVENTS) {
    const cmd = hookCommand(cli, ev);
    const arr = settings.hooks[ev] = settings.hooks[ev] || [];
    const mine = arr.filter((entry) => isOurHook(entry, ev));
    if (!mine.length) {
      arr.push(ev === ACTIVITY_HOOK_EVENT
        ? { matcher: TOOL_MATCHER, hooks: [{ type: 'command', command: cmd }] }
        : { hooks: [{ type: 'command', command: cmd }] });
    } else if (ev === ACTIVITY_HOOK_EVENT) {
      // Keep an existing install in sync when the captured tool set changes.
      for (const entry of mine) entry.matcher = TOOL_MATCHER;
    }
  }
  // Activity capture is opt-in. A plain install also retires one an older
  // version installed by default, leaving unrelated hooks untouched.
  const removed = [];
  if (!withActivity && settings.hooks[ACTIVITY_HOOK_EVENT]) {
    const entries = settings.hooks[ACTIVITY_HOOK_EVENT];
    const kept = entries.filter((entry) => !isOurHook(entry, ACTIVITY_HOOK_EVENT));
    if (kept.length !== entries.length) removed.push(ACTIVITY_HOOK_EVENT);
    if (kept.length) settings.hooks[ACTIVITY_HOOK_EVENT] = kept;
    else delete settings.hooks[ACTIVITY_HOOK_EVENT];
  }
  const plan = JSON.stringify({ hooks: settings.hooks }, null, 2);
  if (write) {
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    if (fs.existsSync(settingsPath)) {
      fs.writeFileSync(`${settingsPath}.flow-backup`, fs.readFileSync(settingsPath));
    }
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  }
  return { file: settingsPath, plan, write, withActivity, removed };
}

export function uninstallHooks({ cwd = process.cwd(), write = false, scope = 'project' }) {
  const settingsPath = settingsPathFor({ scope, cwd });
  let settings = {};
  if (fs.existsSync(settingsPath)) {
    try {
      settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    } catch (e) {
      throw new Error(`无法解析现有设置 ${settingsPath}: ${e.message}`);
    }
  }
  settings.hooks = settings.hooks || {};
  for (const ev of ALL_HOOK_EVENTS) {
    const entries = settings.hooks[ev] || [];
    settings.hooks[ev] = entries.filter((entry) => !isOurHook(entry, ev));
    if (!settings.hooks[ev].length) delete settings.hooks[ev];
  }
  const plan = JSON.stringify({ hooks: settings.hooks }, null, 2);
  if (write) {
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    if (fs.existsSync(settingsPath)) {
      fs.writeFileSync(`${settingsPath}.blackboard-backup`, fs.readFileSync(settingsPath));
    }
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  }
  return { file: settingsPath, plan, write };
}

const SKILL_MD = `---
name: blackboard
description: 维护 Agent 外置黑板。记录值得跨上下文保留的逻辑节点、关系和当前游标；不规定 Agent 的探索顺序。
---

# blackboard — Agent 可读写的外置黑板

\`blackboard\` 是纯数据层和外置工作记忆，不是工作流引擎。它不得决定、批准、阻断或改变 Agent 的行动。Agent 始终自由探索；黑板只记录：

1. 关键逻辑节点；
2. 节点之间的显式关系；
3. Agent 当前所在节点和最近轨迹；
4. 上下文压缩检查点。

## 什么时候写

Agent 在形成重要决策、得到可复核结果、确认结论、切换主要方向或准备交接时，显式调用 blackboard。普通工具调用、过程日志和没有改变判断的输出不需要写成逻辑节点。

## 记录原则

只记录会改变判断、分支状态或后续决策的信息。一个节点只表达一个主要判断；标题保持可扫描，建议不超过 60 个中文字符，参数、证据、过程和复测说明写入 \`--detail\`。Hook 只是可选的恢复辅助（会话开始时注入 digest、压缩前存检查点），不是正常使用所必需；是否写黑板始终由 Agent 决定。

- 新建节点默认不连边，也不移动游标：\`blackboard node add <kind> "标题"\`
- 新建并进入：\`blackboard node add hypothesis "猜测" --enter\`
- 与当前节点建立弱关系：\`blackboard node add question "问题" --relate-here\`
- 明确关系：\`blackboard link <from> <to> --rel supports\`，读作“from supports to”（例如 \`link 结论 前提 --rel derived-from\` 表示结论派生自前提）
- 只移动游标：\`blackboard cursor <id> --reason "为什么切换"\`
- 查看当前位置：\`blackboard here\`
- 建立检查点：\`blackboard checkpoint --summary "当前现场"\`
- 检查上下文质量：\`blackboard lint\`（只提示，永不拦截）

节点类型只是视觉和语义提示，不构成状态机。可以使用 start / goal / intent / observation / fact / hypothesis / question / action / result / finding / vuln / hint / summary / note，也允许自定义类型。

关系可以使用 related-to / derived-from / supports / contradicts / depends-on / proves / caused-by / refines / duplicates，也允许自定义关系。

## 重要边界

- 创建 intent 不会自动移动游标。
- 游标移动不会自动创建逻辑边。
- 当前节点不是新节点的隐式父节点。
- 原始工具活动不是逻辑事实。
- Digest 只恢复现场，不替 Agent 决定下一步。
- blackboard 的任何提示都不构成执行前置条件；先行动还是先记录由 Agent 自主决定。
- 新结论取代旧结论时，保留历史并用 supersedes 关系连接，再把旧节点标为 superseded。
- 正式 finding/vuln 应用 supports 或 proves 关系连接证据，但探索过程不受固定顺序约束。

## 兼容简写

\`blackboard goal\`、\`blackboard intent\`、\`blackboard fact\`、\`blackboard vuln\`、\`blackboard hint\` 仍可用；需要立即进入新节点时显式添加 \`--enter\`。

## 命令位置

1. \`blackboard\`
2. \`node "__FLOW_CLI__"\`

## 查看

- \`blackboard status\` — 黑板概览
- \`blackboard here\` — 当前节点、邻域与轨迹
- \`blackboard digest --write\` — 写入恢复摘要
- \`blackboard serve --open\` — 实时大图
- \`blackboard export\` — 单文件离线视图
`;

export function installSkill({ cwd = process.cwd(), cli, scope = 'project' }) {
  const dir = skillDirFor({ scope, cwd });
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), SKILL_MD.replace('__FLOW_CLI__', cli));
  return `已安装 skill（${scope}）: ${path.join(dir, 'SKILL.md')}\nCLI: "${nodeBinary()}" "${cli}"`;
}

/**
 * A `blackboard` launcher on PATH, so the agent can call `blackboard fact "..."` the way the
 * skill describes instead of typing a long node path.
 */
export function installLauncher({ cli, scope = 'user' }) {
  const dir =
    scope === 'user'
      ? path.join(os.homedir(), '.local', 'bin')
      : path.join(process.cwd(), '.bin');
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, 'blackboard');
  const body = `#!/bin/sh\nexec "${nodeBinary()}" "${cli}" "$@"\n`;
  fs.writeFileSync(target, body, { mode: 0o755 });
  const onPath = (process.env.PATH || '').split(path.delimiter).includes(dir);
  return { file: target, dir, onPath };
}

function summarizeTool(payload) {
  const tool = payload.tool_name || payload.tool || 'tool';
  const input = payload.tool_input || payload.toolInput || {};
  if (tool === 'Bash') return { title: `$ ${String(input.command || '').slice(0, 240)}`, tag: 'bash' };
  if (tool === 'WebFetch') return { title: `GET ${String(input.url || '')}`.slice(0, 300), tag: 'http' };
  if (tool === 'WebSearch') return { title: `search: ${String(input.query || '')}`.slice(0, 300), tag: 'search' };
  if (tool === 'Write' || tool === 'Edit') {
    const p = String(input.file_path || input.filePath || '');
    return { title: `${tool} ${path.basename(p)}`, tag: 'file', at: p };
  }
  // Read/Grep/Glob are how a code audit actually moves: the file and the query
  // are the evidence, and the file is a jump target.
  if (tool === 'Read') {
    const p = String(input.file_path || input.filePath || '');
    return { title: `read ${path.basename(p)}`, tag: 'read', at: p };
  }
  if (tool === 'Grep') {
    const q = String(input.pattern || '');
    const where = input.path ? ` in ${path.basename(String(input.path))}` : '';
    // A search has no single line; the query is the evidence.
    return { title: `grep ${q}`.slice(0, 200) + where, tag: 'grep', at: null };
  }
  if (tool === 'Glob') {
    return { title: `glob ${String(input.pattern || '')}`.slice(0, 200), tag: 'glob' };
  }
  return { title: `${tool}`, tag: 'tool' };
}

function toolResultText(payload) {
  const r = payload.tool_response ?? payload.tool_result ?? payload.result;
  if (r == null) return '';
  if (typeof r === 'string') return r;
  if (typeof r === 'object') {
    if (typeof r.stdout === 'string' || typeof r.stderr === 'string') {
      return [r.stdout, r.stderr].filter(Boolean).join('\n');
    }
    if (Array.isArray(r.content)) {
      return r.content.map((c) => (typeof c === 'string' ? c : c?.text || '')).join('\n');
    }
    if (typeof r.output === 'string') return r.output;
  }
  return '';
}

const SECRET_NAME = '[\\w.-]*(?:secret|token|passw(?:or)?d|pwd|api[_-]?key|access[_-]?key|private[_-]?key|credential|cookie)[\\w.-]*';

/** Best-effort scrubbing of what the opt-in activity capture stores. */
export function redactSensitive(value) {
  return String(value || '')
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g, '[REDACTED PRIVATE KEY]')
    .replace(/(authorization["']?\s*[:=]\s*["']?(?:bearer|basic)\s+)[^\s"']+/gi, '$1[REDACTED]')
    // user:password@host in connection strings and URLs
    .replace(/(\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:)[^\s@/]+@/gi, '$1[REDACTED]@')
    // JSON / env / header style: password: x, "api_key":"x", AWS_SECRET_ACCESS_KEY=x
    .replace(new RegExp(`(${SECRET_NAME}["']?\\s*[:=]\\s*["']?)(?!\\[REDACTED)[^\\s,;"'&}]+`, 'gi'), '$1[REDACTED]')
    .replace(/([?&](?:access_token|api_key|token)=)[^&\s]+/gi, '$1[REDACTED]')
    // well-known token shapes, wherever they appear
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{16,}|xox[baprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16})\b/g, '[REDACTED]')
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/g, '[REDACTED JWT]');
}

/** Write/Edit carry whole file contents; the activity log only needs to know which file changed. */
function recordedInput(tool, input) {
  if (['Write', 'Edit', 'MultiEdit', 'NotebookEdit'].includes(tool)) {
    const file = input.file_path || input.filePath || input.notebook_path;
    return file ? { file_path: file } : {};
  }
  return input;
}

/** The blackboard's own CLI calls are already the record; capturing them would only duplicate node text. */
function isBlackboardCall(tool, input) {
  if (tool !== 'Bash') return false;
  const command = String(input.command || '');
  return /(?:^|[;&|(]\s*)(?:\w+=\S*\s+)*(?:\S*\/)?(?:blackboard|flow)(?:\s|$)/.test(command)
    || /\b(?:blackboard|flow)\.js\b/.test(command);
}

export function runHook({ event, payload, cwd = process.cwd(), args = [] }) {
  if (!isInitialized(cwd)) return null;
  const cfg = readConfig(cwd);

  switch (event) {
    case 'SessionStart': {
      // Reinject the digest so a resumed/compacted session starts from the graph.
      const g = replay(cwd);
      if (!Object.keys(g.nodes).length) return null;
      const md = buildDigest(g, cwd);
      return {
        stdout: JSON.stringify({
          hookSpecificOutput: {
            hookEventName: 'SessionStart',
            additionalContext: md,
          },
        }),
        digest: md,
        digestFile: true,
      };
    }

    case 'PreCompact': {
      const summary = payload.summary || payload.compact_summary || args.join(' ');
      const before = buildDigest(replay(cwd), cwd);
      addCheckpoint({
        summary: summary || before.slice(0, 8000),
        trigger: payload.trigger || 'auto',
      }, cwd, { lockTimeoutMs: HOOK_LOCK_MS * 3 });
      const md = buildDigest(replay(cwd), cwd);
      return { digest: md, digestFile: true };
    }

    case 'PostToolUse': {
      if (!cfg.autoRecord) return null;
      const name = payload.tool_name || payload.tool || '';
      if (cfg.autoTools && !cfg.autoTools.includes(name)) return null;
      const toolInput = payload.tool_input || payload.toolInput || {};
      if (isBlackboardCall(name, toolInput)) return null;
      const { title, at } = summarizeTool(payload);
      if (!title || title === '$ ' || title === 'GET ') return null;
      const rawInput = JSON.stringify(recordedInput(name, toolInput));
      const result = toolResultText(payload).slice(0, cfg.detailLimit || 1200);
      const g = replay(cwd);
      const count = Object.keys(g.activities || {}).length;
      if (count >= (cfg.maxActivities || cfg.maxAutoFacts || 4000)) return null;
      const scrub = cfg.redact === false ? (x) => String(x || '') : redactSensitive;
      addActivity({
        tool: name,
        summary: scrub(title),
        input: scrub(rawInput),
        output: scrub(result),
        location: at || null,
      }, cwd, { lockTimeoutMs: HOOK_LOCK_MS });
      return null;
    }

    case 'Stop':
      return null;

    default:
      return null;  }
}
