// Claude Code integration. Hooks write raw activity; the Agent writes semantic
// logic nodes. Keeping those layers separate prevents the blackboard from
// becoming a terminal transcript.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  paths, isInitialized, addActivity, addCheckpoint, readConfig, replay, defaultAgentId,
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
  return raw.includes(`hook ${ev}`) && raw.includes('.blackboard/events.jsonl');
}

/** Tools whose calls become raw activity events. Keep in sync with summarizeTool. */
const TOOL_MATCHER = 'Bash|WebFetch|WebSearch|Write|Edit|Read|Grep|Glob';

export function resolveNodeBinary(execPath = process.execPath, env = process.env) {
  // Two fnm paths go stale: the per-shell "fnm_multishells" path disappears with
  // the shell, and a pinned "node-versions/<v>" path disappears when that version
  // is uninstalled. In both cases swap in fnm's stable "default" alias; every
  // other install keeps the interpreter we are actually running under.
  const pinned = /^(.*)[\\/]node-versions[\\/][^\\/]+[\\/]installation[\\/]bin[\\/]node(?:\.exe)?$/.exec(execPath);
  if (!pinned && !execPath.includes('fnm_multishells')) return execPath;
  const base = pinned?.[1] || env.FNM_DIR
    || path.join(env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'fnm');
  const stable = path.join(base, 'aliases', 'default', 'bin', 'node');
  try {
    if (fs.existsSync(stable)) return stable;
  } catch {}
  return execPath;
}

function hookCommand(cli, event) {
  // Two guards, both deliberate:
  //  - hooks run through a shell with a narrower PATH than an interactive one
  //    (node here comes from fnm), so pin the interpreter we are running under;
  //  - a globally installed hook fires in every project, so exit in the shell
  //    when this project has no graph, instead of paying node startup each tool call.
  const dir = '"${CLAUDE_PROJECT_DIR:-$PWD}"';
  return (
    `dir=${dir}; [ -f "$dir/.blackboard/events.jsonl" ] && ` +
    `BLACKBOARD_CWD="$dir" exec "${resolveNodeBinary()}" "${cli}" hook ${event} || true`
  );
}

function settingsPathFor({ scope, cwd }) {
  return scope === 'user'
    ? path.join(os.homedir(), '.claude', 'settings.json')
    : path.join(cwd, '.claude', 'settings.json');
}

function skillDirFor({ scope, cwd, agent = 'claude' }) {
  if (!['project', 'user'].includes(scope)) throw new Error(`unsupported Skill scope: ${scope}`);
  if (!['claude', 'codex'].includes(agent)) throw new Error(`unsupported Agent skill target: ${agent}`);
  const base = scope === 'user' ? os.homedir() : path.resolve(cwd);
  const root = agent === 'codex' ? '.agents' : '.claude';
  return path.join(base, root, 'skills', 'blackboard');
}

/** Installation evidence only; a file on disk does not prove an Agent loaded it. */
export function integrationStatus(cwd = process.cwd()) {
  const errors = [];
  const skill = (agent) => Object.fromEntries(['project', 'user'].map((scope) => [
    scope, fs.existsSync(path.join(skillDirFor({ scope, cwd, agent }), 'SKILL.md')),
  ]));
  const hooks = Object.fromEntries(['project', 'user'].map((scope) => {
    const file = settingsPathFor({ scope, cwd });
    if (!fs.existsSync(file)) return [scope, []];
    try {
      const settings = JSON.parse(fs.readFileSync(file, 'utf8'));
      return [scope, ALL_HOOK_EVENTS.filter((event) =>
        Array.isArray(settings.hooks?.[event]) && settings.hooks[event].some((entry) => isOurHook(entry, event)))];
    } catch (error) {
      errors.push({ file, error: error.message });
      return [scope, []];
    }
  }));
  return {
    claude: { skill: skill('claude'), hooks },
    codex: { skill: skill('codex') },
    errors,
  };
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
    } else {
      // Reinstall also refreshes commands and matchers: the CLI or node binary
      // may have moved since the last install, and a stale path fails silently.
      for (const entry of mine) {
        entry.matcher = ev === ACTIVITY_HOOK_EVENT ? TOOL_MATCHER : entry.matcher;
        entry.hooks = entry.hooks || [];
        entry.hooks = entry.hooks.filter((h) => !(h.type === 'command' && isOurHook(entry, ev) && h.command !== cmd));
        if (!entry.hooks.some((h) => h.type === 'command' && h.command === cmd)) entry.hooks.push({ type: 'command', command: cmd });
      }
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
      fs.writeFileSync(`${settingsPath}.blackboard-backup`, fs.readFileSync(settingsPath));
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

/** Install the complete Skill package, leaving unrelated destination files untouched. */
function installSkillTree(source, destination, cli) {
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const sourceFile = new URL(`${encodeURIComponent(entry.name)}${entry.isDirectory() ? '/' : ''}`, source);
    const destinationFile = path.join(destination, entry.name);
    if (entry.isDirectory()) {
      installSkillTree(sourceFile, destinationFile, cli);
    } else if (entry.name.endsWith('.md')) {
      const content = fs.readFileSync(sourceFile, 'utf8');
      fs.writeFileSync(destinationFile, content.replace(/__BLACKBOARD_CLI__/g, () => cli));
    } else {
      fs.copyFileSync(sourceFile, destinationFile);
    }
  }
}

export function installSkill({ cwd = process.cwd(), cli, scope = 'project', agent = 'claude' }) {
  const dir = skillDirFor({ scope, cwd, agent });
  installSkillTree(new URL('../skills/blackboard/', import.meta.url), dir, cli);
  const note = '\n安装文件不代表当前宿主已加载；按宿主机制刷新或开启新会话。';
  return `已安装 skill（${agent}/${scope}）: ${path.join(dir, 'SKILL.md')}\nCLI: "${resolveNodeBinary()}" "${cli}"${note}`;
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

// A secret name is a whole word run ([\w.-]) containing a keyword. The match starts only where a run
// starts and the lookahead finds the keyword once: unanchored, or with the keyword between two
// backtracking stars, the engine rescans the run per start or per keyword hit, which is quadratic and
// stalls the hook on large tool output. What gets redacted is unchanged.
const SECRET_NAME = '(?<![\\w.-])(?=[\\w.-]*?(?:secret|token|passw(?:or)?d|pwd|api[_-]?key|access[_-]?key|private[_-]?key|credential|cookie))[\\w.-]+';

/** Best-effort scrubbing of what the opt-in activity capture stores. */
export function redactSensitive(value) {
  return String(value || '')
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g, '[REDACTED PRIVATE KEY]')
    .replace(/(authorization["']?\s*[:=]\s*["']?(?:bearer|basic)\s+)[^\s"']+/gi, '$1[REDACTED]')
    // user:password@host in connection strings and URLs. Anchored at "://" with the scheme checked
    // behind it, so a long dotted word run without "://" is not rescanned from every letter.
    .replace(/(:\/\/(?<=\b[a-z][a-z0-9+.-]*:\/\/)[^\s:@/]+:)[^\s@/]+@/gi, '$1[REDACTED]@')
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
  return /(?:^|[;&|(]\s*)(?:\w+=\S*\s+)*(?:\S*\/)?blackboard(?:\s|$)/.test(command)
    || /\bblackboard\.js\b/.test(command);
}

export function runHook({ event, payload, cwd = process.cwd(), args = [] }) {
  if (!isInitialized(cwd)) return null;
  const cfg = readConfig(cwd);
  const agentId = defaultAgentId();

  switch (event) {
    case 'SessionStart': {
      // Reinject the digest so a resumed/compacted session starts from the graph.
      const g = replay(cwd);
      if (!Object.keys(g.nodes).length) return null;
      const md = buildDigest(g, cwd, agentId);
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
      const before = buildDigest(replay(cwd), cwd, agentId);
      addCheckpoint({
        summary: summary || before.slice(0, 8000),
        trigger: payload.trigger || 'auto',
        agentId,
      }, cwd, { lockTimeoutMs: HOOK_LOCK_MS * 3 });
      const md = buildDigest(replay(cwd), cwd, agentId);
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
      const scrub = cfg.redact === false ? (x) => String(x || '') : redactSensitive;
      // Scrub first, then truncate: a secret cut in half by the detail limit no
      // longer matches its key name or token shape and would slip through.
      const detailLimit = cfg.detailLimit || 1200;
      const result = scrub(toolResultText(payload)).slice(0, detailLimit);
      const g = replay(cwd);
      const count = Object.keys(g.activities || {}).length;
      if (count >= (cfg.maxActivities || cfg.maxAutoFacts || 4000)) return null;
      addActivity({
        agentId,
        tool: name,
        summary: scrub(title).slice(0, 500),
        input: scrub(rawInput).slice(0, 4000),
        output: result,
        location: at || null,
      }, cwd, { lockTimeoutMs: HOOK_LOCK_MS });
      return null;
    }

    case 'Stop':
      return null;

    default:
      return null;  }
}
