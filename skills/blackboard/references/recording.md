# 记录语义与恢复锚点

记录是可选的数据外化，不是执行门槛。下面 `/已确认项目` 必须替换为真实项目绝对路径；`<证据ID>`、`<论断ID>` 等必须替换为已有节点的实际 ID，尖括号不是 shell 重定向，示例用引号保护它们。不要原样执行未替换的占位符。CLI 定位遵循主入口；并行时每条命令还需显式身份。

## 写入阈值

值得保留的信息包括：用户目标或主要方向变化、可复核观察、关键判断及其支持/反驳/取代、切换主要关注点、暂停/压缩/交接现场。不要写逐命令流水账，也不要求每轮回复都记一笔。原始输出可在必要时摘要到 `--detail`，保留定位与复核条件，避免无关敏感内容。

一个节点只表达一个主要判断；节点类型和关系可自定义，不构成状态机。创建节点默认不连边、不移动游标；`--enter` 才显式进入，`--relate-here` 才与当前位置建立默认弱关系 `related-to`，不能借此暗示已经证明的来源。

```sh
BLACKBOARD_CWD="/已确认项目" blackboard node add hypothesis "边界条件可能导致错误" --confidence suspected --detail "已知条件与待核对部分"
BLACKBOARD_CWD="/已确认项目" blackboard node add observation "已观察到的行为" --detail "输入条件、实际结果、可复核位置"
```

记录命令返回的实际 ID；再根据已知关系显式连边。暂时没有已知关联可以不连，不伪造因果来消除孤立节点。

## 关系读作 from relation to

| 含义 | 方向 |
| --- | --- |
| 证据支持论断 | 证据 → supports → 论断 |
| 论断来自证据 | 论断 → derived-from → 证据 |
| 证据反驳旧论断 | 证据 → contradicts → 旧论断 |
| 新结论取代旧结论 | 新结论 → supersedes → 旧结论 |
| 问题/猜测属于目标或上游判断，暂无更强语义 | 问题/猜测 → related-to → 目标/上游判断 |

```sh
BLACKBOARD_CWD="/已确认项目" blackboard link "<证据ID>" "<论断ID>" --rel supports
BLACKBOARD_CWD="/已确认项目" blackboard link "<发现ID>" "<证据ID>" --rel derived-from
BLACKBOARD_CWD="/已确认项目" blackboard link "<问题ID>" "<目标ID>" --rel related-to
```

`supports` 与反向的 `derived-from` 是两种可选表达；不用为了同一事实重复加边。时间相邻、游标移动或节点重要性均不构成逻辑关系。

### 反驳不等于取代

证据推翻旧判断：记录 `contradicts`，将被推翻节点标为 `refuted`。

```sh
BLACKBOARD_CWD="/已确认项目" blackboard link "<反证ID>" "<旧论断ID>" --rel contradicts
BLACKBOARD_CWD="/已确认项目" blackboard edit "<旧论断ID>" --status refuted
```

新结论替换旧表达、解释或范围：记录 `supersedes`，将旧节点标为 `superseded`。取代不必表示旧结论原本为假。

```sh
BLACKBOARD_CWD="/已确认项目" blackboard link "<新结论ID>" "<旧结论ID>" --rel supersedes
BLACKBOARD_CWD="/已确认项目" blackboard edit "<旧结论ID>" --status superseded
```

不要删除旧节点来隐藏推理历史；事件日志保留演变过程。状态与边是两个独立显式写入，不假设其中一个自动生成另一个。

## 严重度、状态、可信度分开

- `--sev` 表示影响程度，不证明结论成立。
- `--status` 表示节点当前状态，例如 `open`、`confirmed`、`refuted`、`superseded`。
- `--confidence` 表示证据成熟度。未验证的 finding/vuln 候选用 `suspected`；已有源码/静态核对证据可直接用 `static-confirmed`；真实执行复现并观察到结果后才用 `reproduced`，不要求依次升级。命令还接受 `confirmed`，但这个宽泛值不能替代说明证据方法，更不能作为未验证候选的默认值。

```sh
BLACKBOARD_CWD="/已确认项目" blackboard node add finding "候选结论" --confidence suspected --detail "待核对的条件与依据"
BLACKBOARD_CWD="/已确认项目" blackboard edit "<候选ID>" --confidence static-confirmed --detail "已核对的源码位置、成立条件与尚未执行的验证"
```

最后一条只在确实完成静态核对后执行。真实复现后才把该候选更新为 `--confidence reproduced`，并补充真实环境、输入与观测结果。`edit --detail` 会替换详情，应保留仍有价值的旧条件与证据。已核实的 fact/observation/result 可标记 `--status confirmed`，但这不会自动提升其他节点可信度。

## 短 ID 与查询

使用 `node add` 返回的 ID，或用 `ls`/`show` 查询；允许足够长且唯一的 ID 前缀。前缀有歧义时，按 CLI 给出的候选选择完整 ID，不猜、不取列表第一项。

```sh
BLACKBOARD_CWD="/已确认项目" blackboard ls
BLACKBOARD_CWD="/已确认项目" blackboard show "<节点ID或唯一前缀>"
```

## 游标与检查点

游标表示此刻实际继续研究的位置，不是优先级、逻辑父节点或任务队列。切换主要关注点时显式移动；已收束的结论不必长期占据游标。

```sh
BLACKBOARD_CWD="/已确认项目" blackboard cursor "<当前问题ID>" --reason "转向尚未解决的边界条件"
BLACKBOARD_CWD="/已确认项目" blackboard checkpoint --summary "已确认内容；当前节点与依据；开放方向；未执行的验证"
```

检查点是恢复锚点，不等于证明任务完成。需要时用 `context --since "<检查点ID>" --budget 4000` 读取增量现场。`lint` 可提示孤立节点、缺失证据等质量问题，但只读、不修图、不阻断；不要求每次写入后运行。
