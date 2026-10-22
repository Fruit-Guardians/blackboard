// Blackboard digest: restore the Agent's position and local context without
// prescribing a next action.

import { TYPE_LABEL, EDGE_LABEL, CONFIDENCE_LABEL, currentCursor } from './model.js';
import { readConfig, stats } from './store.js';

function fmtTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function clip(s, n) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

function sorted(values, key = 'ts') {
  return [...values].sort((a, b) => (a[key] || a.at || 0) - (b[key] || b.at || 0));
}

function nodeText(n) {
  const type = TYPE_LABEL[n.type] || n.type;
  const state = n.status ? ` · ${n.status}` : '';
  const confidence = n.confidence ? ` · ${CONFIDENCE_LABEL[n.confidence] || n.confidence}` : '';
  const loc = n.loc ? ` @${n.loc.path}${n.loc.line ? `:${n.loc.line}` : ''}` : '';
  return `[${n.id}] ${type}${state}${confidence}：${clip(n.title, 180)}${loc}`;
}

export function neighborsOf(g, id) {
  if (!id) return [];
  const out = [];
  for (const e of Object.values(g.edges)) {
    if (e.from === id && g.nodes[e.to]) out.push({ direction: 'out', edge: e, node: g.nodes[e.to] });
    else if (e.to === id && g.nodes[e.from]) out.push({ direction: 'in', edge: e, node: g.nodes[e.from] });
  }
  return out.sort((a, b) => (a.edge.ts || 0) - (b.edge.ts || 0));
}

/** Legacy helper retained for callers; follows explicit legacy parent only. */
export function pathTo(g, id, max = 40) {
  const out = [];
  let cur = g.nodes[id];
  const seen = new Set();
  while (cur && out.length < max && !seen.has(cur.id)) {
    seen.add(cur.id);
    out.unshift(cur);
    cur = cur.parent ? g.nodes[cur.parent] : null;
  }
  return out;
}

export function buildDigest(g, cwd = process.cwd(), agentId = 'agent:primary') {
  const cfg = readConfig(cwd);
  const d = cfg.digest || {};
  const s = stats(g);
  const nodes = sorted(Object.values(g.nodes));
  const cursorId = currentCursor(g, agentId);
  const cursor = cursorId ? g.nodes[cursorId] : null;
  const neighbors = neighborsOf(g, cursorId).slice(-(d.maxNeighbors || 16));
  const trail = (g.cursorTrail || [])
    .filter((c) => c.agentId === agentId)
    .slice(-(d.maxTrail || 10));
  const openNodes = nodes.filter((n) =>
    ['intent', 'hypothesis', 'question'].includes(n.type) &&
    ['open', 'active', 'blocked'].includes(n.status || 'open'));
  const checkpoints = sorted(Object.values(g.checkpoints || {}), 'at')
    .filter((c) => c.agentId === agentId)
    .slice(-(d.maxCheckpoints || 6));

  const L = [];
  L.push(`# blackboard 黑板恢复${g.meta.title ? ` — ${g.meta.title}` : ''}`);
  L.push('');
  L.push(
    `逻辑节点 ${s.total} · 逻辑关系 ${s.edges} · 开放节点 ${s.frontier} · ` +
    `原始活动 ${s.activities} · 检查点 ${s.checkpoints}`,
  );
  L.push('');

  L.push('## 当前节点');
  if (cursor) {
    L.push(`- ${nodeText(cursor)}`);
    if (cursor.detail) L.push(`  ${clip(cursor.detail, 300)}`);
  } else {
    L.push('_当前 Agent 尚未设置游标。游标是可选的注意力标记，用 `blackboard cursor <id>` 或创建节点时加 `--enter` 设置；下面改为列出最近活跃的节点。_');
  }
  L.push('');

  if (cursor) {
    L.push('## 当前邻域');
    if (!neighbors.length) {
      L.push('_当前节点还没有直接逻辑关系。_');
    } else {
      for (const { direction, edge, node } of neighbors) {
        const rel = EDGE_LABEL[edge.kind] || edge.kind;
        if (direction === 'out') L.push(`- [${cursorId}] --${rel}--> ${nodeText(node)}`);
        else L.push(`- ${nodeText(node)} --${rel}--> [${cursorId}]`);
      }
    }
    L.push('');
  } else {
    // Without a cursor the digest would otherwise be nearly empty, so show what
    // was touched last, with enough detail and relations to pick the thread up.
    const active = [...nodes].filter((n) => n.status !== 'superseded')
      .sort((a, b) => (b.updated || b.ts || 0) - (a.updated || a.ts || 0))
      .slice(0, d.maxActiveNodes || 8);
    if (active.length) {
      L.push('## 最近活跃节点');
      for (const n of active) {
        L.push(`- ${nodeText(n)}`);
        if (n.detail) L.push(`  ${clip(n.detail, 140)}`);
      }
      L.push('');
      const ids = new Set(active.map((n) => n.id));
      const links = sorted(Object.values(g.edges), 'ts')
        .filter((e) => (ids.has(e.from) || ids.has(e.to)) && g.nodes[e.from] && g.nodes[e.to])
        .slice(-(d.maxNeighbors || 16));
      if (links.length) {
        L.push('## 相关关系');
        for (const e of links) L.push(`- [${e.from}] --${EDGE_LABEL[e.kind] || e.kind}--> [${e.to}]`);
        L.push('');
      }
    }
  }

  L.push('## 最近轨迹');
  if (!trail.length) {
    L.push('_尚无游标移动记录。_');
  } else {
    const ids = [];
    if (trail[0].from) ids.push(trail[0].from);
    for (const c of trail) if (c.to) ids.push(c.to);
    L.push(`- ${ids.join(' → ') || '（游标已清空）'}`);
    for (const c of trail.filter((x) => x.reason).slice(-4)) {
      L.push(`  - ${fmtTime(c.at)} → ${c.to || 'none'}：${clip(c.reason, 140)}`);
    }
  }
  L.push('');

  L.push('## 开放节点');
  if (!openNodes.length) {
    L.push('_没有显式标记为开放的意图、猜测或问题。_');
  } else {
    for (const n of openNodes.slice(-(d.maxOpenNodes || 16))) L.push(`- ${nodeText(n)}`);
  }
  L.push('');

  if (checkpoints.length) {
    L.push('## 最近检查点');
    for (const c of checkpoints) {
      const at = c.cursorNodeId ? ` @${c.cursorNodeId}` : '';
      L.push(`- [${c.id}] ${fmtTime(c.at)}${at} ${clip(c.summary || '无摘要', 180)}`);
    }
    L.push('');
  }

  const recent = cursor ? nodes.filter((n) => n.id !== cursorId && n.status !== 'superseded').slice(-10) : [];
  if (recent.length) {
    L.push('## 最近逻辑节点');
    for (const n of recent) L.push(`- ${nodeText(n)}`);
    L.push('');
  }

  L.push('_此摘要只恢复黑板现场，不替 Agent 决定下一步。逻辑关系与游标轨迹相互独立。_');
  return L.join('\n');
}

/** Each identity gets its own read-only recovery projection, including offline exports. */
export function buildAgentDigests(g, cwd = process.cwd()) {
  const identities = new Set(['agent:primary', ...Object.keys(g.cursors || {})]);
  for (const checkpoint of Object.values(g.checkpoints || {})) {
    if (checkpoint.agentId) identities.add(checkpoint.agentId);
  }
  return Object.fromEntries([...identities].map((agentId) => [agentId, buildDigest(g, cwd, agentId)]));
}

/** One-line status pointer. */
export function tail(g, agentId = 'agent:primary') {
  const s = stats(g);
  const cursor = currentCursor(g, agentId);
  return `${s.total}节点 · ${s.edges}关系 · 开放 ${s.frontier} · 活动 ${s.activities}${
    cursor ? ` · 当前 ${cursor}` : ''
  }`;
}
