const titles = {
  blackboard_status: '黑板状态', blackboard_context: '恢复研究现场', blackboard_node_get: '查看节点',
  blackboard_node_add: '记录判断', blackboard_node_patch: '更新节点', blackboard_link: '关联证据',
  blackboard_cursor: '切换关注位置', blackboard_checkpoint: '保存交接', blackboard_diagnose: '接入诊断',
};
const text = value => typeof value === 'string' ? value.slice(0, 320) : '';

/** Bounded, replayable facts for UI only; canonical tool output stays unchanged. */
export function presentationMeta(name, args, value) {
  const data = name === 'blackboard_diagnose' ? value : value.data;
  const node = data?.node;
  let summary = text(node?.title) || text(args.title) || text(args.summary) || text(args.id);
  if (name === 'blackboard_link') summary = `${text(args.from)} → ${text(args.relation)} → ${text(args.to)}`;
  if (name === 'blackboard_context') summary = text(data?.currentFocus?.title) || text(data?.currentFocus?.id);
  if (name === 'blackboard_status' && Number.isSafeInteger(data?.stats?.total)) summary = `${data.stats.total} nodes`;
  return { blackboard: {
    schema: 'blackboard.card.v1', action: name, summary,
    boardRoot: text(value.boardRoot), agentId: text(value.agentId),
    nodeId: text(node?.id) || text(data?.currentFocus?.id) || text(args.id),
    diagnostics: text(value.diagnostics),
    ...(name !== 'blackboard_diagnose' ? {} : {
      readyToRead: data.readyToRead, readyToWrite: data.readyToWrite,
      checks: data.checks.map(check => Object.fromEntries(Object.entries(check).map(([key, value]) => [key, text(value)]))),
    }),
  } };
}

export function presenters(name) {
  return {
    presentCall: () => ({ card: 'generic', title: titles[name], kind: ['blackboard_status', 'blackboard_context', 'blackboard_node_get', 'blackboard_diagnose'].includes(name) ? 'read' : 'edit' }),
    presentResult: (_args, result) => ({ card: 'generic', title: titles[name], content: result.content }),
  };
}
