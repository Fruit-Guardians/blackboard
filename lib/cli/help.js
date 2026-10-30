import { DEFAULT_PORT } from '../service.js';
import { C } from './format.js';

export function usage() {
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
            --to <id>                  新节点指向已有节点，读作 “新节点 <rel> id”；可重复，同一关系连多个节点
            --parent <id>              显式来源节点，读作 “id <rel> 新节点”（兼容）
            --rel <relation>           上述关系的类型，默认 related-to
            --label <text>             上述关系的说明，同 link --label
            --at <file:line>           文件位置
            --detail/-d                详情
            --tag/-t                   可重复标签
            --status <state>           可选状态
            --sev <severity>           严重度
            --confidence <level>       suspected|static-confirmed|reproduced|confirmed
            --no-truncate              超限时整条不保存；同样适用于 edit/link/checkpoint/promote

${b('游标与关系')}
  blackboard cursor <id|none> [--reason "…"] 只移动当前游标，不创建逻辑边
  blackboard focus <id>                      cursor 的兼容别名
  blackboard here                            当前节点、邻域和最近轨迹
  blackboard link <from> <to> [--rel supports]   读作 “from <rel> to”，如 link 观察 猜测 --rel supports
  blackboard unlink <from> <to> [--rel supports] 断开一条关系
  blackboard remove <id> [--reason "…"]      把节点及其关系从图上移除（日志保留历史）
  blackboard done|block|revive <id>          修改节点状态
  blackboard edit <id> [--title …|-d …|--status …|--sev …|--confidence …]

${b('批量写入')}
  blackboard batch --request-id <ID> [--file wave.jsonl]   一次写入多条 node/link/edit；全部成功或全部不写
  blackboard batch --check [--file wave.jsonl]             只校验，不写入；格式见 blackboard batch --help
    每行一个 JSON：{"op":"node","ref":"h","type":"hypothesis","title":"…","to":"g1"}；后续行用 "$h" 引用
    不移动游标；同一 ID 重试不重复写入；不给 --file 时读 stdin

${b('恢复与查看')}
  blackboard checkpoint [--summary "…"]      创建恢复检查点；回显自本身份上一检查点以来的节点与关系变化
  blackboard compact [--summary "…"]         checkpoint 的兼容别名
  blackboard activity ls|show [id]           查看原始活动层
  blackboard promote <activity-id> [--kind observation] [--title "…"] [--to <id> --rel …]
  blackboard digest [--write] [--agent <名称>] 当前节点/邻域/轨迹/开放节点
  blackboard context [选项]                  Agent 可读的结构化上下文包
    --focus <id> --depth <0-5> --budget <tokens> --since <checkpoint|timestamp>
    默认输出 JSON；--markdown 输出便于人读的摘要
  blackboard lint [--json]                   只读检查上下文质量，不修改也不拦截
  blackboard ls [--type hypothesis] [--open] [--limit 30 | --all]
  blackboard show <id>
  blackboard search [关键词] [--type … --tag … --status … --sev … --confidence …]
    --rel … --related-to <id> --limit <1-1000> --json
    --group-by severity,status,tag:site       按全部匹配统计；未填写单列为 null
    --tag site=example.test --tag auth        标签精确匹配，多个标签取交集
  blackboard history <id> [--json]           节点与关联变更历史（含已删除节点）
  blackboard changes --since <checkpoint> [--json]   交接后差异与事件过程
  blackboard backup --out <新备份目录> [--json]      原始事件＋校验清单
  blackboard restore <备份目录> --into <项目目录> [--json]  恢复到未建黑板的目录
  blackboard receipt <request-id> [--json]   只读查询提交回执
  blackboard capabilities [--json]          接入层能力协商
  blackboard tree [-d 4]
  blackboard tail
  blackboard tui [--agent <名称>]            只读的交互式终端视图，给人用；Agent 和脚本用 context/search/show
  blackboard serve [--port ${DEFAULT_PORT}] [--open] [--read-only]   前台查看器；--read-only 关闭页面编辑
  blackboard stop [--port <端口>]            停止当前项目的查看器，不动其他项目
  blackboard export [关键词] [--format html|markdown|mermaid|sarif] [-o 文件]
    报告筛选: --type … --status … --sev … --confidence … --tag … --rel … --related-to …
    --sort severity|time|id                 报告默认按严重度、再按 ID 排序
    --group-by tag:site,severity,status     Markdown/Mermaid 分组
    --max-nodes <数量>                       Mermaid 节点上限，默认 200，明确报告省略
  blackboard reset --yes

${b('宿主接入与服务')}
  blackboard hooks install|uninstall [--write] [--user|--project]   仅 Claude Code 恢复 Hook
    --with-activity  安装时额外采集工具活动（可能含敏感内容，默认关闭）
  blackboard skill install [--codex] [--user|--project]   安装 Claude 或 Codex Skill
  blackboard service status|stop|uninstall [--json]   管理 macOS 共享工作区服务
  blackboard launcher
  blackboard hook <event>

${b('版本发布')}
  blackboard release install [--force]      在开发仓库里运行：复制成独立版本并切换 current
  blackboard release use <版本>              切换或回滚到已安装的版本
  blackboard release ls [--json]             列出已安装版本
  启动器、用户级 Skill/Hook 和常驻服务只指向 current；install/use 后会从新版本刷新它们。

node/edit/link/unlink/remove/cursor/checkpoint/reset 等写命令可加 --request-id <稳定ID>；同一操作重试复用同ID，receipt 可查询提交状态。
写命令都接受 --agent <名称>（记为节点、关系和修改的作者，并决定移动哪个游标）、--cwd <项目根>、--no-init（项目根没有黑板时报错，不自动新建）。
读命令同样接受 --cwd；优先级 --cwd > BLACKBOARD_CWD > 当前目录向上最近的黑板。
每个命令都有独立帮助：blackboard <命令> --help 或 blackboard help <命令>，含选项、示例和 --json 输出形状。
除 tree、tui、serve、hook 外都支持 --json（带 schema，capabilities.outputs 列出全部），写命令用 --json 读取新节点 ID。输出是单行紧凑 JSON；要看缩进请接 jq。
带 --json 失败时 stdout 为空，stderr 是一行 blackboard.error.v1：读 code，有 suggestion 时可据此改正后重试。
选项写在命令之后：blackboard <命令> --cwd <项目根> …
端口优先级: --port > BLACKBOARD_PORT > 项目 viewerPort > ${DEFAULT_PORT}；地址统一为 127.0.0.1。
环境变量: BLACKBOARD_CWD 指定项目根；BLACKBOARD_QUIET=1 静默；BLACKBOARD_AGENT=name 让并行的 Agent 各用各的身份和游标（默认 agent:primary；--agent 优先）。
`);
}

