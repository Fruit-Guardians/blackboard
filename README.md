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

## 启用

使用 CLI、服务和 Agent 接入不需要安装依赖，只要 Node.js ≥ 18。`public/` 里已经带有构建好的前端。

**最快方式：给 Claude Code 安装一次全局 Skill，之后每个项目一句话启用**

```bash
node /path/to/blackboard/bin/blackboard.js skill install --user
```

以后只需在 Claude Code 里说：

> 给当前项目一条龙配置并打开 blackboard

Skill 会调用 `blackboard setup`：初始化数据、安装项目级 Skill、写入只负责恢复的 Hook、关闭工具活动自动采集，并启动随登录常驻的本地可视化服务。它不会替 Agent 选择步骤，也不会把黑板变成执行前置条件。

也可以直接手动执行同一个一条龙命令：

```bash
blackboard setup --target "$PWD" --title "项目或任务名" --open
```

重复执行是幂等的；可视化默认在 `http://127.0.0.1:4333`，再次为别的项目 setup 会把这一个工作区服务切换过去。仅配数据时可加 `--no-serve`，不需要恢复 Hook 时可加 `--no-hooks`。

**分步方式 1. 装一个 `blackboard` 命令**（一次即可）

```bash
git clone https://github.com/Fruit-Guardians/blackboard.git
cd blackboard
node bin/blackboard.js launcher        # 在 ~/.local/bin 生成 blackboard
```

确认 `~/.local/bin` 在 `PATH` 里，然后用 `blackboard help` 检查。不想装的话，下文的 `blackboard` 都可以换成 `node /path/to/blackboard/bin/blackboard.js`。

**分步方式 2. 在要记录的项目里建黑板**

```bash
cd ~/your-project
blackboard init --title "项目目标或任务名"
```

这会创建 `.flow/`（事件日志，自带 `.gitignore`，默认不进版本库）。之后在该项目的任意子目录运行命令，都会自动找到这块黑板。

**分步方式 3. 让 Agent 会用它**（Claude Code，一次即可）

```bash
blackboard skill install --user              # 装 skill，Agent 才知道怎么读写
blackboard hooks install --user --write      # 可选：会话开始自动注入现场，压缩前自动存检查点
```

两条都只对新开的会话生效。之后在带有 `.flow/` 的项目里开会话，Agent 会按 skill 读取现场、在关键判断和结论处写节点并连边；也可以直接对它说“用 blackboard 记录这次审计”。Codex 用 `blackboard skill install --user --codex`。

**分步方式 4. 打开可视化**

```bash
blackboard serve --open                      # 默认 http://127.0.0.1:4317，可用 --port 指定
```

页面实时跟随 Agent 的写入。需要分享时用 `blackboard export -o blackboard.html` 导出单文件。

**分步方式 5. 检查是否生效**

```bash
blackboard digest      # Agent 每次恢复现场看到的内容
blackboard lint        # 孤立节点、缺证据的结论、日志损坏等提示
```

如果图里全是互不相连的卡片，通常是 Agent 没有显式连边，或仍在使用旧版 `flow` skill（`blackboard skill install` 会自动停用它）。

关闭：`blackboard hooks uninstall --user --write` 移除 Hook，删除 `~/.claude/skills/blackboard` 移除 skill；项目里的 `.flow/` 可随时删除，Agent 不依赖它也能正常工作。

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
- Hook 只是可选的恢复辅助（会话开始注入 Digest、压缩前存检查点）；原始活动采集需要显式加 `--with-activity`。正常使用不依赖 Hook。

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
node bin/blackboard.js context --budget 4000
node bin/blackboard.js serve --open
```

## Agent 上下文接口

`context` 是黑板面向 Agent 的只读投影。它压缩当前目标、焦点邻域、开放方向、发现、
已确认事实、检查点和近期活动元数据，但不推断或选择下一步：

```bash
# 默认输出结构化 JSON
blackboard context

# 围绕指定节点读取两跳邻域，并限制近似 Token 预算
blackboard context --focus <node-id> --depth 2 --budget 4000

# 只关注某个检查点之后发生的变化
blackboard context --since <checkpoint-id>

# 人类可读形式
blackboard context --markdown
```

服务启动后也可以直接读取：

```text
GET /api/context?agent=agent:primary&focus=<node-id>&depth=2&budget=4000&since=<checkpoint-id>
```

返回包明确包含 `readOnly: true`、`prescriptive: false` 和
`nextStepSelection: "agent-controlled"`。预算只是 JSON 大小的近似控制，不是模型
Tokenizer 的精确计数；裁剪情况会记录在 `omitted` 中。

## 节点与 ID

节点 ID 是按类型递增的短 ID，在写锁内分配：`n1`、`hy3`、`o2`；活动是 `act5`，检查点是 `cp2`。所有接受 ID 的命令还可以这样写：

- 带方括号：`[n1]`（直接粘贴 Digest 里的写法）；
- 忽略大小写：`HY3`；
- 唯一前缀：`hy`（有多个候选时会报错并列出候选，不会猜）。

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

### 风险、状态和可信度相互独立

代码审计里“影响有多大”“当前是否仍在处理”“证据成熟到什么程度”是三个不同维度：

```bash
# 只有源码链路，尚未端到端验证
blackboard node add vuln "Windows 前缀权限绕过候选" \
  --sev medium --status active --confidence static-confirmed

# 实测后只提升可信度，不需要重建节点
blackboard edit <id> --status confirmed --confidence reproduced
```

可信度可取：`suspected`、`static-confirmed`、`reproduced`、`confirmed`。旧节点未声明可信度时继续兼容，但 `blackboard lint` 会提示；可信度不会替 Agent 判断问题是否成立。

复现或静态确认的事实可以使用 `--status confirmed`，这样它会进入 Agent 上下文的 `confirmedFacts`。游标应指向此刻真正继续研究的开放问题或猜测，而不是仅仅因为某个历史漏洞重要就长期停在那里。

## 逻辑关系

```text
related-to / derived-from / supports / contradicts / depends-on
proves / caused-by / refines / duplicates / supersedes / resolves
```

方向约定：`blackboard link <from> <to> --rel X` 读作 **“from X to”**，与界面标签、Digest 里的箭头一致。

```text
link 观察 猜测  --rel supports      观察 支持 猜测
link 结论 观察  --rel derived-from  结论 派生自 观察
link 结论 前提  --rel depends-on    结论 依赖 前提
link 现象 原因  --rel caused-by     现象 由 原因 导致
link 新结论 旧结论 --rel supersedes  新结论 取代 旧结论
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

没有游标时，Digest 改为列出“最近活跃节点”及其关系，而不是留空。Digest 只恢复现场，不指定 Agent 的下一步。

## 原始活动（可选，默认关闭）

`blackboard hooks install --with-activity` 会额外安装 `PostToolUse` Hook，把 Bash、Read、Grep、WebFetch 等工具调用的输入输出记入独立 `activity` 层，而不是自动生成 `fact`。它默认关闭，因为这会把命令输出写进 `.flow/events.jsonl`：

- 做尽力而为的脱敏（连接串口令、`*_SECRET`/`*_TOKEN` 类变量、JSON 密钥字段、常见 token、JWT、私钥块）；
- `Write`/`Edit` 只记录文件路径，不记录内容；
- 黑板 CLI 自己的调用不会被重复记录；
- 拿不到写锁时最多等 1 秒就放弃，不会拖慢 Agent。

不安装它时，Agent 仍可完整使用节点、关系、游标、检查点和 Digest。新建的 `.flow/` 会自带 `.gitignore`（内容为 `*`），数据默认不进版本库。

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

### 多个 Agent 并行

默认所有命令都用 `agent:primary` 这一个游标，两个 Agent 同时 `--enter` 会互相覆盖位置。并行工作时，让每个 Agent 带上自己的名字：

```bash
export BLACKBOARD_AGENT=research       # 之后这个会话的 cursor / --enter / --relate-here 都用 agent:research
blackboard fact "…" --enter            # 只移动 agent:research 的游标
blackboard cursor --agent review       # 也可以逐条命令指定
```

可视化里，`agent:primary` 显示为“当前”，其他 Agent 的名字会出现在它们所在的卡片上。

## 数据与可靠性

`.flow/events.jsonl` 是唯一事实源。事件包括：

```text
node / edge / cursor / activity / checkpoint / patch / remove / meta / reset
```

实现保证：

- 新事件带 `eventVersion` 和唯一 `eventId`；
- 节点 ID 不依赖 `state.json` 计数器；
- `state.json` 损坏时可以从事件恢复标题和游标；
- 多进程写入由跨进程文件锁串行化；只有持有者进程已不存在时才会回收锁，仍存活的持有者永远不会被抢占。等待上限默认 10 秒（`BLACKBOARD_LOCK_TIMEOUT_MS` 可调），超时会报错而不是强行写入；
- `state.json` 只是可丢弃的缓存，写入失败不会让已经记录的事件报错；
- 追加前会清理 JSONL 尾部的不完整记录；
- 回放时会跳过无法解析的行，以及缺 `id`/`type` 的节点、自环或端点不存在的关系；跳过的数量会通过 `blackboard lint` 的 `log-integrity` 警告报告，而不是静默丢弃；
- `patch` 不能改写节点的 `id` 和 `ts`；
- `remove` 只是让节点（及其关系）或一条关系不再出现在图上，日志里的历史仍在；指向被移除节点的游标会失效为“无位置”，之后可以用同样的 id 重新建立关系；
- 超长内容会被截断（标题 500 字、detail 20000 字、摘要 12000 字），截断时命令会在 stderr 提示，`--json` 结果带 `truncated` 字段。

## 可视化

```bash
blackboard serve --open
```

视图支持：

- “当前现场 / 逻辑链 / 全局图”三种观察方式；
- 当前现场只投影当前节点、两跳邻域、开放节点和最近内容；
- React Flow 节点卡片，每种类型有自己的色调；
- ELK 自动层级布局，可切换横向与纵向，连线可选曲线、折线、直线（默认曲线），按关系分为证实 / 反驳 / 推导 / 产出 / 取代 / 关联六种颜色，并带可收起的图例；
- 左侧导航按“正在关注 / 待验证 / 发现 / 未连接”分区，并支持按类型、状态、可信度、风险筛选；当前节点不会在“发现”中重复出现；
- 漏洞卡片和详情同时显示严重度与可信度；顶部隐藏节点提示可直接切换到全局视图；
- 当前节点标识、新写入节点脉冲，以及可选的“跟随 Agent”；
- ⌘K 搜索与命令、详情面板、活动时间线、摘要和小地图；
- 键盘：方向键沿关系跳转，`/` 搜索，`[` 收起侧栏，`?` 查看快捷键；
- 选中节点写入地址栏（`?node=`），可分享或刷新恢复；
- 导出整张画布为 PNG；
- SSE 实时更新，断线时有明确提示；
- 单文件离线导出。

```bash
blackboard export -o blackboard.html
```

### 在页面上动手

查看器不只是看：顶栏的 **新建** 可以写下一个想法，选中节点后详情里可以 **添加相关节点**（支持 / 反驳 / 由它推出 / 仅相关）、**修改文字**、改状态、**断开某条关系**或 **移除节点**。人写入的节点带 `author: "human"`，修改带 `updatedBy`，详情里显示为“作者：人工”；Agent 读取 `context` 时和其他节点一样看到它们。同样的操作也有命令：

```bash
blackboard unlink <from> <to> [--rel supports]
blackboard remove <id> [--reason "…"]
```

写入由本地服务完成，并有三道保护：只接受以 `127.0.0.1` / `localhost` / `[::1]` 为 Host 的请求（防 DNS 重绑定）；写请求必须来自本页自己的 Origin、使用 `application/json`（别的网站无法跨站提交）；请求体上限 256 KB。只想看、不想让页面改动黑板时：

```bash
blackboard serve --read-only
```

离线导出的文件始终是只读快照。

## Claude Code 接入

```bash
blackboard launcher
blackboard skill install --user
# Hook 不是必需；默认只装恢复类：SessionStart 注入 Digest、PreCompact 存检查点
blackboard hooks install --user --write
# 需要原始工具调用采集时才加（会记录工具输入输出，见上文）
blackboard hooks install --user --write --with-activity
# 随时可以无损移除
blackboard hooks uninstall --user --write
```

重新运行 `hooks install`（不带 `--with-activity`）会停用旧版本默认安装的工具调用采集，其他无关 Hook 不受影响。全局 Hook 只有在当前项目存在 `.flow/events.jsonl` 时才运行。

在项目子目录里运行的命令会自动使用上层最近的 `.flow/`（与 git 找仓库一致）；`blackboard init` 在已有上层黑板的子目录里会拒绝，需要独立黑板时加 `--here`。

## 开发

```bash
npm run build
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
lib/context.js          面向 Agent 的结构化上下文投影
lib/hooks.js            Claude Code 适配器与脱敏
lib/server.js           HTTP + SSE
lib/export.js           脱敏后的单文件导出
web/                    React Flow 前端源码
public/                 Vite 构建后的静态资源
vite.config.js          前端开发与构建配置
test/                   Node.js 自动化测试
docs/BLACKBOARD_DESIGN.md  完整设计基线
```
