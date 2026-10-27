# 公开契约 v1

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

## v1 的四个决定

1. **冻结现有输出形状。** 裸数组输出（`ls`/`list`、`activity`）保持数组，不包成对象；它们的 schema 只在 `capabilities.outputs` 里声明。
2. **顶层是对象的输出都带 `schema` 字段**，放在第一个，包括直接返回节点、关系、检查点、活动记录的命令。`schema` 只出现在顶层：嵌在别的输出里的记录（如 `node` 输出里的 `node`、`ls` 数组里的每一项）不带。`schema` 在打印时加上，所以用 `--request-id` 重试时重放的旧结果也带它；`receipt` 输出里的 `result` 是写入时存下的原样结果，不带。
3. **写命令默认仍自动初始化。** 项目根没有黑板时，写命令会新建一块。适配层和 Skill 必须显式传 `--no-init`，此时缺黑板就以退出码 1 失败，不新建。
4. **错误 = 退出码 + stderr 文字。** 失败时退出码为 1，stdout 为空（即使带了 `--json`），原因写在 stderr。stderr 的措辞不是契约，调用方不要解析它。暂不提供 JSON 错误信封。

## 命令与固定输出

每行一条命令，别名与它共用一份存档，存档里至少有一个用例调用每个别名。“schema”列是顶层对象的 `schema` 字段，或数组每一项的 schema；“输出”列描述 `--json` 的顶层形状。同形的输出共用一个 schema，例如修改节点的四条命令都返回 `blackboard.node.v1`。

| 命令 | 别名 | 存档 | schema | 输出 |
| --- | --- | --- | --- | --- |
| `init` | — | `outputs/init.json` | `blackboard.init.v1` | 对象 `{schema, cwd, board, title, session}` |
| `status` | — | `outputs/status.json` | `blackboard.status.v1` | 对象 `{schema, stats, cursor, cursors, title, session, cwd, agentId, viewer, integration, latestNode}` |
| `node` | `start` `goal` `intent` `fact` `vuln` `hint` | `outputs/node.json` | `blackboard.node-add.v1` | 对象 `{schema, node, edge, cursor}`；`edge`、`cursor` 未发生时为 `null`；给了 `--label` 时 `edge` 带 `label`（`features.nodeEdgeLabel`） |
| `checkpoint` | `compact` | `outputs/checkpoint.json` | `blackboard.checkpoint.v1` | 检查点记录 `{schema, id, agentId, at, sessionId, cursorNodeId, summary, trigger}` |
| `cursor` | `focus` | `outputs/cursor.json` | `blackboard.cursor.v1` | 对象 `{schema, cursor}`；不带参数时另有 `agentId` |
| `here` | — | `outputs/here.json` | `blackboard.here.v1` | 对象 `{schema, agentId, cursor, node, neighbors, trail}` |
| `activity` | — | `outputs/activity.json` | `blackboard.activity.v1` | 不带子命令：活动记录的数组，每项是 `blackboard.activity.v1`；`show`：单个活动记录 |
| `promote` | — | `outputs/promote.json` | `blackboard.node-add.v1` | 同 `node` |
| `done` | — | `outputs/done.json` | `blackboard.node.v1` | 修改后的节点记录 |
| `block` | — | `outputs/block.json` | `blackboard.node.v1` | 修改后的节点记录 |
| `revive` | — | `outputs/revive.json` | `blackboard.node.v1` | 修改后的节点记录 |
| `edit` | — | `outputs/edit.json` | `blackboard.node.v1` | 修改后的节点记录 |
| `link` | — | `outputs/link.json` | `blackboard.edge.v1` | 关系记录 `{schema, id, from, to, kind, ts, author}`，可带 `label` |
| `unlink` | — | `outputs/unlink.json` | `blackboard.edge.v1` | 被断开的关系记录 |
| `remove` | `rm` | `outputs/remove.json` | `blackboard.remove.v1` | 对象 `{schema, id, edges}` |
| `ls` | `list` | `outputs/ls.json` | `blackboard.node.v1` | 节点记录的数组，每项是 `blackboard.node.v1` |
| `show` | — | `outputs/show.json` | `blackboard.show.v1` | 对象 `{schema, node, parents, children}` |
| `digest` | — | `outputs/digest.json` | `blackboard.digest.v1` | 对象 `{schema, digest}`，正文为 Markdown |
| `context` | — | `outputs/context.json` | `blackboard.context.v1` | 恢复上下文，策略字段见下 |
| `lint` | — | `outputs/lint.json` | `blackboard.lint.v1` | 对象 `{schema, summary, issues}`；退出码恒为 0 |
| `tail` | — | `outputs/tail.json` | `blackboard.tail.v1` | 对象 `{schema, tail}` |
| `export` | — | `outputs/export.json` | `blackboard.export.v1` | 对象 `{schema, file}`，`file` 为绝对路径 |
| `reset` | — | `outputs/reset.json` | `blackboard.reset.v1` | 重置后的状态对象（见“已知缺口”） |
| `search` | — | `outputs/search.json` | `blackboard.search.v1` | 搜索结果 |
| `history` | — | `outputs/history.json` | `blackboard.history.v1` | 单个节点的历史 |
| `changes` | — | `outputs/changes.json` | `blackboard.changes.v1` | 某检查点以来的变化 |
| `backup` | — | `outputs/backup.json` | `blackboard.backup-receipt.v1` | 备份回执 |
| `restore` | — | `outputs/restore.json` | `blackboard.restore-receipt.v1` | 恢复回执 |
| `receipt` | — | `outputs/receipt.json` | `blackboard.receipt.v1` | 写入回执 |
| `capabilities` | — | `outputs/capabilities.json` | `blackboard.capabilities.v1` | 能力协商对象，见下 |

写命令都接受 `--agent <名称>`、`--cwd <项目根>`、`--no-init`；`--request-id <稳定ID>` 用于可重试的写入，回执用 `receipt` 查询（见 [receipts.md](receipts.md)）。读命令接受 `--cwd`。项目根的优先级是 `--cwd` > `BLACKBOARD_CWD` > 当前目录向上最近的黑板。

`context` 的返回包必须始终带 `readOnly: true`、`prescriptive: false`、`nextStepSelection: "agent-controlled"`（在 `policy` 里）。`search`、`history`、`changes` 同样带 `readOnly: true`、`prescriptive: false`。

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

固定输出测试为每条命令记录退出码，并包含若干失败用例（`show nope`、`edit nope`、`cursor nope`、`receipt` 缺参数或找不到、`capabilities --cwd`、`goal … --no-init`）。

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
