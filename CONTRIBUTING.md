# 贡献指南

先读[项目原则](AGENT.md)与[架构边界](docs/ARCHITECTURE.md)。blackboard 的改动应帮助如实记录和恢复现场，保留 Agent 自主决策；`.blackboard/events.jsonl` 是唯一事实源。使用问题从[首页](README.md)或[使用参考](docs/USAGE.md)开始。

## 环境与依赖

安装后的 CLI 和已构建工作台支持 **Node.js ≥ 18**，根包保持零运行时依赖。源码开发需要 `npm ci`；Vite 8 要求 **Node `^20.19.0 || >=22.12.0`**，建议跟随 CI 使用 Node 24。不要把前端库、导出校验库或 Host SDK 放入根包的运行时依赖。

DSH 插件是独立子包，Node 与依赖要求见[插件说明](plugins/dsh-blackboard/README.md)。根目录的 `npm test` 不包含插件全部测试，也不加载真实宿主。

<a id="local-development"></a>

## 本地开发

在仓库根目录安装依赖，并生成专用的合成演示板：

```bash
npm ci
node scripts/demo.js /tmp/blackboard-dev-demo
```

`demo.js` 会重建目标目录内已有的演示黑板；只传入专用的临时目录，不使用真实项目或上级黑板。默认目标为仓库的 `demo/`。开发仓库不得写真实项目的 `.blackboard/`，也不应让日常 Skill / Hook / 服务指向开发目录。

分别在两个终端运行，使用同一个演示板路径：

```bash
# 终端一：实际 API / SSE 服务
node bin/blackboard.js serve --cwd /tmp/blackboard-dev-demo
```

```bash
# 终端二：Vite 前端，默认 http://127.0.0.1:5173
BLACKBOARD_CWD=/tmp/blackboard-dev-demo npm run dev
```

Vite 的 `/api` 与 `/events` 代理按演示板配置解析服务端口；后端默认 `4333`。使用自定义端口时，在两个进程中明确使用一致的 `BLACKBOARD_PORT`，不要把开发页连到真实项目服务。开发代理配置见 `vite.config.js`。

`web/` 是前端源码，`public/` 是生成的分发产物。修改前端后运行 `npm run build`，提交对应的 `public/` 变更，不手改压缩后的 JS / CSS。构建会清空并重建 `public/`；CLI 服务和离线 HTML 使用这些资产。可选方法目录的生成规则见[方法框架](docs/METHODS.md#目录由脚本生成)，不要手改生成的 `methods/INDEX.md`。

## 本地验证

在所有相关改动落地后集中运行，避免并发构建或读取半完成的产物：

```bash
npm run check
npm test
npm run build
npm run evaluate:recovery
npm run verify:package
```

`npm run check` 依次执行 `check:types`、`check:docs` 和 `check:publish`；需要定位问题时可单独调用。文档检查在本地解析 Markdown / HTML 的相对路径、图片和标题锚点，不依赖网络。提交与推送前仍应重新运行 publication 检查，覆盖最终公开内容。

`npm test` 使用 Node 内置 test runner，覆盖根包行为和固定契约；部分前端纯模块测试会用本地 TypeScript 编译器，因此需要开发依赖。`evaluate:recovery` 只测合成投影的确定性正确性，模型恢复效果仍需单独试验。`verify:package` 打包当前源码并在隔离的临时消费者安装，检查完整 Skill、静态资产和实际 CLI；它不启动服务、不安装真实接入、不切换 `current`。

改动导出逻辑或生成资产时，另行运行：

```bash
npx playwright install chromium
npm run verify:exports
```

该入口实际用 Chromium 渲染 Markdown / Mermaid，并按固定的官方 SARIF schema 校验 CLI 结果。可选 Postman CLI 检查为 `npm run verify:api`；合成性能观测为 `npm run benchmark -- --quick`。前置条件、完整命令和覆盖限制见 [CI 与导出验证](docs/ci.md)、[历史 API](docs/history-api.md#local-postman-cli-contract-check)、[性能基线](docs/performance.md)。

涉及 DSH 适配时，在插件目录按其[测试说明](plugins/dsh-blackboard/README.md#测试)运行单元与静态检查；通过 `BLACKBOARD_TEST_CLI` 明确指定本次内核执行真实 CLI 集成检查。真实 Host 验证和会发送模型请求的 `verify:e2e` 是分别执行的本地检查，不以单元测试结果代替。

只为有意义的可观察行为添加测试，例如输出兼容、并发写入、身份隔离、读取不变性、草稿冲突与导出消费端行为。不要用源码字符串、内部 import 路径或复制实现的断言固定一个重构方案。

## 契约与版本

[公开契约](docs/CONTRACT.md)是 CLI 参数、JSON schema、HTTP 行为、事件格式与写入目标的唯一参考。内部模块路径、终端文案和目录拆分不是公开接口。

- 外部行为变化时，先更新有意义的契约或行为测试，再同步实现与文档；不要仅为新输出重新生成存档而隐藏差异。
- `lib/contracts.js` 集中声明输出、写入目标和图 schema。新增公开能力必须与 `capabilities`、固定输出和契约文档一致；适配器按能力声明检测，不解析版本号或内核文件名。
- `status`、`severity`、`confidence` 保持独立的字符串或 null，不由类型推断；`receipt.result` 保留写入时原样结果。
- 事件兼容纪律与 schema 兼容纪律分开处理：兼容新增不提高 `EVENT_VERSION`；只有旧逻辑会回放出错误投影时才提高。完整规则见契约，不创建第二份格式说明。
- 根包版本与 lockfile、固定能力输出中的版本一致；可选插件独立版本。`0.8.1`、`0.8.2` 延续 `0.8.0` 的 CLI / JSON / 事件契约，不为内部文件移动或健壮性修复提高 schema 版本。

## 隐私与公开内容

公开测试、截图、导出和演示只使用明确的合成数据。不要提交真实黑板、研究日志、请求/响应、模型会话、目标信息、个人绝对路径、凭据或本机接入副本；`trial/`、`recon/`、`report/`、`.blackboard/`、`.agents/`、`.claude/` 等保留在本地。完整 Skill 的发布源是 `skills/blackboard/`。

提交或推送前运行 `npm run check:publish`。仓库的 `.githooks/` 提供暂存与待推送历史检查；本地可用 `git config core.hooksPath .githooks` 启用。默认命令检查当前工作树可发布文件，暂存快照可用 `npm run check:publish -- --staged` 检查；pre-push 还检查待推送中间提交，不能靠末尾删除敏感内容掩盖已提交历史。真实目标匹配词只存本地 Git 的 `info/publication-deny.json`，不要放进公开扫描器或 fixture。检查输出仅给路径与规则，不回显命中内容。

## 发布与交接

变更说明写清问题、行为变化、运行过的命令及结果，未执行的检查明确写明。CI 配置存在不代表矩阵通过；记录具体运行的链接或本地环境。Chromium 与 SARIF schema 校验不等于 GitHub code scanning 上传或 IDE 导入，DSH headless 模型检查不等于桌面交互验收。

发布候选流程与同一 tarball 的 Linux / macOS / Windows、Node 18 / 22 / 24 验证见 [CI 说明](docs/ci.md)。先构建并核对发布内容，再按[版本管理](docs/USAGE.md#release)安装不可变版本；日常使用从 `current` 切换。发布、真实接入和真实模型请求不由普通代码测试自动触发。

