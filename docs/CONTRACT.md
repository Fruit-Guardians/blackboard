# 公开契约 v2

适配层、Skill 和脚本只能依赖这份文档列出的东西。这里没列的（内部文件名、模块路径、给人看的文案）随时可能变。

本文档由测试守着：[`test/contract-output.test.js`](../test/contract-output.test.js) 用 [`test/fixtures/contract/`](../test/fixtures/contract/) 里的固定事件日志运行每条命令，把 `--json` 输出与存档逐字段比较；下文命令表也由同一个测试与存档、`capabilities` 核对。

## 契约包括什么

| 项 | 契约 | 不是契约 |
| --- | --- | --- |
| 命令与参数 | `capabilities.commands` 列出的命令名、文档化的参数 | `--help` 的排版和措辞 |
| 机器可读输出 | `--json` 输出的字段名、类型和含义 | 不带 `--json` 的文本输出 |
| 退出码 | 成功 0，失败 1 | stderr 的错误文字 |
| 事件格式 | `.blackboard/events.jsonl` 的每行事件、`eventVersion` | `state.json`、`lock`、`state.json.tmp`、`digest.md` 等其他文件 |
| 能力协商 | `capabilities --json` 的字段 | — |
| 环境变量 | 下文“环境变量”一节列出的 | 其他 `BLACKBOARD_*` 名字 |

## 兼容规则

沿用 [AGENT.md](../AGENT.md) 的约定：

- **加字段兼容。** 读取方必须忽略不认识的字段。
- **改语义、删字段或改类型不兼容**，要先升 schema 版本（如 `blackboard.context.v1` → `v2`），对象输出才能这样改。
- 事件格式同理：新字段、新操作不改 `EVENT_VERSION`；只有旧版本按旧逻辑回放会得到错误投影时才升。
- 给人读的文字不是契约，即使出现在 JSON 里：`lint` 的 `issues[].message`、`digest.digest`、`tail.tail` 的正文。它们的字段名和类型是契约，文字不是。`digest` 正文里的时间按本机时区显示（`MM-DD HH:mm`），同一块黑板在不同时区的机器上文字不同；需要准确时间请读 `context`、`history` 等输出里的毫秒时间戳。测试把 `lint` 的 `message` 换成占位符；`digest`、`tail` 的正文仍然存档，改文字时更新存档即可，不升版本。

## 从 v1 保留的四个决定

1. **冻结现有输出形状。** 裸数组输出（`ls`/`list`、`activity`）保持数组，不包成对象；它们的 schema 只在 `capabilities.outputs` 里声明。
2. **顶层是对象的输出都带 `schema` 字段**，放在第一个，包括直接返回节点、关系、检查点、活动记录的命令。`schema` 只出现在顶层：嵌在别的输出里的记录（如 `node` 输出里的 `node`、`ls` 数组里的每一项）不带。`schema` 在打印时加上，所以用 `--request-id` 重试时重放的旧结果也带它；`receipt` 输出里的 `result` 是写入时存下的原样结果，不带。
3. **写命令默认仍自动初始化。** 项目根没有黑板时，写命令会新建一块。适配层和 Skill 必须显式传 `--no-init`，此时缺黑板就以退出码 1 失败，不新建。
4. **错误 = 退出码 + stderr 文字。** 失败时退出码为 1，stdout 为空（即使带了 `--json`），原因写在 stderr。stderr 的措辞不是契约，调用方不要解析它。暂不提供 JSON 错误信封。

## 命令与固定输出

每行一条命令，别名与它共用一份存档，存档里至少有一个用例调用每个别名。“schema”列是顶层对象的 `schema` 字段，或数组每一项的 schema；“输出”列描述 `--json` 的顶层形状。同形的输出共用一个 schema，例如修改节点的四条命令都返回 `blackboard.node.v2`。

| 命令 | 别名 | 存档 | schema | 输出 |
| --- | --- | --- | --- | --- |
| `init` | — | `outputs/init.json` | `blackboard.init.v1` | 对象 `{schema, cwd, board, title, session}` |
| `status` | — | `outputs/status.json` | `blackboard.status.v2` | 对象 `{schema, stats, cursor, cursors, title, session, cwd, agentId, viewer, integration, latestNode}` |
| `node` | `start` `goal` `intent` `fact` `vuln` `hint` | `outputs/node.json` | `blackboard.node-add.v2` | 对象 `{schema, node, edge, edges, cursor}`；`edges` 是本次创建的全部关系（可能为空），`edge` 是其中第一条或 `null`，`cursor` 未发生时为 `null`；给了 `--label` 时关系带 `label`（`features.nodeEdgeLabel`）；`--to` 可重复（`features.nodeMultiTarget`） |
| `checkpoint` | `compact` | `outputs/checkpoint.json` | `blackboard.checkpoint.v1` | 检查点记录 `{schema, id, agentId, at, sessionId, cursorNodeId, summary, trigger, sincePrevious}`；`sincePrevious` 是同一身份上一检查点到本检查点之间的节点 `{added, updated, removed}` 与关系 `{added, removed}` 数量及上一检查点的 `checkpointId`、`at`，没有上一检查点时为 `null`（`features.checkpointDelta`） |
| `cursor` | `focus` | `outputs/cursor.json` | `blackboard.cursor.v1` | 对象 `{schema, cursor}`；不带参数时另有 `agentId` |
| `here` | — | `outputs/here.json` | `blackboard.here.v2` | 对象 `{schema, agentId, cursor, node, neighbors, trail}` |
| `activity` | — | `outputs/activity.json` | `blackboard.activity.v1` | 不带子命令：活动记录的数组，每项是 `blackboard.activity.v1`；`show`：单个活动记录 |
| `promote` | — | `outputs/promote.json` | `blackboard.node-add.v2` | 同 `node` |
| `batch` | — | `outputs/batch.json` | `blackboard.batch.v1` | 对象 `{schema, requestId, counts, results}`；`counts` 为 `{nodes, edges, edits}`；`results` 按输入顺序，每项带输入行号 `line` 与 `op`：`node` 项有 `node`、`edges` 及可选 `ref`，`link` 项有 `edge`，`edit` 项有修改后的 `node`；有截断时该项带 `truncated`。输入格式、必填 `--request-id` 与原子性见下文“批量写入” |
| `done` | — | `outputs/done.json` | `blackboard.node.v2` | 修改后的节点记录 |
| `block` | — | `outputs/block.json` | `blackboard.node.v2` | 修改后的节点记录 |
| `revive` | — | `outputs/revive.json` | `blackboard.node.v2` | 修改后的节点记录 |
| `edit` | — | `outputs/edit.json` | `blackboard.node.v2` | 修改后的节点记录 |
| `link` | — | `outputs/link.json` | `blackboard.edge.v1` | 关系记录 `{schema, id, from, to, kind, ts, author}`，可带 `label` |
| `unlink` | — | `outputs/unlink.json` | `blackboard.edge.v1` | 被断开的关系记录 |
| `remove` | `rm` | `outputs/remove.json` | `blackboard.remove.v1` | 对象 `{schema, id, edges}` |
| `ls` | `list` | `outputs/ls.json` | `blackboard.node.v2` | 节点记录的数组；默认最近 30 条，`--all` 返回全部匹配，截断提示写到 stderr |
| `show` | — | `outputs/show.json` | `blackboard.show.v2` | 对象 `{schema, node, parents, children}` |
| `digest` | — | `outputs/digest.json` | `blackboard.digest.v1` | 对象 `{schema, digest}`，正文为 Markdown |
| `context` | — | `outputs/context.json` | `blackboard.context.v2` | 恢复上下文，策略字段见下 |
| `lint` | — | `outputs/lint.json` | `blackboard.lint.v1` | 对象 `{schema, summary, issues}`；退出码恒为 0 |
| `tail` | — | `outputs/tail.json` | `blackboard.tail.v1` | 对象 `{schema, tail}` |
| `export` | — | `outputs/export.json` | `blackboard.export.v1` | 对象 `{schema, file, format}`；导出物的格式见下 |
| `reset` | — | `outputs/reset.json` | `blackboard.reset.v1` | 重置后的状态对象（见“已知缺口”） |
| `search` | — | `outputs/search.json` | `blackboard.search.v2` | 搜索结果；`--group-by` 增加 `groupBy` 和覆盖全部匹配的 `groups` |
| `history` | — | `outputs/history.json` | `blackboard.history.v2` | 单个节点的历史 |
| `changes` | — | `outputs/changes.json` | `blackboard.changes.v2` | 某检查点以来的变化 |
| `backup` | — | `outputs/backup.json` | `blackboard.backup-receipt.v1` | 备份回执 |
| `restore` | — | `outputs/restore.json` | `blackboard.restore-receipt.v1` | 恢复回执 |
| `receipt` | — | `outputs/receipt.json` | `blackboard.receipt.v1` | 写入回执 |
| `capabilities` | — | `outputs/capabilities.json` | `blackboard.capabilities.v1` | 能力协商对象，见下 |

写命令都接受 `--agent <名称>`、`--cwd <项目根>`、`--no-init`；`--request-id <稳定ID>` 用于可重试的写入，回执用 `receipt` 查询（见 [receipts.md](receipts.md)）。读命令和 `capabilities` 接受 `--cwd`；`capabilities` 描述 CLI 本身，不读取该项目。项目根的优先级是 `--cwd` > `BLACKBOARD_CWD` > 当前目录向上最近的黑板。选项写在命令之后。

`context` 的返回包必须始终带 `readOnly: true`、`prescriptive: false`、`nextStepSelection: "agent-controlled"`（在 `policy` 里）。`search`、`history`、`changes` 同样带 `readOnly: true`、`prescriptive: false`。

### 节点 JSON 的缺省维度（v2）

公开节点投影始终包含 `status`、`severity`、`confidence`，类型为记录的字符串或 `null`；只有未记录/值为 null 时输出 `null`，不按类型或其他字段推断。完整节点、邻域节点、历史前后值、context 中的压缩节点均遵守此规则；context 继续保留自己的 `location`/`at` 命名和预算约束。

写入同样不推断：自 0.9.0 起，没有 `--sev` 的 `vuln` 不再被写成 `medium`，严重度保持未记录。字段含义不变，因此不升 schema；更早写入的事件保留原值，回放不改写。

可选字符串扩展为可空字段，因此 `node`、`node-add`、`status`、`here`、`show`、`context`、`search`、`history`、`changes` 升为对应 `.v2`；`ls` 仍为裸数组，项版本由 capabilities 声明。`/api/graph`、SSE 和离线 HTML 的快照增加 `blackboard.graph.v2`；HTTP 节点创建/修改响应声明对应的 node-add/node v2。DSH 适配和前端随此版本切换，没有旧 schema 输出模式。

只规范化输出，不改写事件、回放图、请求指纹或缓存。`receipt.result` 是当时保存的原始写入结果，保持 v1 原样，可能没有这三个字段，也不补 schema；不能用它的原始结构与 v2 写响应做逐字段相等比较。字段级历史仍报告实际变化，不因补 null 生成虚假变更；节点不存在时仍为整体 `null`。

### 批量写入

`batch --request-id <ID> [--file <JSONL>] [--agent <名称>] [--no-truncate]` 把一组记录作为**一次请求**写入；不给 `--file` 时读 stdin。`--request-id` 必填：同一 ID、同样内容重试返回原结果且不再写入，内容不同返回 `request_id_conflict`；写到一半中断时回执为 pending，用同一 ID 重试按原计划补齐。`features.batch` 声明此命令，`limits.batchMaxOps`、`limits.batchMaxBytes` 给出单批上限。

输入每行一个 JSON 对象，空行忽略，开头的 UTF-8 BOM 忽略：

| `op` | 必填 | 可选 |
| --- | --- | --- |
| `node` | `type`、`title` | `detail`、`tags`、`at`、`status`、`severity`、`confidence`、`to`（ID 或 ID 数组）、`rel`、`label`、`ref`、`agent` |
| `link` | `from`、`to` | `rel`、`label`、`agent` |
| `edit` | `id`，以及 `title`、`detail`、`status`、`severity`、`confidence`、`tags` 中至少一个 | `agent` |

- `ref` 给本批新建的节点起本地名（`[A-Za-z0-9_-]`，最长 64），后续行用 `$名字` 引用；只能引用之前的行，名字在一批内唯一。
- 未知 `op` 或未知字段、类型不对、取值不合法、引用不存在，都使整批失败：退出码 1，stdout 为空，stderr 写明行号，日志不变。文本字段不接受空字符串或纯空白，`tags` 必须是非空数组（与 CLI 拒绝缺值的选项一致，批量写入不能借此清空字段）；`node` 的 `rel`、`label` 描述指向 `to` 的关系，没有 `to` 时报错而不是忽略。
- `agent` 只决定该行的作者（`author` / `updatedBy`），缺省用 `--agent`。批量写入不移动任何游标，不支持 `enter`、`relate-here`、`parent`，也不包含删除、重置、检查点和活动。
- 写入的是普通 `node`、`edge`、`patch` 事件加一个回执标记，与单条写入的事件相同；`receipt` 的 `command` 为 `batch`。文本上限与截断规则同单条写入，`--no-truncate` 作用于整批。

### 导出格式

`export [关键词] --format html|markdown|mermaid|sarif --out <文件>` 默认 `html`；默认文件分别为 `blackboard.html`、`blackboard.md`、`blackboard.mmd`、`blackboard.sarif`。成功的 `--json` 仅返回 `{schema, file, format}`，导出内容写入文件。已有黑板才可导出，不自动初始化；拒绝输出到黑板数据目录或当前黑板数据文件的硬链接。

三个报告格式复用 search 的关键词、类型、状态、严重度、可信度、重复标签、关系和关联节点筛选，读取**全部**匹配，没有 search 的明细上限。`--sort severity|time|id` 默认 severity（critical、high、medium、low、info，其余最后），同严重度按 ID 字典序；time 按更新时间/创建时间倒序，再按 ID。不会按置信度、节点类型或状态推定风险，也不自动排除 refuted/superseded。

Markdown/Mermaid 支持 `--group-by severity,status,tag:<键>` 的组合，含义与 search 相同。选中节点和一跳关联上下文分开呈现；证据、反证和未知关系按原方向保留，不递归补全关系。多组共享节点只展示一次，其余组保留引用或注释。原始工具活动不进入报告；标题/详情不被缩写或改写，已有输入截断标记照实呈现。

- **html**：保持完整、只读、自包含快照，不接受报告筛选、排序或分组，避免把未过滤的摘要误当筛选结果。快照中的原始活动输入/输出/摘要仍排除。
- **markdown**：完整的节点原文、三个独立维度、标签、作者/位置及显式关系；关联上下文包含支持/反驳节点的原文。记录标题进入章节标题，显式锚点供跨记录引用；作者文本经转义或安全代码块显示，不生成未记录的 POC、修复建议或裁定。
- **mermaid**：flowchart 源码；节点使用独立生成的安全标识，原 ID/标题保留在标签中，`related-to` 用带方向的虚线，其他关系为有向实线。`--max-nodes` 默认 200、接受正整数，先选中节点后上下文；超限在注释中列出省略节点/边数，不生成悬空边。多重组归属用注释保留。为匹配默认 Mermaid 消费端，显示边数超过 500 或源码长度超过 50,000 字符时失败，提示减少选中内容；不自动提高消费端限制、不截短原文或额外隐藏边。
- **sarif**：SARIF 2.1.0，仅将带有效已记录 `loc` 的 finding/vuln 转为结果；缺位置和不支持的类型逐项记入 `runs[].properties.skippedNodes`，`coverage` 报告选中/结果/省略数。无有效位置时是结果为空且省略原因可见的日志，不伪造代码位置。原始节点、证据/反证关系保存在 result properties，指纹基于节点 ID。消息文本按 SARIF 规则转义字面量花括号；`properties.node` 保持原始作者文本。代码路径按 URI 编码；只有正整数行/列才生成 region。`--group-by` 不用于 SARIF，`--max-nodes` 仅用于 Mermaid。

SARIF `level` 只映射记录的 severity：critical/high → error，medium → warning，low/info → note；缺省或未知 → none（kind=review）。status/confidence 原样独立保留。官方 schema 为 <https://docs.oasis-open.org/sarif/sarif/v2.1.0/os/schemas/sarif-schema-2.1.0.json>。未来路线图里的 `--as-of`、`--redact` 不属于本次导出参数，不宣称已实现。


### 查询、统计与列表完整性

`search [关键词]` 对关键词做大小写不敏感的字面量匹配，多词取交集。`--type`、`--status`、`--sev`、`--confidence` 按节点已记录的字段精确过滤，不从类型或其他字段推断；未填状态不等于 `open`，`refuted` 也不会因 confidence 已确认而自动排除。`--tag` 可重复，所有标签必须同时存在；`--tag auth --tag session` 是两个标签，`--tag auth,session` 是一个字面量标签。`--rel`、`--related-to` 仍按显式关系过滤。

基础输出保持 `{schema, readOnly, prescriptive, query, total, items, truncated}`：`total` 是全部匹配节点数；`items` 默认最多 30 条，`--limit` 接受 1–1000；`truncated` 仅表示明细是否被截断。

`--group-by <字段,...>` 接受 `severity`、`status` 和 `tag:<键>`，可组合，不接受空字段、重复字段或其他字段。指定时兼容地增加：

- `groupBy`：按调用顺序列出的分组字段数组。
- `groups`：`{values: {<字段>: <值或null>, ...}, count: <节点数>}` 数组。先应用全部筛选，再按全部匹配统计，不受 `--limit` 影响；没有匹配时为 `[]`。
- `tag:site` 只读取显式的 `site=<值>` 标签，其他 `tag:<键>` 同理。不从标题、详情或裸域名标签猜测归属；缺少该键或只有空值标签时计入 `null`。
- 一个节点对每种不同的标签值组合各计一次；重复标签值不重复计数。多站点或多值标签的节点可进入多个分组，所以分组数值之和可能超过 `total`。
- 未填写的字段独立计为 `null`，不写回节点或事件。分组按声明字段依次比较，字符串字典序，`null` 排在最后。不带 `--json` 时，分组模式只打印总数和全部分组；JSON 仍保留受限的 `items`。

`ls` / `list` 先应用类型和开放节点筛选，再按创建时间返回最近 30 条；`--limit` 调整条数，`--all` 返回全部匹配，两者互斥。截断时在 stderr 说明匹配数、返回数和省略数；stdout 仍只输出节点或 JSON 裸数组。stderr 是给人看的提示，不作为机器契约；程序需要总数时读取 `search.total`。


## 不在 v1 固定输出内的命令

这些命令也在 `capabilities.commands` 里，但输出依赖本机安装状态、常驻进程或只给人看，v1 不存档。它们的参数仍按兼容规则对待；它们的 `--json` 输出不带 `schema`，不在 `capabilities.outputs` 里，也不是契约。

| 命令 | 原因 |
| --- | --- |
| `setup` | 改动本机接入配置，输出依赖安装状态 |
| `hooks` | 安装/卸载 Hook，输出依赖本机配置 |
| `skill` | 安装 Skill，输出依赖本机配置 |
| `launcher` | 安装启动器 |
| `service` | 管理 macOS 常驻服务 |
| `release` | 安装与切换版本，只在开发仓库使用 |
| `serve` | 前台常驻进程，没有 `--json` |
| `tree` | 只有文本输出 |
| `hook` | 宿主 Hook 入口，输入输出由宿主协议决定 |
| `help` `version` | 只给人看 |

## 退出码

- `0`：成功。`lint` 无论发现什么都返回 0。
- `1`：失败，如参数错误、未知选项、引用不存在的节点或回执、`--no-init` 时缺黑板、读命令时缺黑板。失败时 stdout 为空。

固定输出测试为每条命令记录退出码，并包含若干失败用例（`show nope`、`edit nope`、`cursor nope`、`receipt` 缺参数或找不到、`goal … --no-init`）。

## 事件格式

`.blackboard/events.jsonl` 每行一个 JSON 事件，只追加：

- `eventVersion`：当前为 `1`。更高版本的事件回放时跳过并计数，写入在锁内拒绝。没有 `eventVersion` 的旧事件按版本 1 回放。
- `eventId`：每个事件唯一。
- `op`：`node`、`edge`、`patch`、`remove`（`kind: "node" | "edge"`）、`cursor`、`activity`、`checkpoint`、`meta`、`receipt`、`reset`。不认识的 `op` 被忽略并计入 `integrity.unknownOps`；无法解析的行被跳过并计数。两者都在 `lint` 里报告。
- 未知节点类型和未知关系类型必须原样保存和回放。

写命令的存档里同时记录了这次写入追加的事件（`events` 字段），所以事件格式的变化也会让测试失败。固定日志 `integrity.events.jsonl` 覆盖旧事件、坏行、未知操作、更高版本事件、未知类型和未知关系。

## capabilities

`capabilities --json` 是版本入口，不另设 `--version --json`：

- `schema`：`blackboard.capabilities.v1`。
- `schemaVersion`：本对象的版本，当前为 `1`。早于 `schema` 字段存在，保留。
- `version`：CLI 版本，与 `package.json` 一致。
- `eventVersion`：当前写入的事件版本。
- `runtime`、`commands`、`features`、`contextContract`、`limits`。
- `features.nodeJsonDefaults`：节点公开投影包含三个可空维度；具体版本仍以 `outputs` 为准。
- `features.nodeMultiTarget`：`node add` / 简写命令 / `promote` 的 `--to` 可重复，用同一关系连向多个已有节点；任一目标不存在时整次写入不发生。
- `features.checkpointDelta`：`checkpoint --json` 带 `sincePrevious`。
- `exportFormats`：当前支持 `html`、`markdown`、`mermaid`、`sarif`。
- `outputs`：每个契约输出的形状，以命令为键（`activity show` 单列）。对象输出是 `{shape: "object", schema}`，数组输出是 `{shape: "array", items}`。输出里的 `schema` 与这张表来自同一处，测试逐个用例核对。
- `writeTargets`：命令在项目根下会写的全部文件，每项是 `{path, role}`，`path` 相对项目根、用 `/` 分隔：

  | `path` | `role` |
  | --- | --- |
  | `.blackboard/events.jsonl` | `log` |
  | `.blackboard/lock` | `lock` |
  | `.blackboard/state.json` | `cache` |
  | `.blackboard/state.json.tmp` | `cache-temp` |
  | `.blackboard/config.json` | `config` |
  | `.blackboard/.gitignore` | `gitignore` |
  | `.blackboard/digest.md` | `digest` |

  除此之外，`export`、`backup`、`restore` 只写调用方显式给出的路径。适配层的写入授权应读这张表，不要写死文件名。测试对每个用例比较运行前后的项目目录，写到表外的文件就失败；锁和临时文件运行完即消失，只靠声明覆盖。

适配层用 `features` 做特性检测，用 `outputs` 确认要读的输出版本，不要比较版本号。

## 节点 ID

- 节点 ID 是不透明字符串。调用方原样保存和传回，不要解析它的格式；节点类型读 `type` 字段，不从 ID 前缀推断。现在的形式是按类型递增的短 ID（如 `g1`、`hy3`），这个形式不是契约。
- 一块黑板内 ID 唯一，并且不复用：删除的节点的 ID 也不会再分配。
- 不同黑板之间 ID 会重复。将来合并黑板时（见 [发展方向](ROADMAP.md) 阶段 10），本方 ID 不变；导入方与本方冲突的节点换新 ID，并记下它原来的黑板和 ID。导入记录的正文不改写，其中引用的旧 ID 通过记下的映射解析。
- 事件 ID（`eventId`）由时间、进程号和随机数生成，不同黑板之间实际不会重复，合并时用它去重。

## 环境变量

| 变量 | 作用 |
| --- | --- |
| `BLACKBOARD_CWD` | 项目根，优先级低于 `--cwd` |
| `BLACKBOARD_AGENT` | 写入身份和游标，优先级低于 `--agent`，默认 `agent:primary` |
| `BLACKBOARD_QUIET` | 设为任意值时，写命令不打印给人看的确认文字 |
| `BLACKBOARD_PORT` | 查看器端口，优先级低于 `--port` |
| `BLACKBOARD_LOCK_TIMEOUT_MS` | 等待事件写锁的毫秒数，默认 10000 |
| `BLACKBOARD_DEBUG` | 出错时把完整堆栈打到 stderr，仅用于调试 |

适配层应显式传 `--cwd`、`--agent`，不要依赖继承的环境变量。DSH 插件已这样做，并且不把继承来的 `BLACKBOARD_CWD`、`BLACKBOARD_AGENT` 传给子进程。

## 固定输出测试

```bash
npm test
```

- 固定日志：`research`（各类节点与关系、编辑、状态变化、断开与重连、两个检查点、两个游标、活动与提升、删除节点和关系、带 `--request-id` 的写入）、`empty`（刚初始化）、`integrity`（见上）。它们先用真实 CLI 生成，再把时间、ID、会话改成固定值，所以可以直接阅读和复现。
- 每个用例在固定日志的新副本上运行，带 `--json`，默认加 `--cwd`。HOME 被隔离，`BLACKBOARD_*` 环境被清空，查看器端口指向一个空闲端口，时区固定为 `TZ=UTC`。
- 运行时才产生的值换成占位符后再比较：临时目录 `<root>`、当前时间 `<now>`/`<now-iso>`、新生成的 ID `<event-id>`/`<cursor-id>`/`<session-id>`、端口 `<port>`、CLI 版本 `<package-version>`、`lint` 文字 `<human-text>`。其余每个字段的值都参与比较。

输出变了，测试就失败。按兼容规则处理：

- **加字段**：运行下面的命令重新生成存档，在 PR 里说明新增了什么。
- **改语义、删字段或改类型**：先升该输出的 schema 版本，再更新存档。

```bash
UPDATE_CONTRACT=1 node --test test/contract-output.test.js
```

新增命令时，要么在上面的命令表里加一行并在测试的 `CASES` 里加用例，要么把它列进“不在 v1 固定输出内的命令”。测试会核对 `capabilities.commands` 中的每个命令恰好出现一次。

## 已知缺口

- `reset --json` 返回的是内部状态对象（含 `seq` 等兼容字段），与 `state.json` 同形。v1 先冻结；以后改成独立的回执时要升版本。
- 路线图提到用 exp1 的事件前缀做固定日志。它是研究日志，含本机绝对路径，按 [AGENT.md](../AGENT.md) 的“安全与隐私”只留本地，不进公开测试；固定日志只用上面的合成数据。
