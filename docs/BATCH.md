# 批量写入 `batch`：设计

状态：已实现（0.10.0）。本文记录设计取舍；对外的输入格式、输出和错误规则以[公开契约](CONTRACT.md#批量写入)为准。来源：一次 4 小时多 Agent 审计的反馈（见[路线图](ROADMAP.md)“真实长任务反馈”）。

## 要解决的问题

1. **记一笔太贵**：39 个节点用了约 45 次调用。每次进程启动只要约 0.1 秒，真正的成本是 Agent 多花的回合：判断已经形成，却要拆成一串命令才能记下。
2. **写权限冲突**：其他 Skill（如 security-audit）规定子 Agent 不得写共享文件，于是只剩协调者能写黑板。协调者同时管着很多子 Agent，记录就被挤到最后。

`batch` 让一次调用写入一组相关的节点、关系和修改：子 Agent 把记录写进**自己的输出文件**，协调者每波用一条命令导入。暂存的内容在黑板之外，事件日志仍是唯一事实源。

## 不做什么

- 不新增事件类型。批量写入产生的仍是普通的 `node` / `edge` / `patch` 事件，`EVENT_VERSION` 不变，旧版本照常回放。
- 不移动游标。游标表示“某个 Agent 此刻在哪”，协调者导入别人的记录时不应改变任何人的游标。需要进入节点时，导入后单独运行 `cursor`。
- 不包含删除和重置（`remove`、`unlink`、`reset`）：破坏性操作不和记录混在一起。
- 不包含检查点：检查点是交接标记，导入后单独运行 `checkpoint`，它的回显会列出这批写入的数量。
- 不包含活动层，也不提供 HTTP 接口。
- 不推断任何东西：不补关系、不补严重度、不补状态，与单条写入的规则相同。

## 命令

```sh
blackboard batch --request-id wave-3 --file wave-3.jsonl --cwd "/已确认项目" --no-init [--agent coordinator] [--no-truncate] [--json]
# 不给 --file 时从 stdin 读取
```

- **必须带 `--request-id`。** 只有带 request-id 的写入是先缓冲、再一次性追加并写回执的；中途崩溃时，回执标记为未完成，用同一 ID 重试会按原样补齐。不带 ID 时，多个事件逐条追加，可能只写进一半，这对批量写入不可接受。同一 ID、同样内容重试时返回原结果、不重复写入；内容不同则报冲突。
- `--agent` 是整批的默认身份；每行可以用 `agent` 覆盖，记为该行节点、关系或修改的作者。
- `--no-truncate` 作用于整批：任一字段超长，整批都不写。不加时与单条写入相同，超长部分截断，并在事件里记下截断信息。

## 输入格式

JSON Lines，每行一个对象，`op` 决定操作。空行忽略。

```jsonl
{"op":"node","ref":"h","type":"hypothesis","title":"导出接口按租户过滤缺失","confidence":"suspected","to":"g1","agent":"audit-a1"}
{"op":"node","type":"observation","title":"handler 直接使用请求里的 tenantId","at":"src/export.ts:42","detail":"未与会话租户比对","to":["$h","g1"],"rel":"supports","agent":"audit-a1"}
{"op":"link","from":"o3","to":"$h","rel":"contradicts","agent":"audit-a2"}
{"op":"edit","id":"hy2","status":"refuted","agent":"audit-a2"}
```

| `op` | 字段 | 含义 |
| --- | --- | --- |
| `node` | `type`、`title` 必填；`detail`、`tags`（字符串数组）、`at`、`status`、`severity`、`confidence`、`to`（字符串或数组）、`rel`、`label`、`ref`、`agent` | 同 `node add`：`to` 读作“新节点 `rel` 目标”，可多个；省略 `rel` 时为 `related-to` |
| `link` | `from`、`to` 必填；`rel`、`label`、`agent` | 同 `link` |
| `edit` | `id` 必填；`title`、`detail`、`status`、`severity`、`confidence`、`agent` 至少一个要修改的字段 | 同 `edit`；`detail` 是替换 |

- **批内引用**：`ref` 给本批新建的节点起一个本地名（`[A-Za-z0-9_-]`，最长 64），后面的行用 `$名字` 引用。只能引用**之前**的行，名字在一批内唯一。`$` 前缀不会与已有节点 ID 混淆；已有节点照常用 ID 或唯一前缀。
- **严格字段**：出现未知字段即报错。字段名拼错（如 `confidance`）如果被静默忽略，这条信息就丢了。节点类型和关系名仍然开放，与单条写入相同。
- 状态、严重度、可信度的取值规则与单条写入相同。

## 原子性与错误

- 整批**要么全部写入，要么一个字节都不写**。先逐行解析并在内存中模拟执行，所有行都通过才追加事件。
- 任一行出错时退出码为 1，stdout 为空，stderr 写明行号和原因（如 `第 3 行：no such target node: o9`），不回显该行内容。
- 上限：每批最多 500 个操作，输入最多 4 MB。超出时整批拒绝，提示拆分。

## 输出

`--json` 输出 `blackboard.batch.v1`：

```json
{
  "schema": "blackboard.batch.v1",
  "requestId": "wave-3",
  "counts": { "nodes": 2, "edges": 4, "edits": 1 },
  "results": [
    { "line": 1, "op": "node", "ref": "h", "node": { "id": "hy4", "...": "..." }, "edges": [ { "from": "hy4", "to": "g1", "kind": "related-to" } ] },
    { "line": 3, "op": "link", "edge": { "from": "o3", "to": "hy4", "kind": "contradicts" } },
    { "line": 4, "op": "edit", "node": { "id": "hy2", "status": "refuted" } }
  ]
}
```

节点使用公开投影（三个维度可空）。文本输出每行一条，格式同单条写入的回显，最后一行汇总本批数量。

## 能力与契约

- `capabilities.features.batch`、`capabilities.outputs.batch`、`capabilities.limits` 里的 `batchMaxOps` 与 `batchMaxBytes`。
- `receipt <request-id>` 能查到这批写入，`command` 为 `batch`。
- 写入目标与其他写命令相同，不新增文件。

## 典型用法

```sh
# 子 Agent：只写自己的输出文件
#   out/audit-a1/wave-3.jsonl
# 协调者：每波结束导入，再打检查点
blackboard batch --request-id wave-3-a1 --file out/audit-a1/wave-3.jsonl --cwd "/已确认项目" --no-init
blackboard checkpoint --summary "第 3 波：…" --cwd "/已确认项目" --no-init
```

导入后检查点回显“自上一检查点以来：节点 +N”，可以直接核对这一波是否记下了东西。
