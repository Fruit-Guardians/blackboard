# AGENT.md — blackboard 项目要义

一句话：**把 Agent 的思考过程变成外置的、可回放的数据，而不夺取 Agent 的任何决策权。**

改动这个项目时，以下三条按优先级排序；凡是要在"更智能"和"更不干预"之间选的地方，本项目每次都选后者。守住这条线，就守住了它的身份。

## 1. 上下文可恢复性（项目存在的理由）

Agent 会话的上下文天然易失：压缩、断线、换会话后思考现场就没了。

- `.blackboard/events.jsonl` 是**唯一事实源**：append-only、可完整回放、事件溯源。
- `state.json` 只是可丢弃的缓存，损坏时必须能从事件日志恢复。
- Digest / `context` / server snapshot / 前端视图全部是这个日志之上的**投影**，不是权威数据。任何新功能都不得制造第二事实源。
- 可靠性优先于功能：跨进程文件锁不抢占存活持有者；回放跳过坏行但必须计数并在 `lint` 报告，绝不静默丢弃；`state.json` 写失败不能让已记录的事件报错。

## 2. 逻辑外化（区别于 todo list / workflow 引擎的关键）

黑板不是步骤清单，而是**思考的语义图**：观察→猜测→发现，带方向性关系（supports / contradicts / supersedes…）。

- 逻辑层（node/edge）、游标层（cursor/trail）、活动层（activity）三层相互独立，不许互相污染——记录"Agent 在哪"和记录"为什么"是两件事。
- 风险（severity）、状态（status）、可信度（confidence）三个维度正交，任何一个都不得从另外两个或从节点类型推断。
- 节点类型只是语义提示和视觉颜色，**不构成状态机**；未知类型、未知关系都必须可保存。

## 3. 不干预（贯穿全部设计的哲学约束）

blackboard 不是行动前置条件，不替 Agent 决定下一步。具体体现，改动时必须保持：

- `lint` 永远以退出状态 0 返回——只报告，不阻断。
- `context` 返回包必须保留 `readOnly: true`、`prescriptive: false`、`nextStepSelection: "agent-controlled"`。
- 创建节点**不**自动连边、**不**自动移动游标；`--enter` / `--relate-here` 只在显式提供时生效。
- 默认关系是弱语义的 `related-to`——系统不得替 Agent 伪造逻辑。
- Hook 只是可选的恢复辅助；不装 Hook 也要能完整使用节点、关系、游标、检查点和 Digest。
- 原始工具活动采集默认关闭；开启时脱敏默认开。

## 工程边界

- 零运行时依赖，只需 Node ≥ 18；前端依赖全部是 devDependencies，`public/` 带构建产物，CLI 即装即用。
- `lib/model.js` 必须保持无 Node-only API：被 CLI、server 和浏览器共用。
- 命名已完成 breaking cutover：唯一 CLI 是 `blackboard`（`bin/blackboard.js`），环境变量只用 `BLACKBOARD_*`，数据目录只用 `.blackboard/`。不保留 `flow` 入口、`FLOW_*` 读取或 `.flow/` 回退，不新增自动迁移/别名；其他项目按 README 手动重命名目录、重装 Skill/Hook，事件原文不改写。
- Skill 的唯一源是完整的 `skills/blackboard/` 包：`SKILL.md` 保持聚焦，参考资料按需加载，`agents/openai.yaml` 与 `assets/` 承载展示信息。安装和发布必须包含完整目录，不恢复内嵌副本，也不只复制入口而遗漏资源。
- 写接口（server 页面编辑）必须维持三道防护：loopback Host 校验（防 DNS 重绑定）、同 Origin + `application/json`、256KB 请求体上限；`--read-only` 与离线导出永远只读。
- 页面协作编辑只提交实际修改字段，并在事件写锁内核对字段基准；冲突保留草稿，不自动覆盖或合并。选择 Agent 阅读视角不写事件、不移动任何人的游标；实时与离线投影须保持同一身份语义。
- 新建 `.blackboard/` 自带 `.gitignore`（内容 `*`）：黑板可能含敏感原文，默认不进版本库。
