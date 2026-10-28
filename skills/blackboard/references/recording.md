# 记录语义与恢复锚点

记录是可选的数据外化，不是执行门槛。下面 `/已确认项目` 必须替换为真实项目绝对路径；`<证据ID>`、`<论断ID>` 等必须替换为已有节点的实际 ID，尖括号不是 shell 重定向，示例用引号保护它们。不要原样执行未替换的占位符。CLI 定位遵循主入口；并行时每条命令还需显式身份。

## 写入阈值

值得保留的信息包括：用户目标或主要方向变化、可复核观察、关键判断及其支持/反驳/取代、切换主要关注点、暂停/压缩/交接现场。不要写逐命令流水账，也不要求每轮回复都记一笔。原始输出可在必要时摘要到 `--detail`，保留定位与复核条件，避免无关敏感内容。

阈值管的是“记什么”，不是“什么时候记”：达到阈值的判断在形成时就写，不等结论稳定或任务收尾。磁盘上的日志和台账不替代节点，下一个会话只从黑板恢复。

一个节点只表达一个主要判断。标题只写这个判断，控制在约 80 字内，`lint` 的 `long-titles` 以此为界；证据、文件位置、条件和过程放 `--detail`。标题不复述其他节点的结论，例如不写“hy1 被反驳”：反驳用 `contradicts` 边和 `refuted` 状态表达，否则读者只看标题就以为关系可有可无。节点类型和关系可自定义，不构成状态机。创建节点默认不连边、不移动游标；`--enter` 才显式进入，`--relate-here` 才与当前位置建立默认弱关系 `related-to`，不能借此暗示已经证明的来源。已知新节点与已有节点的关系时，可用 `--to "<已有ID>" --rel <关系>` 在创建时一并声明，读作“新节点 关系 已有节点”；省略 `--rel` 只得到弱关系 `related-to`。`--to` 可重复，同一关系连向多个已有节点（`features.nodeMultiTarget`）；它不移动游标，也不与 `--parent`/`--relate-here` 同用。关系不同的连边用 `link`。

```sh
blackboard node add hypothesis "边界条件可能导致错误" --confidence suspected --detail "已知条件与待核对部分" --cwd "/已确认项目" --no-init
blackboard node add observation "已观察到的行为" --detail "输入条件、实际结果、可复核位置" --cwd "/已确认项目" --no-init
```

```sh
blackboard node add observation "已观察到的行为" --to "<论断ID>" --rel supports --detail "输入条件、实际结果、可复核位置" --cwd "/已确认项目" --no-init
```

记录命令返回的实际 ID：加 `--json` 时读 `node.id`，新建的关系在 `edges` 数组里。之后发现的关系用 `link` 显式连边。暂时没有已知关联可以不连，不伪造因果来消除孤立节点。

假设、问题和发现在创建时往往已经知道属于哪个目标；这时就用 `--to "<目标ID>"` 连上（省略 `--rel` 即 `related-to`）。没有这条边，交接后无法从目标找回它，`lint` 会报 `unscoped-findings`。`lint` 沿关系双向查找，所以经由证据或上游假设间接连到目标也算。

## 关系读作 from relation to

| 含义 | 方向 |
| --- | --- |
| 证据支持论断 | 证据 → supports → 论断 |
| 论断来自证据 | 论断 → derived-from → 证据 |
| 证据反驳旧论断 | 证据 → contradicts → 旧论断 |
| 新结论取代旧结论 | 新结论 → supersedes → 旧结论 |
| 问题/猜测属于目标或上游判断，暂无更强语义 | 问题/猜测 → related-to → 目标/上游判断 |

```sh
blackboard link "<证据ID>" "<论断ID>" --rel supports --cwd "/已确认项目" --no-init
blackboard link "<发现ID>" "<证据ID>" --rel derived-from --cwd "/已确认项目" --no-init
blackboard link "<问题ID>" "<目标ID>" --rel related-to --cwd "/已确认项目" --no-init
```

新节点在关系左侧时（如新证据支持已有论断、新结论取代旧结论），上述 `link` 可改为创建时的 `--to`。`supports` 与反向的 `derived-from` 是两种可选表达；不用为了同一事实重复加边。时间相邻、游标移动或节点重要性均不构成逻辑关系。

### 反驳不等于取代

证据推翻旧判断：记录 `contradicts`，将被推翻节点标为 `refuted`。

```sh
blackboard link "<反证ID>" "<旧论断ID>" --rel contradicts --cwd "/已确认项目" --no-init
blackboard edit "<旧论断ID>" --status refuted --cwd "/已确认项目" --no-init
```

新结论替换旧表达、解释或范围：记录 `supersedes`，将旧节点标为 `superseded`。取代不必表示旧结论原本为假。

```sh
blackboard link "<新结论ID>" "<旧结论ID>" --rel supersedes --cwd "/已确认项目" --no-init
blackboard edit "<旧结论ID>" --status superseded --cwd "/已确认项目" --no-init
```

不要删除旧节点来隐藏推理历史；事件日志保留演变过程。状态与边是两个独立显式写入，不假设其中一个自动生成另一个。

## 严重度、状态、可信度分开

- `--sev` 表示影响程度，不证明结论成立。
- `--status` 表示节点当前状态，例如 `open`、`confirmed`、`refuted`、`superseded`。
- `--confidence` 表示证据成熟度。未验证的 finding/vuln 候选用 `suspected`；已有源码/静态核对证据可直接用 `static-confirmed`；真实执行复现并观察到结果后才用 `reproduced`，不要求依次升级。命令还接受 `confirmed`，但这个宽泛值不能替代说明证据方法，更不能作为未验证候选的默认值。

```sh
blackboard node add finding "候选结论" --confidence suspected --detail "待核对的条件与依据" --cwd "/已确认项目" --no-init
blackboard edit "<候选ID>" --confidence static-confirmed --detail "已核对的源码位置、成立条件与尚未执行的验证" --cwd "/已确认项目" --no-init
```

最后一条只在确实完成静态核对后执行。真实复现后才把该候选更新为 `--confidence reproduced`，并补充真实环境、输入与观测结果。`edit --detail` 会替换详情，应保留仍有价值的旧条件与证据。已核实的 fact/observation/result 可标记 `--status confirmed`，但这不会自动提升其他节点可信度。

## 短 ID 与查询

使用 `node add` 返回的 ID，或用 `search` / `show` 查询；允许足够长且唯一的 ID 前缀。前缀有歧义时，按 CLI 给出的候选选择完整 ID，不猜、不取列表第一项。

```sh
blackboard ls --all --cwd "/已确认项目"
blackboard show "<节点ID或唯一前缀>" --cwd "/已确认项目"
```

`ls` 默认只返回最近 30 条；截断会在 stderr 说明匹配、显示和省略数，JSON stdout 仍是数组。完整读取用 `--all`，与 `--limit` 互斥；`features.listAll` 声明此能力。程序需要总数时用下方 `search.total`，不解析提示文字。

### 查询与统计

```sh
blackboard search "session cookie" --json --cwd "/已确认项目"
blackboard search --type vuln --sev high --confidence reproduced --json --cwd "/已确认项目"
blackboard search --tag site=alpha.example --tag auth --group-by severity,status --cwd "/已确认项目"
blackboard search --type vuln --group-by tag:site,severity,status --limit 1 --json --cwd "/已确认项目"
```

- 关键词按字面量匹配；`--type`、`--status`、`--sev`、`--confidence`、可重复的 `--tag` 和 `--rel` / `--related-to` 可组合，取交集。未填状态不等于 `open`；只读查询不推断或更改节点。
- `total` 是全部匹配数，`items` 是最多 `--limit` 条明细（默认 30，上限 1000），`truncated` 表示明细是否截断。不要根据 `items.length` 统计全部结果。
- `--group-by` 支持 `severity`、`status`、`tag:<键>`，可用逗号组合。JSON 的 `groups` 每项为 `{values: {...}, count}`，覆盖全部匹配，不受 `--limit` 影响；缺省值独立列为 `null`。文本模式只列总数和全部分组。
- 站点显式记录为 `--tag site=alpha.example`；`tag:site` 只读这个约定，不猜正文或裸域名标签。一个节点有多个站点标签时，每站各计一次，不代表多条独立发现。
- 多标签用 `--tag auth --tag session`，不是 `--tag auth,session`；后者是一个字面量标签。重复同值标签不重复计数，不替旧数据改写标签。

`features.searchFilters` 声明严重度/可信度筛选，`features.searchGrouping` 声明分组统计；新选项只用于声明了相应能力的 CLI。`BLACKBOARD_CWD` 可在同一终端一次设置，`--cwd` 优先；跨工具调用和子 Agent 仍应显式传项目路径。

节点公开投影的 `status`、`severity`、`confidence` 始终存在，缺省为 `null`；`features.nodeJsonDefaults` 和 `capabilities.outputs` 声明能力与 schema。NULL 不是 open，不按其他维度补默认裁定；`receipt.result` 是原始写入结果，不规范化为当前读取形状。

### 报告导出

先读取 `capabilities.exportFormats`；仅调用已支持的格式：

```sh
blackboard export --format markdown --type vuln --confidence reproduced --sort severity --out report.md --cwd "/已确认项目"
blackboard export --format markdown --tag site=alpha.example --group-by severity,status --out site.md --cwd "/已确认项目"
blackboard export --format mermaid --group-by tag:site --max-nodes 200 --out graph.mmd --cwd "/已确认项目"
blackboard export --format sarif --type finding --out findings.sarif --cwd "/已确认项目"
```

三个报告格式复用 search 的筛选，读取全部匹配；默认按记录的严重度、再按 ID 排序。Markdown/Mermaid 支持分组，并保留一跳的证据/反证上下文；相关节点可能不满足主筛选，但会标为上下文，不假装新增发现。Markdown 使用记录标题和显式锚点导航，保留完整原文和输入截断标记；Mermaid 有向虚线表示 related-to，节点上限省略量写在注释里。显示边超过 500 条或图源码超过 50,000 字符时会拒绝导出；用更精确的筛选或更低的 `--max-nodes` 缩小图，不截短原文或猜测该丢弃哪些关系。

SARIF 仅将带已记录 `loc` 的 finding/vuln 转为结果；不从正文或站点标签伪造代码位置。检查 `runs[].properties.coverage` 和 `skippedNodes`：无位置导致零结果不等于没有发现。`--group-by` 不用于 SARIF，`--max-nodes` 仅用于 Mermaid。HTML 仍是完整快照，不接受报告筛选。导出不改事件；输出文件不能放入黑板数据目录。任何格式的逻辑记录都可能含敏感正文，交付前仍需核对实际内容。



## 游标与检查点

游标表示此刻实际继续研究的位置，不是优先级、逻辑父节点或任务队列。切换主要关注点时显式移动；已收束的结论不必长期占据游标。

```sh
blackboard cursor "<当前问题ID>" --reason "转向尚未解决的边界条件" --cwd "/已确认项目" --no-init
blackboard checkpoint --summary "已确认内容；当前节点与依据；开放方向；未执行的验证" --cwd "/已确认项目" --no-init
```

等待外部依赖时（源码未到、等用户答复、等长时间运行的结果），把卡住的目标或问题标为 `blocked`，等到后 `revive` 恢复为 `open`，完成后 `done`；在等什么写进检查点摘要。`blocked` 只是记录，不阻止任何命令，但没有它，接手者只看到一个刚开始的目标，看不出它卡住了：

```sh
blackboard block "<目标或问题ID>" --cwd "/已确认项目" --no-init
blackboard checkpoint --summary "等待：缺少的源码或答复；已确认内容；恢复后先核对的点" --cwd "/已确认项目" --no-init
blackboard revive "<目标或问题ID>" --cwd "/已确认项目" --no-init
```

检查点是恢复锚点，不等于证明任务完成。打检查点时，回显会列出同一身份上一检查点以来的节点与关系变化（`--json` 的 `sincePrevious`）；这只是记录的数量，不评判做得够不够。需要时用 `context --since "<检查点ID>" --budget 4000` 读取增量现场。`lint` 可提示孤立节点、缺失证据等质量问题，但只读、不修图、不阻断；不要求每次写入后运行。

增量包的 `recentChanges` 是仍存在的新增或修改节点；`changes` 按新到旧报告 `relation-added`、`relation-removed` 与 `node-removed`。删除节点也使其关联关系失效，不要因节点不再出现在快照里就保留旧结论链。检查 `omitted.changes`，被预算裁剪不等于没有变更；无效检查点会明确报错。检查点按事件顺序划界，不遗漏同一毫秒内的后续写入。
