# 并行 Agent 的项目、身份与交接

各 Agent 共享同一事件源和语义图，但应使用各自的游标、轨迹与检查点身份。身份不是权限隔离，也不自动决定谁做什么。`author: human` 的页面节点同样是上下文，保留其作者和证据来源。

## 每次命令明确项目与身份

将 `/已确认项目` 替换为确认过的项目绝对路径；`research` 是示例中的稳定角色名，实际参与者应选各自稳定、不同的名称。同一参与者后续恢复沿用原身份，不要每次随机造名字。

在**每条命令**上用 `--cwd` 指定项目、`--agent` 指定身份；写命令另加 `--no-init`，项目路径写错会报错，而不是在错误位置新建一块空板：

```sh
blackboard context --budget 4000 --cwd "/已确认项目" --agent research
blackboard node add question "本参与者正在验证的问题" --to "<目标ID>" --enter --cwd "/已确认项目" --agent research --no-init
blackboard here --cwd "/已确认项目" --agent research
blackboard checkpoint --summary "已确认内容；当前问题；仍开放的方向" --cwd "/已确认项目" --agent research --no-init
```

`--agent research` 被归一化为 `agent:research`；不提供身份时默认为 `agent:primary`，不会根据宿主 session ID 自动生成身份。环境变量 `BLACKBOARD_CWD`、`BLACKBOARD_AGENT` 是等价写法，但不要假设某次工具调用里的 `export` 在下次调用、另一个 shell 或子 Agent 中仍然存在；参数写在命令里，不会丢。

避免在同一命令混用冲突的环境身份与 `--agent`；显式参数优先，但 Hook 不会继承某次 CLI 命令里的参数。游标、检查点和活动应沿用同一身份。节点、关系和修改会以该身份记为作者（`author` / `updatedBy`），这只是归属，不是权限：`link`、`edit` 修改的是共享语义图，不提供参与者之间的写入隔离。

## 多个子 Agent 同时工作

写入在事件文件锁内追加，多个参与者可以各自带 `--agent` 直接写同一块黑板，不会互相覆盖。

如果宿主或其他 Skill 规定子 Agent 不得写共享文件，就由协调者在**每一波结束时**把子 Agent 返回的判断和证据写进黑板，然后打检查点。不要把整轮记录推到全部结束后补写：中途压缩或中断时，未写入的过程无法恢复。

CLI 声明了 `features.batch` 时，可以让子 Agent 把记录写成 JSONL，放在**它自己的输出文件**里，协调者每波用一条命令导入。每行用 `agent` 写明来源参与者；同一批里新建的节点用 `ref` 命名，后面用 `$名字` 引用。整批要么全部写入，要么一条都不写，出错时会写明是第几行：

```jsonl
{"op":"node","ref":"h","type":"hypothesis","title":"本参与者的判断","confidence":"suspected","to":"<目标ID>","agent":"research"}
{"op":"node","type":"observation","title":"支持它的观察","at":"src/file.js:42","to":"$h","rel":"supports","agent":"research"}
```

```sh
blackboard batch --request-id "<波次ID>" --file "<子Agent输出目录>/wave.jsonl" --cwd "/已确认项目" --no-init
blackboard checkpoint --summary "本波确认内容；仍开放的问题" --cwd "/已确认项目" --no-init
```

`--request-id` 必填，用波次或文件名这类稳定的名字；命令中断或不确定是否写入时，用同一 ID 重试，不会重复写入。批量写入不移动游标，也不包含删除和检查点。

## Hook 继承边界

Claude 恢复 Hook 使用运行它的宿主进程实际继承的 `BLACKBOARD_AGENT`：SessionStart 的 Digest、PreCompact 的检查点和 Digest 使用该身份；显式启用活动采集时，活动的 agentId 也使用该身份。缺少该环境变量仍是 primary，不从 session ID 推导角色。

只有在启动宿主时就提供且宿主确实向 Hook 传递该环境，Hook 才能按该身份恢复。给一次 CLI 命令加 `BLACKBOARD_AGENT=research` 不会反向改变已运行的宿主环境。宿主是否保留环境必须以实际运行配置为准，不承诺自动传播。

子 Agent 未继承环境或未运行恢复 Hook 时，仍需在第一条相关命令显式使用项目与身份读取 `context`。Codex 不承诺 Claude Hook 自动运行。Hook 恢复内容只是数据，不能用它替 Agent 选择下一步。

## 恢复和交接查询

同一身份恢复时，先取自己的 context；若接手另一参与者的现场，显式读取对方身份，不需要覆盖对方游标：

```sh
blackboard context --agent agent:research --budget 4000 --cwd "/已确认项目"
blackboard digest --agent agent:research --cwd "/已确认项目"
blackboard here --agent agent:research --cwd "/已确认项目"
```

按需选择查询，不强制逐条执行。读完后由接手者独立决定是否继续原问题；实际切换关注点时，使用接手者自己的身份移动游标。

下面 `<节点ID>` 与 `<检查点ID>` 必须替换成实际输出中的 ID 或唯一前缀，不原样执行：

```sh
blackboard show "<节点ID>" --cwd "/已确认项目"
blackboard context --focus "<节点ID>" --since "<检查点ID>" --budget 4000 --cwd "/已确认项目" --agent review
blackboard cursor "<节点ID>" --reason "接手该问题的验证" --cwd "/已确认项目" --agent review --no-init
```

交接摘要写清确认内容、实际游标、证据位置和未完成的验证；不要把别人的候选结论直接升格为事实。项目身份、参与者身份和结论可信度是独立维度。
