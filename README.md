<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="design/blackboard-logo/blackboard-logo-light.svg">
    <img src="design/blackboard-logo/blackboard-logo-dark.svg" alt="blackboard" width="320">
  </picture>
</p>

<h1 align="center">Agent 的外置记忆与可视化工作台</h1>

<p align="center">
  记录判断、证据与当前位置。<br>
  上下文压缩、断线或换会话后，接着同一份现场继续工作。
</p>

<p align="center">
  <a href="https://github.com/Fruit-Guardians/blackboard/actions/workflows/verify.yml"><img src="https://github.com/Fruit-Guardians/blackboard/actions/workflows/verify.yml/badge.svg" alt="Release verification"></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/Node.js-%E2%89%A5%2018-147453?style=flat-square" alt="Node.js ≥ 18"></a>
  <a href="package.json"><img src="https://img.shields.io/badge/runtime_dependencies-0-147453?style=flat-square" alt="零运行时依赖"></a>
  <a href="package.json"><img src="https://img.shields.io/badge/license-MIT-147453?style=flat-square" alt="MIT"></a>
</p>

<p align="center">
  <a href="#quick-start">一句话开始</a> ·
  <a href="#workspace">看看工作台</a> ·
  <a href="#agent-integration">Agent 接入</a> ·
  <a href="#manual-install">手动安装</a> ·
  <a href="#documentation">文档</a>
</p>

---

blackboard 把 Agent 的关键判断、显式证据关系和关注位置保存在项目本地，呈现为一张可追溯的图。Agent 可以恢复现场，你也能查看进展、补充记录和检查判断的依据。

<a id="quick-start"></a>

## 一句话开始

**打开你要使用黑板的项目，复制下面这句话发给 Agent：**

> 请阅读 https://github.com/Fruit-Guardians/blackboard 的接入说明，为当前项目安装或复用 blackboard，按当前 Agent 宿主接入完整 Skill 并打开工作台，保留已有黑板记录，最后核验项目与服务状态并给我访问地址。

Agent 应按当前宿主选择接入方式：Claude Code 使用其 Skill / Hook，Codex 使用 Codex Skill，其他宿主复用完整 Skill 包。具体安装与验证以[接入说明](skills/blackboard/references/setup.md)为准。

只需 **Node.js ≥ 18**，使用 CLI 和工作台无需安装开发依赖。新 Skill 的加载方式取决于宿主；需要时开启新会话。

<a id="workspace"></a>

## 看看工作台

<p align="center">
  <img src="docs/assets/blackboard-workspace.png" alt="blackboard 工作台：左侧导航关注点与发现，画布呈现目标、观察、猜测和显式证据关系" width="1200">
</p>
<p align="center"><sub>合成演示数据。节点之间的关系由记录者明确声明，不由系统推断。</sub></p>

| 阅读方式 | 用来做什么 |
| --- | --- |
| **现场** | 围绕当前关注点，查看一跳邻域、目标与开放问题 |
| **逻辑** | 沿已记录的支持、反驳与推导关系阅读证据 |
| **全局** | 浏览整块黑板，包括尚未连接的记录 |

工作台支持实时同步、搜索筛选、多 Agent 视角、节点编辑与修改历史；提供明暗主题及简体中文、繁體中文、English、日本語。离线 HTML 可保留工作台用于只读查看。

## 能留下什么

| 需要解决的问题 | blackboard 提供的记录 |
| --- | --- |
| 多轮排查后，忘了为什么走到这里 | 目标、观察、猜测，以及明确的支持或反驳关系 |
| 上下文压缩或换了 Agent，需要接手 | 检查点、当前游标与可按预算读取的上下文 |
| 结论变了，需要核对变化 | 节点字段历史、关系历史与检查点后的差异 |
| 多个 Agent 同时探索 | 各自的身份、关注位置与写入署名 |
| 需要分享成果或长期保存 | Markdown、Mermaid、SARIF、离线 HTML，以及事件备份与校验恢复 |

**它是记忆与记录工具，不替 Agent 决定下一步。** 创建节点不会自动连边或移动游标；风险、状态与可信度分别记录，不互相推断。

<a id="agent-integration"></a>

## 接入你正在用的 Agent

同一份 [Skill 包](skills/blackboard/)和 CLI 跨宿主复用，宿主负责加载 Skill。安装文件存在，不等于当前会话已经加载。

| 宿主 | 接入方式 | 说明 |
| --- | --- | --- |
| **Claude Code** | `blackboard setup` | 配置项目 Skill 和恢复 Hook；macOS 可配置共享常驻服务 |
| **Codex** | `blackboard skill install --codex` | 使用 Codex Skill；不安装 Claude Hook |
| **DeepSeek Harness** | [独立 DSH 插件](plugins/dsh-blackboard/README.md) | 提供原生工具与配置页，项目需显式启用 |
| **OMP、ZCode 等** | 复用完整 Skill 包 | 由 Agent 按宿主机制安装，并展开 CLI 路径占位符 |

<a id="manual-install"></a>

<details>
<summary><strong>手动安装 CLI，并为项目配置接入</strong></summary>

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

Claude 用户级 Skill 与恢复 Hook、Codex 用户级接入及其他宿主的详细说明，见[接入、恢复与打开](skills/blackboard/references/setup.md)。

</details>

<details>
<summary><strong>Agent 进阶：恢复上下文、预算与并行身份</strong></summary>

### 给 Agent 的只读上下文

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

### 多个 Agent 并行

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

</details>

## 日常怎么用

让 Agent 记录有价值的现场：

> 用 blackboard 记下这次排查的关键判断、证据和待验证问题，明确记录支持与反驳关系。

压缩后或换会话时继续：

> 读取当前项目的 blackboard，复述已确认内容、当前关注点和开放问题，再继续工作。

你也可以直接查看和导出：

```bash
blackboard context --budget 4000
blackboard search --type finding --group-by severity,status
blackboard export --format markdown --out report.md
blackboard export --format mermaid --out graph.mmd
blackboard export --format sarif --type finding --out findings.sarif
blackboard export --out blackboard.html
```

导出保留已记录的原文与关系。SARIF 只将带有效代码位置的 `finding` / `vuln` 转为结果；没有位置的记录会列入省略清单。Mermaid 超出节点上限会注明省略，超过默认消费端的边数或文本限额则明确报错。完整规则见[导出契约](docs/CONTRACT.md#导出格式)。

## 数据留在哪里

- **项目本地**：`.blackboard/events.jsonl` 是唯一事实源；缓存损坏可从事件恢复。
- **默认不入库**：新建黑板自带忽略规则；记录仍可能包含敏感原文，分享前需要检查。
- **本机查看**：服务仅监听 loopback；可用 `serve --read-only` 关闭页面写入。
- **自主使用**：Hook 是可选辅助，`lint` 只报告问题，不阻断 Agent 工作。

<a id="documentation"></a>

## 文档

| 我想了解 | 从这里开始 |
| --- | --- |
| 安装、打开、恢复与宿主差异 | [Agent 接入指南](skills/blackboard/references/setup.md) |
| 节点、关系、可信度与检查点 | [记录语义](skills/blackboard/references/recording.md) |
| 多 Agent 的项目归属与交接 | [并行 Agent](skills/blackboard/references/parallel-agents.md) |
| 可选的审计、研究与威胁建模视角 | [记录方法目录](skills/blackboard/methods/INDEX.md) |
| CLI / JSON / HTTP 的公开约定 | [公开契约](docs/CONTRACT.md) |
| 变化追溯与可靠性 | [历史与差异](docs/history-api.md) · [备份恢复](docs/backup.md) · [写入回执](docs/receipts.md) |
| 设计、路线图与贡献 | [设计文档](docs/BLACKBOARD_DESIGN.md) · [路线图](docs/ROADMAP.md) · [工程约定](AGENT.md) |
| 自动验证与性能证据 | [CI 与导出验证](docs/ci.md) · [性能基线](docs/performance.md) · [恢复试验](docs/RECOVERY_EXPERIMENT.md) |

---

<a id="cli"></a>

## CLI：记录一条可恢复的思路

<details>
<summary><strong>展开 CLI 示例与参数说明</strong></summary>

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


<details>
<summary><strong>节点类型、短 ID 与常用参数</strong></summary>

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

</details>

<details>
<summary><strong>关系方向，以及风险、状态、可信度</strong></summary>

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

</details>

</details>

<a id="configuration"></a>

## 配置与数据边界

<details>
<summary><strong>展开环境变量、数据保证与可选活动记录</strong></summary>

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

<details>
<summary><strong>事件回放、锁与截断的具体保证</strong></summary>

- 新事件包含 `eventVersion` 和唯一 `eventId`；节点 ID 在写锁内分配，不依赖缓存计数器。
- 跨进程写入由文件锁串行化，不抢占仍存活的持有者；超时会报错，不强行写入。
- 回放会跳过坏行、缺少必要字段的节点、自环和缺失端点的关系，并在 `lint` 的 `log-integrity` 警告中报告计数，不静默隐藏损坏。
- 追加前清理日志尾部的不完整记录；缓存写入失败不让已追加的事件报错。
- `patch` 不改写节点的 `id` / `ts`；`remove` 从当前投影移除节点及关系，保留事件历史。
- 标题、详情、关系说明、检查点摘要上限分别为 500、20,000、500、12,000 个 UTF-16 代码单元（与 JavaScript 字符串长度一致）。现有默认裁剪行为保留：stderr 提示，JSON 结果带 `truncated`；新的节点、边、检查点事件还保存 `inputTruncation`，逐字段记录 `originalLength` 和 `storedLength`，供后续回放、context、lint 与页面查阅。它不保存被丢弃的原文，也不为旧日志猜测缺失信息。
- `node add`、节点简写、`edit`、`link`、`checkpoint`、`compact` 和 `promote` 可显式加 `--no-truncate`：超限时整条不保存，已有事件不变，记录者自行缩写、拆分或引用项目内证据文件。`capabilities --json` 以 `rejectTruncation`、`inputTruncationMetadata` 声明支持；原任务和宿主照常继续，`lint` 仍仅报告且退出 0。
- 新 Web 客户端显式发送 `rejectTruncation: true` 保存节点，超限得到 HTTP 422 `code: "input_too_long"`（含字段与长度），不显示保存成功，保留草稿。旧 API 客户端未声明此选项时仍按原约定裁剪。编辑某个文本字段会更新或清除该字段的截断提示；只改状态、风险或可信度不会清掉其他文本的提示。
- Web 画布卡片是紧凑预览，点击后详情面板读取完整已保存的标题和 detail，保留标点与换行并可滚动。侧栏超出首屏条数的记录有明确展开入口，不再直接遗漏；“现场”依然是局部视图，“全景”用于浏览整板。

</details>

<details>
<summary><strong>原始工具活动：默认关闭，明确启用后才记录</strong></summary>

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

</details>

</details>

<a id="troubleshooting"></a>


## 常见问题

**图里都是未连接的卡片？** 检查 Agent 是否已加载当前 Skill，并显式使用 `link`、`--to`、`--parent` 或 `--relate-here`。安装接入不会自动补建关系。

**现场视图里找不到某条记录？** 它不是全量视图。切到“全局”，或用搜索定位；没有游标时，Digest 仍会列出最近活跃节点及其关系。

**服务在线，但 Agent 没有继续写？** 服务只负责读写和展示，不会驱动 Agent。可明确说“用 blackboard 记录这次研究”，再用 `digest` 核对实际内容。

<details>
<summary><strong>停用接入、停止或卸载共享服务</strong></summary>

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

</details>

<a id="release"></a>

## 版本与升级

<details>
<summary><strong>展开安装版本、升级与回滚说明</strong></summary>

`0.8.0` 统一节点 JSON 的三个可空维度，将受影响的输出 schema 升为 v2，并增加 Markdown、Mermaid、SARIF 导出；包含可导航的 Markdown 报告、Mermaid 默认消费端限额，以及浏览器渲染和官方 SARIF schema 的持续回归。前端与 DSH 适配同步切换；事件格式仍为 v1，旧安装可保留用于回滚。`0.7.0` 的字段筛选、完整分组统计和 `ls --all` 继续可用。

日常使用的 CLI、启动器、Skill、Hook 和常驻服务都指向 `~/.local/share/blackboard/current`（设置了 `XDG_DATA_HOME` 时位于其下），不指向开发仓库：

```text
~/.local/share/blackboard/
├── versions/0.6.0/    已安装版本，安装后不再改动
├── versions/0.7.0/
└── current -> versions/0.7.0
```

```bash
# 在仓库里：测试、构建，再安装为新版本并切换
npm test && npm run build
node bin/blackboard.js release install

blackboard release ls          # 已安装版本，* 为 current
blackboard release use 0.6.0   # 回滚或切换
blackboard --version           # 显示版本，以及运行的是 current 还是开发目录
```

- **版本不可变**：同一版本号重复安装会报错，请提升 `package.json` 的版本号；确需覆盖时加 `--force`。
- **切换即生效**：`install` 和 `use` 原子地切换 `current`，再由新版本自己刷新启动器、已安装的用户级 Skill（Claude / Codex）、用户级 Hook，并重启正在运行的受管常驻服务（已停止的服务只更新配置）。从 `current` 运行的 `setup`、`skill install`、`hooks install` 也记录 `current` 路径，而不是具体版本。
- **项目级接入不自动刷新**：`setup` 写入各项目 `.claude/` 的 Skill 和 Hook 无法从这里发现；它们指向 `current` 时无需改动，若曾从开发仓库安装，请在对应项目重新运行 `blackboard setup`。从开发目录运行安装类命令时，CLI 会在 stderr 提示接入将指向仓库。
- **跨版本读取**：每个事件带 `eventVersion`。旧版本遇到更高版本格式的事件时跳过它们、在 `lint` 中报告 `log-version`，并暂停写入以免 ID 冲突，切回较新版本即可恢复；遇到同格式下不认识的事件类型只忽略并报告 `unknown-events`，不影响写入。

</details>

<a id="upgrade"></a>

## 从旧版迁移

<details>
<summary><strong>从 flow 命名的旧版本迁移</strong></summary>

> **不兼容切换**：唯一命令是 `blackboard`，唯一数据目录是 `.blackboard/`，只读取 `BLACKBOARD_*`。不再提供 `flow` 命令、`FLOW_*` 回退或 `.flow/` 自动发现，也不自动搬迁旧数据。

1. 停止旧服务和写入进程，备份数据。在没有 `.blackboard/` 的项目里将 `.flow/` 重命名为 `.blackboard/`；若两者都存在，先核对，**不要覆盖或直接拼接日志**。
2. 更新脚本中的命令和环境变量，在仓库里执行 `node bin/blackboard.js release install`，手动移除旧 launcher。
3. 移除所用范围的旧 `skills/flow` 和 Claude settings 中指向旧命令、旧目录的 Hook，只处理旧接入，不动无关配置。重新安装 blackboard Skill 与可选 Hook；用户级安装加 `--user`，Codex Skill 加 `--codex`。
4. 重启服务并开启新的 Agent 会话，用 `blackboard status` 和 `blackboard digest` 核对现场。迁移只重命名目录，**不改写事件原文**。

</details>

<a id="development"></a>

## 开发

<details>
<summary><strong>开发环境、验证命令与源码结构</strong></summary>

使用构建产物只需 Node.js ≥ 18；修改前端时再安装开发依赖。当前 Vite 要求 **Node.js 20.x（≥ 20.19.0）或 ≥ 22.12.0**：

```bash
npm ci
npm run dev       # Vite 开发页，代理到选定的黑板服务
npm run build     # 更新 public/，供 CLI 服务和离线导出使用
npm test
```

开发时使用 `node bin/blackboard.js`，并用 `BLACKBOARD_CWD` 指向演示黑板，不要让开发中的代码写入真实项目的 `.blackboard/`；改动通过 `release install` 才进入日常使用。开发页需要另行启动 `node bin/blackboard.js serve`。生成演示可用 `node scripts/demo.js [目录]`（默认 `demo/`）：它创建独立黑板，**会重建目标目录里已有的演示黑板**，但不改上级黑板。

```text
bin/blackboard.js           唯一 CLI 入口
skills/blackboard/          完整 Agent Skill 包，核心指令、按需参考与展示资源
lib/model.js               CLI、服务、浏览器共用的事件模型
lib/store.js               事件存储、写锁、游标和检查点
lib/context.js · digest.js  面向 Agent 的只读上下文投影
lib/hooks.js · setup.js     Agent 接入与项目初始化
lib/server.js · service.js  本地服务、端口选择和身份探测
lib/release.js             已安装版本、current 切换与接入刷新
lib/export.js              单文件离线导出
web/ · public/             前端源码与随仓库分发的构建产物
test/                      自动化测试
```

深入阅读：[完整设计](docs/BLACKBOARD_DESIGN.md) · [工程约定](AGENT.md) · [界面规范](design/UI_SYSTEM.md) · [品牌素材](design/blackboard-logo/README.md)

</details>
