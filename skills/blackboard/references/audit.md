# 审计场景的记录语义

仅在代码审计需要黑板记录时读取。本参考不规定研究顺序、工具、扫描策略或复现步骤；blackboard 不是安全审计流程引擎。它只约束写入内容不能比实际证据更强，缺少记录或 lint 提示不能成为行动门槛。

## 节点的含义

- 开放问题只表达一个可独立结束的验证事项；剩余方向相互独立时分别建问题，并关联已知目标或上游判断。
- hypothesis 保存待核对解释；fact/observation/result 保存实际检查到的内容与可复核条件，不能用拟执行的实验冒充已观测结果。
- finding/vuln 可先记录未验证候选，可信度用 `suspected`；已有静态核对证据可直接标 `static-confirmed`，真实复现后才标 `reproduced`，不要求依次升级。漏洞严重度与可信度分开，源码推导不是端到端复现。
- 已核实的 fact/observation/result 可用 `--status confirmed`，有利于恢复确认事实；这不隐式证明相关漏洞结论。
- 游标是当前实际研究位置，不是“最重要漏洞”的书签。方向切换时显式移动到正在继续的问题；无需因为某结论严重而一直停在已收束节点。

## 候选与证据示例

`/已确认项目` 必须替换成真实绝对项目路径；`<候选ID>`、`<证据ID>` 等必须替换为命令输出中的实际 ID 或唯一前缀。CLI 定位遵循主入口，并行时每条命令另加身份。不原样执行未替换占位符。

先记录实际候选，而非捏造复现结果：

```sh
BLACKBOARD_CWD="/已确认项目" blackboard node add vuln "候选：某入口可能缺少授权检查" --sev high --confidence suspected --detail "已知入口与待核对条件"
```

完成真实静态核对后，记录核对事实并更新候选；示例中的描述也须替换成实际观察，不能把示例当审计结果：

```sh
BLACKBOARD_CWD="/已确认项目" blackboard node add fact "已核对入口到敏感操作的调用链" --status confirmed --detail "实际文件位置、检查路径、成立条件与限制"
BLACKBOARD_CWD="/已确认项目" blackboard link "<证据ID>" "<候选ID>" --rel supports
BLACKBOARD_CWD="/已确认项目" blackboard edit "<候选ID>" --confidence static-confirmed
BLACKBOARD_CWD="/已确认项目" blackboard link "<候选ID>" "<目标ID>" --rel related-to
```

事实 `supports` 结论，或结论 `derived-from` 事实，选择能准确表达已知证据的方向。正式发现应能沿显式关系回到目标；暂缺证据可照常记录候选，`lint` 的 `unsupported-conclusions` 仅提示补证，不拒绝写入。

真实复现后，再用 `node add result` 记录环境、输入、可观察结果及复核位置，关联该结果与候选，最后更新候选为 `--confidence reproduced`。不要在尚未执行或未观察到预期结果时提前使用该值。失败实验也可以是 confirmed 的观察，但不因此确认漏洞不存在；结论必须受实验覆盖范围约束。

## 反驳、取代与交接

如果证据推翻候选，用证据 `contradicts` 候选并把候选状态设为 `refuted`。若新结论只是取代旧解释或范围，用新结论 `supersedes` 旧结论并把旧节点设为 `superseded`。两者不是同义关系，不用取代来掩盖被反驳的旧判断。

暂停、交接或完成一轮审计时可写检查点：

```sh
BLACKBOARD_CWD="/已确认项目" blackboard checkpoint --summary "已确认内容及证据ID；当前验证节点；开放方向；尚未执行的复现"
```

摘要区分静态核对与真实复现，标明限制和未知。context/digest 只重建现场，不自动指派下一项研究，也不承诺审计完整性。
