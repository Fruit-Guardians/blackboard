# 可校验备份与恢复

HTML 导出用于分享一个只读投影；备份用于保留完整、可继续写入的事件历史。两者不是同一种文件。

```sh
blackboard backup --out /absolute/path/board-backup --json
blackboard restore /absolute/path/board-backup --into /absolute/path/restored-project --json
```

`backup` 的源是当前选定项目；`restore --into` 明确指定目标项目，不隐式合并到当前黑板。目标可以是新目录，或者尚无 `.blackboard` 的现有项目目录。即使 `.blackboard` 为空，也不会覆盖。已有项目的其他文件保持原样。备份输出目录必须尚不存在，并且位于源 `.blackboard` 之外。恢复目标也必须位于源备份目录之外，不能通过恢复往备份内添加文件。

## 备份内容

目录只包含以下文件：

- `events.jsonl`：源日志的原始字节，包括完整节点、关系、游标轨迹、活动、检查点、移除记录和未知的兼容操作。
- `config.json`：存在时按原始字节保存的项目配置。
- `manifest.json`：备份格式版本、事件格式版本、创建时间、固定文件清单、字节数、SHA-256 和回放诊断。

`state.json`、digest、锁、临时文件及其他目录内容都不进入备份。缓存不是事实源；恢复端从原事件重建缓存和 `.gitignore`。仅存在于旧缓存、没有对应事件的标题或游标不作为恢复事实。没有配置文件时，恢复端创建空配置，由现有配置读取逻辑补齐默认值。

备份不会删减事件中的原文，也不会将日志改写成当前图投影；删除节点的历史仍在。新建备份目录和文件分别使用私有目录、文件权限（操作系统支持时为 `0700` / `0600`）。SHA-256 用于发现字节损坏，不是签名或来源认证。

## 一致性和发布

备份使用与正常写入相同的跨进程锁，捕获锁内的事件和配置字节，再在锁外落盘。正常的复合写入不会被备份拆开，例如显式创建节点、建立关系并移动游标的三个事件属于同一个锁内操作。

源事件不会因备份被修改、修复或截断。输出先写入同级临时目录，完成后以目录重命名发布。失败时临时目录被清理。配置变更方也应使用同一写锁，才能与备份严格序列化；直接绕过锁修改日志或配置不属于这一并发协议。

恢复先校验整个备份，再创建目标和临时黑板。事件、配置和重建缓存均就绪后，才将完整 `.blackboard` 发布到目标项目。失败不会留下半恢复的 `.blackboard`；恢复不覆盖、合并或改写其他黑板。

## 完整性策略

备份允许保存受损或较新版本的原始日志，回执会报告问题；这让原始数据能够被完整留存，并不表示当前版本能恢复它。

恢复时重新计算和检查，不能通过修改 manifest 中的诊断数字跳过校验：

| 输入 | 当前恢复行为 |
| --- | --- |
| 文件缺失、额外文件、字节数或 SHA-256 不符 | 拒绝，在创建目标前结束 |
| 路径穿越、绝对/嵌套路径、重复文件名 | 拒绝；只接受固定的平面文件清单 |
| 备份目录或备份文件为符号链接 | 拒绝 |
| 损坏 JSON 行、无换行结尾的残缺尾部、非法 UTF-8 | 拒绝，回报完整性诊断 |
| 模型拒绝的记录，例如缺少类型的节点 | 拒绝，不把跳过后的图当成完整恢复 |
| 比当前支持范围更高的事件格式版本 | 拒绝，保留备份供兼容的新版本处理 |
| 当前版本不认识的兼容操作 | 原样保留，回放忽略并报告 `unknownOps`；正常 lint 仍可报告 |
| 自定义节点类型、自定义关系 | 原样保留 |
| 缺失或损坏缓存 | 不影响；备份本就不依赖缓存 |
| 配置 JSON 损坏或不是对象 | 拒绝恢复；备份仍保留原始字节并标记诊断 |

恢复后日志 SHA-256 应与备份回执的 `eventsSha256` 一致。节点、关系、游标与轨迹、检查点、已删除 ID 均由同一份事件回放，后续创建节点不会复用已删除 ID。

## 程序接口

核心模块保持零运行时依赖，使用同步 API：

```js
import { backupBoard, restoreBoard } from './lib/backup.js';

const saved = backupBoard('/absolute/project', '/absolute/backup');
// saved: { kind: 'backup', path, manifest, eventsSha256,
//          eventCount, integrity, files }

const restored = restoreBoard(saved.path, '/absolute/new-project');
// restored: { kind: 'restore', path, boardPath, eventsSha256,
//             eventCount, integrity, state: 'rebuilt-from-events' }
```

完整性诊断包括 `corruptLines`、`futureEvents`、`rejected`、`unknownOps`、`incompleteTailBytes`；非法 UTF-8 或配置损坏另外带有对应标志。正常 lint 的报告语义不变。

## 验证

```sh
node --test test/backup.test.js
```

用例覆盖：原始日志 SHA 和字节一致、完整图与多 Agent 游标/轨迹/检查点/已删除 ID 一致、配置保留、缓存重建、缺失配置、禁止覆盖、坏行/残缺尾部、未来版本、未知兼容操作、清单/校验/路径/符号链接校验、并发复合写入，以及缓存写入故障后清理并重试。
