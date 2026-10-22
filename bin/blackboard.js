#!/usr/bin/env node
// blackboard — 把 Agent 的探索路径外化成递进图状态。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  NODE_TYPES,
  TYPE_LABEL,
  EDGE_LABEL,
  INTENT_STATUS,
  NODE_STATES,
  SEVERITIES,
  CONFIDENCE_LEVELS,
  CONFIDENCE_LABEL,
  currentCursor,
  resolveRef,
} from '../lib/model.js';
import {
  paths,
  ensure,
  isInitialized,
  findRoot,
  protectBoard,
  LIMITS,
  addNode,
  addEdge,
  addCheckpoint,
  patchNode,
  removeNode,
  removeEdge,
  defaultAgentId,
  moveCursor,
  setMeta,
  reset,
  replay,
  readState,
  readEvents,
  stats,
} from '../lib/store.js';
import { buildDigest, neighborsOf, tail } from '../lib/digest.js';
import { buildAgentContext, renderAgentContext } from '../lib/context.js';
import { DEFAULT_PORT, resolvePort, rememberViewerPort, probeViewer } from '../lib/service.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const CLI = path.join(ROOT, 'bin', 'blackboard.js');
const VERSION = '0.5.0';

const C = process.stdout.isTTY
  ? {
      dim: (s) => `\x1b[2m${s}\x1b[0m`,
      bold: (s) => `\x1b[1m${s}\x1b[0m`,
      grn: (s) => `\x1b[32m${s}\x1b[0m`,
      blu: (s) => `\x1b[34m${s}\x1b[0m`,
      mag: (s) => `\x1b[35m${s}\x1b[0m`,
      red: (s) => `\x1b[31m${s}\x1b[0m`,
      yel: (s) => `\x1b[33m${s}\x1b[0m`,
      cyn: (s) => `\x1b[36m${s}\x1b[0m`,
      gry: (s) => `\x1b[90m${s}\x1b[0m`,
    }
  : new Proxy({}, { get: () => (s) => s });

const TYPE_COLOR = {
  start: C.gry,
  goal: C.grn,
  intent: C.blu,
  observation: C.yel,
  fact: C.yel,
  hypothesis: C.mag,
  question: C.cyn,
  action: C.blu,
  result: C.yel,
  finding: C.red,
  vuln: C.red,
  hint: C.mag,
  summary: C.cyn,
  note: C.gry,
  compact: C.cyn,
};

function colorType(n) {
  return (TYPE_COLOR[n.type] || ((s) => s))(`${TYPE_LABEL[n.type] || n.type}`);
}

function usage() {
  const b = C.bold;
  console.log(`
${b('blackboard')} — Agent 外置黑板

${b('初始化')}
  blackboard init [--title "任务标题"]       建立 .blackboard/
  blackboard setup [选项]                   一条龙配置 Claude Skill、恢复 Hook 和持久服务
    --target <目录> --title "标题" --port ${DEFAULT_PORT} --open
    --no-hooks --no-skill --no-serve        可按需关闭某一接入项
  blackboard status [--json] [--port <端口>]   查看数据、接入配置和实际服务状态

${b('逻辑节点')}
  blackboard node add <kind> "标题" [选项]   任意类型节点
  blackboard start|goal|intent|fact|vuln|hint "标题"  兼容简写
  可用选项: --enter                    创建后进入该节点
            --relate-here              与当前节点建立弱关系
            --parent <id>              显式来源节点（兼容）
            --rel <relation>           关系，默认 related-to
            --at <file:line>           文件位置
            --detail/-d                详情
            --tag/-t                   可重复标签
            --status <state>           可选状态
            --sev <severity>           严重度
            --confidence <level>       suspected|static-confirmed|reproduced|confirmed

${b('游标与关系')}
  blackboard cursor <id|none> [--reason "…"] 只移动当前游标，不创建逻辑边
  blackboard focus <id>                      cursor 的兼容别名
  blackboard here                            当前节点、邻域和最近轨迹
  blackboard link <from> <to> [--rel supports]   读作 “from <rel> to”，如 link 观察 猜测 --rel supports
  blackboard unlink <from> <to> [--rel supports] 断开一条关系
  blackboard remove <id> [--reason "…"]      把节点及其关系从图上移除（日志保留历史）
  blackboard done|block|revive <id>          修改节点状态
  blackboard edit <id> [--title …|-d …|--status …|--sev …|--confidence …]

${b('恢复与查看')}
  blackboard checkpoint [--summary "…"]      创建恢复检查点
  blackboard compact [--summary "…"]         checkpoint 的兼容别名
  blackboard activity ls|show [id]           查看原始活动层
  blackboard promote <activity-id> [--kind observation] [--title "…"]
  blackboard digest [--write] [--agent <名称>] 当前节点/邻域/轨迹/开放节点
  blackboard context [选项]                  Agent 可读的结构化上下文包
    --focus <id> --depth <0-5> --budget <tokens> --since <checkpoint|timestamp>
    默认输出 JSON；--markdown 输出便于人读的摘要
  blackboard lint [--json]                   只读检查上下文质量，不修改也不拦截
  blackboard ls [--type hypothesis] [--open] [-n 30]
  blackboard show <id>
  blackboard tree [-d 4]
  blackboard tail
  blackboard serve [--port ${DEFAULT_PORT}] [--open] [--read-only]   前台查看器；--read-only 关闭页面编辑
  blackboard export [-o blackboard.html]
  blackboard reset --yes

${b('宿主接入与服务')}
  blackboard hooks install|uninstall [--write] [--user|--project]   仅 Claude Code 恢复 Hook
    --with-activity  安装时额外采集工具活动（可能含敏感内容，默认关闭）
  blackboard skill install [--codex] [--user|--project]   安装 Claude 或 Codex Skill
  blackboard service status|stop|uninstall [--json]   管理 macOS 共享工作区服务
  blackboard launcher
  blackboard hook <event>

所有命令支持 --help / -h；init/setup/status/skill/hooks/launcher/service 支持 --json，供脚本读取。
端口优先级: --port > BLACKBOARD_PORT > 项目 viewerPort > ${DEFAULT_PORT}；地址统一为 127.0.0.1。
环境变量: BLACKBOARD_CWD 指定项目根；BLACKBOARD_QUIET=1 静默；BLACKBOARD_AGENT=name 让并行的 Agent 各用各的游标（默认 agent:primary）。
`);
}
/** Resolve a typed id, failing with the candidate list instead of a stack trace. */
function refOrFail(map, ref, label = 'node') {
  try {
    return resolveRef(map, ref, label);
  } catch (e) {
    return fail(e.message);
  }
}

function fail(msg) {
  console.error(`${C.red('blackboard:')} ${msg}`);
  process.exit(1);
}

const BOOLEAN_FLAGS = new Set([
  'json', 'open', 'write', 'all', 'open-only', 'quiet', 'enter', 'relate-here',
  'user', 'project', 'yes', 'with-activity', 'here', 'codex', 'no-hooks',
  'no-skill', 'no-serve', 'read-only', 'markdown',
]);
const NODE_FLAGS = 'detail tag status sev confidence at parent enter relate-here rel kind reason agent json';
const COMMAND_FLAGS = {
  init: 'title here json',
  setup: 'target title port open no-hooks no-skill no-serve json',
  status: 'port agent json',
  node: NODE_FLAGS, start: NODE_FLAGS, goal: NODE_FLAGS, intent: NODE_FLAGS,
  fact: NODE_FLAGS, vuln: NODE_FLAGS, hint: NODE_FLAGS,
  checkpoint: 'summary title trigger agent write json', compact: 'summary title trigger agent write json',
  cursor: 'agent reason json', focus: 'agent reason json', here: 'agent json',
  activity: 'limit json',
  promote: 'kind type title detail enter relate-here rel reason json',
  done: 'json', block: 'json', revive: 'json',
  edit: 'title detail status sev confidence tag json',
  link: 'rel kind label json', unlink: 'rel kind agent json',
  remove: 'reason agent json', rm: 'reason agent json',
  ls: 'type open open-only limit json', list: 'type open open-only limit json',
  show: 'json', tree: 'depth', digest: 'agent write quiet json',
  context: 'focus depth budget since limit agent markdown json',
  lint: 'json', tail: 'agent json', serve: 'port open read-only',
  export: 'out json', reset: 'yes',
  hooks: 'write user project with-activity json',
  skill: 'codex user project json', launcher: 'user project json',
  service: 'json', hook: '', help: '', version: '', '-v': '', '--version': '',
};

function parseArgs(argv, cmd = '') {
  const args = [];
  const flags = {};
  const allowed = new Set((COMMAND_FLAGS[cmd] || '').split(' ').filter(Boolean));
  const aliases = {
    '-d': cmd === 'tree' ? 'depth' : 'detail',
    '-t': ['ls', 'list'].includes(cmd) ? 'type' : 'tag',
    '-n': 'limit', '-o': 'out', n: 'limit', o: 'out', md: 'markdown',
    d: cmd === 'tree' ? 'depth' : 'detail',
    t: ['ls', 'list'].includes(cmd) ? 'type' : 'tag',
  };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--') { args.push(...argv.slice(i + 1)); break; }
    if (!token.startsWith('-') || token === '-') { args.push(token); continue; }
    const eq = token.indexOf('=');
    const spelling = eq < 0 ? token : token.slice(0, eq);
    const raw = spelling.startsWith('--') ? spelling.slice(2) : spelling;
    const key = aliases[raw] || raw;
    if (!allowed.has(key)) fail(`未知选项 ${spelling}（命令 ${cmd}）`);
    let value;
    if (BOOLEAN_FLAGS.has(key)) {
      if (eq >= 0) fail(`选项 ${spelling} 不接受值`);
      value = true;
    } else {
      value = eq >= 0 ? token.slice(eq + 1) : argv[++i];
      if (value === undefined || (eq < 0 && value.startsWith('-') && !/^-\d/.test(value))) {
        fail(`选项 ${spelling} 缺少值`);
      }
      if (!value.length) fail(`选项 ${spelling} 缺少值`);
    }
    if (flags[key] !== undefined) {
      if (key !== 'tag') fail(`选项 ${spelling} 不可重复`);
      flags.tag = [].concat(flags.tag, value);
    } else flags[key] = value;
  }
  for (const pair of [['user', 'project'], ['rel', 'kind'], ['markdown', 'json'],
    ...(cmd === 'promote' ? [['kind', 'type']] : []),
    ...(['checkpoint', 'compact'].includes(cmd) ? [['summary', 'title']] : [])]) {
    if (pair.every((key) => flags[key] !== undefined)) fail(`选项 --${pair[0]} 与 --${pair[1]} 冲突`);
  }
  for (const [key, min, max] of [
    ['port', cmd === 'serve' ? 0 : 1, 65535],
    ['depth', 0, cmd === 'context' ? 5 : Number.MAX_SAFE_INTEGER],
    ['budget', 1, Number.MAX_SAFE_INTEGER], ['limit', 1, Number.MAX_SAFE_INTEGER],
  ]) {
    if (flags[key] !== undefined && (!/^\d+$/.test(flags[key])
      || !Number.isSafeInteger(Number(flags[key])) || Number(flags[key]) < min || Number(flags[key]) > max)) {
      fail(`--${key} 应为 ${min}–${max} 的整数，收到 ${flags[key]}`);
    }
  }
  for (const [key, values] of [['status', NODE_STATES], ['sev', SEVERITIES], ['confidence', CONFIDENCE_LEVELS]]) {
    if (flags[key] !== undefined && !values.includes(flags[key])) fail(`--${key} 只能是 ${values.join('|')}`);
  }
  if (cmd === 'setup' && flags.target && args.length) fail('--target 与位置目录冲突');
  if (['skill', 'hooks'].includes(cmd) && args.length > 1) fail(`${cmd} 只接受一个子命令`);
  if (cmd === 'hooks' && args[0] === 'uninstall' && flags['with-activity']) {
    fail('--with-activity 只用于 hooks install');
  }
  return { args, flags };
}

function cwd() {
  const projectCwd = process.env.BLACKBOARD_CWD;
  if (projectCwd) return path.resolve(projectCwd);
  // Like git: a command run from a subdirectory belongs to the nearest board above it.
  return findRoot(process.cwd()) || process.cwd();
}

/** Tell the Agent when something it wrote was shortened; silently losing text would be worse. */
function warnTruncated(result) {
  const fields = result?.truncated;
  if (!fields?.length) return;
  const names = { title: '标题', detail: '详情', label: '关系说明', summary: '摘要' };
  const parts = fields.map((f) => `${names[f] || f}（上限 ${LIMITS[f]} 字）`);
  console.error(`${C.yel('提示')} ${parts.join('、')}超出上限，已被截断；长内容请拆成多个节点或写入文件。`);
}

function needInit() {
  if (!isInitialized(cwd())) {
    console.error(`${C.yel('提示')} 当前目录还没有 .blackboard/，已自动初始化。`);
    ensure(cwd());
  }
  return ensure(cwd());
}

/** Read-only commands must not create state as a side effect. */
function needInitRead() {
  if (!isInitialized(cwd())) {
    console.error(`${C.red('blackboard:')} 当前目录没有 .blackboard/。先运行 blackboard init --title "审计目标"`);
    process.exit(1);
  }
  return paths(cwd());
}

function out(flags, obj) {
  if (flags.json) console.log(JSON.stringify(obj, null, 2));
}

function shortDetail(s, n = 100) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

function nodeLine(n) {
  const st = n.status ? ` ${C.dim('[' + n.status + ']')}` : '';
  const sev = n.severity ? ` ${C.red(n.severity.toUpperCase())}` : '';
  const confidence = n.confidence ? ` ${C.dim(CONFIDENCE_LABEL[n.confidence] || n.confidence)}` : '';
  const loc = n.loc ? ` ${C.dim(`@${n.loc.path}${n.loc.line ? `:${n.loc.line}` : ''}`)}` : '';
  return `${C.dim(n.id.padEnd(5))} ${colorType(n).padEnd(8)}${st}${sev}${confidence} ${n.title}${loc}`;
}

async function cmdServe(args, flags) {
  const target = cwd();
  const port = resolvePort({ cwd: target, port: flags.port, allowZero: true });
  needInit();
  const { startServer } = await import('../lib/server.js');
  const server = await startServer({ cwd: target, port, open: !!flags.open, readOnly: !!flags['read-only'] });
  try {
    rememberViewerPort(target, server.address().port);
  } catch (error) {
    server.close();
    throw error;
  }
}

async function cmdExport(args, flags) {
  needInit();
  const { renderExport } = await import('../lib/export.js');
  const file = flags.out || flags.o || 'blackboard.html';
  const abs = path.resolve(cwd(), file);
  fs.writeFileSync(abs, renderExport({ cwd: cwd() }));
  if (flags.json) return out(flags, { file: abs });
  console.log(`${C.grn('已导出')} ${abs}`);
}

async function cmdStatus(args, flags) {
  const p = needInitRead();
  const port = resolvePort({ cwd: p.cwd, port: flags.port });
  const g = replay(p.cwd);
  const s = stats(g);
  const state = readState(p.cwd);
  const agentId = flags.agent || defaultAgentId();
  const cursorId = currentCursor(g, agentId);
  const cursor = cursorId ? g.nodes[cursorId] : null;
  const { integrationStatus } = await import('../lib/hooks.js');
  const integration = integrationStatus(p.cwd);
  const viewer = await probeViewer({ cwd: p.cwd, port });
  const latestNode = Object.values(g.nodes).reduce((latest, node) =>
    !latest || (node.updated || node.ts || 0) > (latest.updated || latest.ts || 0) ? node : latest, null);
  if (flags.json) return out(flags, {
    stats: s, cursor, cursors: g.cursors, title: g.meta.title || state.title, session: state.session,
    cwd: p.cwd, agentId, viewer, integration, latestNode,
  });

  console.log(
    `${C.bold('blackboard')} ${C.dim(p.cwd)}${g.meta.title || state.title ? ` · ${g.meta.title || state.title}` : ''}`,
  );
  console.log(
    `逻辑节点 ${C.bold(String(s.total))}  关系 ${s.edges}  ` +
      `开放 ${C.yel(String(s.frontier))}  活动 ${s.activities}  检查点 ${s.checkpoints}`,
  );
  const parts = [...NODE_TYPES, ...Object.keys(s.byType).filter((t) => !NODE_TYPES.includes(t))]
    .filter((t) => s.byType[t]).map(
    (t) => `${colorType({ type: t })} ${s.byType[t]}`,
  );
  if (parts.length) console.log(parts.join('  '));
  if (s.confirmed) {
    const sev = Object.entries(s.vulns)
      .filter(([, v]) => v)
      .map(([k, v]) => `${k} ${v}`)
      .join(' · ');
    console.log(`漏洞分布 ${sev}`);
  }
  if (cursor) console.log(`当前节点 ${nodeLine(cursor)}`);
  else console.log(C.dim('当前游标未设置；使用 blackboard cursor <id> 或创建节点时加 --enter。'));
  const scopes = (value) => ['project', 'user'].filter((scope) => value[scope] === true).join(', ') || '未安装';
  console.log(`接入配置 ${['claude', 'codex'].map((agent) => `${agent} Skill: ${scopes(integration[agent].skill)}`).join(' · ')}`);
  for (const scope of ['project', 'user']) {
    const events = integration.claude.hooks[scope];
    if (events.length) console.log(`  Claude Hook (${scope}): ${events.join(', ')}`);
  }
  for (const error of integration.errors) console.log(C.yel(`  无法检查 ${error.file}: ${error.error}`));
  if (latestNode) console.log(`最近节点 ${nodeLine(latestNode)} · ${new Date(latestNode.updated || latestNode.ts).toISOString()}`);
  else console.log(C.dim('尚无语义节点；安装配置不代表 Agent 已加载或使用。'));
  const labels = { online: '在线', offline: '未启动或无法连接', 'other-project': '正在服务其他项目', unrecognized: '该地址不是可识别的 blackboard 服务' };
  console.log(`可视化 ${viewer.url} · ${labels[viewer.state]}${viewer.state === 'online' && viewer.readOnly ? '（只读）' : ''}`);
  if (viewer.state === 'other-project') console.log(C.yel(`  服务项目 ${viewer.cwd}；当前项目 ${p.cwd}`));
  if (viewer.state !== 'online') console.log(C.dim(`  当前项目启动: blackboard serve --port ${port} --open`));
}

function cmdList(args, flags) {
  needInitRead();
  const g = replay(cwd());
  let nodes = Object.values(g.nodes).sort((a, b) => (a.ts || 0) - (b.ts || 0));
  const type = flags.type || flags.t;
  if (type) nodes = nodes.filter((n) => n.type === type || TYPE_LABEL[n.type] === type);
  if (flags.open || flags['open-only']) {
    nodes = nodes.filter((n) =>
      ['intent', 'hypothesis', 'question'].includes(n.type) &&
      ['open', 'active', 'blocked'].includes(n.status || 'open'));
  }
  const limit = Number(flags.limit || flags.n || 30);
  nodes = nodes.slice(-limit);
  if (flags.json) return out(flags, nodes);
  if (!nodes.length) return console.log(C.dim('（空）'));
  for (const n of nodes) console.log(nodeLine(n));
}

function cmdShow(args, flags) {
  needInitRead();
  const id = args[0];
  if (!id) fail('用法: blackboard show <id>');
  const g = replay(cwd());
  const nodeId = refOrFail(g.nodes, id);
  const n = g.nodes[nodeId];
  if (flags.json) return out(flags, { node: n, parents: parentsOf(g, nodeId), children: childrenOf(g, nodeId) });
  const chain = [];
  let cur = n;
  const seen = new Set();
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    chain.unshift(cur);
    cur = cur.parent ? g.nodes[cur.parent] : null;
  }
  if (chain.length > 1) {
    console.log(C.dim(chain.map((c) => `${c.id}`).join(' → ')));
  }
  console.log(`${C.bold(n.id)} ${colorType(n)} ${n.title}`);
  if (n.status) console.log(`状态 ${n.status}`);
  if (n.severity) console.log(`严重度 ${n.severity}`);
  if (n.tags && n.tags.length) console.log(`标签 ${n.tags.join(', ')}`);
  if (n.detail) {
    console.log('');
    console.log(n.detail);
  }
  const kids = childrenOf(g, nodeId);
  if (kids.length) {
    console.log('');
    console.log(C.dim('— 下游 —'));
    for (const k of kids) console.log(`  ${C.dim(EDGE_LABEL[k.kind] || k.kind)} ${nodeLine(k)}`);
  }
}

function parentsOf(g, id) {
  return Object.values(g.edges)
    .filter((e) => e.to === id)
    .map((e) => ({ ...g.nodes[e.from], edge: e.kind }))
    .filter((x) => x.id);
}

function childrenOf(g, id) {
  return Object.values(g.edges)
    .filter((e) => e.from === id)
    .map((e) => ({ ...g.nodes[e.to], edge: e.kind }))
    .filter((x) => x.id);
}

function cmdTree(args, flags) {
  needInitRead();
  const g = replay(cwd());
  const depth = Number(flags.depth ?? 4);
  const kids = new Map();
  for (const e of Object.values(g.edges)) {
    if (!kids.has(e.from)) kids.set(e.from, []);
    kids.get(e.from).push(e);
  }
  const incoming = new Set(Object.values(g.edges).map((e) => e.to));
  const starts = Object.values(g.nodes).filter((n) => !incoming.has(n.id));
  const roots = starts.length
    ? starts
    : Object.values(g.nodes).slice(0, 10);
  const walk = (n, d, seen, prefix) => {
    if (seen.has(n.id) || d > depth) {
      if (d > depth) console.log(`${prefix}${C.dim('…')}`);
      return;
    }
    seen.add(n.id);
    console.log(`${prefix}${nodeLine(n)}`);
    const cs = (kids.get(n.id) || [])
      .map((e) => g.nodes[e.to])
      .filter(Boolean)
      .sort((a, b) => (a.ts || 0) - (b.ts || 0));
    for (const c of cs) walk(c, d + 1, seen, `${prefix}  `);
  };
  const seen = new Set();
  for (const r of roots) walk(r, 0, seen, '');
  const orphans = Object.values(g.nodes).filter((n) => !seen.has(n.id));
  if (orphans.length) {
    console.log(C.dim(`… ${orphans.length} 个节点未在树中显示（blackboard ls 查看）`));
  }
}

function cmdDigest(args, flags) {
  const p = needInitRead();
  const g = replay(cwd());
  const md = buildDigest(g, cwd(), flags.agent || defaultAgentId());
  if (flags.write) {
    fs.writeFileSync(p.digest, md);
    if (!flags.quiet) console.error(C.dim(`已写入 ${p.digest}`));
  }
  if (flags.json) return out(flags, { digest: md });
  console.log(md);
}

function cmdContext(args, flags) {
  needInitRead();
  const g = replay(cwd());
  const wanted = flags.focus || args[0] || null;
  const focus = wanted ? refOrFail(g.nodes, wanted, 'focus node') : null;
  let since = flags.since;
  if (since !== undefined && !/^\d+$/.test(String(since)) && Object.keys(g.checkpoints || {}).length) {
    try { since = resolveRef(g.checkpoints, since, 'checkpoint'); } catch {}
  }
  const packet = buildAgentContext(g, {
    agentId: flags.agent || defaultAgentId(),
    focus,
    depth: flags.depth === undefined ? 2 : Number(flags.depth),
    budgetTokens: flags.budget === undefined ? 4000 : Number(flags.budget),
    since,
    ...(flags.since ? { events: readEvents(cwd()).events } : {}),
    maxItems: flags.limit || flags.n,
  });
  if (flags.markdown || flags.md) console.log(renderAgentContext(packet));
  else console.log(JSON.stringify(packet, null, 2));
}

async function cmdLint(args, flags) {
  needInitRead();
  const { lintGraph } = await import('../lib/lint.js');
  const result = lintGraph(replay(cwd()), {
    maxTitleLength: Number(flags['max-title'] || 80),
  });
  if (flags.json) return out(flags, result);
  console.log(`${C.bold('blackboard lint')} · ${result.summary.nodes} 节点 · ${result.summary.edges} 关系`);
  if (!result.issues.length) return console.log(C.grn('没有发现上下文质量提示。'));
  for (const x of result.issues) {
    const label = x.level === 'warn' ? C.yel('WARN') : C.cyn('INFO');
    console.log(`${label} ${x.code} · ${x.message}`);
    if (x.nodeIds?.length) {
      console.log(C.dim(`  ${x.nodeIds.join(', ')}${x.count > x.nodeIds.length ? ' …' : ''}`));
    }
  }
  console.log(C.dim('这些提示不会修改黑板，也不会限制 Agent 行动。'));
}

function cmdTail(args, flags) {
  needInitRead();
  const g = replay(cwd());
  const text = tail(g, flags.agent || defaultAgentId());
  console.log(flags.json ? JSON.stringify({ tail: text }) : text);
}

function cmdInit(args, flags) {
  const explicit = process.env.BLACKBOARD_CWD;
  const target = explicit ? path.resolve(explicit) : process.cwd();
  const parent = findRoot(target);
  if (parent && path.resolve(parent) !== path.resolve(target) && !flags.here) {
    fail(`上级目录已有黑板 ${parent}。在子目录里的命令会自动使用它；确实要在此处新建独立黑板，请加 --here。`);
  }
  const p = ensure(target);
  if (protectBoard(target) && !flags.json) console.log(C.dim('已写入 .blackboard/.gitignore，黑板数据默认不进版本库。'));
  if (flags.title) setMeta({ title: String(flags.title) }, target);
  const g = replay(target);
  const state = readState(target);
  if (flags.json) return out(flags, { cwd: p.cwd, board: p.root, title: g.meta.title || state.title, session: state.session });
  if (g.meta.title || flags.title) {
    console.log(`${C.grn('已初始化')} ${C.dim(p.cwd)} · ${g.meta.title}`);
  } else {
    console.log(`${C.grn('已初始化')} ${C.dim(p.cwd)} · 会话 ${state.session}`);
    console.log(C.dim('下一步: blackboard node add goal "目标" --enter'));
  }
}

async function cmdSetup(args, flags) {
  const { setupProject } = await import('../lib/setup.js');
  const target = path.resolve(String(flags.target || args[0] || cwd()));
  if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) {
    fail(`项目目录不存在: ${target}`);
  }
  const result = await setupProject({
    cwd: target,
    cli: CLI,
    title: flags.title || path.basename(target),
    port: resolvePort({ cwd: target, port: flags.port }),
    hooks: !flags['no-hooks'],
    skill: !flags['no-skill'],
    serve: !flags['no-serve'],
  });
  if (flags.open && result.service?.url) {
    const { execFile } = await import('node:child_process');
    const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
    const openerArgs = process.platform === 'win32' ? ['/c', 'start', '', result.service.url] : [result.service.url];
    execFile(opener, openerArgs, () => {});
  }
  if (flags.json) return out(flags, result);
  console.log(`${C.grn('blackboard 已就绪')} ${result.cwd}`);
  console.log(`  数据 ${result.board} · autoRecord=false`);
  if (result.launcher && !result.launcher.onPath) console.log(C.yel(`  命令目录 ${result.launcher.dir} 不在 PATH；请加入 shell 配置。`));
  if (result.skill) console.log('  Claude Skill 已安装（项目级）');
  if (result.hooks) console.log(`  恢复 Hook 已安装 ${result.hooks.file}（不采集工具活动）`);
  if (result.service) {
    if (result.service.switched) console.log(C.yel(`  共享服务归属切换: ${result.service.previousCwd} → ${result.service.cwd}`));
    if (result.service.verified) console.log(`  可视化 ${result.service.url} · 已验证`);
    else console.log(`  可视化需手动启动: ${result.service.command}`);
  }
  console.log(C.dim('下一步由 Agent 自主决定；黑板只在关键判断、结果和交接点记录。'));
  console.log(C.dim('Skill / Hook 配置供新会话加载；已安装不代表当前 Agent 已加载。用 blackboard status 查看配置和服务状态。'));
}

async function main() {
  const argv = process.argv.slice(2);
  const delimiter = argv.indexOf('--');
  const options = delimiter < 0 ? argv : argv.slice(0, delimiter);
  if (options.includes('--help') || options.includes('-h')) return usage();
  const cmd = argv[0];
  const { args, flags } = parseArgs(argv.slice(1), cmd);

  switch (cmd) {
    case undefined:
    case '-h':
    case '--help':
    case 'help':
      return usage();
    case '-v':
    case '--version':
    case 'version':
      return console.log(`blackboard ${VERSION}`);
    case 'init':
      return cmdInit(args, flags);
    case 'setup':
      return cmdSetup(args, flags);
    case 'status':
      return cmdStatus(args, flags);
    case 'node':
      if (args[0] !== 'add') fail('用法: blackboard node add <kind> "标题" [--enter|--relate-here]');
      if (!args[1]) fail('缺少节点 kind');
      return addSimple(args[1], args.slice(2), flags);
    case 'start':
      return addSimple('start', args, flags);
    case 'goal':
      return addSimple('goal', args, flags);
    case 'intent':
      return addSimple('intent', args, flags);
    case 'fact':
      return addSimple('fact', args, flags);
    case 'vuln':
      return addSimple('vuln', args, flags);
    case 'hint':
      return addSimple('hint', args, flags);
    case 'compact':
    case 'checkpoint':
      return cmdCheckpoint(args, flags);
    case 'focus':
    case 'cursor':
      return cmdCursor(args, flags);
    case 'here':
      return cmdHere(args, flags);
    case 'activity':
      return cmdActivity(args, flags);
    case 'promote':
      return cmdPromote(args, flags);
    case 'done':
    case 'block':
    case 'revive':
      return cmdState(cmd, args, flags);
    case 'edit':
      return cmdEdit(args, flags);
    case 'link':
      return cmdLink(args, flags);
    case 'unlink':
      return cmdUnlink(args, flags);
    case 'remove':
    case 'rm':
      return cmdRemove(args, flags);
    case 'ls':
    case 'list':
      return cmdList(args, flags);
    case 'show':
      return cmdShow(args, flags);
    case 'tree':
      return cmdTree(args, flags);
    case 'digest':
      return cmdDigest(args, flags);
    case 'context':
      return cmdContext(args, flags);
    case 'lint':
      return cmdLint(args, flags);
    case 'tail':
      return cmdTail(args, flags);
    case 'serve':
      return cmdServe(args, flags);
    case 'export':
      return cmdExport(args, flags);
    case 'reset':
      return cmdReset(args, flags);
    case 'hooks':
      return cmdHooks(args, flags);
    case 'service':
      return cmdService(args, flags);
    case 'skill':
      return cmdSkill(args, flags);
    case 'launcher':
      return cmdLauncher(args, flags);
    case 'hook':
      return hookEntry(args[0], args.slice(1), flags);
    default:
      fail(`未知命令 ${cmd}（blackboard help 查看用法）`);
  }
}

function addSimple(type, args, flags) {
  const title = args.join(' ').trim();
  if (!title) fail(`用法: blackboard node add ${type} "标题"`);
  if (flags.status && !NODE_STATES.includes(flags.status)) {
    fail(`--status 只能是 ${NODE_STATES.join('|')}`);
  }
  if (flags.sev && !SEVERITIES.includes(flags.sev)) {
    fail(`--sev 只能是 ${SEVERITIES.join('|')}`);
  }
  if (flags.confidence && !CONFIDENCE_LEVELS.includes(flags.confidence)) {
    fail(`--confidence 只能是 ${CONFIDENCE_LEVELS.join('|')}`);
  }
  needInit();
  const result = addNode(
    {
      type,
      title,
      detail: flags.detail || flags.d || '',
      parent: flags.parent || null,
      status: flags.status || null,
      severity: flags.sev || null,
      confidence: flags.confidence || null,
      tags: flags.tag ? [].concat(flags.tag) : [],
      at: flags.at || null,
      enter: !!flags.enter,
      relateHere: !!flags['relate-here'],
      relation: flags.rel || flags.kind || null,
      reason: flags.reason || '',
      agentId: flags.agent || defaultAgentId(),
    },
    cwd(),
  );
  warnTruncated(result);
  if (flags.json) return out(flags, result);
  if (!process.env.BLACKBOARD_QUIET) {
    const via = result.edge ? ` ${EDGE_LABEL[result.edge.kind] || result.edge.kind} ${result.edge.from}` : '';
    const entered = result.cursor ? ' · 已进入' : '';
    console.log(`${C.grn('+')} ${nodeLine(result.node)}${C.dim(via + entered)}`);
  }
}

function cmdCheckpoint(args, flags) {
  needInit();
  const agentId = flags.agent || defaultAgentId();
  const summary = flags.summary || flags.title || args.join(' ').trim() || buildDigest(replay(cwd()), cwd(), agentId);
  const checkpoint = addCheckpoint(
    {
      summary,
      trigger: flags.trigger || (process.argv[2] === 'compact' ? 'manual-compact' : 'manual'),
      agentId,
    },
    cwd(),
  );
  if (flags.write) fs.writeFileSync(paths(cwd()).digest, buildDigest(replay(cwd()), cwd(), agentId));
  warnTruncated(checkpoint);
  if (flags.json) return out(flags, checkpoint);
  if (!process.env.BLACKBOARD_QUIET) {
    console.log(`${C.cyn('+')} 检查点 ${checkpoint.id}${checkpoint.cursorNodeId ? ` @${checkpoint.cursorNodeId}` : ''}`);
  }
}

function cmdCursor(args, flags) {
  needInit();
  const g = replay(cwd());
  let id = args[0];
  const agentId = flags.agent || defaultAgentId();
  if (!id) {
    const current = currentCursor(g, agentId);
    if (flags.json) return out(flags, { cursor: current, agentId });
    console.log(current || '(none)');
    return;
  }
  if (id === 'none' || id === 'clear') id = null;
  if (id === 'next') {
    const open = Object.values(g.nodes)
      .filter((n) => ['intent', 'hypothesis', 'question'].includes(n.type) &&
        ['open', 'active'].includes(n.status || 'open'))
      .sort((a, b) => (a.ts || 0) - (b.ts || 0));
    if (!open.length) fail('没有可直接进入的开放节点');
    id = open[open.length - 1].id;
  }
  const cursor = moveCursor(id, { reason: flags.reason || '', agentId }, cwd());
  if (flags.json) return out(flags, { cursor });
  if (!process.env.BLACKBOARD_QUIET) {
    if (cursor.to) console.log(`${C.grn('游标 →')} ${nodeLine(replay(cwd()).nodes[cursor.to])}`);
    else console.log(C.grn('游标已清空'));
  }
}

function cmdHere(args, flags) {
  needInitRead();
  const g = replay(cwd());
  const agentId = flags.agent || defaultAgentId();
  const id = currentCursor(g, agentId);
  const node = id ? g.nodes[id] : null;
  const neighbors = neighborsOf(g, id);
  const trail = (g.cursorTrail || []).filter((c) => c.agentId === agentId).slice(-10);
  if (flags.json) return out(flags, { agentId, cursor: id, node, neighbors, trail });
  if (!node) return console.log(C.dim('当前游标未设置。'));
  console.log(`${C.bold('当前')} ${nodeLine(node)}`);
  if (neighbors.length) {
    console.log(C.dim('— 邻域 —'));
    for (const x of neighbors) {
      const arrow = x.direction === 'out' ? '→' : '←';
      console.log(`  ${arrow} ${EDGE_LABEL[x.edge.kind] || x.edge.kind} ${nodeLine(x.node)}`);
    }
  }
  if (trail.length) {
    const ids = [];
    if (trail[0].from) ids.push(trail[0].from);
    for (const c of trail) if (c.to) ids.push(c.to);
    console.log(`${C.dim('最近轨迹')} ${ids.join(' → ')}`);
  }
}

function activityLine(a) {
  const at = new Date(a.at || 0).toISOString().replace('T', ' ').slice(0, 19);
  return `${C.dim(a.id)} ${C.cyn(a.tool)} ${a.summary || ''} ${C.dim(at)}`;
}

function cmdActivity(args, flags) {
  needInitRead();
  const g = replay(cwd());
  const sub = args[0] || 'ls';
  if (sub === 'show') {
    if (!args[1]) fail('用法: blackboard activity show <id>');
    const a = g.activities[refOrFail(g.activities, args[1], 'activity')];
    if (flags.json) return out(flags, a);
    console.log(activityLine(a));
    if (a.input) console.log(`\n输入\n${a.input}`);
    if (a.output) console.log(`\n输出\n${a.output}`);
    return;
  }
  if (sub !== 'ls' && sub !== 'list') fail('用法: blackboard activity ls|show [id]');
  const limit = Number(flags.limit || flags.n || 30);
  const activities = Object.values(g.activities)
    .sort((a, b) => (a.at || 0) - (b.at || 0))
    .slice(-limit);
  if (flags.json) return out(flags, activities);
  if (!activities.length) return console.log(C.dim('（活动层为空）'));
  for (const a of activities) console.log(activityLine(a));
}

function cmdPromote(args, flags) {
  needInit();
  const id = args[0];
  const g = replay(cwd());
  if (!id) fail('用法: blackboard promote <activity-id>');
  const activity = g.activities[refOrFail(g.activities, id, 'activity')];
  const type = flags.kind || flags.type || 'observation';
  const result = addNode({
    type,
    title: flags.title || activity.summary || `${activity.tool} 活动`,
    detail: flags.detail || flags.d || activity.output || '',
    at: activity.location?.path || activity.location || null,
    tags: ['promoted', String(activity.tool || 'tool').toLowerCase()],
    extra: { activityId: activity.id },
    enter: !!flags.enter,
    relateHere: !!flags['relate-here'],
    relation: flags.rel || null,
    reason: flags.reason || '',
  }, cwd());
  warnTruncated(result);
  if (flags.json) return out(flags, result);
  console.log(`${C.grn('提升 →')} ${nodeLine(result.node)}`);
}

function cmdState(cmd, args, flags) {
  needInit();
  const id = args[0];
  if (!id) fail(`用法: blackboard ${cmd} <id>`);
  const map = { done: 'done', block: 'blocked', revive: 'open' };
  const n = patchNode(id, { status: map[cmd] }, cwd());
  if (flags.json) return out(flags, n);
  if (!process.env.BLACKBOARD_QUIET) console.log(`${C.grn('✓')} ${nodeLine(n)}`);
}

function cmdEdit(args, flags) {
  needInit();
  const id = args[0];
  if (!id) fail('用法: blackboard edit <id> [--title …] [-d …] [--status …] [--sev …] [--confidence …]');
  const set = {};
  if (flags.title) set.title = String(flags.title);
  if (flags.detail || flags.d) set.detail = String(flags.detail || flags.d);
  if (flags.status) set.status = flags.status;
  if (flags.sev) set.severity = flags.sev;
  if (flags.confidence) set.confidence = flags.confidence;
  if (flags.tag) set.tags = [].concat(flags.tag);
  if (!Object.keys(set).length) fail('没有要修改的字段');
  const n = patchNode(id, set, cwd());
  warnTruncated(n);
  if (flags.json) return out(flags, n);
  if (!process.env.BLACKBOARD_QUIET) console.log(`${C.grn('✓')} ${nodeLine(n)}`);
}

function cmdLink(args, flags) {
  needInit();
  const [from, to] = args;
  if (!from || !to) fail('用法: blackboard link <from> <to> [--rel supports]');
  const kind = flags.rel || flags.kind || 'related-to';
  const edge = addEdge({ from, to, kind, label: flags.label || '' }, cwd());
  warnTruncated(edge);
  if (flags.json) return out(flags, edge);
  if (!process.env.BLACKBOARD_QUIET) {
    console.log(`${C.grn('+')} ${edge.from} ${C.dim(EDGE_LABEL[edge.kind] || edge.kind)} ${edge.to}`);
  }
}

function cmdUnlink(args, flags) {
  needInit();
  const [from, to] = args;
  if (!from || !to) fail('用法: blackboard unlink <from> <to> [--rel supports]');
  let edge;
  try { edge = removeEdge({ from, to, kind: flags.rel || flags.kind || null }, { by: flags.agent || defaultAgentId() }, cwd()); }
  catch (e) { return fail(e.message); }
  if (flags.json) return out(flags, edge);
  if (!process.env.BLACKBOARD_QUIET) {
    console.log(`${C.grn('−')} ${edge.from} ${C.dim(EDGE_LABEL[edge.kind] || edge.kind)} ${edge.to}`);
  }
}

function cmdRemove(args, flags) {
  needInit();
  if (!args[0]) fail('用法: blackboard remove <id> [--reason "…"]（节点及其关系从图上移除，事件日志仍保留历史）');
  let result;
  try { result = removeNode(args[0], { by: flags.agent || defaultAgentId(), reason: flags.reason || '' }, cwd()); }
  catch (e) { return fail(e.message); }
  if (flags.json) return out(flags, result);
  if (!process.env.BLACKBOARD_QUIET) {
    console.log(`${C.grn('−')} ${result.id}${result.edges.length ? C.dim(`（连带 ${result.edges.length} 条关系）`) : ''}`);
  }
}

function cmdReset(args, flags) {
  if (isInitialized(cwd()) && !flags.yes) {
    fail('这会清空整张图。确认请加 --yes');
  }
  ensure(cwd());
  reset(cwd());
  console.log(C.grn('已重置'));
}

async function cmdHooks(args, flags) {
  const { installHooks, uninstallHooks } = await import('../lib/hooks.js');
  const sub = args[0] || 'install';
  if (!['install', 'uninstall'].includes(sub)) {
    fail('用法: blackboard hooks install|uninstall [--write] [--user] [--with-activity]');
  }
  const scope = flags.user ? 'user' : 'project';
  const action = sub === 'install' ? installHooks : uninstallHooks;
  const res = action({
    cwd: cwd(), write: !!flags.write, cli: CLI, scope, withActivity: !!flags['with-activity'],
  });
  if (flags.json) return out(flags, res);
  console.log(res.plan);
  if (res.write) {
    console.log(C.grn(`${sub === 'install' ? '已写入' : '已移除 blackboard Hook'} ${res.file}`));
  }
  else console.log(C.dim('未写入。加 --write 应用。'));
  if (sub === 'install' && res.removed?.length) {
    console.log(C.yel(`已停用旧版默认安装的工具调用采集（${res.removed.join(', ')}）。需要时用 --with-activity 重新开启。`));
  }
  if (sub === 'install' && res.withActivity) {
    console.log(C.yel('已开启活动采集：Bash/Read/Grep 等的输入输出会写入 .blackboard/events.jsonl，并做尽力脱敏；Write/Edit 只记录路径。注意不要把 .blackboard/ 提交进仓库。'));
  }
  if (sub === 'install' && scope === 'project') {
    console.log(C.dim('提示：--user 可全局安装；全局 hook 只在有 .blackboard/ 的目录里生效。'));
  }
}

async function cmdSkill(args, flags) {
  const { installSkill } = await import('../lib/hooks.js');
  const sub = args[0] || 'install';
  if (sub !== 'install') fail('用法: blackboard skill install [--codex] [--project|--user]');
  const scope = flags.user ? 'user' : 'project';
  const agent = flags.codex ? 'codex' : 'claude';
  const message = installSkill({ cwd: cwd(), cli: CLI, scope, agent });
  if (flags.json) return out(flags, { agent, scope, message });
  console.log(message);
}

async function cmdService(args, flags) {
  const { workspaceServiceStatus, stopWorkspaceService } = await import('../lib/setup.js');
  const sub = args[0] || 'status';
  if (!['status', 'stop', 'uninstall'].includes(sub) || args.length > 1) {
    fail('用法: blackboard service status|stop|uninstall [--json]');
  }
  const result = sub === 'status'
    ? workspaceServiceStatus({ cwd: cwd() })
    : stopWorkspaceService({ cwd: cwd(), uninstall: sub === 'uninstall' });
  if (flags.json) return out(flags, result);
  console.log(`共享工作区服务: ${result.state} (${result.mode})`);
  if (result.cwd) console.log(`  归属 ${result.cwd} · ${result.currentProject ? '当前项目' : '其他项目'}`);
  if (result.file) console.log(`  配置 ${result.file}${result.removed ? ' · 已删除' : ''}`);
  if (result.message) console.log(`  ${result.message}`);
}

async function cmdLauncher(args, flags) {
  const { installLauncher } = await import('../lib/hooks.js');
  const res = installLauncher({ cli: CLI, scope: flags.project ? 'project' : 'user' });
  if (flags.json) return out(flags, res);
  console.log(`${C.grn('已安装')} ${res.file}`);
  if (!res.onPath) console.log(C.yel(`注意: ${res.dir} 不在 PATH 中，请把它加进 shell 配置。`));
}

async function hookEntry(event, args, flags) {
  const { runHook } = await import('../lib/hooks.js');
  let payload = {};
  try {
    const raw = fs.readFileSync(0, 'utf8');
    if (raw.trim()) payload = JSON.parse(raw);
  } catch {
    payload = {};
  }
  try {
    const res = runHook({ event, payload, cwd: cwd(), args });
    if (res && res.stdout) process.stdout.write(res.stdout);
    if (res && res.digestFile) {
      try {
        fs.writeFileSync(paths(cwd()).digest, res.digest || '');
      } catch {}
    }
  } catch (e) {
    // A hook must never break the host session.
    if (process.env.BLACKBOARD_DEBUG) console.error(e);
  }
}

main().catch((e) => {
  if (process.env.BLACKBOARD_DEBUG) console.error(e);
  else fail(e.message);
});
