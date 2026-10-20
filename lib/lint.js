// Read-only quality hints for a blackboard. Lint never changes the graph and
// never blocks an Agent action; it only makes context drift visible.

import { currentCursor } from './model.js';

function issue(level, code, message, nodeIds = [], detail = {}) {
  return { level, code, message, nodeIds, ...detail };
}

export function lintGraph(g, { maxTitleLength = 80 } = {}) {
  const nodes = Object.values(g.nodes || {});
  const edges = Object.values(g.edges || {});
  const linked = new Set(edges.flatMap((e) => [e.from, e.to]));
  const incoming = new Map(nodes.map((n) => [n.id, []]));
  const outgoing = new Map(nodes.map((n) => [n.id, []]));
  for (const e of edges) {
    if (incoming.has(e.to)) incoming.get(e.to).push(e);
    if (outgoing.has(e.from)) outgoing.get(e.from).push(e);
  }

  const issues = [];
  const long = nodes.filter((n) => [...String(n.title || '')].length > maxTitleLength);
  if (long.length) {
    issues.push(issue(
      'warn', 'long-titles',
      `${long.length} 个节点标题超过 ${maxTitleLength} 字；建议把证据和过程移入 detail。`,
      long.slice(0, 20).map((n) => n.id),
      { count: long.length },
    ));
  }

  const isolated = nodes.filter((n) => !linked.has(n.id));
  if (isolated.length) {
    const byType = {};
    for (const n of isolated) byType[n.type] = (byType[n.type] || 0) + 1;
    issues.push(issue(
      isolated.length > nodes.length / 2 ? 'warn' : 'info',
      'isolated-nodes',
      `${isolated.length}/${nodes.length} 个逻辑节点尚未建立关系；它们仍可保留在未整理区。`,
      isolated.slice(0, 20).map((n) => n.id),
      { count: isolated.length, byType },
    ));
  }

  const unsupported = nodes.filter((n) => {
    if (!['finding', 'vuln'].includes(n.type) || n.status === 'superseded') return false;
    return !(incoming.get(n.id) || []).some((e) => ['supports', 'proves', 'refines', 'caused-by'].includes(e.kind));
  });
  if (unsupported.length) {
    issues.push(issue(
      'warn', 'unsupported-conclusions',
      `${unsupported.length} 个 finding/vuln 没有显式证据边；这不阻止记录，但会降低可恢复性。`,
      unsupported.slice(0, 20).map((n) => n.id),
      { count: unsupported.length },
    ));
  }

  const cursorId = currentCursor(g);
  const cursor = cursorId ? g.nodes[cursorId] : null;
  if (cursor && ['done', 'dead', 'refuted', 'superseded'].includes(cursor.status)) {
    issues.push(issue('warn', 'stale-cursor', `当前游标停在已结束节点 ${cursor.id} (${cursor.status})。`, [cursor.id]));
  } else if (cursor && !(incoming.get(cursor.id)?.length || outgoing.get(cursor.id)?.length)) {
    issues.push(issue('info', 'isolated-cursor', `当前节点 ${cursor.id} 没有直接逻辑邻域。`, [cursor.id]));
  }

  const danglingSuperseded = nodes.filter((n) => n.status === 'superseded' &&
    ![...(incoming.get(n.id) || []), ...(outgoing.get(n.id) || [])].some((e) => e.kind === 'supersedes'));
  if (danglingSuperseded.length) {
    issues.push(issue(
      'info', 'unexplained-superseded',
      `${danglingSuperseded.length} 个 superseded 节点没有指出替代它的新结论。`,
      danglingSuperseded.map((n) => n.id),
    ));
  }

  const checkpoints = Object.values(g.checkpoints || {}).sort((a, b) => (a.at || 0) - (b.at || 0));
  if (cursor && ['intent', 'question', 'hypothesis'].includes(cursor.type) && ['open', 'active'].includes(cursor.status || 'open')) {
    const closing = checkpoints.find((c) => c.cursorNodeId === cursor.id &&
      /(?:完成|收尾|结束|已确认|已关闭)/.test(String(c.summary || '')));
    if (closing) {
      issues.push(issue(
        'warn', 'checkpoint-status-drift',
        `检查点 ${closing.id} 表示当前方向已经收束，但节点 ${cursor.id} 仍为 ${cursor.status || 'open'}。`,
        [cursor.id], { checkpointId: closing.id },
      ));
    }
  }

  return {
    summary: {
      nodes: nodes.length,
      edges: edges.length,
      issues: issues.length,
      warnings: issues.filter((x) => x.level === 'warn').length,
      infos: issues.filter((x) => x.level === 'info').length,
    },
    issues,
  };
}
