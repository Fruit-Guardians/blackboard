# blackboard 接入 DSH 的调研

调研日期：2026-10-22。本文中的 DSH 指 DeepSeek Harness。

落地更新：适配器采用**同仓库、独立子包**，位于 `/Users/zhangboxiang/Progarm/bx33661/flow/plugins/dsh-blackboard/`。隔离依赖与运行边界，不拆分 Git 仓库。实现和当前验收入口见[插件说明](../plugins/dsh-blackboard/README.md)；下文的测试基线保留为调研时记录。

## 结论

可行。建议保留 blackboard 的事件存储、CLI 和查看器，新增一个独立发布的 `dsh-blackboard` 薄适配包。第一版提供完整 Skill 和结构化工具；随后增加可选的自动恢复、检查点，最后再做 DSH 内嵌界面。

**不需要把 blackboard 改造成 DSH 专属项目，也不需要先做 MCP Server。** 当前的 CLI JSON 输出已经足以支持第一版桥接。首版建议异步调用已安装的稳定 CLI，暂不把同步文件锁和回放逻辑搬进 DSH 主进程。

调研阶段仅增加本文档；后续已实现可选插件。日常宿主配置与项目启用仍保持显式操作。

## 已核对的基线

| 项目 | 实际观察 |
| --- | --- |
| blackboard | `0.6.0`，提交 `c9e5dc50f2c5d12324d0ae8f27cc86e5f0734705` |
| 本机 DSH | `dsh --version` 返回 `0.2.1-rc.2`；桌面 App 版本相同 |
| DSH 上游源码快照 | `687f282e8625c6b8d11ff58211a90524be2e4317`，根包版本 `0.2.1-rc.2` |
| 本机 Node | `v22.23.1` |
| blackboard 回归测试 | `npm test`：115 项，114 通过、1 跳过、0 失败，退出状态 0 |
| CLI 桥接冒烟 | 临时黑板中执行 init、两个身份分别 node add、context；JSON 解析、游标隔离、context 只读检查通过，退出状态 0 |

本机已安装的 DSH 包中，另行核对了 `dsh-skill-badge` 的 Skill provider 实现、`dsh-system-prompt` 的 `context()` 注册、`dsh-working-directory` 的目录读取，以及压缩实现中的会话事件。接口建议不是仅根据搜索摘要推测。

## 现有代码能复用什么

以下路径均相对于仓库 `/Users/zhangboxiang/Progarm/bx33661/flow`。

| 现有模块 | 在插件中的用途 | 注意点 |
| --- | --- | --- |
| `lib/store.js` | 事件写入、回放、节点、关系、游标、检查点 | 保持 `.blackboard/events.jsonl` 唯一事实源；保留跨进程锁 |
| `lib/context.js` | 有预算的 Agent 恢复数据包 | `policy.readOnly`、`policy.prescriptive`、`policy.nextStepSelection` 位于嵌套 policy 字段 |
| `lib/digest.js` | 人类可读的恢复摘要 | 按需要展示，不作为行动指令 |
| `bin/blackboard.js` | 首版插件的进程桥接边界 | 使用 JSON 模式，不解析终端文案；同时处理 stderr 中的截断提示 |
| `skills/blackboard/` | 完整 Skill、参考资料、图标的唯一分发源 | 保留整个目录，不另维护 DSH 专属副本 |
| `lib/hooks.js` | 可参考恢复语义 | 当前安装器和输出封装面向 Claude；不能直接当 DSH 原生 Hook |
| `lib/setup.js` | 当前 Claude 接入和 macOS 服务配置 | 插件不直接调用 setup，以免顺带安装 Claude 配置、切换共享服务 |
| `lib/release.js` | 稳定安装版本和 current 指针 | 日常插件调用遵循现有 current 规则，不指向开发仓库 |
| `lib/server.js`、`web/src/`、`public/` | 继续使用已有图形查看器 | 第一版独立打开，后续才适配 DSH Client |

项目当前无运行时依赖，DSH SDK 依赖应放在适配包内，不追加到 blackboard 根包。`lib/model.js` 继续保持浏览器可用。

## 三条接入路线

### A. 只接 Skill：最低成本验证

DSH 默认的文件 Skill provider 支持项目 `.dsh/skills`、`.agents/skills` 等目录；其中项目 `.agents/skills` 的优先级高于 bundled provider。因此，现有 Codex 安装目标 `.agents/skills/blackboard` 可以作为 DSH 的共享 Skill 目录，不意味着安装了 Codex Hook。[Skill 发现规则](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/docs/subsystems/skills.md)

这种方式可以先验证“DSH 发现 Skill → 调用 CLI → 写记录 → 新会话恢复”的实际体验。它仍依赖 Agent 使用 shell 工具，尚不具备完整插件的原生工具和生命周期接入。

### B. 原生插件加 CLI 桥：推荐第一版

插件注册 Skill provider 和原生工具；工具通过异步子进程调用已安装的 blackboard CLI。DSH 插件本身采用 Cordis 的 `apply(ctx)`，工具通过 `ctx.tools.register(defineTool(...))` 注册，并声明规范 JSON 返回值与展示方法。[工具开发约定](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/docs/cookbook/adding-a-tool.md)

优点是改动集中、维持现有发布隔离规则，同时避免同步锁等待阻塞 DSH 事件循环。代价是每次调用存在进程启动开销，用户需要先有可用的 blackboard 安装。

### C. 原生插件直接调用内核：后续优化

工具进程开销经测量确实成为问题后，再从已安装发行物引入核心接口，或增加 worker。当前内核的文件 I/O 和锁操作是同步的，直接在 `execute()` 里调用并不会因为外层标了 async 就变成非阻塞。

若以后要求插件自包含、一键安装 runtime，需要单独设计它与 blackboard current 发布机制的归属关系；不要同时维护一份插件内核和一份 current 内核而不向用户说明实际使用版本。

## 推荐插件结构

实际采用本仓库中的独立插件子包，不增加根包 workspace 或 DSH 依赖：

```text
/Users/zhangboxiang/Progarm/bx33661/flow/plugins/dsh-blackboard/
├── package.json
├── cordis.patch.yml
├── src/
│   ├── index.ts          # apply、依赖声明、注册与释放
│   ├── bridge.ts         # CLI 参数数组、JSON、超时、取消
│   ├── scope.ts          # 项目归属、参与者身份
│   ├── skills.ts         # provider 复用完整 Skill 源
│   ├── tools.ts          # 原生工具定义
│   └── recovery.ts       # 第二阶段的恢复与检查点
├── test/
└── lib/                  # 发布前构建；用户安装后不依赖构建脚本
```

DSH 安装的是声明了 `dsh.bundle.patch` 的 npm bundle；单有 `main` 或 `apply` 不会让安装器自动挂载插件。插件 bundle 与 profile 是两种不同的清单。[打包与安装文档](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/docs/user/develop/basic/publish.md)

最小清单示意，实施时还需补充实际使用的 peerDependencies 和开发依赖：

```json
{
  "name": "dsh-blackboard",
  "version": "0.1.0",
  "type": "module",
  "main": "./lib/index.js",
  "files": ["lib/", "cordis.patch.yml", "README.md"],
  "engines": {
    "node": "^22.19.0 || >=24.0.0",
    "dsh": "0.2.1-rc.2"
  },
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" }
  }
}
```

```yaml
- insert:
    - id: blackboard
      name: dsh-blackboard
```

起步锁定本机已经核对的 DSH 预发布版本；后续每增加支持版本都跑兼容测试，再扩展范围。不要直接用 `>=0.2.0 <0.3.0` 表示已支持当前 rc：常规 SemVer 范围对预发布版本有额外匹配规则。

开发安装命令示意，仅在子包已实现、构建后执行。本次未运行：

```sh
dsh plugin --profile web add /Users/zhangboxiang/Progarm/bx33661/flow/plugins/dsh-blackboard
dsh --profile web --dump-config

# 移除适配包；保留项目 .blackboard/ 数据
dsh plugin --profile web remove dsh-blackboard
```

这里的 web 是示例 profile，不代表已经识别出桌面 App 当前运行的 profile。

## 第一版的工具边界

| 建议工具 | 对应 CLI | 主要返回 |
| --- | --- | --- |
| `blackboard_status` | status --json | 项目、实际数据与服务状态 |
| `blackboard_context` | context | `blackboard.context.v1` 数据包 |
| `blackboard_node_get` | show --json | 节点与关联节点 |
| `blackboard_node_add` | node add --json | 新节点、明确声明的关系或游标变化 |
| `blackboard_node_patch` | edit --json | 更新后的节点 |
| `blackboard_link` | link --json | 显式有向关系 |
| `blackboard_cursor` | cursor --json | 当前参与者的游标变化 |
| `blackboard_checkpoint` | checkpoint --json | 检查点 |

初始化、删除、清空和服务管理不需要全部出现在初版常用工具集中。用户启用某项目时显式初始化，日常恢复不隐式建黑板。当前部分 CLI 写命令会自动初始化，桥接层需在写入前检查项目已经启用。

桥接层使用固定命令映射和参数数组，不提供任意 shell 字符串入口。每个子进程单独传入 `BLACKBOARD_CWD` 和 `BLACKBOARD_AGENT`；不修改 DSH 主进程的 process.env 或 cwd。取消、超时、stdout 上限、stderr 和 JSON schema 不匹配都要有可诊断结果。对写命令，不因等待超时就盲目重试：事件可能已提交。

节点类型和关系名称保持开放字符串；状态、严重度、可信度沿用 blackboard 已有校验。工具描述保留“新增节点不自动进入、不自动连边”，`enter` 等行为只在显式参数下发生。

## Skill 作为插件内容分发

优先参照 DSH 自带 `dsh-skill-badge` 的 packaged provider：通过 `ctx.skills.registerProvider()` 提供候选和完整正文，并用 `resourceBase` 指向参考资源目录。[官方 provider 实现](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/experimental/skill-badge/src/index.ts)

blackboard provider 读取已安装 current 中的完整 `skills/blackboard/`，在返回 Markdown 时展开 CLI 占位符，不写回不可变安装目录。若发布包携带 Skill 资源，应由现有唯一源在构建时生成，不能长期维护第二份正文。原生工具的使用提示可以作为 DSH 适配附加说明，不改写基础记录语义。

同名项目 Skill 会按 DSH 优先级覆盖 bundled Skill；测试需要覆盖旧版本项目 Skill 的遮蔽情况。插件已安装、provider 已注册、当前模型确实调用 Skill 是不同的验证层次。

## 自动恢复与检查点

### 恢复内容放动态 context

稳定的使用原则适合 Skill 或静态 section；持续变化的黑板内容适合 `ctx.systemPrompt.context()`。该接口提供 cache-safe 的动态上下文快照，内容变化或压缩移除后会由 agent-loop 再物化；不需要替换整个系统提示词。[动态上下文约定](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/docs/subsystems/system-prompt.md)

建议第二阶段实现：

1. 仅对用户启用的项目生成恢复投影；未启用项目不创建文件。
2. 使用 agent 创建/恢复及 step 边界刷新缓存，缓存按 boardRoot、参与者身份和事件版本区分。
3. context provider 同步返回已经准备好的文本；异步 CLI 读取在注册文本函数之外完成。
4. 事件日志没有变化时复用投影；外部 CLI 或页面写入后，在后续读取或 step 刷新。
5. 内容按预算截断，保留 policy、截断和遗漏信息；读取失败记录诊断，不接管原任务。
6. 插件卸载/HMR 时释放注册、文件监听、计时器和未完成子进程。

不要把整个日志每轮塞进提示词，也不要把黑板事实文本升级成系统指令。不要用 `system-prompt/assemble` 全量替换组装结果，以免覆盖其他插件贡献。

### 压缩不是照搬 Claude PreCompact

DSH 的 `compaction/start`、`compaction/summary`、`compaction/end` 是持久会话记录，不是同名 Cordis Hook。观察它们时监听 `session/event` 并检查 event.type。[事件系统](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/docs/user/develop/framework/events.md)、[压缩生命周期](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/docs/subsystems/compaction.md)

`session/event` 是同步广播，不能把异步 listener 误当成宿主会 await 的前置屏障。第一版以 Agent 显式 checkpoint 为准；可选自动功能只承诺观察压缩起点后排队保存、或压缩结束后保存，并标明实际时机。若需要严格“压缩开始前持久写完”，需要另外验证可等待扩展点的顺序或明确包装压缩服务，不能只换个 Hook 名称。

自动检查点保存已经存在的黑板投影，不根据原始工具轨迹自动编造判断。活动采集默认关闭。

## 项目归属与多 Agent

不能使用 DSH 进程级 process.cwd() 代表当前项目。当前 DSH 区分不可变的 `session.header.cwd`（原始项目）和 `ctx.workingDirectory.get(session)`（会话当前目录）。[工作目录约定](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/docs/subsystems/working-directory.md)

建议用户启用项目时明确 boardRoot，默认从原始工作区寻找已有黑板，并在会话内固定归属。当前目录用于相对证据位置解析；cd 到其他仓库不能悄悄切换写入目标。BLACKBOARD_CWD 一旦显式传入，CLI 就直接使用该目录，不再帮插件向上寻找黑板，因此最近祖先黑板的解析需由适配层先完成。

默认参与者身份可采用 `dsh:<sessionId>`，恢复同一会话沿用身份，子 Agent 各用自己的身份。新会话不会因此自动拥有旧会话游标；跨会话接手应显式读取旧身份，或使用用户指定的稳定角色 agentKey。身份是游标与记录归属，不是数据访问隔离。

## 查看器的处理

第一版继续打开 blackboard 独立查看器，复用现有 React Flow 图、SSE 和协作编辑。已有工作区服务需先核对归属；多项目不要争抢固定 4333 或悄悄切换共享 macOS 服务。

后续如需 DSH 内嵌面板，单独做 Client 插件，采用其 Slots、Client model、Host gateway 路线。DSH 的 Web 与 Electron 载体不同，Host 插件也不会自动把当前 React 应用变成桌面侧栏；原生工具的展示方法同样不自动产生 Web 专用工具卡片。[Web Client 分层](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/docs/subsystems/web-client.md)、[工具展示约定](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/docs/cookbook/adding-a-tool.md)

这时可以复用浏览器兼容的 model 和画布组件，替换 `use-graph-stream` 的数据适配层。第一版无需为了 iframe 接入去放宽现有查看器的写入校验。

## 实施顺序与验收

| 阶段 | 交付 | 验收重点 |
| --- | --- | --- |
| 0：接入试验 | 完整 Skill、稳定 CLI、临时项目 | DSH 实际发现并调用 Skill，写入和恢复成功 |
| 1：可安装 MVP | 独立 bundle、provider、8 个工具、异步桥接 | add、dump-config、工具调用、remove；禁用后不再注册，数据保留 |
| 2：恢复辅助 | 动态 context、身份映射、可选检查点 | 恢复、fork、压缩、HMR；失败不改变 Agent 下一步决策 |
| 3：界面整合 | DSH Client 面板 | Web/Desktop 各自验证，跨项目与流式重连正确 |

建议验收集：

- 空目录加载插件不产生 `.blackboard/`；只读 context 不改变 events 哈希。
- 两个项目和两个 Agent 交错写入不串板、不共享游标；原始工作区、当前目录不同也有明确归属。
- 未知节点类型/关系可存；创建不自动连边、不自动进入；lint 返回 0。
- CLI 缺失、版本不匹配、锁超时、取消、损坏日志、输出截断均有明确结果；写入不盲重试。
- state.json 丢失后仍可回放；不在 DSH Session 记录中建立第二权威图。
- Skill 参考目录随包可读；同名项目 Skill 的覆盖行为已验证。
- 插件禁用、重载、移除后无残留监听或子进程，不删除黑板数据。
- 打包产物含构建后的入口和 patch；普通用户安装不依赖 prepare/postinstall 才生成入口。

调研阶段的 npm 测试和 CLI 冒烟验证了复用基础；后续插件另行验证了 DSH 实际装载、原生工具调用和卸载。模型自动选用、自动恢复、压缩联动与内嵌 UI 不属于当前首版交付。

## 可复用实施提示词

```text
在 blackboard 仓库中实现独立 dsh-blackboard 适配包，先以本机
DeepSeek Harness 0.2.1-rc.2 为目标。先交付完整 Skill provider 和
结构化原生工具，异步调用已安装 current 的 CLI，暂不做内嵌 UI。
遵守 AGENT.md：events.jsonl 唯一事实源、三层分离、不替 Agent 选下一步、
不自动连边或移动游标、活动默认关闭、Skill 只有一个完整源。
项目必须显式启用；每次工具调用明确 boardRoot 和参与者身份，
不得把 process.cwd() 当成所有会话的项目，不调用 Claude setup。
补齐工具参数/返回契约、bundle 清单、生命周期释放和临时项目测试。
验证打包安装、实际工具调用、两个项目/身份隔离、只读哈希不变、
HMR 与卸载后数据保留。区分已执行结果与尚未验证的 DSH 行为。
自动恢复和压缩检查点作为下一阶段，不宣称 session/event 能等待异步前置写入。
```
