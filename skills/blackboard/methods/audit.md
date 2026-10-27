---
name: audit
description: 代码审计场景的记录语义；候选漏洞、静态核对、真实复现、反驳与取代各自怎么记，让写入不比实际证据更强。审计需要黑板记录时可选使用，不规定审计顺序、工具或复现步骤。
metadata:
  version: "1"
  invocation: agent
  relations: supports, contradicts, derived-from, supersedes, related-to
---

# 审计场景的记录语义

这是代码审计场景的可选记录方式，仅在审计需要黑板记录时读取；不用它也是正常记录。本参考不规定研究顺序、工具、扫描策略或复现步骤；blackboard 不是安全审计流程引擎。它只约束写入内容不能比实际证据更强，缺少记录或 lint 提示不能成为行动门槛。

## 节点的含义

- 审计目标写明被审代码的版本：标题带包名@版本或短提交号，detail 写源码的实际位置（安装副本路径，或仓库与提交号）。审计时用的若不是原定那份副本，在目标或第一条观察里如实说明。不同版本之间行号引用不可比，同一个函数可能差出几十行。
- 开放问题只表达一个可独立结束的验证事项；剩余方向相互独立时分别建问题，并关联已知目标或上游判断。
- hypothesis 保存待核对解释；fact/observation/result 保存实际检查到的内容与可复核条件，不能用拟执行的实验冒充已观测结果。
- finding/vuln 可先记录未验证候选，可信度用 `suspected`；已有静态核对证据可直接标 `static-confirmed`，真实复现后才标 `reproduced`，不要求依次升级。漏洞严重度与可信度分开，源码推导不是端到端复现。
- 已核实的 fact/observation/result 可用 `--status confirmed`，有利于恢复确认事实；这不隐式证明相关漏洞结论。
- 游标是当前实际研究位置，不是“最重要漏洞”的书签。方向切换时显式移动到正在继续的问题；无需因为某结论严重而一直停在已收束节点。

## 候选与证据示例

`/已确认项目` 必须替换成真实绝对项目路径；`<候选ID>`、`<证据ID>` 等必须替换为命令输出中的实际 ID 或唯一前缀。CLI 定位遵循主入口，并行时每条命令另加身份。不原样执行未替换占位符。

先记录实际候选，而非捏造复现结果。已知候选属于哪个审计目标时，创建时就用 `--to` 连上：

```sh
blackboard node add vuln "候选：某入口可能缺少授权检查" --sev high --confidence suspected --to "<目标ID>" --detail "已知入口与待核对条件" --cwd "/已确认项目" --no-init
```

完成真实静态核对后，记录核对事实并更新候选；示例中的描述也须替换成实际观察，不能把示例当审计结果：

```sh
blackboard node add fact "已核对入口到敏感操作的调用链" --status confirmed --to "<候选ID>" --rel supports --detail "实际文件位置、检查路径、成立条件与限制" --cwd "/已确认项目" --no-init
blackboard edit "<候选ID>" --confidence static-confirmed --cwd "/已确认项目" --no-init
# 创建时没连目标、之后才明确两者关系时，可选执行：
blackboard link "<候选ID>" "<目标ID>" --rel related-to --cwd "/已确认项目" --no-init
```

事实 `supports` 结论，或结论 `derived-from` 事实，选择能准确表达已知证据的方向。若发现与目标存在明确关系，可以显式记录；没有已知关系时保持独立，不为图的完整性补边。暂缺证据可照常记录候选，`lint` 的 `unsupported-conclusions` 仅提示补证，不拒绝写入。

真实复现后，再用 `node add result` 记录环境、输入、可观察结果及复核位置，关联该结果与候选，最后更新候选为 `--confidence reproduced`。不要在尚未执行或未观察到预期结果时提前使用该值。失败实验也可以是 confirmed 的观察，但不因此确认漏洞不存在；结论必须受实验覆盖范围约束。

## 反驳、取代与交接

如果证据推翻候选，用证据 `contradicts` 候选并把候选状态设为 `refuted`。若新结论只是取代旧解释或范围，用新结论 `supersedes` 旧结论并把旧节点设为 `superseded`。两者不是同义关系，不用取代来掩盖被反驳的旧判断。

暂停、交接或完成一轮审计时可写检查点：

```sh
blackboard checkpoint --summary "已确认内容及证据ID；当前验证节点；开放方向；尚未执行的复现" --cwd "/已确认项目" --no-init
```

摘要区分静态核对与真实复现，标明限制和未知。context/digest 只重建现场，不自动指派下一项研究，也不承诺审计完整性。

需要记下排除了哪些候选、哪些范围检查过没有问题时，可选地参考[研究记录方式](inquiry.md)；不用它也不影响审计记录。
