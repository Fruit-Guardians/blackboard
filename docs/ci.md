# 发布候选验证

`.github/workflows/verify.yml` 是验证流程，不会发布 npm 包、创建 release、安装全局启动器、接入个人宿主或调用付费模型。

## 流程

1. **构建一次**：Ubuntu / Node 24 执行 `npm ci`、测试及前端 build，收集 quick 合成性能报告，再 `npm pack --ignore-scripts`。
2. **同包多运行时验证**：将同一个 tarball 交给 Linux、macOS、Windows 的 Node 18 / 22 / 24 矩阵；不执行源码目录的 `npm ci`。
3. **插件独立验证**：DSH 单元测试与静态 manifest/syntax 检查单独运行在插件声明支持的 Node 22.19 / 24；不把 Host SDK 加到根包，不假装这就是实际 DSH 端到端运行。

Vite 8 的构建依赖要求 Node `^20.19.0 || >=22.12.0`。核心运行时仍是 Node ≥18；Node 18 只消费已构建的 public 产物，不承担前端构建。

`blackboard-release-candidate` artifact 保存 tarball、npm pack 清单和带机器信息的 quick 基线，保留 14 天。性能报告是观测，不是跨共享 runner 的毫秒级门禁。任何完整性断言失败仍会使任务失败。

## tarball smoke 的实际覆盖

```sh
# 当前源码 -> npm pack -> 全新临时消费者安装 -> CLI 检查
node scripts/verify-package.mjs

# 已有候选 tarball，CI 矩阵使用这个入口
node scripts/verify-package.mjs --tarball /absolute/path/to/blackboard-0.6.0.tgz

# 用同一验证器测试另一个源码目录
node scripts/verify-package.mjs --source /absolute/path/to/baseline
```

验证器使用临时 HOME / USERPROFILE、独立 npm cache、独立 BLACKBOARD_CWD，并在结束时删除临时目录。它检查：

- 根包没有 runtime / peer 依赖，干净消费者只有 blackboard 一个包；
- runtime 包不包含 plugins、web 源码、test、node_modules 或黑板数据；
- 完整单源 Skill 的目录与文件字节一致，不只是入口文件；
- public 的 JS / CSS 存在，HTML 引用的本地资源实际存在；
- **安装后的 CLI** 能显示版本、初始化、写节点、输出 JSON / Markdown context、只报告 lint、导出离线 HTML；
- context 保持只读 / non-prescriptive / Agent 决定下一步的契约；
- context、lint、export 前后事件日志字节不变。

它不启动服务，不修改真实项目，不执行 release install/setup/hooks，不验证 OS 专属常驻服务。矩阵通过也不应被描述成所有平台服务功能都已测过。

## DSH 真实 Host 与付费模型检查

常规 CI 无需模型账号。发版需要真实 Host 验证时，在插件目录按其 README 显式运行 `verify:dsh`、`verify:metadata`、`verify:profile`、`verify:settings`，并使用临时 DSH_HOME / 测试黑板。它们与不加载 SDK 的 unit test 是不同层级。

`verify:e2e` 会使用真实模型配置，保留为人工触发的本地发版检查；不要把模型密钥、个人 profile 或真实研究黑板放进公共 PR runner。

## 结果措辞

本地新增测试和 macOS / Node 26 tarball smoke 已实跑；GitHub Actions 矩阵只有在该 workflow 的具体运行成功后才算经过验证。提交 workflow 文件本身，不等于 Linux / Windows / Node 18 已经跑通。
