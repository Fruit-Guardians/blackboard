---
name: inquiry
description: 按问题、候选、证据、裁定、排除记录研究；有几个相互竞争的解释、需要记下排除了什么、或要让接手者分清已定与未定时可选使用。只讲怎么记录，不规定研究步骤。
metadata:
  version: "1"
  invocation: agent
  relations: answers, refines, supports, contradicts, supersedes
---

# 可选的研究记录方式：问题、候选、证据、裁定、排除

这是一种可选的记录方式，不是研究步骤。只在你自己觉得有用时读取和使用：同时有几个相互竞争的解释、需要记下排除了什么、或者要让接手者分清“已定”和“未定”。不用它也是完整、正常的记录；没有候选的问题、只有一条观察的记录，都不需要补成这个结构。

blackboard 不认识这种方式：`context`、`digest`、`lint` 不会因为你用或不用它而改变显示或提示。下面的写法只用已有的节点、状态和关系，加一个约定的关系名 `answers`；内核把它当作普通关系保存。

`/已确认项目` 必须替换成真实绝对项目路径；`<问题ID>`、`<候选ID>` 等必须替换为命令输出中的实际 ID 或唯一前缀。CLI 定位遵循主入口，并行时每条命令另加身份。不原样执行未替换的占位符。

## 五个要素怎么记

| 要素 | 记成 | 关系 |
| --- | --- | --- |
| 问题 | `question`（目标本身也可以是被回答的问题） | 子问题 `refines` 上级问题 |
| 候选 | `hypothesis`；审计里常是 `finding` / `vuln` | 候选 `answers` 问题 |
| 证据 | `observation`、`fact`、`result` | 证据 `supports` 或 `contradicts` 候选，`--label` 写为什么 |
| 裁定 | 候选的 `--status`（`confirmed`、`refuted`、`superseded`、`deferred`） | 依据就是指向它的证据边 |
| 排除 | 被推翻的候选，或写明范围的否定结果 | 否定结果 `contradicts` 候选 |

同一个问题下的候选彼此竞争，这一点由它们都 `answers` 同一个问题来表达，候选之间不必互相连边。

```sh
blackboard node add question "为什么导入会丢掉重命名的文件" --to "<目标ID>" --cwd "/已确认项目" --no-init
blackboard node add hypothesis "diff 阶段把重命名当成删除加新增" --confidence suspected --to "<问题ID>" --rel answers --cwd "/已确认项目" --no-init
blackboard node add observation "关闭重命名检测后丢失消失" --to "<候选ID>" --rel supports --label "只改这一个条件，丢失就消失" --detail "复现条件、命令、结果位置" --cwd "/已确认项目" --no-init
blackboard link "<证据ID>" "<另一候选ID>" --rel contradicts --label "小文件同样丢失，与阈值无关" --cwd "/已确认项目" --no-init
```

`node add --to … --label` 在创建时就写下关系说明（`capabilities --json` 的 `features.nodeEdgeLabel` 表示支持）；较旧的 CLI 不接受时，用 `link` 另加一次。

## 裁定只由你写

状态和边是两次独立写入。“有几条支持、状态仍是 open”是合法的记录：证据多少不等于已经裁定，是否改状态由你判断。推翻时先有 `contradicts` 边，再设 `refuted`；取代用 `supersedes` 和 `superseded`，两者不同义，见[记录语义](../references/recording.md)。

## 没决定的方向单独成节点

“留作候选”“以后再说”的方向，单独记一个节点，不写进别的节点正文。它是问题的一个答案时，记成 `deferred` 的候选；它本身是一个待答事项时，记成 open 的 `question`。`detail` 写暂不处理的原因和重新考虑的条件。写在正文里的未决项，交接后常被读成已经否定。

```sh
blackboard node add hypothesis "支持基于内容相似度的重命名识别" --status deferred --to "<问题ID>" --rel answers --detail "本轮不做的原因；重新考虑的条件" --cwd "/已确认项目" --no-init
```

## 否定结果写明覆盖范围

“检查过、没发现问题”是有界的结论：标题写明检查的范围，`detail` 写怎么查的、哪些没有覆盖。它反驳的是“在这个范围内存在问题”，不是“问题不存在”。被它反驳的候选是否标 `refuted`，按覆盖程度自己判断。

```sh
blackboard node add result "14 个导入路径都经过重命名检测" --status confirmed --to "<候选ID>" --rel contradicts --detail "检查方法；未覆盖：符号链接、子模块" --cwd "/已确认项目" --no-init
```

## 怎么读回来

blackboard 不会按问题替你组织现场；需要看一个问题的全貌时自己查：

```sh
blackboard search --rel answers --related-to "<问题ID>" --json --cwd "/已确认项目"
blackboard show "<候选ID>" --json --cwd "/已确认项目"
```

第一条列出回答这个问题的候选及其状态；第二条的 `parents` 是指向候选的证据，`edge` 字段标明 `supports` 还是 `contradicts`。`context` 照常把这些节点按类型和状态分段，`answers` 边出现在关系列表里。

页面上新建关联时只能选内置关系，`answers` 请用 CLI 写入；页面照常显示它。

## 不同研究的侧重

只说记录时值得注意什么，不说先做什么。

- **审计**：问题常是“某类缺陷是否存在于某个范围”。重点在覆盖：否定结果的标题写范围，被排除的候选连同反证就是“检查过、没问题”的清单。与[审计记录](audit.md)一起读。
- **调试**：问题常是“为什么出现某现象”，候选是可能的原因。重点在排除：每个被排除的原因都带反证，接手者不必重复验证。
- **探索与调研**：重点在问题树。子问题用 `refines`；暂不深入的方向用 `deferred` 的候选或问题，不写进正文。
