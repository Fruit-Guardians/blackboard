# dsh-blackboard

blackboard 的可选 **DeepSeek Harness 适配器**，位于主仓库的 `plugins/dsh-blackboard/`。子包独立管理依赖、版本、测试和发布，不包含嵌套 Git 仓库；blackboard 核心不依赖、不导入 DSH。

```text
DSH → dsh-blackboard → 独立安装的 blackboard CLI → 项目 .blackboard/events.jsonl
```

目标版本：DSH `0.2.1-rc.2`。blackboard 不按版本号判断，而按 `capabilities --json` 检测：`schema` 为 `blackboard.capabilities.v1`，`features` 含 `writeAttribution`、`cwdFlag`、`noInit`，用到的 8 个命令输出声明为插件读取的 schema，并声明 `writeTargets`，即 [公开契约](../../docs/CONTRACT.md) v1。早于契约的构建（包括 2026-10-27 的 0.6.1 发布准备提交）缺少 `outputs`、`writeTargets`，诊断会报 RUNTIME_INCOMPATIBLE。Node 与 DSH 的运行要求一致：`^22.19.0 || >=24.0.0`。源码是可直接运行的 ESM，安装后不依赖构建或生命周期脚本。

## 插件展示信息

中文界面显示 **blackboard · 外置黑板**，英文界面显示 **blackboard · External Blackboard**；插件与所含组件共用名称、简介和黑底薄荷绿品牌图标。展示文字来自导出的 `locale/en.json`、`locale/zh.json`，图标来自包内 `assets/blackboard-icon.svg`（复用主项目的 `design/blackboard-logo/blackboard-app-icon.svg`）。这些资源随插件独立打包，不依赖仓库外路径或网络加载。

包标识仍为 `dsh-blackboard`，组件 ID 仍为 `blackboard`；既有安装命令、bundle 配置和项目选择保持不变。源码链接安装修改后，重新进入插件页查看；宿主仍缓存旧元信息时，退出并重新打开 DSH。发布包安装需要更新插件包。项目主页、代码仓库子目录和问题反馈地址同时保存在 package.json 中；具体展示项由 DSH 界面决定。

## 已实现

- 9 个结构化原生工具（原有 8 个读写工具 + 只读接入诊断）；参数校验和工具执行使用宿主提供的 SDK。
- Skill provider 从已安装 blackboard 的完整 Skill 包读取正文、元数据和参考资源，不维护副本。
- 异步 CLI 桥接；每次调用独立绑定项目、身份、超时、输出上限和取消信号。
- 写工具读取宿主实时 sandboxPolicy；read-only 阻止写入，workspace-write 核对黑板真实路径位于会话工作区内。
- 禁用/HMR 时释放注册，并终止、等待未完成的 CLI 子进程。

本版不自动初始化项目、不安装 Claude/Codex Hook、不配置常驻服务、不采集工具活动，也不添加自动压缩 Hook 或内嵌图谱。移除本插件后，黑板数据和独立 CLI 保持可用。

## 安装与启用

### 1. 独立安装 blackboard

按 [blackboard 文档](https://github.com/Fruit-Guardians/blackboard) 安装并执行其 `release install`。默认运行路径为：

```text
$XDG_DATA_HOME/blackboard/current/bin/blackboard.js
# 未设置 XDG_DATA_HOME 时：~/.local/share/blackboard/current/bin/blackboard.js
```

不要把日常插件指向开发仓库；current 指针的切换、升级与回滚由 blackboard 自己管理。

### 2. 将插件子包安装为 DSH bundle

从主仓库中插件子包的绝对路径安装，例如：

```sh
dsh plugin --profile web add /absolute/path/to/blackboard/plugins/dsh-blackboard
dsh --profile web --dump-config
```

在插件子目录运行 `npm pack`，从生成的 tgz 安装。根包的发布文件列表不包含本插件，插件也不复制 blackboard 内核或 Skill 正文。SDK 仅声明为子包的 peerDependencies，由 DSH 提供共享实例；根目录安装不需要 DSH SDK。

### 3. 显式初始化并选择项目

用户选择接入的项目后，独立执行一次：

```sh
blackboard init --cwd /absolute/path/to/your-project --json
```

将配置示例中的目录替换为实际绝对路径，通过 profile 的 `cordis.patch.yml` 或启动 overlay 应用：

```yaml
- id: blackboard
  config:
    projects:
      - workspace: /absolute/path/to/your-project
        boardRoot: /absolute/path/to/your-project
```

```sh
dsh web --patch /absolute/path/to/blackboard-project.patch.yml
```

bundle 默认 `projects: []`，安装本身不启用任何项目。DSH 替换整行 config 而非深合并；自定义 runtimeCli 等字段时在同一配置中一并保留。`web` 是示例 profile，桌面端应选择实际使用的 profile。

## DSH 内的配置与卡片

打开 **插件 → blackboard · 外置黑板 → 包含的组件 → 配置 blackboard · 外置黑板**。插件携带即用的 browser client，桌面端和 Web 使用同一配置页与工具卡片，不要求用户构建。

- 添加/移除项目，填写工作区绝对路径；黑板根目录留空时使用工作区。保存配置不会创建黑板，仍须在确认的项目中显式执行 `blackboard init --json`。
- CLI 和 Node 字段留空时恢复默认路径；超时和输出上限可直接调整。修改只提交实际变化字段，通过宿主 settings 服务保存；并发修改会被修订号拒绝，草稿保留，可重新读取后重试。
- 配置采用 volatile 字段。新调用读取完整快照；已开始的调用保留原项目、CLI、超时与输出上限，不在执行途中切换。配置保存不重新挂载插件。
- 在项目会话中输入“检查 blackboard 接入状态”，可让 Agent 调用 `blackboard_diagnose`。此工具在项目尚未启用时也可用，分别报告 CLI、项目/黑板、实际只读状态查询及当前宿主写策略，并给出处理提示；不自动修复、不写入或调整权限。
- 所有 blackboard 工具提供本地化标题、节点/关系摘要、项目与参与者身份、诊断事项、可展开的原始调用/结果和轨迹入口。卡片展示是持久结果上的投影，不是新的黑板事实源；错误或旧记录没有可识别元信息时保留原始结果，不显示成功摘要。

这版只提供配置、显式诊断与展示，不启用自动恢复或自动检查点。安装过旧版源码链接时，重启 DSH 以刷新 Config 和 browser client 清单；发布包安装需更新包。仅提供 Host 的 headless profile 仍可使用全部工具，无需加载浏览器资源。

## 配置

| 字段 | 默认值 | 含义 |
| --- | --- | --- |
| `projects` | `[]` | 显式项目数组；每项有绝对路径 `workspace`、可选 `boardRoot`，后者默认同 workspace |
| `runtimeCli` | 独立安装的 current CLI | 绝对脚本路径；支持自定义数据目录 |
| `nodeExecutable` | 宿主 process.execPath | Node 绝对路径；桌面 Electron 自动使用 Node 模式启动子进程 |
| `timeoutMs` | `10000` | 50–120000 毫秒 |
| `maxOutputBytes` | `1048576` | stdout + stderr 合计上限，1024–16777216 字节 |

项目匹配以原始 `session.header.cwd` 为锚点，使用真实路径和最近的已配置祖先；当前会话 cd 不会悄悄切换黑板。嵌套配置优先于外层配置；相同真实目录的别名配置产生明确错误。配置一个仓库即允许其原始会话子目录使用同一黑板；需要隔离的嵌套工作区应另行配置。

写入身份固定为 `dsh:<session.id>`，恢复同一会话沿用该身份，子会话使用独立游标。context 的可选 agentId 只用于显式读取其他参与者现场。身份标识不构成权限隔离。

## 工具契约

| 工具 | 参数 | 行为 |
| --- | --- | --- |
| `blackboard_diagnose` | 无 | 只读检查接入、返回问题与处理提示；不要求项目已经启用 |
| `blackboard_status` | 无 | 读取数据及服务状态，不启动服务 |
| `blackboard_context` | budget、focus、since、agentId 可选 | 读取恢复投影，不移动游标 |
| `blackboard_node_get` | id | 读取节点及关联 |
| `blackboard_node_add` | type、title；detail、status、severity、confidence、at、tags、enter 可选 | 创建节点，enter 默认关闭，不自动连边 |
| `blackboard_node_patch` | id；至少一个 title、detail、status、severity、confidence、tags | 只更新显式字段；0.6 CLI 不支持在此清空字段或 tags |
| `blackboard_link` | from、to、relation；label 可选 | 写入显式有向关系，支持自定义关系 |
| `blackboard_cursor` | id；reason 可选 | 明确移动到节点或 none，不提供 next 自动选择 |
| `blackboard_checkpoint` | summary | 保存显式交接检查点 |

原有 8 个读写工具的成功结果保持规范 JSON envelope：

```json
{
  "boardRoot": "/absolute/path/to/project",
  "agentId": "dsh:session-id",
  "data": {},
  "diagnostics": ""
}
```

`blackboard_diagnose` 单独返回 `blackboard.diagnostics.v1`：`readOnly: true`、`runtimeCli`、可为空的 `sessionWorkspace`/`boardRoot`/`agentId`、`readyToRead`、`readyToWrite` 和 `checks`（id/status/code/message/remedy）。预期的未接入或只读状态作为诊断数据返回；取消和卸载仍是工具执行错误。可写结论只是调用时的宿主策略检查，真正写入仍会重新授权。

data 是 CLI 的原始结构化结果，diagnostics 保留 stderr 提示（包括字段截断）。context 强制核对 `blackboard.context.v2` 及 policy 中的 readOnly=true、prescriptive=false、nextStepSelection=agent-controlled。节点公开 JSON 的 status/severity/confidence 为字符串或 null；当前适配要求节点输出 v2，与该版内核一同升级。

失败通过 DSH 标准错误结果呈现，消息携带错误代码：NOT_ENABLED、BOARD_NOT_INITIALIZED、SESSION_REQUIRED、WORKSPACE_MISSING、AMBIGUOUS_PROJECT、RUNTIME_MISSING、RUNTIME_INCOMPATIBLE、SPAWN_FAILED、CLI_FAILED、INVALID_JSON、CONTEXT_CONTRACT、POLICY_REQUIRED、WRITE_POLICY、TIMEOUT、ABORTED、OUTPUT_LIMIT 或 DISPOSED。模型参数不开放任意命令、shell 或目标目录。

固定 CLI 桥接只通过公开契约调用内核：项目根和身份以 `--cwd`、`--agent` 显式传入（写命令另加 `--no-init`），不设置也不继承 `BLACKBOARD_CWD`、`BLACKBOARD_AGENT`；写入前按 `capabilities.writeTargets` 声明的每个文件做宿主模式/路径校验：已存在的目标解析真实路径后必须在工作区内，悬空软链拒绝，尚不存在的目标看最近的已存在上级目录。不把它宣称为独立的 OS 沙箱。Skill 仍按发布包结构从 CLI 所在包的 `skills/blackboard/` 读取，这一处不在公开契约内。boardRoot 配置到工作区外时，workspace-write 模式下写工具会返回 WRITE_POLICY。read-only 模式仍可读取已配置黑板。文件系统上的并发路径替换仍由实际运行环境的隔离承担。

超时、取消或输出过限时，写入可能已经提交；先读取现场，不自动重试写操作。黑板内容是用户或 Agent 留下的数据，不能提升为宿主指令。

## Skill 与资源

provider 使用 blackboard 安装包的 `skills/blackboard/`，展开 CLI 占位符，resourceBase 指向完整资源目录；不改写安装文件。候选指向已解析的不可变版本资源，CLI 路径仍保持 current。升级需要按 DSH 机制重载 provider 以刷新目录；项目同名 Skill 按 DSH 优先级覆盖 bundled 候选。

Skill 可见不代表项目已启用，更不代表模型已经加载或调用了它；实际使用以工具执行与事件记录为准。runtime 未安装时 provider 会向 DSH 报告发现失败，不创建替代 Skill 或黑板。

## 测试

以下命令在插件子目录执行。无需安装 SDK 即可运行桥接/隔离单元测试；真实 CLI 集成测试通过显式路径启用：

```sh
npm run check
BLACKBOARD_TEST_CLI=/absolute/path/to/blackboard/current/bin/blackboard.js npm test
npm run verify:profile
npm run verify:settings
```

SDK 注册验证可使用正常 npm 开发依赖环境，或使用桌面附带 runtime（macOS 示例）：

```sh
DSH_RUNTIME_MANIFEST='/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/package.json' \
ELECTRON_RUN_AS_NODE=1 \
'/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness' \
scripts/verify-dsh.mjs
```

同样的 runtime 环境下，将最后一行替换为 `scripts/verify-metadata.mjs`，可用 DSH 原生元信息读取器检查源码链接与实际 `npm pack` 产物的中英文标题、简介及图标。该检查不激活插件、不发送模型请求，也不修改已有 profile。

该验证使用真实 Cordis、ToolRuntime、SkillRegistry 和本插件入口，检查规范参数/结果、Skill 加载、卸载及重载；临时目录在结束时删除，不触及真实项目。它不发送模型请求，不等同于完整模型会话测试。

`verify:settings` 在独立 DSH_HOME 中通过真实宿主 settings/configEditor 保存配置，检查新调用即时生效、插件实例身份不变、非法值/过期修订号不落盘、重启恢复，以及诊断前后事件内容不变。设置 DSH_PLUGIN_PACKAGE 为 tgz 可检查发布产物；不发送模型请求。

`verify:profile` 另用临时 DSH_HOME 实际安装、启动和移除 bundle；创建真实会话，核对 read-only 拒绝写入、workspace-write 允许写入和 Skill 发现。它使用 PATH 中的 dsh，或 DSH_BIN 指定的可执行文件。设置 DSH_PLUGIN_PACKAGE 为 tgz 的绝对路径即可验证打包产物；测试结束移除整个临时 home。

### 真实模型端到端验收（显式运行）

```sh
npm run verify:e2e
```

此命令会发送真实模型请求，使用现有 DSH headless 模型配置和 `.env` 中的环境变量凭据，不使用模型或工具响应 mock，也不在脚本中代替模型调用插件工具。它独立打包安装插件，再通过三次自然语言任务验证：模型加载 Skill、创建节点/关系/游标/检查点；新进程恢复同一会话；新会话从黑板读取交接口令。恢复前后核对事件文件哈希。

默认读取 `$DSH_HOME/profiles/headless/cordis.patch.yml` 和 `$DSH_HOME/.env`，未设置 DSH_HOME 时使用 `~/.dsh`。测试 home 通过临时符号链接读取 `.env`，结束即移除链接；不复制密钥到报告，原模型配置和凭据文件须保持原哈希。这个入口针对已有的环境变量认证路由，不启用 GUI 托管凭据。

可选环境变量：`DSH_E2E_AUTH_HOME` 指定已有配置目录，`DSH_E2E_MODEL_PATCH` 指定模型 patch，`DSH_E2E_DIR` 指定一个全新的证据目录；DSH_BIN 和 BLACKBOARD_TEST_CLI 的用法同上。默认保留在系统临时目录中的 `REPORT.json`、自然语言提示、模型工具调用 JSONL、会话日志和测试黑板，不写真实项目。

测试项目创建独立 Git 根并显式 `init --here`，避免继承上级黑板；测试中关闭其他文件 Skill provider，核对 blackboard Skill 来自本插件 provider。验证用观察器只限制工具集合、记录模型路由和设置步数上限，不提供工具调用结果。该验收覆盖 headless 模型链路，桌面 UI 点击流程需另外验证。

## 移除与独立性

```sh
dsh plugin --profile web remove dsh-blackboard
```

另外移除自己添加的项目 override。插件不删除 `.blackboard/`，不回滚 blackboard 自身的版本，不修改其他宿主的接入配置。

维护边界：适配代码只处理 DSH 协议、配置、身份和展示；通用图语义、锁、回放与持久化改动应在 blackboard 主项目独立讨论和测试，不在适配包复制核心实现。
