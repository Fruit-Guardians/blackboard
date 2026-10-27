# 研究骨架：问题、候选、证据、裁定与排除

状态：设计稿，待评审。本文不改代码；实现另开 PR。

## 一句话

黑板现在记的是散的节点和边，没有研究的骨架。本设计让 Agent 按“问题 → 候选解释 → 证据 → 裁定 → 排除与覆盖”来记录，并让 `context` 按这个骨架投影现场。只规定记录的语法，不规定研究的步骤；所有关系和状态都由 Agent 写入，内核不推断。

## 问题

研究、审计、调试的共同骨架是：

1. 有一个要回答的**问题**；
2. 有几个**候选**解释或答案；
3. 每条**证据**支持或反驳某个候选；
4. 候选得到**裁定**：成立、被推翻、被取代，或搁置；
5. 被排除的候选、检查过但没发现问题的范围，构成**排除与覆盖**。

黑板的词汇其实够用：`question`、`hypothesis`、`observation`、`supports`、`contradicts`、`refuted`、`deferred` 都有。缺的是两样东西：

- **没有“候选属于哪个问题”这层关系。** 候选和问题之间多半是 `related-to`，或根本没连。读者看到一个假设，不知道它在回答什么、和谁是竞争关系。
- **投影不按骨架组织。** `context` 按类型和最近程度分段（目标、邻域、开放线索、发现、已确认事实、已退役、其他）。一个假设的证据只在扁平、受预算裁剪的 `relations` 列表里，节点本身不带边；读者得自己把两处拼起来。

exp1 的失误都落在这两处：

| exp1 现象 | 落在骨架的哪一环 |
| --- | --- |
| “改名识别留作候选”写在已推翻假设的正文里，B、C 的 4 份答案都读成“不会做” | 搁置的候选没有自己的位置，被它宿主的 `refuted` 吞掉 |
| open / suspected 的假设有支持证据，摘要说成“已验证” | 证据和裁定分开展示，读者把“有支持”当成“已裁定” |
| 关系没带来收益，`related-to` 占 14 条边里的 5 条 | 边没有表达骨架，只表达“有点关系” |
| “检查过、没问题”的结论无处安放 | 否定结果和覆盖范围不是一等记录 |

## 边界（宪章）

本设计必须守住 [AGENT.md](../AGENT.md) 的这些条款：

- **不介入**：`lint` 退出码恒为 0；不推断关系或下一步；不自动连边、不自动移游标。`context` 策略保持 `readOnly: true`、`prescriptive: false`、`nextStepSelection: "agent-controlled"`。
- **严重度、状态、可信度正交**，互不推断，也不从类型推断。
- **节点类型是提示，不是状态机。**
- **Skill 教 Agent 怎么记录，不教 Agent 怎么做任务。**
- **相持时选更少的那个**；加能力前先问能不能用已有的节点、关系、游标、检查点表达，能就不加新概念。
- **未知类型、未知关系都必须可保存**；默认关系 `related-to` 是弱语义，系统不得替它附加逻辑。

因此本设计的分寸是：

- 规定**记录的语法**：这个候选回答哪个问题、这条证据支持还是反驳哪个候选、裁定的依据是哪些边、排除了什么、覆盖到哪里。
- 不规定**研究的步骤**：不要求先列候选再找证据，不要求问题关闭前必须有候选，不提示“下一步该验证哪个候选”。
- 投影只做**机械分组**：按 Agent 写下的边和状态分组，不按证据多少推断裁定，不按类型猜归属。

## 记录语法

只新增一种关系 `answers`，不新增节点类型、状态或字段。

### 问题

问题是一个可以独立结束的待答事项。通常是 `question` 节点；目标（`goal`）本身也可以是被回答的问题。

```sh
blackboard node add question "为什么 v2.3 的导入会丢重命名的文件" --to "<目标ID>" --cwd "/已确认项目" --no-init
```

子问题用 `refines` 指向上级问题：`<子问题> refines <上级问题>`。

问题的 `status` 照旧：`open`、`active`、`blocked`、`deferred`、`done`。问题关闭不要求有候选成立；“查不出”“不值得查”也是合法的关闭，理由写进检查点或 `detail`。

### 候选

候选是问题的一个可能答案，通常是 `hypothesis`；审计里常是 `finding` / `vuln`。候选用**新关系 `answers`** 指向它回答的问题：

```sh
blackboard node add hypothesis "diff 阶段把重命名当成删除加新增" --confidence suspected --to "<问题ID>" --rel answers --cwd "/已确认项目" --no-init
blackboard node add hypothesis "rename 检测阈值在大文件上失效" --confidence suspected --to "<问题ID>" --rel answers --cwd "/已确认项目" --no-init
```

读作“候选 answers 问题”。同一个问题下的候选彼此是竞争关系，这一点由分组表达，不需要候选之间互相连边。

一个候选可以回答多个问题；一个节点能不能当候选不看类型，只看有没有 `answers` 边。

**没决定的事单独成候选。** “留作候选”“以后再说”的方向，单独建一个候选，状态设为 `deferred`，不写进别的节点正文。这条直接对应 exp1 的失误，也覆盖了路线图阶段 4 的“未决项单独成节点”。

```sh
blackboard node add hypothesis "支持基于内容相似度的改名识别" --status deferred --to "<问题ID>" --rel answers --detail "本轮不做：原因；重新考虑的条件" --cwd "/已确认项目" --no-init
```

### 证据

证据是实际观察到的东西（`observation`、`fact`、`result`），用 `supports` 或 `contradicts` 指向候选。这和现有约定一致，不变。

```sh
blackboard node add observation "关闭 rename 检测后丢失消失" --to "<候选ID>" --rel supports --detail "复现条件、命令、结果位置" --cwd "/已确认项目" --no-init
blackboard link "<证据ID>" "<另一候选ID>" --rel contradicts --label "小文件同样丢失，与阈值无关" --cwd "/已确认项目" --no-init
```

一条证据可以同时支持一个候选、反驳另一个。边的 `--label` 写“为什么支持/反驳”，这正是证据账本里最有用的一行。

### 裁定

裁定就是候选的 `status`，加上指向它的证据边作为依据：

| 裁定 | 状态 | 依据 |
| --- | --- | --- |
| 成立 | `confirmed` | 至少一条 `supports`，可信度单独标（`static-confirmed` / `reproduced`） |
| 推翻 | `refuted` | 至少一条 `contradicts` |
| 取代 | `superseded` | 新候选 `supersedes` 旧候选 |
| 搁置 | `deferred` | `detail` 写不做的原因和重新考虑的条件 |
| 未定 | `open` / `active` / `blocked` | 有多少证据都只是未定 |

状态和边是两次独立写入，内核不从一个推出另一个。“有三条支持、状态仍是 open”是合法的记录，投影会如实显示这个事实（见下文），但不替 Agent 改状态。

不新增“裁定”节点：裁定的内容就是状态，再加一个节点只会让状态有两个来源。

### 排除与覆盖

排除有两种，都已经能用现有词汇表达，本设计只是让它们在投影里有自己的一段：

1. **被推翻的候选**：`refuted`，带 `contradicts` 证据。
2. **检查过、没发现问题的范围**：一条否定结果，状态 `confirmed`，**标题写明覆盖范围**，`detail` 写怎么查的、哪些没查。

```sh
blackboard node add result "v2.3 的 14 个导入路径都经过 rename 检测" --status confirmed --to "<候选ID>" --rel contradicts --detail "检查方法；未覆盖：符号链接、子模块" --cwd "/已确认项目" --no-init
```

否定结果是有界的：它反驳的是“在这个范围内存在问题”，不是“问题不存在”。审计参考里已有的那句“失败实验也可以是 confirmed 的观察，但不因此确认漏洞不存在；结论必须受实验覆盖范围约束”，在这里落成具体写法：范围写进标题，未覆盖的部分写进 `detail`。被它反驳的候选是否标 `refuted`，由 Agent 按覆盖程度判断。

## 投影

### `context` 新增 `inquiries` 段

在 `blackboard.context.v1` 里加一个字段 `inquiries`（只加字段，按契约兼容）。分组规则全部是机械的：

- **问题集合**：所有被 `answers` 边指向的节点，加上所有 open / active / blocked 的 `question` 节点（没有候选的问题也要露出来）。
- **每个问题下的候选**：指向它的 `answers` 边的起点，按状态分进四组：
  - `live`：open / active / blocked；
  - `settled`：confirmed；
  - `excluded`：refuted / superseded / dead；
  - `deferred`：deferred。
- **每个候选的证据账本**：指向它的 `supports` 和 `contradicts` 边，分成 `for` 和 `against`，每条带证据的 id、标题、状态、可信度和边的 `label`。
- **事实陈述**：对 `live` 组的候选，注明 `for` / `against` 的条数，以及自最近检查点以来新增了几条。这是阶段 4“状态未跟上证据”的落点。只陈述数目和时间，不说“应当确认”。
- **子问题**：指向该问题的 `refines` 边的起点，只列 id 和标题。
- **顺序**：问题按创建时间，组内候选和账本条目也按创建时间。不按证据多少、严重度或“重要性”排序，不给出推荐。

JSON 形状（示意）：

```json
{
  "inquiries": [
    {
      "question": { "id": "q1", "title": "为什么 v2.3 的导入会丢重命名的文件", "status": "open" },
      "refinedBy": [],
      "candidates": {
        "live": [
          {
            "id": "hy1", "type": "hypothesis", "title": "diff 阶段把重命名当成删除加新增",
            "status": "open", "confidence": "suspected",
            "for": [{ "id": "o3", "title": "关闭 rename 检测后丢失消失", "status": "confirmed", "label": "" }],
            "against": [],
            "evidenceSinceCheckpoint": { "checkpoint": "c2", "for": 1, "against": 0 }
          }
        ],
        "settled": [],
        "excluded": [
          {
            "id": "hy2", "type": "hypothesis", "title": "rename 检测阈值在大文件上失效",
            "status": "refuted",
            "for": [],
            "against": [{ "id": "o4", "title": "小文件同样丢失", "status": "confirmed", "label": "与阈值无关" }]
          }
        ],
        "deferred": [
          { "id": "hy3", "type": "hypothesis", "title": "支持基于内容相似度的改名识别", "status": "deferred" }
        ]
      }
    }
  ]
}
```

Markdown 渲染（示意）：

```text
## Inquiries（按问题组织；状态由 Agent 记录，未经推断）

### q1 为什么 v2.3 的导入会丢重命名的文件 [open]
未定：
- hy1 diff 阶段把重命名当成删除加新增 [open, suspected]
  支持 1 · 反驳 0（自 c2 起 +1 支持，状态未变）
  + o3 关闭 rename 检测后丢失消失 [confirmed]
已排除：
- hy2 rename 检测阈值在大文件上失效 [refuted]
  − o4 小文件同样丢失 [confirmed] —— 与阈值无关
搁置（未决定，不是否定）：
- hy3 支持基于内容相似度的改名识别 [deferred]
```

“搁置（未决定，不是否定）”这类段名是有意的：exp1 的错误就是把搁置读成了否定，段名直接说清楚。

### 预算

- 账本条目只带 id、标题、状态、可信度和 `label`，不带 `detail`；详情仍在原有分段里。
- `inquiries` 在 `objectives` 之后、`neighborhood` 之前花预算，因为它是骨架。一个问题作为一个单位纳入；放不下时整个问题省略，计入 `omitted.inquiries`。
- 第一版不改其他分段，同一个节点可能在 `inquiries` 和 `openThreads` 里各出现一次。这样改动只加不减，契约安全。是否去重留给 exp2 的数据决定。

### `show` 与 `digest`

- `show <问题ID>` 的文本输出按上面的格式列出候选和账本；`show <候选ID>` 把上游、下游按 `answers` / `supports` / `contradicts` 分组显示。`show --json` 已经带 `parents` / `children`，不改。
- `digest` 加同样的一段，内容与 `context` 的 Markdown 渲染一致。

## lint

只加机械核对，级别为 info，退出码仍为 0：

- **`unexplained-refutation`**：`refuted` 的节点没有任何指向它的 `contradicts`。与现有的 `unexplained-superseded` 对称。
- **`closed-question-without-answer`**：`done` 的问题既没有 `answers` 边，`detail` 也为空。只提示“交接后看不出它是怎么结束的”，不要求补候选。

不做：不检查“正文里是否藏了未决项”（要解析自然语言，等于推断）；不检查“证据够不够确认”（等于替 Agent 裁定）。

## CLI 的小缺口

`node add --to <ID> --rel <关系>` 不接受 `--label`，现在要写“为什么支持”得再执行一次 `link`。建议给 `node add` 加 `--label`，只在有 `--to` 时生效。这是加参数，按契约兼容。

## Skill

- `recording.md` 新增一节“按问题组织”：上面五个要素的写法和例子，强调这是记录方式，不是研究顺序。
- 新增 `references/inquiry.md`，三种研究的侧重点各一段。只说记录时注意什么，不说先做什么：
  - **审计**：问题是“某类缺陷是否存在于某范围”。重点在覆盖：否定结果的标题写明范围，`excluded` 段就是“检查过、没问题”的清单；`audit.md` 改为引用这一节。
  - **调试**：问题是“为什么出现某现象”，候选是可能原因。重点在排除：每个被排除的原因都带反证，避免交接后重复验证。
  - **探索与调研**：重点在问题树。子问题用 `refines`；暂不深入的方向用 `deferred` 候选或 `deferred` 问题，不写进正文。
- `SKILL.md` 主文件只在“写什么不写什么”里加一行：候选用 `answers` 连到问题，未决方向单独成节点。

## 不采用的方案

- **新增节点类型**（candidate、verdict、exclusion）：类型只是提示，新类型会和状态重复表达同一件事，还会诱导出“必须先有 candidate 才能有 verdict”的状态机。
- **问题的状态机**（如关闭前必须有成立的候选）：规定了研究步骤，违反不介入。
- **用 `related-to` 加类型推断归属**（hypothesis 连到 question 就算候选）：这是从类型推断关系。exp1 里 `related-to` 本来就是噪声，再给它加隐含语义只会更糊。
- **按证据数量自动改状态或给出“建议确认”**：替 Agent 裁定，违反不推断。
- **新增 `scope` 字段记录覆盖范围**：先用“标题写范围、`detail` 写未覆盖部分”的约定。若 exp2 显示读者仍然把否定结果读成全局否定，再考虑加字段。
- **状态变更带 `--reason`**：裁定的依据已经由证据边和 `label` 表达。多一个理由字段会形成第二个依据来源。exp2 若发现依据经常不是单条证据，再议。

## 待你决定

1. **新增关系 `answers`，还是复用已有关系？** 建议新增。宪章要求能用已有关系表达就不加，这里逐个看过：`related-to` 按宪章是弱语义，给它加“候选”含义就是替它附加逻辑，分组还得靠类型推断；`resolves` 表示“已解决”，用在未定或被推翻的候选上意思相反；`refines` 已经用来表示子问题；`depends-on`、`derived-from` 方向和含义都不对。这是本设计唯一的词汇新增。
2. **覆盖范围放哪？** 建议先用标题加 `detail` 的约定，不加字段。
3. **`inquiries` 的预算位置**：建议放在 `objectives` 之后、`neighborhood` 之前，条目不带 `detail`。
4. **`inquiries` 与 `openThreads` 是否去重**：建议第一版不去重，等 exp2 的数据。
5. **问题集合是否包含没有候选的 open `goal`**：建议不包含。目标已在 `objectives` 段，只有被 `answers` 指向时才作为问题出现。

## 验证

- **固定输出测试**：用合成事件日志覆盖四组候选、双向证据、子问题、预算省略，以及 `evidenceSinceCheckpoint`。存档只加不改。
- **exp1 回放（只在本地）**：把 exp1 黑板按新语法重记一遍，用同样的题目复测。完成标准：
  - “改名识别”出现在 `deferred` 组，B、C 不再把它答成“不会做”；
  - hy1 显示“支持 N · 反驳 0，状态未变”，答案不再把它说成“已验证”。
- **exp2（阶段 3）**：题目按骨架出，例如“q1 现在有哪些候选还没排除”“hy2 是被什么推翻的”“哪些范围已经检查过”。对照组加一组按旧方式记录的同一块黑板，区分“骨架”和“信息量”各自的作用。

## 与路线图的关系

- **阶段 4（把缺口显示出来）**：本设计吸收其中两项。“未决项单独成节点”落成 `deferred` 候选；“状态未跟上证据”落成 `inquiries` 里的 `evidenceSinceCheckpoint`。阶段 4 的另外两项（未连关系的回显、省略可见）不受影响。
- **阶段 3（exp2）**：题目按骨架设计，`inquiries` 作为被测对象之一。
- **阶段 5（交接回执）**：回执的机械核对可以多一条：把 `deferred` 或 `excluded` 组里的候选当作已定结论引用。
- **契约**：只加字段（`inquiries`、`omitted.inquiries`）、加一个关系种类（`answers`）、加一个参数（`node add --label`）。`EDGE_KINDS` 新增值需要在 `CONTRACT.md` 注明。旧版 CLI 回放时不校验关系种类，读到 `answers` 边会照常保留，只是不分组。

## 实现顺序（供后续 PR 参考）

1. `lib/model.js`：`EDGE_KINDS` 加 `answers`；`node add` 接受 `--label`。
2. `lib/context.js`：构建 `inquiries`，接入预算和 Markdown 渲染；`digest` 复用同一渲染。
3. `bin/blackboard.js`：`show` 的分组显示。
4. `lib/lint.js`：两条 info 规则。
5. 固定输出测试与 `CONTRACT.md`。
6. Skill：`recording.md`、`references/inquiry.md`、`audit.md`、`SKILL.md`。
