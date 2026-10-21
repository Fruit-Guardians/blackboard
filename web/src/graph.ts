import ELK, { type ElkExtendedEdge } from 'elkjs/lib/elk.bundled.js';
import type { Edge, Node } from '@xyflow/react';
import type { EdgeRoute } from './edge-route';
import type { BoardEdge, BoardNode, GraphSnapshot, ViewMode } from './types';
import { values } from './types';
import { matchesNode, presentNode } from './presentation';
import { BOARD_GROUPS, groupFor } from './canvas-state';
export { typeLabel } from './presentation';

export const NODE_W = 288;
export const NODE_H = 128;
export const NODE_H_TITLE = 88;

const elk = new ELK();

export type CanvasNodeData = Record<string, unknown> & {
  item: BoardNode;
  current: boolean;
  dimmed: boolean;
  degree: number;
  compact?: boolean;
  group?: boolean;
  muted?: boolean;
  fresh?: boolean;
  groupCount?: number;
  groupSubtitle?: string;
  groupColor?: string;
  direction?: 'RIGHT' | 'DOWN';
};

export type CanvasNode = Node<CanvasNodeData, 'security' | 'boardGroup'>;

export const currentNodeId = (snapshot: GraphSnapshot): string | null =>
  snapshot.cursors?.['agent:primary']?.to ||
  snapshot.meta?.focus ||
  Object.values(snapshot.cursors || {})[0]?.to ||
  null;

function contextIds(snapshot: GraphSnapshot, nodes: BoardNode[], edges: BoardEdge[]) {
  const ids = new Set<string>();
  const current = currentNodeId(snapshot);
  const adjacency = new Map(nodes.map((node) => [node.id, [] as string[]]));
  for (const edge of edges) {
    adjacency.get(edge.from)?.push(edge.to);
    adjacency.get(edge.to)?.push(edge.from);
  }

  if (current && adjacency.has(current)) {
    ids.add(current);
    let wave = [current];
    for (let depth = 0; depth < 1; depth += 1) {
      const next: string[] = [];
      for (const id of wave) {
        for (const neighbor of adjacency.get(id) || []) {
          if (!ids.has(neighbor)) {
            ids.add(neighbor);
            next.push(neighbor);
          }
        }
      }
      wave = next;
    }
  }

  nodes.forEach((node) => {
    if (node.type === 'goal') ids.add(node.id);
    if (['intent', 'hypothesis', 'question'].includes(node.type) &&
      ['open', 'active', 'blocked', undefined].includes(node.status)) ids.add(node.id);
  });

  // 现场只展开当前节点的一跳邻域；完整推理路径留给逻辑视图。
  // “当前现场”必须是一张可读的工作台，而不是缩小版全局图。仅补充最高风险
  // 发现和少量最近节点；完整发现仍可从左栏或“全局图”进入。
  nodes
    .filter((node) => ['finding', 'vuln'].includes(node.type) && ['critical', 'high'].includes(node.severity || ''))
    .slice(0, 3)
    .forEach((node) => ids.add(node.id));
  [...nodes].sort((a, b) => Number(b.ts || 0) - Number(a.ts || 0)).slice(0, 3).forEach((node) => ids.add(node.id));
  return ids;
}

export function project(snapshot: GraphSnapshot, mode: ViewMode, query: string) {
  const allNodes = values(snapshot.nodes);
  const existing = new Set(allNodes.map((node) => node.id));
  const allEdges = values(snapshot.edges).filter((edge) => existing.has(edge.from) && existing.has(edge.to));
  const linked = new Set(allEdges.flatMap((edge) => [edge.from, edge.to]));
  const visibleIds = mode === 'all'
    ? new Set(allNodes.map((node) => node.id))
    : mode === 'logic'
      ? linked
      : contextIds(snapshot, allNodes, allEdges);
  const nodes = allNodes.filter((node) => visibleIds.has(node.id));
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = allEdges.filter((edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to));
  const degree = new Map<string, number>();
  edges.forEach((edge) => {
    degree.set(edge.from, (degree.get(edge.from) || 0) + 1);
    degree.set(edge.to, (degree.get(edge.to) || 0) + 1);
  });
  const q = query.trim();
  const current = currentNodeId(snapshot);

  const flowNodes: CanvasNode[] = nodes.map((item) => ({
    id: item.id,
    type: 'security',
    position: { x: 0, y: 0 },
    style: { width: NODE_W, height: presentNode(item).summary ? NODE_H : NODE_H_TITLE },
    data: {
      item,
      current: item.id === current,
      dimmed: Boolean(q) && !matchesNode(item, q),
      degree: degree.get(item.id) || 0,
    },
  }));

  const flowEdges: Edge[] = edges.map((edge) => {
    const important = ['proves', 'supports', 'contradicts', 'supersedes', 'resolves'].includes(edge.kind);
    const group = relationGroup(edge.kind);
    return {
      id: edge.id,
      source: edge.from,
      target: edge.to,
      type: 'default',
      label: important ? relationLabel(edge.kind) : undefined,
      className: `edge edge-${edge.kind} edge-g-${group}`,
      data: { kind: edge.kind, group },
      animated: false,
      markerEnd: { type: 'arrowclosed' as const, width: 12, height: 12, color: `var(--edge-${group})` },
      style: { strokeWidth: important ? 1.5 : 1.25 },
    };
  });

  return { nodes: flowNodes, edges: flowEdges, hidden: allNodes.length - nodes.length };
}

export async function layoutGraph(nodes: CanvasNode[], edges: Edge[], direction: 'RIGHT' | 'DOWN' = 'RIGHT', grouped = false, overviewColumns: 1 | 2 = 2) {
  if (!nodes.length) return { nodes, edges };
  if (grouped) return layoutOverview(nodes, edges, overviewColumns);
  try {
    return await elkLayout(nodes, edges, direction);
  } catch {
    // A layout engine failure must never leave the board blank.
    return gridLayout(nodes, edges, direction);
  }
}

/** Plain left-to-right grid; used only when ELK cannot lay the graph out. */
export function gridLayout(nodes: CanvasNode[], edges: Edge[], direction: 'RIGHT' | 'DOWN' = 'RIGHT') {
  const columns = Math.max(1, Math.ceil(Math.sqrt(nodes.length)));
  const rowHeight = NODE_H + 40;
  return {
    nodes: nodes.map((node, index) => ({
      ...node,
      data: { ...node.data, direction },
      position: { x: (index % columns) * (NODE_W + 48), y: Math.floor(index / columns) * rowHeight },
    })),
    edges,
  };
}

async function elkLayout(nodes: CanvasNode[], edges: Edge[], direction: 'RIGHT' | 'DOWN') {
  const result = await elk.layout({
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': direction,
      'elk.spacing.nodeNode': '36',
      'elk.layered.spacing.nodeNodeBetweenLayers': '96',
      'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
      'elk.edgeRouting': 'ORTHOGONAL',
    },
    children: nodes.map((node) => {
      const type = node.data.item.type;
      const layerConstraint = ['goal', 'start'].includes(type)
        ? 'FIRST'
        : ['finding', 'vuln'].includes(type) ? 'LAST' : undefined;
      return {
        id: node.id,
        width: NODE_W,
        height: Number(node.style?.height || NODE_H),
        ...(layerConstraint ? { layoutOptions: { 'org.eclipse.elk.layered.layering.layerConstraint': layerConstraint } } : {}),
      };
    }),
    edges: edges.map((edge) => ({ id: edge.id, sources: [edge.source], targets: [edge.target] })),
  });
  const positions = new Map((result.children || []).map((node) => [node.id, node]));
  const sections = new Map(((result.edges || []) as ElkExtendedEdge[]).map((edge) => [edge.id, edge.sections?.[0]]));
  const at = (id: string) => ({ x: positions.get(id)?.x || 0, y: positions.get(id)?.y || 0 });
  return {
    nodes: nodes.map((node) => ({ ...node, data: { ...node.data, direction }, position: at(node.id) })),
    // ELK's own routes keep long edges clear of the nodes between their ends.
    edges: edges.map((edge) => {
      const section = sections.get(edge.id);
      if (!section) return edge;
      const route: EdgeRoute = {
        points: [section.startPoint, ...(section.bendPoints || []), section.endPoint].map(({ x, y }) => ({ x, y })),
        source: at(edge.source), target: at(edge.target), direction,
      };
      return { ...edge, data: { ...edge.data, route } };
    }),
  };
}

/** Relation kinds fall into six families; each family has one colour and stroke in the UI. */
export type RelationGroup = 'support' | 'oppose' | 'derive' | 'produce' | 'replace' | 'link';
export const RELATION_GROUPS: { id: RelationGroup; label: string }[] = [
  { id: 'support', label: '证实' }, { id: 'oppose', label: '反驳' }, { id: 'derive', label: '推导' },
  { id: 'produce', label: '产出' }, { id: 'replace', label: '取代' }, { id: 'link', label: '关联' },
];
const GROUP_OF: Record<string, RelationGroup> = {
  proves: 'support', prove: 'support', supports: 'support',
  contradicts: 'oppose',
  'derived-from': 'derive', derive: 'derive', refines: 'derive', 'caused-by': 'derive', 'depends-on': 'derive', 'intent-chain': 'derive',
  produce: 'produce', resolves: 'produce',
  supersedes: 'replace', duplicates: 'replace',
};
export const relationGroup = (kind: string): RelationGroup => GROUP_OF[kind] || 'link';

/** How connections are drawn; the layout itself is unaffected. */
export type EdgeStyle = 'curve' | 'step' | 'straight';

export function relationLabel(kind: string) {
  return ({
    proves: '证明', prove: '证明', supports: '支持', contradicts: '反驳',
    supersedes: '取代', resolves: '解决', 'derived-from': '派生',
    'depends-on': '依赖', 'caused-by': '因果', refines: '细化',
    'related-to': '相关', produce: '产出',
  } as Record<string, string>)[kind] || kind;
}

export function formatTime(value?: number) {
  if (!value || !Number.isFinite(value) || !Number.isFinite(new Date(value).getTime())) return '—';
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(value));
}

/** A display-only catalogue. Group frames never enter the persisted graph. */
export function layoutOverview(nodes: CanvasNode[], edges: Edge[], overviewColumns: 1 | 2 = 2) {
  const connected = new Set(edges.flatMap((edge) => [edge.source, edge.target]));
  const groups = BOARD_GROUPS.map((group) => ({ ...group, nodes: nodes.filter((node) => groupFor(node.data.item, connected) === group.id) })).filter((group) => group.nodes.length);
  const W = 240, H = 112, gap = 22, pad = 28, top = 90;
  const frames: CanvasNode[] = [], children: CanvasNode[] = [];
  const columns = [0, 0];
  const groupColumns = (size: number) => Math.min(4, Math.max(2, Math.ceil(Math.sqrt(size))));
  const widths = [0, 0];
  groups.forEach((group, i) => { const count = groupColumns(group.nodes.length); widths[i % overviewColumns] = Math.max(widths[i % overviewColumns], pad * 2 + count * W + (count - 1) * gap); });
  for (const [index, group] of groups.entries()) {
    const col = index % overviewColumns;
    const count = groupColumns(group.nodes.length);
    const width = widths[col];
    const height = top + Math.ceil(group.nodes.length / count) * (H + gap) - gap + pad;
    const id = `__display_group_${group.id}`;
    frames.push({ id, type: 'boardGroup', position: { x: col ? widths[0] + 56 : 0, y: columns[col] }, style: { width, height }, draggable: false, selectable: false, focusable: false,
      data: { item: { id, type: 'display-group', title: group.title }, current: false, dimmed: false, degree: 0, group: true, groupCount: group.nodes.length, groupSubtitle: group.subtitle, groupColor: group.color }, zIndex: -1 });
    group.nodes.forEach((node, i) => children.push({ ...node, parentId: id, extent: 'parent', position: { x: pad + (i % count) * (W + gap), y: top + Math.floor(i / count) * (H + gap) }, style: { width: W, height: H }, data: { ...node.data, compact: true, direction: 'RIGHT' } }));
    columns[col] += height + 56;
  }
  return { nodes: [...frames, ...children], edges };
}
