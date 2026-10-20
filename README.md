# blackboard — Agent 的外置黑板

`blackboard` 把 Agent 的关键思考、逻辑关系、当前位置和移动轨迹持续记录成一张可恢复、可缩放的大图。

它不是工作流引擎：Agent 可以自由探索、回跳、交叉连接或留下游离节点；`blackboard` 不规定合法步骤，也不替 Agent 决定下一步。

黑板是纯数据组件：人类用它建立思路和规划，Agent 用它恢复上下文并继续递推。Agent 可以在形成重要决策或得到有效结果后显式读写黑板；任何黑板提示都不会成为行动前置条件。

完整设计见 [`docs/BLACKBOARD_DESIGN.md`](docs/BLACKBOARD_DESIGN.md)。

## 项目标识

- 正式名称、npm 包名和主命令统一为 **`blackboard`**；
- `flow` 命令继续作为兼容别名，已有脚本不需要立即迁移；
- 事件目录暂时保留为 `.flow/`，避免升级时搬迁或丢失历史黑板；
- 新环境变量使用 `BLACKBOARD_CWD`、`BLACKBOARD_PORT`、`BLACKBOARD_QUIET`，对应的 `FLOW_*` 仍可读取。

## 核心模型

黑板分为三个相互独立的层：

1. **逻辑层**：目标、观察、猜测、问题、事实、发现及其显式关系；
2. **游标层**：每个 Agent 当前所在节点与最近访问轨迹；
3. **活动层**：工具调用和原始输出，默认不混入逻辑节点。

```text
逻辑关系： observation --supports--> hypothesis
游标轨迹： n12 → n31 → n43
原始活动： Bash / Read / Grep / WebFetch ...
```

创建节点、建立关系和移动游标是三个独立动作。

## 不干预原则

- Agent 不需要先获得 blackboard 许可才能行动；
- blackboard 不自动选择下一步、不强制状态机、不阻断命令；
- 节点、关系、游标都由 Agent 或人类显式写入；
- `blackboard lint` 只报告上下文质量，永远以退出状态 0 返回；
- Hook 仅作为可选的原始活动采集方式，正常使用不依赖 Hook。

## 快速开始

```bash
node bin/blackboard.js init --title "内部 API 安全审计"

# 创建并进入目标节点
node bin/blackboard.js node add goal "确认管理接口的授权边界" --enter

# 创建观察；默认不连边、不移动游标
node bin/blackboard.js node add observation "匿名请求返回 200" --at evidence.txt:12

# 创建猜测并进入；与当前节点建立弱关系
node bin/blackboard.js node add hypothesis "读接口可能遗漏统一鉴权" \
  --relate-here --enter

# 逻辑关系由 Agent 明确声明
node bin/blackboard.js link <observation-id> <hypothesis-id> --rel supports

# 只移动位置，不创建逻辑边
node bin/blackboard.js cursor <node-id> --reason "回到该猜测继续验证"

node bin/blackboard.js here
node bin/blackboard.js digest
node bin/blackboard.js serve --open
```

## 节点

内置类型只负责语义提示和视觉颜色，不构成状态机：

| 类型 | 含义 |
|---|---|
| `start` | 黑板入口 |
| `goal` | 目标 |
| `intent` | 当前打算 |
| `observation` | 直接观察 |
| `fact` | 经确认的信息 |
| `hypothesis` | 待验证猜测 |
| `question` | 开放问题 |
| `action` | 行动 |
| `result` | 行动结果 |
| `finding` | 正式发现 |
| `vuln` | 漏洞发现的兼容类型 |
| `hint` | 线索或卡点 |
| `summary` | 局部摘要 |
| `note` | 自由记录 |

也允许自定义类型：

```bash
blackboard node add decision "暂时停止 fuzz，优先验证权限边界"
```

## 逻辑关系

```text
related-to / derived-from / supports / contradicts / depends-on
proves / caused-by / refines / duplicates
```

未知关系也允许保存：

```bash
blackboard link <a> <b> --rel inspired-by
```

默认关系 `related-to` 有意保持为弱关系，避免系统替 Agent 伪造逻辑。

## 游标

```bash
blackboard cursor <id> --reason "开始验证"
blackboard cursor none                 # 清空当前位置
blackboard cursor                      # 输出当前位置
blackboard here                        # 当前节点、邻域、最近轨迹
```

创建节点不会自动移动游标。需要立即进入时使用 `--enter`：

```bash
blackboard node add question "其他接口是否同样受影响" --enter
```

当前游标不是新节点的隐式父节点。需要与当前位置建立弱关系时显式使用：

```bash
blackboard node add observation "发现相同路由模式" --relate-here
```

## 检查点与恢复

```bash
blackboard checkpoint --summary "已确认匿名读取，正在比较中间件差异"
blackboard digest --write
```

Digest 恢复：

- 当前节点；
- 一跳逻辑邻域；
- 最近游标轨迹；
- 开放的意图、猜测和问题；
- 最近检查点；
- 最近逻辑节点。

Digest 只恢复现场，不指定 Agent 的下一步。

## 原始活动（可选 Hook）

显式安装 Claude Code Hook 后，Bash、Read、Grep、WebFetch 等工具调用会进入独立 `activity` 层，而不是自动生成 `fact`。不安装 Hook 时，Agent 仍可完整使用节点、关系、游标、检查点和 Digest。

默认行为：

- 常见 Token、密码、Cookie 和 Authorization 头脱敏；
- 输出按 `detailLimit` 截断；
- 活动与当时的当前节点关联；
- 离线导出只包含活动 ID、工具、状态和时间，不包含 summary/input/output。

```bash
blackboard activity ls
blackboard activity show <activity-id>
blackboard promote <activity-id> --kind observation --title "值得保留的观察"
```

`promote` 会创建新的逻辑节点并保留来源活动 ID；提升本身不会自动移动游标或建立逻辑关系。

配置位于 `.flow/config.json`：

```json
{
  "autoRecord": true,
  "autoTools": ["Bash", "WebFetch", "Read", "Grep"],
  "maxActivities": 4000,
  "detailLimit": 1200,
  "redact": true
}
```

## 兼容命令

原有简写继续可用，但不再隐式切换游标或挂到当前节点：

```bash
blackboard start "入口"
blackboard goal "目标"
blackboard intent "准备验证什么"
blackboard fact "确认的信息"
blackboard vuln "正式漏洞" --sev high
blackboard hint "线索"
blackboard focus <id>      # cursor 的兼容别名
blackboard compact         # checkpoint 的兼容别名
```

需要旧式显式来源时仍可使用 `--parent <id>`；它只在明确提供时生效。

## 数据与可靠性

`.flow/events.jsonl` 是唯一事实源。事件包括：

```text
node / edge / cursor / activity / checkpoint / patch / meta / reset
```

实现保证：

- 新事件带 `eventVersion` 和唯一 `eventId`；
- 节点 ID 不依赖 `state.json` 计数器；
- `state.json` 损坏时可以从事件恢复标题和游标；
- 活锁超时会失败，不会删除仍有效的锁；
- 追加前会清理 JSONL 尾部的不完整记录。

## 可视化

```bash
blackboard serve --open
```

视图支持：

- “当前现场 / 逻辑图 / 时间线 / 全部”四种观察方式；
- 当前现场只投影当前节点、两跳邻域、开放节点和最近内容；
- 未建立关系的节点进入“未整理”列表，不再拉长主图；
- 逻辑分层与未整理节点网格分区；
- 多级细节缩放；
- 类型和关系过滤；
- 当前节点光环；
- 最近 Agent 轨迹虚线；
- 搜索、详情面板和小地图；
- SSE 实时更新；
- 单文件离线导出。

```bash
blackboard export -o blackboard.html
```

## Claude Code 接入

```bash
blackboard launcher
blackboard skill install --user
# Hook 不是必需；需要原始活动采集时再安装
blackboard hooks install --user --write
# 随时可以无损移除
blackboard hooks uninstall --user --write
```

全局 Hook 只有在当前项目存在 `.flow/events.jsonl` 时才运行。

## 开发

```bash
npm test
npm run serve
npm run export
```

目录：

```text
bin/blackboard.js       主 CLI 入口
bin/flow.js             CLI 实现与兼容入口
lib/model.js            黑板事件回放模型
lib/store.js            事件存储、游标、活动、检查点
lib/digest.js           现场恢复摘要
lib/hooks.js            Claude Code 适配器与脱敏
lib/server.js           HTTP + SSE
lib/export.js           脱敏后的单文件导出
public/                 Canvas 黑板视图
test/                   Node.js 自动化测试
docs/BLACKBOARD_DESIGN.md  完整设计基线
```
