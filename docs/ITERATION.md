# 从记录到可信交接

> 历史迭代记录：保留当轮范围、验收线和执行边界；下文“本轮”及浏览器验证描述不指向当前改动。当前目录边界见[架构说明](ARCHITECTURE.md)，实际开发与发布前命令见[贡献指南](../CONTRIBUTING.md)。

本轮保留 blackboard 的身份：外置语义记忆，不选择下一步；events.jsonl 是唯一事实源。所有开发、故障注入和基准只操作临时演示板，不修改日常项目板或 installed/current。

## 已实现

| 方向 | 入口 | 验收 |
| --- | --- | --- |
| 恢复正确性 | context / digest / stats，共享 semantics | 缺省 confidence 不等于确认，refuted/dead/superseded 不混入当前事实；status 与 confidence 不改写；action 开放项一致 |
| 恢复完整性 | JSON / Markdown、otherNodes / retiredNodes / omitted | 未知类型不静默丢失；Markdown 展示交接摘要、独立字段、方向关系和来源；低预算明确省略数量 |
| 变化追溯 | history / changes、viewer 历史与交接差异 | 同毫秒也按 checkpoint 事件位置划分；字段前后值、删边、隐式删边、删除节点与 reset 可追溯 |
| 检索 | search | 文本分词 AND（跨字段）、type/tag/status/关系/邻接过滤、稳定 ID、命中字段、来源位置、截断标记；不读源文件、不移动游标 |
| 显式编辑 | viewer | 两个已有节点建立方向明确的关系；severity/confidence 独立编辑；只提交变化字段与对应 expected，冲突保留草稿 |
| 备份恢复 | backup / restore | 原始日志字节和 SHA256 相同，清单校验，缓存重建；不覆盖已有板；损坏/未来事件可归档但不恢复成可写板 |
| 幂等 | --request-id / receipt、HTTP Idempotency-Key | 同 ID 同 payload 返回原结果；异 payload 冲突；显式恢复 pending，查询只读；日志保存去重凭据 |
| 能力描述 | capabilities --json | schemaVersion、事件格式、命令、功能及限制；不依赖版本正则推断功能 |
| 工程验证 | package smoke / CI / benchmark | 实际 tarball 全新安装、零 runtime deps、完整 Skill 与静态资产；基准记录环境、原始样本及完整性 |

## 一条端到端验收线

1. Agent A 建立假设和支持证据，保存 checkpoint。
2. Agent B 改判、移除旧支持并建立反证关系。
3. 读取 changes，准确看到改判字段、删除支持关系与新增反证。
4. 读取 history 和 search，找到变更过程与原始来源指针。
5. 读取 context，保留非指令契约；恢复/检索全过程事件 SHA 不变。
6. 写入后丢失响应，原 request ID 重试只返回原结果，receipt 查询不写入。
7. backup 后 restore 到另一目录，原始事件 SHA 与完整图谱保持一致。

自动覆盖在 `test/iteration.test.js`、history、backup、receipts、recovery、search 等测试中。真实浏览器交互另行记录在本轮验证材料中。

## 开发命令

```bash
npm test
npm run check:types
npm run build
npm run evaluate:recovery
npm run verify:package
npm run benchmark -- --quick
npm run benchmark:full
```

恢复评测覆盖中断、反驳、取代、多 Agent 交接、无游标、低预算、交接后删边。输出模型评测 `not-run`，区分确定性正确性与真实新会话的恢复效果；后者需要固定模型、提示、输入板与无板/旧版/新版对照。低预算不保证全量事实召回，以 omitted 显式报告缺失。

性能基线先收集 full replay、context、写入和并发读写。暂不引入数据库、向量库、缓存第二事实源、历史裁剪或自动决策；后续仅根据测量优化可丢弃投影。新增回执有日志扫描成本，必须与普通日志及请求密集日志分别测量。

## 接手提示（可复用）

```text
读取 blackboard context --json（默认 JSON）与指定 checkpoint 后的 changes。
仅依据所读记录说明当前问题、有效证据、已反驳项、变更原因（若有记录）与未验证项。
用节点 ID、关系方向和来源位置引用证据；省略项通过 search/show/history 补读。
缺少记录时明确写“未记录”，不要由类型推断状态、可信度或下一步。
由你自主选择下一步；这次读取不修改节点、关系或游标。
```

事件格式版本仍为 1；新 receipt 操作是可忽略的辅助事件，节点/关系/游标仍用既有操作写入。本轮只修改开发仓库，不切换 current、不发布 npm，也不自动推送 Git。
