---
name: blackboard
description: 恢复长期任务上下文、记录关键判断/发现/进度、压缩前保存现场或跨 Agent 交接时使用；也处理用户明确要求的 blackboard 配置、接入、启动与打开。适合研究、审计和长任务的可选外置记忆，不因项目存在 .blackboard 就要求普通任务启用。
---

# blackboard — 可选的 Agent 外置记忆

## 触发与边界

用户要求恢复上下文、保留关键判断、交接或使用 blackboard 时使用本 Skill。仅存在 `.blackboard/` 不是启用所有普通任务的理由。

长研究、反复试错、上下文将丢失或关联发现值得保留时，可以一句话建议启用，说明收益与记录开销。**用户同意前不安装、不初始化。** 一次性问答、纯执行任务或用户赶时间时不建议；未回应或拒绝后不重复打扰，除非用户重新提出或任务背景实质变化。

blackboard 只提供数据，不是工作流引擎：不批准、阻断、排序或替 Agent 决定下一步。调用失败不应阻止原任务继续；lint、context、digest 和 Hook 都不是行动前置条件。

## 先选宿主与意图

先确认项目根目录和宿主，再选择最小操作；不要把“打开”解释成“重新安装”。

| 用户意图 | 操作 |
| --- | --- |
| 已有黑板，恢复/接手/压缩后继续 | 读取 `context`，按需要补读节点；不重新 setup |
| 仅打开查看器 | 先 `status`；若对应项目在线，访问其 URL；离线再按需启动服务 |
| 首次 Claude Code 接入或明确重配 | 先读 [接入与打开](references/setup.md)，说明 setup 副作用后使用 |
| 首次 Codex 接入 | 读 [接入与打开](references/setup.md)，用 init 和 Codex Skill 安装；不默认执行 Claude setup |
| OMP、ZCode 等其他宿主接入 | 按当前宿主机制安装完整 Skill 包并展开 CLI 路径；不增加专用 CLI 分支、不安装其他宿主的 Hook |
| 已启用，只记录关键判断 | 使用下方最小命令；复杂关系见 [记录语义](references/recording.md) |

## 命令位置与项目归属

下列例子中的 `/已确认项目` 必须替换成已确认的绝对项目路径。每次命令显式带 `BLACKBOARD_CWD`，避免工具调用工作目录不同而写错项目。

优先用 PATH 中的 `blackboard`。不可用时，安装后的 Skill 可用 `node "__BLACKBOARD_CLI__"` 替换命令名，**仅限路径已展开为真实文件**。如果路径仍是双下划线包围的 CLI 占位符，说明直接加载了仓库源 Skill；不要执行占位符、不要猜安装路径。可在已确认的 blackboard 仓库根使用 `node bin/blackboard.js`，否则先定位实际 CLI。

## 最小操作

恢复长期现场（默认返回结构化 JSON）：

```sh
BLACKBOARD_CWD="/已确认项目" blackboard context --budget 4000
```

仅查看服务与接入状态：

```sh
BLACKBOARD_CWD="/已确认项目" blackboard status
```

关键猜测值得保留时，新建并显式进入：

```sh
BLACKBOARD_CWD="/已确认项目" blackboard node add hypothesis "待验证的判断" --confidence suspected --enter
```

交接、暂停或压缩前保存现场：

```sh
BLACKBOARD_CWD="/已确认项目" blackboard checkpoint --summary "已确认内容；当前关注点；仍开放的问题"
```

空黑板且用户同时给出实质任务时，可用 `node add goal "用户目标" --enter` 建目标锚点；仅配环境时不凭空创建任务或结论。

## 写什么，不写什么

- 记录可供未来会话复核的目标变化、关键观察、判断支持/反驳/取代、主要关注点与交接现场。
- 不把每次命令、读取、成功提示或原始输出写成逻辑节点。工具活动默认不采集；显式启用后仍是独立活动层，不自动成为事实。
- 一个节点表达一个主要判断，标题可扫描，证据和条件放 `--detail`。
- 未验证的 finding/vuln 候选用 `suspected`；已有静态核对证据可直接用 `static-confirmed`，真实复现后才用 `reproduced`，不要求依次升级。严重度、状态和可信度相互独立。
- 关系读作 “from relation to”：证据 `supports` 或 `contradicts` 论断；有足够证据推翻时才将旧论断设为 `refuted`。新结论确实取代旧结论时才用 `supersedes` 和 `superseded`；反驳不等于取代。

## 按需读取参考

只打开当前操作需要的参考，不一次加载全部：

- [接入与打开](references/setup.md)：首次接入、其他宿主的通用安装、已有黑板、服务生命周期与 setup 副作用。
- [记录语义](references/recording.md)：阈值、关系方向、可信度、短 ID、游标与检查点。
- [并行 Agent](references/parallel-agents.md)：每次显式项目/身份、Hook 继承边界、恢复与交接查询。
- [审计记录](references/audit.md)：仅在代码审计需要时读取；约束记录含义，不规定研究步骤。

## 不可改变的边界

`.blackboard/events.jsonl` 是唯一事实源；state、context、digest、服务快照和页面都是可重建投影，不另建权威记录。

逻辑节点/边、游标/轨迹、工具活动相互独立：创建节点默认不连边、不移动游标；当前节点不是隐式父节点，时间先后和游标轨迹不构成逻辑关系。只保存明确知道的关系，不为连图而编造因果。

并行参与者必须明确身份；不要假设一次 `export` 会跨工具调用保留。使用前按需读取并行参考。Hook 只是可选恢复辅助，不保证子 Agent 自动恢复，也不决定行动。

## 输出预期

配置后简述实际安装/重配项、项目与服务状态、可访问 URL 或手动启动命令；区分“文件已安装”和“当前宿主已加载”。

恢复后简述已确认现场、当前关注点和开放问题，标明未知，不把投影当成下一步指令。记录后只报告实际写入的节点/关系/检查点及必要 ID；没有执行或没有证据的能力、状态与复现结果不要承诺。
