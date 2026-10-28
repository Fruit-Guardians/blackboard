# 发布候选验证

`.github/workflows/verify.yml` 是验证流程，不会发布 npm 包、创建 release、安装全局启动器、接入个人宿主或调用付费模型。

当前源码边界见[架构说明](ARCHITECTURE.md)，本地开发与检查清单见[贡献指南](../CONTRIBUTING.md)。`0.8.3` 延续 0.8.0 的公开契约；本文描述验证器与 workflow 的覆盖，不为该版本预先记通过结果。

## 流程

1. **构建一次**：Ubuntu / Node 24 先检查 publication hygiene，再执行 `npm ci`、`npm run check:types`、`npm run check:docs`、测试及前端 build；安装 Playwright Chromium 后，用真实 CLI 生成合成报告，在浏览器中渲染 Markdown/Mermaid，并用随库固定的 OASIS schema 校验 SARIF；收集 quick 合成性能报告，再 `npm pack --ignore-scripts`。本地 `npm run check` 合并类型、文档和 publication 检查，CI 将三项分开执行以明确失败位置。
2. **同包多运行时验证**：将同一个 tarball 交给 Linux、macOS、Windows 的 Node 18 / 22 / 24 矩阵；不执行源码目录的 `npm ci`。
3. **插件独立验证**：DSH 单元测试与静态 manifest/syntax 检查单独运行在插件声明支持的 Node 22.19 / 24；不把 Host SDK 加到根包，不假装这就是实际 DSH 端到端运行。

Vite 8 的构建依赖要求 Node `^20.19.0 || >=22.12.0`。核心运行时仍是 Node ≥18；Node 18 只消费已构建的 public 产物，不承担前端构建。

`blackboard-release-candidate` artifact 保存 tarball、npm pack 清单、合成导出的渲染截图与带机器信息的 quick 基线，保留 14 天。性能报告是观测，不是跨共享 runner 的毫秒级门禁。任何完整性断言失败仍会使任务失败。

## tarball smoke 的实际覆盖

```sh
# 当前源码 -> npm pack -> 全新临时消费者安装 -> CLI 检查
node scripts/verify-package.mjs

# 已有候选 tarball，CI 矩阵使用这个入口
node scripts/verify-package.mjs --tarball /absolute/path/to/blackboard-0.8.3.tgz

# 用同一验证器测试另一个源码目录
node scripts/verify-package.mjs --source /absolute/path/to/baseline
```

验证器使用临时 HOME / USERPROFILE、独立 npm cache、独立 BLACKBOARD_CWD，并在结束时删除临时目录。它检查：

- 根包没有 runtime / peer 依赖，干净消费者只有 blackboard 一个包；
- runtime 包不包含 plugins、web 源码、test、node_modules 或黑板数据；
- 完整单源 Skill 的目录与文件字节一致，不只是入口文件；
- public 的 JS / CSS 存在，HTML 引用的本地资源实际存在；
- **安装后的 CLI** 能显示版本、初始化、写节点、输出 JSON / Markdown context、只报告 lint，导出离线 HTML、Markdown、Mermaid 和带代码位置的 SARIF；运行时不依赖导出验证所需的开发依赖。
- context 保持只读 / non-prescriptive / Agent 决定下一步的契约；
- context、lint、export 前后事件日志字节不变。

它不启动服务，不修改真实项目，不执行 release install/setup/hooks，不验证 OS 专属常驻服务。矩阵通过也不应被描述成所有平台服务功能都已测过。

## 离线文档检查

`npm run check:docs` 使用 Markdown、HTML 与 GitHub 标题解析器检查公开文档中的相对链接、图片和标题片段，也检查图片 `srcset`。显式 HTML ID 和重复标题生成的锚点均参与核对；围栏示例不当成真实链接。不访问外部网站，不检查非 Markdown 资源内部的片段，也不扫描被 publication 规则排除的任务数据。诊断仅报告源文件、行号和原因，不回显链接目标。


## 导出消费端回归

```sh
npm ci
npx playwright install chromium
npm run verify:exports
# 需要保留合成报告的视觉证据时：
npm run verify:exports:text -- --out-dir /tmp/blackboard-export-consumers
```

验证器只创建临时合成黑板。Markdown 检查浏览器中显示的作者原文、章节与关系链接，并检查恶意输入没有生成可执行元素；Mermaid 使用本地官方 bundle 在 Chromium 中生成 SVG，覆盖普通图、长标题、特殊字符、分组和空图。SARIF 使用固定的官方 2.1.0 schema 校验真实 CLI 的结果，并检查有位置、缺位置和重复导出的身份语义。验证前后检查事件日志不变；不写真实项目，不依赖网络或模型账号。

这些检查不宣称已经通过 GitHub code scanning 上传或特定 IDE 的导入验收。实际平台的权限、路径解析和告警生命周期仍需在对应环境验证。

## DSH 真实 Host 与付费模型检查

常规 CI 无需模型账号。发版需要真实 Host 验证时，在插件目录按其 README 显式运行 `verify:dsh`、`verify:metadata`、`verify:profile`、`verify:settings`，并使用临时 DSH_HOME / 测试黑板。它们与不加载 SDK 的 unit test 是不同层级。

`verify:e2e` 会使用真实模型配置，保留为人工触发的本地发版检查；不要把模型密钥、个人 profile 或真实研究黑板放进公共 PR runner。

## 结果措辞

此前文档记录过本地新增测试和 macOS / Node 26 tarball smoke 实跑；这是历史环境记录，不代表当前提交或 Node 18 已验证。每次交接应明确实际运行的命令、环境、结果与未运行项；GitHub Actions 矩阵只有在该 workflow 的具体运行成功后才算经过验证。提交 workflow 文件本身，不等于 Linux / Windows / Node 18 已经跑通。
