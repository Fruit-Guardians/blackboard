# 接入、恢复与打开

只在配置接入、初始化或管理查看器时读取本参考。先确认宿主、项目绝对路径和用户意图；以下 `/已确认项目` 是必须替换的路径，不是可直接执行的默认值。命令优先用 PATH 中的 `blackboard`；若需 Node 入口，遵守主入口的 CLI 定位规则，绝不执行未展开的占位符。

## 已有黑板：恢复不是重装

需要接手任务、恢复长期上下文或压缩后继续时：

```sh
BLACKBOARD_CWD="/已确认项目" blackboard context --budget 4000
BLACKBOARD_CWD="/已确认项目" blackboard digest
BLACKBOARD_CWD="/已确认项目" blackboard here
```

`context` 默认输出 JSON；可加 `--markdown`。`digest` 是人类可读摘要，`here` 是当前身份的游标及一跳邻域；按需选用，不必全部执行。它们是只读投影，不规定下一步。并行任务需在每条命令中明确身份。

## 仅打开：先看实际服务状态

```sh
BLACKBOARD_CWD="/已确认项目" blackboard status
```

若提示项目尚无黑板，说明现状；只有用户同意初始化后才进入相应宿主的接入分支，不为“打开”静默重配环境或创建虚构记录。

若返回的查看器确实在线且服务于目标项目，直接访问该 URL；不要为打开页面而重装 Skill/Hook 或运行 setup。若离线，按用户的启动意图运行前台服务：

```sh
BLACKBOARD_CWD="/已确认项目" blackboard serve --open
```

前台服务要保持进程存活，不承诺命令退出后继续运行。若端口服务于其他项目，不要把该页面当成本项目；可选用已确认空闲的端口，以 `serve --port <端口> --open` 启动并用同一 `--port` 查询 status。只需要查看时可加 `--read-only`。本地 URL 并非远程访问服务。

## 首次 Claude Code 接入或明确重配

用户同意配置后，说明下列副作用，再运行：

```sh
blackboard setup --target "/已确认项目" --title "项目或任务标题" --open
BLACKBOARD_CWD="/已确认项目" blackboard status
```

`setup` 是 **Claude 专用的一体化配置命令**，可重复执行但不是无副作用的查询。它会：

- 创建或复用 `.blackboard/`，设置标题，并写入默认忽略规则保护黑板数据；事件日志仍是唯一事实源。
- 将自动活动记录设为关闭；安装用户级 CLI launcher、项目级 Claude Skill 和仅恢复类 Hook。已有接入可能被重配，不要假称它只打开页面。
- 默认配置服务并记住端口；macOS 下重配共享的用户级 launchd 服务，可能把该服务从另一项目切换到当前项目。
- `--open` 尝试打开浏览器，不代表浏览器已成功展示，也不代表当前宿主已加载新 Skill/Hook。

`--no-hooks`、`--no-skill`、`--no-serve` 可按明确需求关闭相应部分；即使关闭服务，setup 仍有其他配置副作用。不要默认加活动采集 Hook。仅需黑板数据、无需宿主接入时用 `init` 即可。

### 平台差异

macOS setup 默认配置并启动 launchd 持久服务，并核对它服务的项目。非 macOS 不自动配置持久服务，返回 `mode: manual` 和实际手动服务命令；执行返回命令后再确认状态。不要把 setup 的成功提示当成非 macOS 服务已在线。shell 环境不同则使用相应环境变量语法；本文前缀示例是 POSIX shell。

## 首次 Codex 接入

Codex 不默认执行 setup，不默认安装 Claude Hook，也不承诺存在 Codex 自动恢复 Hook。用户同意初始化与安装后：

```sh
BLACKBOARD_CWD="/已确认项目" blackboard init --title "项目或任务标题"
BLACKBOARD_CWD="/已确认项目" blackboard skill install --codex
BLACKBOARD_CWD="/已确认项目" blackboard status
```

已有黑板不必重新 init。项目级 Codex Skill 位于 `.agents/skills/blackboard/`；若用户明确要求用户级安装，使用 `skill install --codex --user`，安装到 `~/.agents/skills/blackboard/`。不回退到旧安装路径。不要因文件已安装就宣称当前宿主已发现或加载；是否需要新会话取决于宿主实际加载机制。若同时要求打开查看器，另用 status/serve 分支。

## 结果汇报

说明实际执行了哪些初始化/安装/重配、对应项目、服务是否真实在线以及 URL 或手动启动命令。Skill 和 Hook 文件安装成功不等于当前会话已经加载；配置完成不意味着创建了研究结论。用户仅要求配环境时，不建立虚构目标或发现。
