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
- 给人读的文字不是契约，即使出现在 JSON 里：`lint` 的 `issues[].message`、`digest.digest`、`tail.tail` 的正文。它们的字段名和类型是契约，文字不是。测试把 `lint` 的 `message` 换成占位符；`digest`、`tail` 的正文仍然存档，改文字时更新存档即可，不升版本。

## v1 的四个决定

1. **冻结现有输出形状。** 本 PR 不改任何 CLI 输出。裸数组输出（`ls`/`list`、`activity`）保持数组，不包成对象；它们的 schema 只在 `capabilities` 里声明（下一个 PR）。
2. **对象输出带 `schema` 字段**，作为加字段，在下一个 PR 做。目前已带的有：`blackboard.context.v1`、`blackboard.search.v1`、`blackboard.history.v1`、`blackboard.changes.v1`、`blackboard.receipt.v1`、`blackboard.backup-receipt.v1`、`blackboard.restore-receipt.v1`。
3. **写命令默认仍自动初始化。** 项目根没有黑板时，写命令会新建一块。适配层和 Skill 必须显式传 `--no-init`，此时缺黑板就以退出码 1 失败，不新建。
4. **错误 = 退出码 + stderr 文字。** 失败时退出码为 1，stdout 为空（即使带了 `--json`），原因写在 stderr。stderr 的措辞不是契约，调用方不要解析它。暂不提供 JSON 错误信封。

## 命令与固定输出

每行一条命令，别名与它共用一份存档，存档里至少有一个用例调用每个别名。“输出”列描述 `--json` 的顶层形状。

| 命令 | 别名 | 存档 | 输出 |
| --- | --- | --- | --- |
| `init` | — | `outputs/init.json` | 对象 `{cwd, board, title, session}` |
| `status` | — | `outputs/status.json` | 对象 `{stats, cursor, cursors, title, session, cwd, agentId, viewer, integration, latestNode}` |
| `node` | `start` `goal` `intent` `fact` `vuln` `hint` | `outputs/node.json` | 对象 `{node, edge, cursor}`；`edge`、`cursor` 未发生时为 `null` |
| `checkpoint` | `compact` | `outputs/checkpoint.json` | 检查点对象 `{id, agentId, at, sessionId, cursorNodeId, summary, trigger}` |
| `cursor` | `focus` | `outputs/cursor.json` | 对象 `{cursor}` |
| `here` | — | `outputs/here.json` | 对象 `{agentId, cursor, node, neighbors, trail}` |
| `activity` | — | `outputs/activity.json` | `ls`：活动数组；`show`：单个活动对象 |
| `promote` | — | `outputs/promote.json` | 同 `node` |
| `done` | — | `outputs/done.json` | 修改后的节点对象 |
| `block` | — | `outputs/block.json` | 修改后的节点对象 |
| `revive` | — | `outputs/revive.json` | 修改后的节点对象 |
| `edit` | — | `outputs/edit.json` | 修改后的节点对象 |
| `link` | — | `outputs/link.json` | 关系对象 `{id, from, to, kind, ts, author}`，可带 `label` |
| `unlink` | — | `outputs/unlink.json` | 被断开的关系对象 |
| `remove` | `rm` | `outputs/remove.json` | 对象 `{id, edges}` |
| `ls` | `list` | `outputs/ls.json` | 节点数组 |
| `show` | — | `outputs/show.json` | 对象 `{node, parents, children}` |
| `digest` | — | `outputs/digest.json` | 对象 `{digest}`，正文为 Markdown |
| `context` | — | `outputs/context.json` | `blackboard.context.v1`，策略字段见下 |
| `lint` | — | `outputs/lint.json` | 对象 `{summary, issues}`；退出码恒为 0 |
| `tail` | — | `outputs/tail.json` | 对象 `{tail}` |
| `export` | — | `outputs/export.json` | 对象 `{file}`，为绝对路径 |
| `reset` | — | `outputs/reset.json` | 重置后的状态对象（见“已知缺口”） |
| `search` | — | `outputs/search.json` | `blackboard.search.v1` |
| `history` | — | `outputs/history.json` | `blackboard.history.v1` |
| `changes` | — | `outputs/changes.json` | `blackboard.changes.v1` |
| `backup` | — | `outputs/backup.json` | `blackboard.backup-receipt.v1` |
| `restore` | — | `outputs/restore.json` | `blackboard.restore-receipt.v1` |
| `receipt` | — | `outputs/receipt.json` | `blackboard.receipt.v1` |
| `capabilities` | — | `outputs/capabilities.json` | 能力协商对象，见下 |

写命令都接受 `--agent <名称>`、`--cwd <项目根>`、`--no-init`；`--request-id <稳定ID>` 用于可重试的写入，回执用 `receipt` 查询（见 [receipts.md](receipts.md)）。读命令接受 `--cwd`。项目根的优先级是 `--cwd` > `BLACKBOARD_CWD` > 当前目录向上最近的黑板。

`context` 的返回包必须始终带 `readOnly: true`、`prescriptive: false`、`nextStepSelection: "agent-controlled"`（在 `policy` 里）。`search`、`history`、`changes` 同样带 `readOnly: true`、`prescriptive: false`。

## 不在 v1 固定输出内的命令

这些命令也在 `capabilities.commands` 里，但输出依赖本机安装状态、常驻进程或只给人看，v1 不存档。它们的参数仍按兼容规则对待。

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

- `schemaVersion`：本对象的版本，当前为 `1`。
- `version`：CLI 版本，与 `package.json` 一致。
- `eventVersion`：当前写入的事件版本。
- `runtime`、`commands`、`features`、`contextContract`、`limits`。

适配层用 `features` 做特性检测，不要比较版本号。

## 环境变量

| 变量 | 作用 |
| --- | --- |
| `BLACKBOARD_CWD` | 项目根，优先级低于 `--cwd` |
| `BLACKBOARD_AGENT` | 写入身份和游标，优先级低于 `--agent`，默认 `agent:primary` |
| `BLACKBOARD_QUIET` | 设为任意值时，写命令不打印给人看的确认文字 |
| `BLACKBOARD_PORT` | 查看器端口，优先级低于 `--port` |
| `BLACKBOARD_LOCK_TIMEOUT_MS` | 等待事件写锁的毫秒数，默认 10000 |
| `BLACKBOARD_DEBUG` | 出错时把完整堆栈打到 stderr，仅用于调试 |

适配层应显式传 `--cwd`、`--agent`，不要依赖继承的环境变量（见阶段 2）。

## 固定输出测试

```bash
npm test
```

- 固定日志：`research`（各类节点与关系、编辑、状态变化、断开与重连、两个检查点、两个游标、活动与提升、删除节点和关系、带 `--request-id` 的写入）、`empty`（刚初始化）、`integrity`（见上）。它们先用真实 CLI 生成，再把时间、ID、会话改成固定值，所以可以直接阅读和复现。
- 每个用例在固定日志的新副本上运行，带 `--json`，默认加 `--cwd`。HOME 被隔离，`BLACKBOARD_*` 环境被清空，查看器端口指向一个空闲端口。
- 运行时才产生的值换成占位符后再比较：临时目录 `<root>`、当前时间 `<now>`/`<now-iso>`、新生成的 ID `<event-id>`/`<cursor-id>`/`<session-id>`、端口 `<port>`、CLI 版本 `<package-version>`、`lint` 文字 `<human-text>`。其余每个字段的值都参与比较。

输出变了，测试就失败。按兼容规则处理：

- **加字段**：运行下面的命令重新生成存档，在 PR 里说明新增了什么。
- **改语义、删字段或改类型**：先升该输出的 schema 版本，再更新存档。

```bash
UPDATE_CONTRACT=1 node --test test/contract-output.test.js
```

新增命令时，要么在上面的命令表里加一行并在测试的 `CASES` 里加用例，要么把它列进“不在 v1 固定输出内的命令”。测试会核对 `capabilities.commands` 中的每个命令恰好出现一次。

## 已知缺口

- 多数对象输出还没有 `schema` 字段；`capabilities` 还没有命令到 schema 的映射。下一个 PR 补上，属于加字段。
- `reset --json` 返回的是内部状态对象（含 `seq` 等兼容字段），与 `state.json` 同形。v1 先冻结；以后改成独立的回执时要升版本。
- 内核还没有声明自己会写入哪些文件（锁、缓存、临时文件），DSH 插件仍写死这些文件名。见 [发展方向](ROADMAP.md) 阶段 1、2。
- 节点 ID 在黑板合并时的规则（保持短 ID 并在合并时重编号，或加黑板前缀）还没定。v1 冻结的是现在的短 ID（如 `g1`、`f3`）；路线图要求这条规则随第一个契约版本定，见阶段 1、10。
- 路线图提到用 exp1 的事件前缀做固定日志。它是研究日志，含本机绝对路径，按 [AGENT.md](../AGENT.md) 的“安全与隐私”只留本地，不进公开测试；固定日志只用上面的合成数据。
