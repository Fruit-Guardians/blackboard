// `blackboard <command> --help`. Accepted options come from COMMAND_FLAGS and
// schemas from OUTPUTS, so this table only adds what they cannot say.
import { CONFIDENCE_LEVELS, NODE_STATES, SEVERITIES } from '../model.js';
import { OUTPUTS } from '../contracts.js';
import { DEFAULT_PORT } from '../service.js';
import { COMMAND_FLAGS } from './args.js';
import { C } from './format.js';

const ALIASES = {
  start: 'node', goal: 'node', intent: 'node', fact: 'node', vuln: 'node', hint: 'node',
  compact: 'checkpoint', focus: 'cursor', block: 'done', revive: 'done', rm: 'remove', list: 'ls',
};

const FLAGS = {
  agent: '身份：记为作者并决定使用哪个游标，默认 agent:primary',
  cwd: '项目根；优先于 BLACKBOARD_CWD 和向上查找',
  'no-init': '项目没有黑板时报错，不自动新建',
  'request-id': '稳定请求 ID；重试不重复写入，用 receipt 查询',
  'no-truncate': '文本超限时整次不写入，而不是截断',
  json: '输出 JSON',
  detail: '详情；证据、条件和过程写这里（-d）',
  tag: '标签，可重复（-t）',
  status: `状态：${NODE_STATES.join('|')}`,
  sev: `严重度：${SEVERITIES.join('|')}`,
  confidence: `可信度：${CONFIDENCE_LEVELS.join('|')}`,
  at: '文件位置，如 src/auth.js:42',
  to: '新节点指向已有节点，读作“新节点 <rel> id”；可重复',
  parent: '来源节点，读作“id <rel> 新节点”（兼容）',
  enter: '创建后把游标移到新节点',
  'relate-here': '与当前节点建立关系',
  rel: '关系类型，默认 related-to；未知关系照常保存',
  kind: '--rel 的同义写法',
  label: '关系说明',
  reason: '原因，记入事件',
  title: '标题',
  port: `查看器端口，默认取项目 viewerPort，否则 ${DEFAULT_PORT}`,
  limit: '返回条数上限（-n）',
  type: '按节点类型筛选',
  'related-to': '只看与该节点有显式关系的记录',
  'group-by': '分组字段：severity,status,tag:<键>，可组合',
  user: '安装到用户级',
  project: '安装到项目级（默认）',
};

const SEARCH_FLAGS = { limit: '明细上限 1–1000，默认 30（-n）', tag: '标签精确匹配，可重复，多个取交集（-t）' };

const HELP = {
  init: {
    about: '在项目根建立 .blackboard/。',
    usage: ['blackboard init [--title "任务标题"] [--here]'],
    flags: { title: '黑板标题', here: '上级已有黑板时仍在此处新建独立黑板' },
    examples: ['blackboard init --title "审计 synthetic-lib@1.0.0"'],
    output: '{schema, cwd, board, title, session}',
  },
  setup: {
    about: '一条龙配置 Claude Skill、恢复 Hook 和持久查看器。会改动本机接入配置。',
    usage: ['blackboard setup [目录] [选项]'],
    flags: {
      target: '项目目录，等同位置参数', title: '黑板标题', open: '完成后打开页面',
      'no-hooks': '不安装 Hook', 'no-skill': '不安装 Skill', 'no-serve': '不启动持久服务',
    },
    examples: ['blackboard setup --title "任务" --open', 'blackboard setup --no-hooks --no-serve'],
  },
  status: {
    about: '查看数据量、接入配置和查看器的实际探测结果。只读。',
    usage: ['blackboard status [--port <端口>]'],
    examples: ['blackboard status --cwd /path/to/project', 'blackboard status --json'],
    output: '{schema, stats, cursor, cursors, title, session, cwd, agentId, viewer, integration, latestNode}',
  },
  node: {
    about: '新增逻辑节点。默认不连边、不移动游标；类型开放，未知类型照常保存。',
    usage: [
      'blackboard node add <kind> "标题" [选项]',
      'blackboard start|goal|intent|fact|vuln|hint "标题" [选项]   node add 的简写',
    ],
    examples: [
      'blackboard node add hypothesis "待验证的判断" --confidence suspected --to g1 --enter',
      'blackboard fact "接口无鉴权返回 200" --at src/api.js:42 --to hy1 --rel supports --json',
    ],
    output: '{schema, node, edge, edges, cursor}；新 ID 在 node.id，edges 是本次创建的全部关系，edge 是其中第一条或 null，cursor 未移动时为 null',
  },
  checkpoint: {
    about: '创建恢复检查点，并回显自本身份上一检查点以来的变化。compact 是兼容别名。',
    usage: ['blackboard checkpoint [--summary "已确认内容；当前关注点；开放问题"]'],
    flags: {
      summary: '摘要；不给时用当前 Digest', title: '--summary 的同义写法',
      trigger: '触发来源标记，默认 manual', write: '同时写入 .blackboard/digest.md',
    },
    examples: ['blackboard checkpoint --summary "fd1 已复现；停在 q2；报告见 out/REPORT.md"'],
    output: '{schema, id, agentId, at, sessionId, cursorNodeId, summary, trigger, sincePrevious}；sincePrevious 是增量计数，首个检查点为 null',
  },
  cursor: {
    about: '移动当前游标，不创建逻辑边。不带参数时查看当前游标。focus 是兼容别名。',
    usage: ['blackboard cursor [<id>|none] [--reason "…"]'],
    examples: ['blackboard cursor q1 --reason "切到授权问题"', 'blackboard cursor none'],
    output: '{schema, cursor}；不带参数时另有 agentId',
  },
  here: {
    about: '查看当前节点、一跳邻域和最近轨迹。只读。',
    usage: ['blackboard here'],
    examples: ['blackboard here --agent audit-a1'],
    output: '{schema, agentId, cursor, node, neighbors, trail}',
  },
  activity: {
    about: '查看原始活动层。活动不是逻辑节点，默认不采集。',
    usage: ['blackboard activity [ls]', 'blackboard activity show <id>'],
    examples: ['blackboard activity ls --limit 10', 'blackboard activity show act1 --json'],
    output: 'ls：活动记录数组；show：单个活动记录',
  },
  promote: {
    about: '把一条活动提升为逻辑节点。',
    usage: ['blackboard promote <activity-id> [--kind observation] [--title "…"] [--to <id> --rel …]'],
    flags: { kind: '新节点类型', type: '--kind 的同义写法', detail: '详情（-d）' },
    examples: ['blackboard promote act1 --kind observation --title "登出后 token 仍有效" --to hy1 --rel supports'],
    output: '同 node add：{schema, node, edge, edges, cursor}',
  },
  batch: {
    about: '一次写入一组 node/link/edit：全部成功或一条都不写。不移动游标，不包含删除和检查点。',
    usage: [
      'blackboard batch --request-id <ID> [--file wave.jsonl]   不给 --file 时读 stdin',
      'blackboard batch --check [--file wave.jsonl]             只校验，不写入',
    ],
    flags: {
      file: 'JSONL 文件；不给时读 stdin',
      'request-id': '写入时必填；同一 ID、同样内容重试不重复写入',
      check: '按当前黑板完整校验一遍，不写入；通过后日志若有变化，实际写入仍可能失败',
      agent: '整批默认作者；每行可用 agent 覆盖',
      'no-truncate': '任一字段超限时整批不写入',
    },
    sections: [['输入格式（JSON Lines，每行一个对象，空行忽略）', [
      'op=node  必填 type title；可选 detail tags at status severity confidence to rel label ref agent',
      'op=link  必填 from to；可选 rel label agent',
      'op=edit  必填 id，以及 title detail status severity confidence tags 至少一个；可选 agent',
      'to 可以是 ID 或 ID 数组。ref 是本批内的名字，后续行写 "$名字" 引用，批次结束后失效；',
      '最终 ID 按类型分配，从 results[].node.id 读取。未知字段报错；单批上限见 capabilities.limits。',
    ]]],
    examples: [
      `blackboard batch --check --file wave-3.jsonl`,
      `blackboard batch --request-id wave-3 --file wave-3.jsonl --no-init --json`,
      `{"op":"node","ref":"h","type":"hypothesis","title":"过滤缺失","confidence":"suspected","to":"g1"}`,
      `{"op":"node","type":"observation","title":"未比对租户","at":"src/export.ts:42","to":"$h","rel":"supports"}`,
    ],
    output: '{schema, requestId, refs, counts: {nodes, edges, edits}, results}；refs 是批内名字到节点 ID 的映射；results[] 按输入顺序带 line 和 op：node 项有 node、edges 和可选 ref，link 项有 edge，edit 项有 node，截断时带 truncated。--check 另有 checked: true，ID 只是预计值',
  },
  done: {
    about: '修改节点状态：done 记为完成，block 记为受阻，revive 恢复为 open。',
    usage: ['blackboard done|block|revive <id>'],
    examples: ['blackboard block q1', 'blackboard revive q1 --json'],
    output: '修改后的节点字段在顶层：{schema, id, type, title, status, severity, confidence, …}，没有 node 包裹',
  },
  edit: {
    about: '修改节点字段；--detail 是替换，不是追加。',
    usage: ['blackboard edit <id> [--title …|-d …|--status …|--sev …|--confidence …|--tag …]'],
    flags: { title: '新标题', detail: '新详情，替换原文（-d）', tag: '标签，可重复，替换原有标签（-t）' },
    examples: ['blackboard edit fd1 --confidence reproduced', 'blackboard edit hy1 --status refuted --json'],
    output: '修改后的节点字段在顶层：{schema, id, type, title, status, severity, confidence, …}，没有 node 包裹；读 id，不是 node.id',
  },
  link: {
    about: '建立显式关系，读作“from <rel> to”。',
    usage: ['blackboard link <from> <to> [--rel supports] [--label "…"]'],
    examples: ['blackboard link o1 hy1 --rel supports', 'blackboard link o2 hy1 --rel contradicts --label "写接口返回 403"'],
    output: '{schema, id, from, to, kind, ts, author}，可带 label',
  },
  unlink: {
    about: '断开一条关系；两点间有多种关系时用 --rel 指定。',
    usage: ['blackboard unlink <from> <to> [--rel supports]'],
    examples: ['blackboard unlink o1 hy1 --rel supports'],
    output: '被断开的关系记录：{schema, id, from, to, kind, ts, author}',
  },
  remove: {
    about: '把节点及其关系从图上移除；事件日志保留历史。rm 是别名。',
    usage: ['blackboard remove <id> [--reason "…"]'],
    examples: ['blackboard remove hy3 --reason "重复记录"'],
    output: '{schema, id, edges}',
  },
  ls: {
    about: '按创建时间列出最近的节点；截断时在 stderr 说明数量。list 是别名。',
    usage: ['blackboard ls [--type hypothesis] [--open] [--limit 30 | --all]'],
    flags: {
      type: '节点类型（-t）', open: '只看开放的假设和问题', 'open-only': '同 --open',
      limit: '返回条数，默认 30（-n）', all: '返回全部匹配，与 --limit 互斥',
    },
    examples: ['blackboard ls --type finding --all', 'blackboard ls --open --json'],
    output: '节点记录的数组，无顶层 schema；程序要总数时读 search 的 total',
  },
  show: {
    about: '查看一个节点及其上下游关系。只读。',
    usage: ['blackboard show <id>'],
    examples: ['blackboard show fd1', 'blackboard show fd1 --json'],
    output: '{schema, node, parents, children}',
  },
  tree: {
    about: '按显式关系打印缩进树。只有文本输出。',
    usage: ['blackboard tree [-d 4]'],
    flags: { depth: '展开深度，默认 4（-d）' },
    examples: ['blackboard tree -d 8'],
  },
  tui: {
    about: '只读的交互式终端视图，给人用，日志变化时自动刷新。不写事件、不移动游标。Agent 和脚本用 context、search、show；非 TTY 时立即报错退出。',
    usage: ['blackboard tui [--agent <名称>]'],
    flags: { agent: '初始视角，只决定看谁的游标，进入后按 a 切换' },
    examples: ['blackboard tui', 'blackboard tui --agent audit-a1 --cwd /path/to/project'],
  },
  digest: {
    about: '生成当前节点、邻域、轨迹和开放节点的 Markdown 摘要。',
    usage: ['blackboard digest [--write] [--agent <名称>]'],
    flags: { write: '同时写入 .blackboard/digest.md', quiet: '配合 --write，不提示写入路径' },
    examples: ['blackboard digest --agent audit-a1'],
    output: '{schema, digest}，正文为 Markdown',
  },
  context: {
    about: 'Agent 恢复现场用的结构化上下文包，默认输出 JSON。只读，不建议下一步。',
    usage: ['blackboard context [--focus <id>] [--depth <0-5>] [--budget <tokens>] [--since <checkpoint|时间>]'],
    flags: {
      focus: '以该节点为焦点，不移动游标', depth: '邻域深度 0–5', budget: '近似 token 预算',
      since: '只看该检查点或时间之后的变化', limit: '每段条数上限（-n）', markdown: '输出便于人读的 Markdown（--md）',
    },
    examples: ['blackboard context --budget 4000', 'blackboard context --since cp2 --markdown'],
    output: '恢复上下文对象；policy 固定为 readOnly: true、prescriptive: false、nextStepSelection: "agent-controlled"；truncated 和 omitted 说明预算省略了什么',
  },
  lint: {
    about: '只读检查上下文质量。只报告，退出码恒为 0。',
    usage: ['blackboard lint'],
    examples: ['blackboard lint --json'],
    output: '{schema, summary, issues}',
  },
  tail: {
    about: '打印一行现状：节点、关系、开放项、活动和当前节点。',
    usage: ['blackboard tail'],
    examples: ['blackboard tail --agent audit-a1'],
    output: '{schema, tail}',
  },
  serve: {
    about: '在前台启动本地查看器，仅监听 127.0.0.1。Ctrl+C 或 blackboard stop 停止。',
    usage: [`blackboard serve [--port ${DEFAULT_PORT}] [--open] [--read-only]`],
    flags: {
      port: '监听端口；0 表示由系统分配空闲端口。实际端口记入项目配置',
      open: '启动后打开浏览器', 'read-only': '关闭页面编辑',
    },
    examples: ['blackboard serve --open', 'blackboard serve --port 0 --read-only'],
  },
  stop: {
    about: '停止当前项目的查看器。其他项目或无法识别的监听进程一律不动；不改动黑板数据。',
    usage: ['blackboard stop [--port <端口>]'],
    flags: { port: '要停止的端口；不给时用项目记录的端口。给了它时不操作共享服务' },
    examples: ['blackboard stop', 'blackboard stop --cwd /path/to/project --port 4334'],
    output: '{state, via, port, url, cwd}；state 为 stopped 或 not-running，via 为 process、launchd 或 null。不是契约输出，无 schema',
  },
  export: {
    about: '导出快照或报告。html 是完整只读快照；markdown/mermaid/sarif 支持筛选。',
    usage: ['blackboard export [关键词] [--format html|markdown|mermaid|sarif] [-o 文件] [筛选]'],
    flags: {
      out: '输出文件，默认 blackboard.<扩展名>（-o）', format: '导出格式，默认 html',
      type: '按节点类型筛选（报告格式）', tag: '标签精确匹配，可重复（-t）',
      sort: '排序：severity|time|id，默认 severity', 'group-by': 'Markdown/Mermaid 分组：severity,status,tag:<键>',
      'max-nodes': 'Mermaid 节点上限，默认 200，省略部分写入注释',
    },
    examples: ['blackboard export --format markdown --sev high -o report.md', 'blackboard export --format sarif --type vuln -o findings.sarif'],
    output: '{schema, file, format}；内容写入文件',
  },
  reset: {
    about: '清空图。必须加 --yes。',
    usage: ['blackboard reset --yes'],
    flags: { yes: '确认清空' },
    examples: ['blackboard reset --yes --cwd /path/to/demo'],
    output: '重置后的状态对象',
  },
  search: {
    about: '搜索全部节点；关键词大小写不敏感，多词取交集，筛选只读记录的字段。',
    usage: ['blackboard search [关键词] [筛选] [--group-by …] [--limit <1-1000>]'],
    flags: SEARCH_FLAGS,
    examples: ['blackboard search "tenant" --json', 'blackboard search --type vuln --group-by severity,status'],
    output: '{schema, readOnly, prescriptive, query, total, items, truncated}；total 是全部匹配数，--group-by 另有 groupBy 和 groups',
  },
  history: {
    about: '查看一个节点及其关系的变更历史，含已删除节点。',
    usage: ['blackboard history <id>'],
    examples: ['blackboard history fd1 --json'],
    output: '单个节点的历史，带 readOnly 和 prescriptive',
  },
  changes: {
    about: '查看某检查点以来的差异与事件过程。',
    usage: ['blackboard changes --since <checkpoint>'],
    flags: { since: '起点检查点 ID' },
    examples: ['blackboard changes --since cp2 --json'],
    output: '某检查点以来的变化，带 readOnly 和 prescriptive',
  },
  backup: {
    about: '把原始事件和校验清单写到新目录。',
    usage: ['blackboard backup --out <新备份目录>'],
    flags: { out: '备份目录，必须是新目录（-o）' },
    examples: ['blackboard backup --out /tmp/board-backup --json'],
    output: '备份回执',
  },
  restore: {
    about: '把备份恢复到尚无黑板的目录。',
    usage: ['blackboard restore <备份目录> --into <项目目录>'],
    flags: { into: '目标项目目录，不能已有黑板' },
    examples: ['blackboard restore /tmp/board-backup --into /tmp/board-restored --json'],
    output: '恢复回执',
  },
  receipt: {
    about: '只读查询一次带 --request-id 的写入是否完成。',
    usage: ['blackboard receipt <request-id>'],
    examples: ['blackboard receipt wave-3 --json'],
    output: '写入回执；其中 result 保留写入时的原样结果，不规范化',
  },
  capabilities: {
    about: '接入层能力协商：命令、特性、输出 schema、上限和写入路径。',
    usage: ['blackboard capabilities'],
    examples: ['blackboard capabilities --json'],
    output: '{schema, schemaVersion, version, eventVersion, runtime, commands, features, exportFormats, contextContract, limits, outputs, writeTargets}',
  },
  hooks: {
    about: '安装或卸载 Claude Code 恢复 Hook。不加 --write 时只打印计划。',
    usage: ['blackboard hooks install|uninstall [--write] [--user|--project]'],
    flags: { write: '实际写入配置', 'with-activity': '额外采集工具活动（可能含敏感内容，默认关闭）' },
    examples: ['blackboard hooks install --user --write', 'blackboard hooks uninstall --project --write'],
  },
  skill: {
    about: '安装完整 Skill 包到 Claude 或 Codex。',
    usage: ['blackboard skill install [--codex] [--user|--project]'],
    flags: { codex: '安装到 Codex 而不是 Claude' },
    examples: ['blackboard skill install --user', 'blackboard skill install --codex'],
  },
  launcher: {
    about: '安装 blackboard 启动器。',
    usage: ['blackboard launcher [--user|--project]'],
    examples: ['blackboard launcher --user'],
  },
  service: {
    about: '管理 macOS 共享工作区服务。它可能属于其他项目；只想关闭当前项目的查看器时用 blackboard stop。',
    usage: ['blackboard service status|stop|uninstall'],
    examples: ['blackboard service status --json', 'blackboard service stop'],
  },
  release: {
    about: '管理已安装的不可变版本。install 只在开发仓库里运行。',
    usage: ['blackboard release install [--force]', 'blackboard release use <版本>', 'blackboard release ls'],
    flags: { force: '覆盖已安装的同版本' },
    examples: ['blackboard release ls --json', 'blackboard release use 0.10.1'],
  },
  hook: {
    about: '宿主 Hook 入口，由宿主调用，不需要手动运行。',
    usage: ['blackboard hook <event>'],
    examples: ['blackboard hook SessionStart'],
  },
  help: {
    about: '查看全部命令，或某个命令的参数、示例和 --json 输出。',
    usage: ['blackboard help [命令]'],
    examples: ['blackboard help batch'],
  },
  version: {
    about: '打印版本和当前 CLI 来源。',
    usage: ['blackboard version'],
    examples: ['blackboard version'],
  },
};

export const commandHelpFor = (command) => (Object.hasOwn(HELP, ALIASES[command] || command) ? ALIASES[command] || command : null);

export function commandHelp(command) {
  const name = commandHelpFor(command);
  const entry = HELP[name];
  const b = C.bold;
  const list = (lines) => lines.map((line) => `  ${line}`).join('\n');
  const options = (COMMAND_FLAGS[name] || '').split(' ').filter(Boolean)
    .map((flag) => `--${flag.padEnd(14)} ${entry.flags?.[flag] || FLAGS[flag]}`);
  const output = !(name in OUTPUTS) && !entry.output ? null
    : name in OUTPUTS ? `${OUTPUTS[name].schema || OUTPUTS[name].items} · ${entry.output}` : entry.output;
  const aliases = Object.keys(ALIASES).filter((alias) => ALIASES[alias] === name);
  const sections = [
    `${b(`blackboard ${name}`)}${aliases.length ? C.dim(`（${aliases.join('、')}）`) : ''} — ${entry.about}`,
    `${b('用法')}\n${list(entry.usage)}`,
    ...(options.length ? [`${b('选项')}\n${list(options)}`] : []),
    ...(entry.sections || []).map(([title, lines]) => `${b(title)}\n${list(lines)}`),
    `${b('示例')}\n${list(entry.examples)}`,
    ...(output ? [`${b('--json 输出')}\n${list([output])}`] : []),
  ];
  return `\n${sections.join('\n\n')}\n`;
}
