# 写入回执与显式幂等重试

`events.jsonl` 仍是唯一事实源。回执从它即时投影，不读写独立回执数据库，也不依赖 `state.json` 或宿主插件缓存。

## 使用契约

在核心 mutation 输入或选项中传入 `requestId`。它必须是 1–200 字符的字符串，没有首尾空白或控制字符。未传时维持普通写入行为。CLI 使用 `--request-id <id>`，查询使用 `blackboard receipt <id>`。

同一个日志内，请求 ID 是跨命令的全局命名空间：

- 相同 ID、命令与 JSON payload：返回第一次保存的结果，不再次记录动作。
- 同 ID 但命令或 payload 不同：以 `request_id_conflict` 拒绝，不追加事件。
- 对象属性顺序不影响 fingerprint；省略字段与 JSON 中不可序列化的可选 `undefined` 属性等价。显式提供默认值与省略默认值可能是不同 payload，应原样保留重试参数。
- 去重先于对象解析与字段冲突校验。因此节点后来被修改或删除，也能查询原回执并原样重试。
- `reset` 清空当前黑板投影，**不清空请求 ID 的历史**。重试旧的 reset 不会清空 reset 之后的新节点。开启一项新动作必须使用新 ID。

```js
import { addNode, getReceipt } from '../lib/store.js';

const input = {
  requestId: 'capture-response-001',
  type: 'observation', title: 'Response returned 200',
  parent: 'hy1', relation: 'supports', enter: true,
};
const original = addNode(input, projectDirectory);
const retry = addNode(input, projectDirectory); // same saved result
const receipt = getReceipt(input.requestId, projectDirectory); // read-only
```

接口参数：

| 核心接口 | requestId 所在位置 |
| --- | --- |
| `addNode(input, cwd)` / `addEdge(input, cwd)` | `input.requestId` |
| `patchNode(ref, set, cwd, options)` | `options.requestId` |
| `removeNode(ref, options, cwd)` / `removeEdge(ref, options, cwd)` | `options.requestId` |
| `moveCursor(ref, options, cwd)` | `options.requestId` |
| `addActivity(input, cwd, options)` / `addCheckpoint(input, cwd, options)` | `input.requestId` 或 `options.requestId` |
| `setMeta(set, cwd, options)` / `reset(cwd, options)` | `options.requestId` |

## 复合写入的提交语义

创建节点、显式关联和显式移动游标仍分别使用 `node`、`edge`、`cursor` 事件。实现不把它们封装进旧版会忽略的事务操作，也不提高 `EVENT_VERSION`。

带请求 ID 的一次动作在同一跨进程写锁内执行：

1. 检查历史请求及 payload fingerprint。
2. 校验输入并准备普通事件和返回结果，暂不写缓存。
3. 首个普通事件的新增 `request` 字段记录完整计划、事件 ID 和原始结果。
4. 一次 append 调用写出计划中的普通事件行，随后写出 `receipt` 完成标记。
5. 成功后尽力更新可丢弃的状态缓存。

这是**可恢复的完整行前缀提交**，不是数据库式原子事务。进程退出或文件系统错误可能只留下部分完整行；其他读取者可以看到已落地的节点或关系前缀。实现不承诺一次 append 在所有文件系统上原子，也没有执行 `fsync`，因此不承诺突然掉电后的持久性。

- 首行尚未落地：没有已提交请求，原参数重试可重新开始。
- 部分普通事件已落地：回执为 `pending`，包含已记录的 `committedEventIds`。
- 全部普通事件与完成标记已落地：回执为 `committed`。即使响应丢失，原参数重试也返回同一结果。
- 缓存写入失败：回执仍以事件日志为准，不把已提交动作误报为失败。

## 中断恢复与旧 writer

`getReceipt(id, cwd)` 是纯读取：不追加完成标记，不修剪残缺行，不补写关系或游标。

`pending` 只有在显式使用同 ID、同命令、同 payload 重试时才恢复。恢复过程持有同一写锁，根据事件 ID 仅补齐缺失的计划事件，修剪未完整落地的尾行，再追加完成标记。新动作会收到 `pending_request`，防止它越过尚未完成的复合动作。

旧版会忽略新增 `request` 元数据和 `receipt` 操作，但仍能回放每个普通节点、关系和游标事件。因此旧版可以读取图谱，却不提供幂等保证，也不会阻止跨越 pending 请求的写入。若旧 writer 已在 pending 之后写了其他动作，回执显示 `recoverable: false`，重试以 `request_recovery_conflict` 拒绝，避免把旧游标或补丁写到新动作之后。实现不自动重排、合并或重放这些有冲突的历史。

## 验证

运行 `node --test test/receipts.test.js`。覆盖同 ID 1000 次重试、1000 个独立 ID、8 个进程并发同 ID、提交前与提交后故障、带残缺尾行的复合前缀恢复、旧 writer 干扰、不同 payload 冲突、已删除对象的重试、reset 边界及缓存写入失败。
