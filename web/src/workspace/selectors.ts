import { currentNodeId } from '../graph';
import type { Activity, BoardEdge, BoardNode, GraphSnapshot } from '../types';
import { values } from '../types';

const severityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
const compareAgents = (a: string, b: string) => a === 'agent:primary' ? -1 : b === 'agent:primary' ? 1 : a.localeCompare(b);
const count = (counts: Map<string, number>, value: string) => counts.set(value, (counts.get(value) || 0) + 1);
const options = (counts: Map<string, number>) => [...counts].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count);

type FilterOption = { value: string; count: number };

export type WorkspaceSnapshot = {
  allNodes: BoardNode[];
  allEdges: BoardEdge[];
  activities: Activity[];
  byId: Map<string, BoardNode>;
  findings: BoardNode[];
  openItems: BoardNode[];
  inbox: BoardNode[];
  agentIds: string[];
  paletteNodes: BoardNode[];
  filterOptions: { types: FilterOption[]; statuses: FilterOption[]; confidences: FilterOption[]; riskCount: number };
  counts: { nodes: number; edges: number; risk: number; open: number; candidates: number };
};

/** Snapshot-wide indexes and catalogues stay independent of selection, filters and Agent perspective. */
export function selectWorkspaceSnapshot(snapshot: GraphSnapshot | null): WorkspaceSnapshot {
  const allNodes = values(snapshot?.nodes);
  const allEdges = values(snapshot?.edges);
  const activities = Array.isArray(snapshot?.activities) ? [...snapshot.activities] : values(snapshot?.activities);
  activities.sort((a, b) => Number(b.at || 0) - Number(a.at || 0));

  const linked = new Set<string>();
  for (const edge of allEdges) {
    linked.add(edge.from);
    linked.add(edge.to);
  }
  const byId = new Map<string, BoardNode>();
  const findings: BoardNode[] = [];
  const openItems: BoardNode[] = [];
  const inbox: BoardNode[] = [];
  const types = new Map<string, number>();
  const statuses = new Map<string, number>();
  const confidences = new Map<string, number>();
  let riskCount = 0;
  for (const node of allNodes) {
    byId.set(node.id, node);
    count(types, node.type);
    count(statuses, node.status || '');
    count(confidences, node.confidence || '');
    if (node.severity === 'critical' || node.severity === 'high') riskCount += 1;
    if ((node.type === 'finding' || node.type === 'vuln') && node.status !== 'superseded') findings.push(node);
    // Same notion of open as stats.frontier / context.openThreads (deferred is closed).
    if ((node.type === 'intent' || node.type === 'hypothesis' || node.type === 'question') &&
      ['open', 'active', 'blocked'].includes(node.status || 'open')) openItems.push(node);
    if (!linked.has(node.id)) inbox.push(node);
  }
  findings.sort((a, b) => (severityOrder[a.severity || 'info'] ?? 5) - (severityOrder[b.severity || 'info'] ?? 5));
  openItems.reverse();
  inbox.reverse();

  const agents = new Set(['agent:primary', ...Object.keys(snapshot?.cursors || {})]);
  for (const checkpoint of values(snapshot?.checkpoints)) {
    if (checkpoint.agentId) agents.add(checkpoint.agentId);
  }
  const stats = snapshot?.stats;
  return {
    allNodes, allEdges, activities, byId, findings, openItems, inbox,
    agentIds: [...agents].sort(compareAgents),
    paletteNodes: [...allNodes].sort((a, b) => Number(b.ts || 0) - Number(a.ts || 0)),
    filterOptions: { types: options(types), statuses: options(statuses), confidences: options(confidences), riskCount },
    counts: {
      nodes: allNodes.length,
      edges: allEdges.length,
      risk: Number(stats?.vulns?.critical || 0) + Number(stats?.vulns?.high || 0),
      open: Number(stats?.frontier || 0),
      candidates: Number(stats?.candidates || 0),
    },
  };
}

/** An explicit identity keeps its own cursor and digest, including before its first recorded write. */
export function selectWorkspaceAgent(snapshot: GraphSnapshot | null, board: WorkspaceSnapshot, agentId: string) {
  const currentId = snapshot ? currentNodeId(snapshot, agentId) : null;
  return {
    currentId,
    current: currentId ? board.byId.get(currentId) || null : null,
    agentIds: board.agentIds.includes(agentId) ? board.agentIds : [...board.agentIds, agentId].sort(compareAgents),
    digest: snapshot?.digests?.[agentId] ?? (agentId === 'agent:primary' ? snapshot?.digest || '' : ''),
    findings: currentId ? board.findings.filter((node) => node.id !== currentId) : board.findings,
    openItems: currentId ? board.openItems.filter((node) => node.id !== currentId) : board.openItems,
  };
}
