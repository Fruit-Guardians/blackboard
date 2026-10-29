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
<a id="1-安装稳定的本机版本"></a>
<a id="2-切回你的项目选择对应宿主"></a>
<a id="3-核验接入结果"></a>

## 手动安装

按[完整使用参考](docs/USAGE.md#manual-install)安装独立 CLI，再为当前项目选择 Claude Code、Codex 或手动接入。日常使用通过 `release install` 安装的稳定副本；开发仓库与真实黑板保持隔离。

<a id="给-agent-的只读上下文"></a>
<a id="多个-agent-并行"></a>

需要了解恢复包的预算、省略项或并行身份时，见 [Agent 上下文与并行使用](docs/USAGE.md#agent-context)。


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
| 手动安装、CLI、配置、服务与升级 | [使用参考](docs/USAGE.md) |
| 宿主接入、恢复与打开 | [Agent 接入指南](skills/blackboard/references/setup.md) |
| 节点、关系与并行记录 | [记录语义](skills/blackboard/references/recording.md) · [并行 Agent](skills/blackboard/references/parallel-agents.md) |
| 可选的审计、研究与威胁建模视角 | [记录方法目录](skills/blackboard/methods/INDEX.md) |
| CLI / JSON / HTTP 的公开约定 | [公开契约](docs/CONTRACT.md) |
| 源码边界、贡献与验证 | [架构](docs/ARCHITECTURE.md) · [贡献指南](CONTRIBUTING.md) · [工程约定](AGENT.md) |
| 专题说明、证据与历史研究 | [文档目录](docs/README.md) |

<a id="cli"></a>
<a id="常用命令速查"></a>
<a id="查询统计与完整列表"></a>

## CLI：记录一条可恢复的思路

[CLI 示例与参数](docs/USAGE.md#cli)介绍节点、显式关系、游标、检查点、筛选与统计；所有命令都可用 `--help` 查询帮助。

<a id="configuration"></a>
<a id="服务地址与环境变量"></a>
<a id="本地数据与安全"></a>

## 配置与数据边界

[配置参考](docs/USAGE.md#configuration)包含端口优先级、环境变量、事件回放和可选的原始工具活动记录。原始活动默认关闭，开启后的脱敏仍需人工检查。

<a id="troubleshooting"></a>

## 常见问题

图中没有关系、现场视图找不到记录，或需要停用接入、停止共享服务时，查看[常见问题](docs/USAGE.md#troubleshooting)。

<a id="release"></a>

## 版本与升级

`0.10.0` 新增 `batch`：一条命令写入一组相关的节点、关系和修改，整批全部成功或全部不写，适合每波并行工作结束时导入子 Agent 的记录。`0.9.0` 修正了一批日常记录的接口细节，并让检查点回显自上一检查点以来的记录变化。新增均为兼容扩展，事件格式不变。安装、切换与回滚见[版本管理](docs/USAGE.md#release)，验证范围见 [CI 说明](docs/ci.md)。

<a id="upgrade"></a>

## 从旧版迁移

仍使用 `flow` 命令、`.flow/` 或 `FLOW_*` 的项目，按[旧命名迁移步骤](docs/USAGE.md#upgrade)备份后手动迁移；不覆盖已有黑板，不改写事件原文。

<a id="development"></a>

## 开发

[贡献指南](CONTRIBUTING.md)说明本地演示、构建、类型检查、测试、发布候选检查和隐私要求；[架构说明](docs/ARCHITECTURE.md)列出运行时、CLI、前端、插件和测试边界。使用已构建产物只需 Node.js ≥ 18，前端开发请使用构建工具支持的 Node 版本。
