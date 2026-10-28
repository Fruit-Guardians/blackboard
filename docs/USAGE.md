# 使用参考

[返回首页](../README.md) · [文档目录](README.md) · [公开契约](CONTRACT.md) · [贡献指南](../CONTRIBUTING.md)

先尝试首页的[一句话开始](../README.md#quick-start)。本文保留手动安装、CLI 示例、上下文预算、配置、服务管理与升级细节；机器可读输出以公开契约为准。所有命令示例使用合成场景，示例 ID 必须替换为当前黑板返回的实际 ID。

- [手动安装](#manual-install)
- [Agent 上下文与并行身份](#agent-context)
- [CLI 与记录语义](#cli)
- [配置、数据保证与活动记录](#configuration)
- [常见问题与停止服务](#troubleshooting)
- [版本与升级](#release) · [旧命名迁移](#upgrade)

<a id="manual-install"></a>


## 手动安装

### 1. 安装稳定的本机版本

以下终端示例使用 Bash / Zsh：

```bash
git clone https://github.com/Fruit-Guardians/blackboard.git
cd blackboard
node bin/blackboard.js release install

# 当前终端立即可用；长期使用请加入 shell 配置
export PATH="$HOME/.local/bin:$PATH"
blackboard --version
```

`release install` 安装独立版本，由 `current` 指向它。日常 CLI、Skill 与服务使用这份副本，不随开发仓库分支切换。版本管理见[版本与升级](#release)。

### 2. 切回你的项目，选择对应宿主

**Claude Code：**

```bash
cd /path/to/your-project
blackboard setup --target "$PWD" --title "项目或任务名" --open
```

`setup` 创建或复用 `.blackboard/`，安装项目 Skill 与恢复 Hook，关闭原始工具活动自动采集。macOS 会配置共享常驻服务，对其他项目再次执行会切换服务目标；其他平台按输出的手动命令启动服务。按需使用 `--no-serve`、`--no-hooks`、`--no-skill`。

**Codex：**

```bash
cd /path/to/your-project
blackboard init --title "项目或任务名"
blackboard skill install --codex
blackboard serve --open
```

已有黑板可跳过 `init`。项目 Skill 安装到 `.agents/skills/blackboard/`；明确需要用户级安装时加 `--user`。Codex 不使用 Claude 专用 `setup` 或 Hook。

**仅手动使用 CLI：**

```bash
cd /path/to/your-project
blackboard init --title "项目或任务名"
blackboard serve --open
```

`serve` 是前台服务，退出进程即停止。项目子目录会发现上层最近的 `.blackboard/`；确需独立黑板时使用 `init --here`。

### 3. 核验接入结果

```bash
blackboard status
blackboard digest
```

默认工作台地址为 **http://127.0.0.1:4333**，以 `status` 返回的实际地址与项目归属为准。服务在线只说明工作台可用；Agent 是否已加载 Skill、是否已记录内容，需要分别确认。

Claude 用户级 Skill 与恢复 Hook、Codex 用户级接入及其他宿主的详细说明，见[接入、恢复与打开](../skills/blackboard/references/setup.md)。



<a id="agent-context"></a>

## 给 Agent 的只读上下文

```bash
blackboard context                              # 默认结构化 JSON
blackboard context --focus hy1 --depth 2 --budget 4000
blackboard context --since cp1                   # 查询检查点之后的变化
blackboard context --markdown                    # 人类可读形式
```

示例 ID 需替换成当前黑板中的实际 ID。服务提供同一接口：

```text
GET /api/context?agent=agent:primary&focus=hy1&depth=2&budget=4000&since=cp1
```

返回包的 `policy` 明确声明 `readOnly: true`、`prescriptive: false`、`nextStepSelection: "agent-controlled"`。它整理目标、邻域、开放问题、发现、已确认事实和检查点，不生成下一步指令。

- **原文完整或整项省略**：已带入的节点标题、detail、标签、检查点/活动摘要和关系标签保留原文与空白，不再按固定字符数切掉末尾条件。`budget` 根据紧凑 JSON 估算 Token，不是真实 tokenizer 用量，也不包含格式化输出的额外空白；预算不足或达到 `--limit`（默认每分区 24 项）时，整项省略并计入 `omitted`、`truncated`。扩大预算不等于取消条数限制。
- 同一候选窗口内，某条记录太长装不下时，仍尝试后面的完整记录；`--limit` 继续限制候选窗口，不按可装入的数量向后扩展，也不推断记录的重要性。重复正文和分区预算分配保持现有契约。
- 若记录带有 `inputTruncation`，表示写入时原输入已被截短，与当前恢复包的 `truncated` 是两回事。投影会保留这一元信息；没有标记的旧记录不反推其历史完整性。
- **焦点同样遵守预算**：焦点正文放不下时，`currentFocus: null`、`omitted.currentFocus: 1`，但 `request.focus` 保留原 ID；这表示正文未带入，不表示游标消失或结论被撤销。`blackboard show <id> --json` 可按 ID 读取完整节点。固定的项目/请求元数据本身超过预算时，`estimatedTokens` 如实显示开销，不裁剪元数据或改写记录。
- **省略不是改判**：省略计数按分区条目统计，包含同一节点的不同视图，不等于不同缺失节点数。投影不抽取“关键句”、不推断限制条件、不改变状态/可信度或下一步。

指定 `since` 时，`recentChanges` 返回仍存在的新增或修改节点，`changes` 按新到旧报告 `relation-added`、`relation-removed`、`node-removed`；节点删除同时使其关联关系失效。检查点按事件位置划界，同一毫秒内的后续写入也纳入增量；时间戳则只包含严格晚于该时间的事件。无效检查点明确报错，不静默返回空增量。变化记录同样整项受预算约束，需检查 `omitted.changes`。节点公开投影遵循 `blackboard.context.v2`；事件格式不变。

## 多个 Agent 并行

```bash
# 每次工具调用都显式指定身份与项目，不依赖上一次调用的 export
blackboard node add hypothesis "待验证的猜测" --cwd /path/to/project --agent research --no-init --enter
blackboard here --cwd /path/to/project --agent research

# 环境变量写法等价；--cwd / --agent 优先
BLACKBOARD_AGENT=research BLACKBOARD_CWD=/path/to/project blackboard here

# 恢复或交接时读取指定视角
blackboard context --cwd /path/to/project --agent research
```

默认身份是 `agent:primary`；并行 Agent 应使用不同身份，避免互相覆盖位置。`--agent research` 与 `BLACKBOARD_AGENT=research` 一样归一化为 `agent:research`。写命令把身份记为节点和关系的 `author`、修改的 `updatedBy`、删除与重置的 `by`，用于事后回答"这条结论是谁写的"；这是归属，不是权限。`--no-init` 让写命令在项目根没有黑板时报错退出，不新建任何目录，避免路径写错时静默写进一块新的空板。`status`、`digest`、`tail`、`context` 可用 `--agent` 读取指定视角。工作台的 **Agent 视角** 下拉会同步切换当前焦点、现场投影、游标跟随和摘要，节点分享链接保留身份；没有游标时不借用其他 Agent 的位置。切换只改变阅读视角，不写事件、不移动游标；离线导出也支持已有身份的独立摘要。
Claude 恢复 Hook 仅使用其进程实际继承到的 `BLACKBOARD_AGENT`：会话开始时恢复该身份的 Digest，压缩前保存该身份及其游标的检查点；启用工具活动采集时，活动也关联该身份。不设置时仍为 `agent:primary`，不会从宿主 `session_id` 自动创建身份。不要假设不同工具调用或所有子 Agent 会话都会继承环境；普通子 Agent 应在每次命令中显式指定身份与项目，并主动调用 `context` 恢复或交接。上下文只整理已记录的现场，不自动决定下一步。


<a id="cli"></a>

## CLI：记录一条可恢复的思路


黑板的三层互相独立：**逻辑层**记录“为什么”，**游标层**记录“在哪”，**活动层**保留可选的原始工具材料。创建节点、建立关系、移动游标不是同一件事。

下面在**新建、空白的黑板**中运行；`g1`、`o1`、`hy1` 是该示例按顺序得到的短 ID。已有记录时，请使用命令实际返回的 ID。

```bash
blackboard init --title "内部 API 审计"

# 记录目标，显式进入
blackboard node add goal "确认管理接口的授权边界" --enter

# 显式关联目标，并把关注点移到猜测
blackboard node add hypothesis "读接口可能遗漏统一鉴权" \
  --parent g1 --rel related-to --enter

# 记录观察，并在创建时声明它支持猜测；不移动游标
blackboard node add observation "匿名请求返回 200" --at evidence.txt:12 \
  --to hy1 --rel supports

# 事后才发现的关系用 link 声明，而不是让系统推断
blackboard link o1 g1 --rel related-to

blackboard here
blackboard checkpoint --summary "已有匿名访问证据，正在比较中间件差异"
blackboard digest --write
```

### 常用命令速查

| 要做的事 | 命令 |
| --- | --- |
| 看现状、列出记录 | `blackboard status` / `blackboard ls` / `blackboard show hy1` |
| 筛选、统计记录 | `blackboard search --type vuln --sev high --confidence reproduced` / `blackboard search --type vuln --group-by severity,status` |
| 新建、编辑节点 | `blackboard node add <类型> "标题" [--to hy1 --rel supports]` / `blackboard edit hy1 --status active` |
| 声明、移除关系 | `blackboard link o1 hy1 --rel supports` / `blackboard unlink o1 hy1 --rel supports` |
| 移动、清空游标 | `blackboard cursor hy1 --reason "继续验证"` / `blackboard cursor none` |
| 保存、恢复现场 | `blackboard checkpoint --summary "…"` / `blackboard digest` / `blackboard context` |
| 检查上下文质量 | `blackboard lint` / `blackboard lint --json` |
| 从图中移除节点 | `blackboard remove hy1 --reason "合并到其他结论"`，事件历史仍保留 |

所有命令支持 `--help` / `-h`，查看帮助不会执行安装或启动服务。`init`、`setup`、`status`、`skill install`、`hooks install|uninstall`、`launcher`、`export` 支持单个 JSON 对象输出；节点写入与常用查询也可用 `--json`。

### 查询、统计与完整列表

```bash
blackboard search "session cookie" --tag auth --json
blackboard search --type vuln --sev high --confidence reproduced --json
blackboard search --tag site=alpha.example --tag auth --group-by severity,status
blackboard search --type vuln --group-by tag:site,severity,status --limit 1 --json
blackboard ls --all --json
```

`search` 支持关键词、`--type`、`--status`、`--sev`、`--confidence`、可重复的 `--tag`，以及 `--rel` / `--related-to`。筛选取交集，不自动推断缺省字段。需要总数时读 JSON 的 `total`；`items` 默认最多 30 条，`--limit` 可设 1–1000，`truncated` 说明明细是否截断。

`--group-by` 支持 `severity`、`status` 和 `tag:<键>` 的组合；统计始终覆盖全部匹配，与明细的 `--limit` 无关。JSON 增加 `groupBy` 与 `groups`，每项为 `{values: {...}, count}`；文本模式只列总数和分组。未填写单列为 `null`，不等同于 `open`；已复现也不隐含某个状态。

站点用显式标签 `--tag site=alpha.example` 记录；`tag:site` 不从正文或裸域名猜测站点。一个节点可带多个站点标签，并在每个站点各计一次，所以跨站点分组的合计可能大于匹配节点数。多个标签请写 `--tag auth --tag session`；`--tag auth,session` 会保存或匹配一个带逗号的标签，不会拆分。

`ls` 默认只列最近 30 条匹配记录，截断时在 stderr 说明匹配、显示和省略的数量；stdout 保持节点列表或 JSON 数组。`--all` 返回全部匹配，不能与 `--limit` 同用。项目路径仍可用 `--cwd`，或在同一终端设置 `BLACKBOARD_CWD`；跨工具与子 Agent 调用不要假设环境会自动继承。

节点公开 JSON 始终含 `status`、`severity`、`confidence`，未记录时为 `null`。相应 node/node-add/status/here/show/context/search/history/changes 输出使用 v2 schema；`ls` 保持数组形状，项版本见 `capabilities.outputs`。API、SSE 与离线快照同样保留三个可空维度。事件日志与请求指纹不变；`receipt.result` 保留原始写入结果，不补 null，因此可能与当前写命令的 JSON 投影形状不同。



内置类型是语义提示，不是状态机；自定义类型同样可以保存。

| 用途 | 类型 |
| --- | --- |
| 入口与方向 | `start`、`goal`、`intent` |
| 证据与推理 | `observation`、`fact`、`hypothesis`、`question` |
| 行动与产出 | `action`、`result`、`finding`、`vuln` |
| 辅助记录 | `hint`、`summary`、`note` |

```bash
blackboard node add decision "优先验证权限边界"
blackboard node add observation "出现相同路由模式" --relate-here
blackboard edit hy1 --title "修订后的猜测" --detail "补充证据"
```

- `--enter` 显式移动游标；`--relate-here` 显式关联当前位置，默认关系为弱语义的 `related-to`。
- `--to <id>` 让新节点指向已有节点，读作“新节点 `--rel` id”，如新证据 `--to hy1 --rel supports`；`--parent <id>` 方向相反，读作“id `--rel` 新节点”。**当前游标不是隐式父节点**。
- 一次创建只声明一条关系：`--to` 不能与 `--parent`/`--relate-here` 同用，其余关系用 `link`；目标不存在时整条命令不写入。
- `--at <file:line>` 记录证据位置；`--detail` / `-d` 添加详情；`--tag` / `-t` 可重复指定标签。
- ID 按类型递增，如 `g1`、`o1`、`hy1`；活动和检查点如 `act1`、`cp1`。接受 ID 的命令支持 `[hy1]`、大小写不敏感及唯一前缀，存在歧义时列出候选。
- `start`、`goal`、`intent`、`fact`、`vuln`、`hint` 可用同名简写；`focus` 是 `cursor` 的别名，`compact` 是 `checkpoint` 的别名。这些写法也不会隐式连边或进入节点。
- 未知 CLI 选项、缺失参数值、冲突选项与无效数值会明确报错，且不执行写入；`--tag` 可重复，其他单值选项不可重复。标题以 `-` 开头时放在 `--` 后；自定义节点类型和关系名仍可使用。



`link <from> <to> --rel X` 读作 **“from X to”**：

| 写法 | 含义 |
| --- | --- |
| `link 观察 猜测 --rel supports` | 观察支持猜测 |
| `link 结论 观察 --rel derived-from` | 结论派生自观察 |
| `link 结论 前提 --rel depends-on` | 结论依赖前提 |
| `link 现象 原因 --rel caused-by` | 现象由原因导致 |
| `link 新结论 旧结论 --rel supersedes` | 新结论取代旧结论 |

还可使用 `proves`、`contradicts`、`refines`、`duplicates`、`resolves` 等关系，或自定义关系。默认 `related-to` 不替作者声明支持或因果。

风险、状态、可信度是三个独立维度：

```bash
blackboard node add finding "授权绕过候选" \
  --sev medium --status active --confidence static-confirmed
blackboard edit fd1 --status confirmed --confidence reproduced
```

`fd1` 需替换成实际 ID。可信度可取 `suspected`、`static-confirmed`、`reproduced`、`confirmed`；未声明时不会自动推断，`lint` 会对相关记录给出提示。确认过的事实、观察、结果可通过已确认状态或可信度进入 `context` 的 `confirmedFacts`。



<a id="configuration"></a>

## 配置与数据边界


### 服务地址与环境变量

端口选择顺序统一为：**`--port` → `BLACKBOARD_PORT` → 项目配置 `viewerPort` → `4333`**。端口必须是 `1–65535` 的整数。`setup` 成功后保存所选端口（包括 `--no-serve`）；`serve` 成功启动后也会保存，后续 `status` 因而检查同一地址。

| 变量 | 用途 |
| --- | --- |
| `BLACKBOARD_CWD` | 显式指定项目根目录 |
| `BLACKBOARD_PORT` | 覆盖项目的服务端口 |
| `BLACKBOARD_AGENT` | 设置 Agent 身份与游标视角 |
| `BLACKBOARD_QUIET=1` | 静默常用写命令的成功提示 |
| `BLACKBOARD_DEBUG=1` | 输出错误调试信息 |
| `BLACKBOARD_LOCK_TIMEOUT_MS` | 调整普通写入的锁等待上限，默认 10 秒 |

`status --json` 提供 `cwd`、`agentId`、`stats`、`cursor`、`cursors`、`title`、`session`、`viewer`、`integration`、`latestNode`。`viewer.state` 区分 `online`、`offline`、`other-project`、`unrecognized`；不会把别的项目误报为当前项目在线。查询本身不初始化黑板或安装接入。

### 本地数据与安全

- **唯一事实源**：`.blackboard/events.jsonl` 只追加；`state.json` 是可丢弃缓存，损坏后可由事件恢复。
- **默认不入库**：新建 `.blackboard/` 自带 `.gitignore`。逻辑节点也可能含敏感原文，请勿将“本地记录”等同于“已经脱敏”。
- **页面写入受限**：服务仅监听 loopback，校验 Host 防 DNS 重绑定；写请求要求同 Origin、JSON 类型，大小上限 256 KB。
- **不阻断 Agent**：`lint` 只报告，始终以退出状态 0 返回；Hook 是可选辅助，不是任务前置条件。


- 新事件包含 `eventVersion` 和唯一 `eventId`；节点 ID 在写锁内分配，不依赖缓存计数器。
- 跨进程写入由文件锁串行化，不抢占仍存活的持有者；超时会报错，不强行写入。
- 回放会跳过坏行、缺少必要字段的节点、自环和缺失端点的关系，并在 `lint` 的 `log-integrity` 警告中报告计数，不静默隐藏损坏。
- 追加前清理日志尾部的不完整记录；缓存写入失败不让已追加的事件报错。
- `patch` 不改写节点的 `id` / `ts`；`remove` 从当前投影移除节点及关系，保留事件历史。
- 标题、详情、关系说明、检查点摘要上限分别为 500、20,000、500、12,000 个 UTF-16 代码单元（与 JavaScript 字符串长度一致）。现有默认裁剪行为保留：stderr 提示，JSON 结果带 `truncated`；新的节点、边、检查点事件还保存 `inputTruncation`，逐字段记录 `originalLength` 和 `storedLength`，供后续回放、context、lint 与页面查阅。它不保存被丢弃的原文，也不为旧日志猜测缺失信息。
- `node add`、节点简写、`edit`、`link`、`checkpoint`、`compact` 和 `promote` 可显式加 `--no-truncate`：超限时整条不保存，已有事件不变，记录者自行缩写、拆分或引用项目内证据文件。`capabilities --json` 以 `rejectTruncation`、`inputTruncationMetadata` 声明支持；原任务和宿主照常继续，`lint` 仍仅报告且退出 0。
- 新 Web 客户端显式发送 `rejectTruncation: true` 保存节点，超限得到 HTTP 422 `code: "input_too_long"`（含字段与长度），不显示保存成功，保留草稿。旧 API 客户端未声明此选项时仍按原约定裁剪。编辑某个文本字段会更新或清除该字段的截断提示；只改状态、风险或可信度不会清掉其他文本的提示。
- Web 画布卡片是紧凑预览，点击后详情面板读取完整已保存的标题和 detail，保留标点与换行并可滚动。侧栏超出首屏条数的记录有明确展开入口，不再直接遗漏；“现场”依然是局部视图，“全景”用于浏览整板。



只有需要保存工具调用材料时，再启用活动 Hook，并在现有 `.blackboard/config.json` 中将 `autoRecord` 设为 `true`。保留其余配置，例如：

```json
{
  "autoRecord": true,
  "autoTools": ["Bash", "WebFetch", "Read", "Grep"],
  "maxActivities": 4000,
  "detailLimit": 1200,
  "redact": true
}
```

```bash
blackboard hooks install --write --with-activity
blackboard activity ls
blackboard activity show act1
blackboard promote act1 --kind observation --title "值得保留的观察"
```

`act1` 需替换成实际活动 ID。工具材料进入独立 `activity` 层，不自动成为事实；`promote` 也不会自动连边或移动游标。`Write` / `Edit` 等只保留文件路径，黑板 CLI 自身调用不重复采集；尽力脱敏后截断，拿不到锁时活动写入最多等 1 秒。

重新运行不带 `--with-activity` 的 `hooks install --write` 会停用活动 Hook；`setup` 会再次关闭 `autoRecord`。脱敏不是保密保证，开启前请确认工具输出的敏感程度。



<a id="troubleshooting"></a>


## 常见问题

**图里都是未连接的卡片？** 检查 Agent 是否已加载当前 Skill，并显式使用 `link`、`--to`、`--parent` 或 `--relate-here`。安装接入不会自动补建关系。

**现场视图里找不到某条记录？** 它不是全量视图。切到“全局”，或用搜索定位；没有游标时，Digest 仍会列出最近活跃节点及其关系。

**服务在线，但 Agent 没有继续写？** 服务只负责读写和展示，不会驱动 Agent。可明确说“用 blackboard 记录这次研究”，再用 `digest` 核对实际内容。

**保存后提示服务响应损坏？** HTTP 成功状态不足以确认保存结果；响应无法读取或不是有效 JSON 对象时，页面会保留草稿并提示结果不确定。先核对节点或历史记录，再决定是否重试；页面不会自动重新提交。


**如何停用？** 前台 `serve` 用 `Ctrl+C` 停止。用下面的命令移除所用范围的 Hook，再手动移除对应的 Skill 目录；不必删除黑板数据：

```bash
blackboard hooks uninstall --user --write
# 项目级 Hook 去掉 --user；Skill 位于对应的 skills/blackboard 目录
```

macOS 的 `setup` 常驻服务是共享工作区服务，不是前台进程。先确认归属，再选择停止或卸载：

```bash
blackboard service status --json  # 归属 cwd、是否当前项目、loaded/running 与状态
blackboard service stop           # 卸载运行任务，保留 plist；用 setup 重新启动
blackboard service uninstall      # 停止任务并删除本工具受管 plist
```

`waiting` 表示任务已加载但未在运行，不等于查看器在线；页面是否可用仍以 `blackboard status` 的实际探测为准。`setup` 切换项目会报告原归属与新归属。停止/卸载针对共享服务的当前项目，即使它不是命令所在项目；不删除黑板数据，不操作其他服务。非 macOS 明确报告不支持持久服务管理，前台服务仍手动启动和停止。


<a id="release"></a>

## 版本与升级


`0.8.2` 拆分存储文件 I/O 与 HTTP 请求/写入职责，修复日志短读、文件描述符及失败锁写入的清理，损坏的成功响应会保留页面草稿并提示结果不确定；增加离线文档链接、图片和锚点检查。CLI / JSON schema 与事件格式延续 `0.8.0`。

`0.8.1` 整理内部 CLI、共享快照、前端工作台和开发验证脚本边界，并重组文档；这是兼容性维护版本，CLI / JSON schema 与事件格式延续 `0.8.0`，不增加新的导出参数。实时与离线快照统一忽略指向不存在节点的缓存焦点，修复离线曾保留失效 ID 的差异；离线 HTML 继续省略原始活动 input/output/summary 和可写标记。验证入口与覆盖限制见 [贡献指南](../CONTRIBUTING.md)和 [CI 说明](ci.md)，版本说明本身不代表本轮检查已执行。

`0.8.0` 统一节点 JSON 的三个可空维度，将受影响的输出 schema 升为 v2，并增加 Markdown、Mermaid、SARIF 导出；包含可导航的 Markdown 报告、Mermaid 默认消费端限额，以及浏览器渲染和官方 SARIF schema 的持续回归。前端与 DSH 适配同步切换；事件格式仍为 v1，旧安装可保留用于回滚。`0.7.0` 的字段筛选、完整分组统计和 `ls --all` 继续可用。

日常使用的 CLI、启动器、Skill、Hook 和常驻服务都指向 `~/.local/share/blackboard/current`（设置了 `XDG_DATA_HOME` 时位于其下），不指向开发仓库：

```text
~/.local/share/blackboard/
├── versions/0.8.0/    已安装版本，安装后不再改动
├── versions/0.8.1/
├── versions/0.8.2/
└── current -> versions/0.8.2
```

```bash
# 在仓库里：先按贡献指南完成本地与发布候选验证，再安装新版本并切换
# 包含 npm test、npm run check:types、npm run build、npm run verify:package
node bin/blackboard.js release install

blackboard release ls          # 已安装版本，* 为 current
blackboard release use 0.8.0   # 回滚或切换
blackboard --version           # 显示版本，以及运行的是 current 还是开发目录
```

- **版本不可变**：同一版本号重复安装会报错，请提升 `package.json` 的版本号；确需覆盖时加 `--force`。
- **切换即生效**：`install` 和 `use` 原子地切换 `current`，再由新版本自己刷新启动器、已安装的用户级 Skill（Claude / Codex）、用户级 Hook，并重启正在运行的受管常驻服务（已停止的服务只更新配置）。从 `current` 运行的 `setup`、`skill install`、`hooks install` 也记录 `current` 路径，而不是具体版本。
- **项目级接入不自动刷新**：`setup` 写入各项目 `.claude/` 的 Skill 和 Hook 无法从这里发现；它们指向 `current` 时无需改动，若曾从开发仓库安装，请在对应项目重新运行 `blackboard setup`。从开发目录运行安装类命令时，CLI 会在 stderr 提示接入将指向仓库。
- **跨版本读取**：每个事件带 `eventVersion`。旧版本遇到更高版本格式的事件时跳过它们、在 `lint` 中报告 `log-version`，并暂停写入以免 ID 冲突，切回较新版本即可恢复；遇到同格式下不认识的事件类型只忽略并报告 `unknown-events`，不影响写入。


<a id="upgrade"></a>

## 从旧版迁移


> **不兼容切换**：唯一命令是 `blackboard`，唯一数据目录是 `.blackboard/`，只读取 `BLACKBOARD_*`。不再提供 `flow` 命令、`FLOW_*` 回退或 `.flow/` 自动发现，也不自动搬迁旧数据。

1. 停止旧服务和写入进程，备份数据。在没有 `.blackboard/` 的项目里将 `.flow/` 重命名为 `.blackboard/`；若两者都存在，先核对，**不要覆盖或直接拼接日志**。
2. 更新脚本中的命令和环境变量，在仓库里执行 `node bin/blackboard.js release install`，手动移除旧 launcher。
3. 移除所用范围的旧 `skills/flow` 和 Claude settings 中指向旧命令、旧目录的 Hook，只处理旧接入，不动无关配置。重新安装 blackboard Skill 与可选 Hook；用户级安装加 `--user`，Codex Skill 加 `--codex`。
4. 重启服务并开启新的 Agent 会话，用 `blackboard status` 和 `blackboard digest` 核对现场。迁移只重命名目录，**不改写事件原文**。
