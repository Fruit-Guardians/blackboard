# 文档目录

第一次使用从[首页的一句话配置](../README.md#quick-start)开始。这里按使用、维护、证据与历史设计组织资料，避免把内部设计当成安装说明，或把历史结果当成本次验证。

## 使用与接入

| 需要了解 | 文档 |
| --- | --- |
| 手动安装、CLI 示例、上下文预算、多 Agent、配置与服务管理 | [使用参考](USAGE.md) |
| 按 Claude Code、Codex 或其他宿主安装、恢复、打开 | [完整 Skill 的接入参考](../skills/blackboard/references/setup.md) |
| 节点、关系方向、风险、状态、可信度与检查点 | [记录语义](../skills/blackboard/references/recording.md) |
| 并行身份、项目归属与交接 | [并行 Agent](../skills/blackboard/references/parallel-agents.md) |
| 可选研究、审计与威胁建模记录方式 | [方法目录](../skills/blackboard/methods/INDEX.md) |
| DeepSeek Harness 配置、工具与独立测试 | [DSH 插件说明](../plugins/dsh-blackboard/README.md) |

## 当前实现与贡献

| 需要了解 | 文档 |
| --- | --- |
| 原则、自主权、唯一事实源与工程约束 | [AGENT.md](../AGENT.md) |
| 运行时、共享模块、CLI、前端、插件与测试的责任边界 | [架构与维护边界](ARCHITECTURE.md) |
| 本地开发、生成资产、契约与版本、隐私和提交前检查 | [贡献指南](../CONTRIBUTING.md) |
| CLI / JSON / HTTP、capabilities、事件与兼容纪律 | [公开契约](CONTRACT.md) |
| 只读字段历史与检查点之后的变化 | [历史 API](history-api.md) |
| 原始事件备份、校验与恢复限制 | [备份恢复](backup.md) |
| 显式重试、回执、部分提交与恢复 | [写入回执](receipts.md) |
| Skill 中可选方法的格式、生成目录与扩展方式 | [方法框架](METHODS.md) |
| 工作台样式与品牌素材 | [界面规范](../design/UI_SYSTEM.md) · [品牌素材](../design/blackboard-logo/README.md) |

`0.8.2` 继续整理内部边界、健壮性与文档验证，延续 `0.8.0` 的公开契约和事件格式。源码职责看架构，外部接口看契约；使用参考不另行定义一份 JSON schema。

## 验证入口与证据

| 范围 | 入口与限制 |
| --- | --- |
| 发布候选、Node 运行时矩阵、导出消费端 | [CI 说明](ci.md)：描述流程和实际覆盖，不把配置文件当成通过记录 |
| 合成性能测量 | [性能基线](performance.md)：含首轮实测的日期、环境和限制；数据不代表真实 Agent 恢复质量 |
| 真实任务恢复试验 | [恢复对照试验](RECOVERY_EXPERIMENT.md)：预先约定的试验方案与试验时限制；不能代替当前代码检查 |
| 当前方向与历史恢复结果 | [路线图](ROADMAP.md)：区分已完成能力、历史 exp1 观察和未承诺方向 |

文档列出命令不表示已经执行。验证报告需带环境、结果与未覆盖范围；未运行的真实 Host、模型、云端导入或平台矩阵不写成通过。

## 历史设计与研究

这些文档保留当时的问题、建议与结果，用于解释决策；当前模块结构以[架构说明](ARCHITECTURE.md)、当前外部行为以[公开契约](CONTRACT.md)为准。

- [初期完整设计](BLACKBOARD_DESIGN.md)：Draft 2 / 0.3.0 历史设计基线，不是当前实现清单。
- [DSH 接入调研](DSH_PLUGIN_RESEARCH.md)：2026-10-22 的宿主快照、备选路线与测试基线；已实现的插件另见其说明。
- [从记录到可信交接](ITERATION.md)：历史迭代范围、验收线与当轮交接记录，保留当时执行边界。
- [研究记录方式](INQUIRY.md)：2026-10-27 的设计裁定与撤回说明；可选方式的现行文本在 Skill 方法包中。

历史材料中的旧版本、测试数量、机器环境、“尚未合并”或当时的投影缺口属于对应时点，不作为当前状态声明。路线图里的未来方向不表示 CLI 已有对应参数。
