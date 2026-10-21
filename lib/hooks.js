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

export function resolveNodeBinary() {
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
    `BLACKBOARD_CWD="$dir" FLOW_CWD="$dir" exec "${resolveNodeBinary()}" "${cli}" hook ${event} || true`
  );
}

function settingsPathFor({ scope, cwd }) {
  return scope === 'user'
    ? path.join(os.homedir(), '.claude', 'settings.json')
    : path.join(cwd, '.claude', 'settings.json');
}

function skillDirFor({ scope, cwd, agent = 'claude' }) {
  if (agent === 'codex') {
    return scope === 'user'
      ? path.join(os.homedir(), '.codex', 'skills', 'blackboard')
      : path.join(cwd, '.agents', 'skills', 'blackboard');
  }
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
description: 当项目已有 .flow/events.jsonl，或用户要求配置、启动、打开、接入或使用 blackboard 时，完成一条龙初始化并维护 Agent 外置黑板；适合长任务、研究、审计、交接和上下文恢复，不用于约束普通任务的执行步骤。
---

# blackboard — 可选的 Agent 外置记忆

blackboard 是数据层，不是工作流引擎。它记录关键判断、显式关系、Agent 游标和检查点，但不批准、阻断、排序或替 Agent 选择行动。黑板调用失败也不应阻止原任务继续。

## 一条龙启用

用户要求为某个项目“配置/启动/打开/接入 blackboard”时，先确定那个项目的根目录，然后只需运行：

\`blackboard setup --target "<项目根目录>" --title "<项目或任务标题>" --open\`

找不到 \`blackboard\` 命令时运行：

\`node "__FLOW_CLI__" setup --target "<项目根目录>" --title "<项目或任务标题>" --open\`

该命令可重复执行，会创建或复用 \`.flow/\`、关闭自动活动记录、安装项目级 Claude Skill、安装仅负责恢复的 Hook，并把持久化可视化服务切换到该项目。不要另装活动采集 Hook；除非用户明确要求，setup 不会记录每次工具调用。

完成后运行 \`blackboard status\` 核对。若黑板为空且用户同时给出了实质任务，可以建立一个目标锚点：

\`blackboard node add goal "<用户要达成的目标>" --enter\`

目标锚点只是记录用户目标，不是执行门槛。若用户仅要求配环境，不要凭空创建研究结论或任务节点。

## 恢复现场

项目存在 \`.flow/events.jsonl\` 时，在需要恢复长期上下文、接手任务或发生压缩后读取：

\`blackboard context --budget 4000\`

需要人类可读摘要时使用 \`blackboard digest\`；需要当前节点及一跳邻域时使用 \`blackboard here\`。\`context\` 和 \`digest\` 都只提供数据，不构成下一步指令。

## 写入阈值

只在信息值得留给未来会话或其他参与者时写入，例如：

- 目标、主要方向或判断发生变化；
- 得到可复核的观察、结果或正式发现；
- 猜测被支持、反驳或取代；
- 切换主要关注点；
- 即将压缩、交接或暂停。

不要把每次命令、读取、成功提示或原始输出写成逻辑节点。原始工具活动只有在项目显式开启活动采集时才进入独立活动层；活动不自动成为事实。

## 代码审计的语义质量

这些规则只约束记录的含义，不规定 Agent 的研究步骤，也不能成为行动前置条件：

- 游标表示“此刻实际继续研究的位置”。方向切换时，把游标移到新的开放问题或猜测；不要因为某个漏洞重要，就长期停在已经收束的结论上。
- 一个开放问题只表达一个可以独立结束的验证事项。多个剩余方向分别建问题节点，再各自关联目标或上游判断。
- 正式 finding/vuln 至少关联一条证据边，并能沿显式关系回到目标。可用事实 \`supports\` 结论，或结论 \`derived-from\` 事实。
- 严重度与可信度分开记录：\`--sev\` 表示影响，\`--confidence suspected|static-confirmed|reproduced|confirmed\` 表示证据成熟度。只有源码推导而未端到端验证的问题不要伪装成已复现。
- 复现或静态核对完成的 fact/observation/result 使用 \`--status confirmed\`，让跨会话恢复能够优先取回确认事实。
- 交接、暂停或完成一轮审计时写 checkpoint；摘要说明已确认内容、正在验证的节点和仍开放的方向。

## 写入操作

- 新建节点，不连边也不移动游标：\`blackboard node add <kind> "标题"\`
- 新建并进入：\`blackboard node add hypothesis "猜测" --enter\`
- 带可信度记录候选结论：\`blackboard node add vuln "标题" --sev high --confidence reproduced\`
- 与当前位置建立默认弱关系：\`blackboard node add question "问题" --relate-here\`
- 写入时顺手声明来源：\`blackboard node add finding "标题" --parent <来源id> --rel derived-from\`（不带 \`--rel\` 时按类型推断）
- 明确关系：\`blackboard link <from> <to> --rel supports\`
- 只移动游标：\`blackboard cursor <id> --reason "切换原因"\`
- 建立恢复锚点：\`blackboard checkpoint --summary "当前现场"\`
- 只读质量提示：\`blackboard lint\`

关系读作“from relation to”。例如证据支持论断使用 \`link <evidence> <claim> --rel supports\`；新结论取代旧结论使用 \`link <new> <old> --rel supersedes\`，再把旧节点标为 \`superseded\`。

节点类型只是语义和视觉提示，不构成状态机。允许自定义节点类型和关系。一个节点表达一个主要判断；标题保持可扫描，参数、证据和复测过程放入 \`--detail\`。

## 让图成为图

黑板只记录显式关系，不会替你猜。节点之间不连边，人类看到的就只是一堆散落的卡片，也无法顺着它递推。所以写节点时顺手说明它和什么有关：

- 观察/事实 → 它支持或反驳的猜测、结论：\`link <事实> <猜测> --rel supports\`；
- 正式发现 → 支撑它的事实：创建时 \`--parent <事实id>\`，或 \`link <发现> <事实> --rel derived-from\`；
- 猜测/问题 → 它所属的目标或上游判断；
- 被推翻或取代的结论 → \`--rel supersedes\`，并把旧节点标为 \`superseded\`；
- 确实暂时没有关联的节点可以留着不连，不必为了连而连。

写完一批节点后可运行 \`blackboard lint\`；\`isolated-nodes\` 提示只是提醒，不是前置条件。

## 独立性边界

- 创建节点不会隐式移动游标或建立关系。
- 游标轨迹不是逻辑关系。
- 当前节点不是新节点的隐式父节点。
- 时间先后不能替代显式逻辑边。
- lint、digest、context 和 Hook 都不能成为执行前置条件。
- 是否先行动、何时记录、走哪个分支始终由 Agent 自主决定。

## 命令位置

优先使用 \`blackboard\`；找不到时使用 \`node "__FLOW_CLI__"\`。
`;

/**
 * The pre-0.4 \`flow\` skill told Agents the current node is every new node's implicit
 * parent. That no longer holds, so an Agent following it records disconnected cards.
 * Move it aside (not deleted) so it stops loading but can still be recovered.
 */
function retireLegacySkill({ cwd, scope, agent }) {
  const dir = path.join(path.dirname(skillDirFor({ scope, cwd, agent })), 'flow');
  const file = path.join(dir, 'SKILL.md');
  try {
    if (!fs.readFileSync(file, 'utf8').includes('flow — 探索图')) return null;
    const backup = path.join(dir, 'SKILL.md.legacy');
    fs.renameSync(file, backup);
    return backup;
  } catch {
    return null;
  }
}

export function installSkill({ cwd = process.cwd(), cli, scope = 'project', agent = 'claude' }) {
  if (!['claude', 'codex'].includes(agent)) throw new Error(`unsupported Agent skill target: ${agent}`);
  const dir = skillDirFor({ scope, cwd, agent });
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), SKILL_MD.replace('__FLOW_CLI__', cli));
  const retired = retireLegacySkill({ cwd, scope, agent });
  return `已安装 skill（${agent}/${scope}）: ${path.join(dir, 'SKILL.md')}\nCLI: "${resolveNodeBinary()}" "${cli}"`
    + (retired ? `\n已停用旧版 flow skill（它假设“当前节点是隐式父节点”，与现行语义不符）；原文件保留为 ${retired}` : '');
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
  const body = `#!/bin/sh\nexec "${resolveNodeBinary()}" "${cli}" "$@"\n`;
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
