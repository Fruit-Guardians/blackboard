import type ELK from 'elkjs/lib/elk-api';
import type { ElkExtendedEdge } from 'elkjs/lib/elk-api';
import type { Edge, Node } from '@xyflow/react';
import type { EdgeRoute } from './edge-route';
import type { BoardEdge, BoardNode, GraphSnapshot, ViewMode } from './types';
import { values } from './types';
import { matchesNode, presentNode } from './presentation';
import { BOARD_GROUPS, groupFor } from './canvas-state';
import { locale, t, tOptional } from './i18n';
export { typeLabel } from './presentation';

export const NODE_W = 288;
export const NODE_H = 128;
export const NODE_H_TITLE = 88;

type ElkEngine = InstanceType<typeof ELK>;
let elk: ElkEngine | undefined;
let layoutRuns = 0;

/**
 * The layout engine is injected so the 1.4 MB ELK runs in a Web Worker (or, in tests, in-process)
 * instead of being bundled into this module and blocking the page while a large board lays out.
 * Without an engine the board falls back to the plain grid.
 */
export function configureElk(factory: () => ElkEngine) {
  elk = factory();
}

export type CanvasNodeData = Record<string, unknown> & {
  item: BoardNode;
  current: boolean;
  dimmed: boolean;
  degree: number;
  compact?: boolean;
  group?: boolean;
  muted?: boolean;
  fresh?: boolean;
  /** Other Agents whose cursor is on this card (the selected Agent is shown as "current"). */
  agents?: string[];
  groupCount?: number;
  groupSubtitle?: string;
  groupColor?: string;
  direction?: 'RIGHT' | 'DOWN';
  /** The layout run that placed this card; see EdgeRoute.run. */
  layoutRun?: number;
};

export type CanvasNode = Node<CanvasNodeData, 'security' | 'boardGroup'>;

export const currentNodeId = (snapshot: GraphSnapshot, agentId = 'agent:primary'): string | null => {
  const id = snapshot.cursors?.[agentId]?.to || (agentId === 'agent:primary' ? snapshot.meta?.focus : null);
  return id && (Array.isArray(snapshot.nodes) ? snapshot.nodes.some((node) => node.id === id) : snapshot.nodes[id]) ? id : null;
};

function contextIds(snapshot: GraphSnapshot, nodes: BoardNode[], edges: BoardEdge[], agentId: string) {
  const ids = new Set<string>();
  const current = currentNodeId(snapshot, agentId);
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
      ['open', 'active', 'blocked', undefined].includes(node.status ?? undefined)) ids.add(node.id);
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

export function project(snapshot: GraphSnapshot, mode: ViewMode, query: string, agentId = 'agent:primary') {
  const allNodes = values(snapshot.nodes);
  const existing = new Set(allNodes.map((node) => node.id));
  const allEdges = values(snapshot.edges).filter((edge) => existing.has(edge.from) && existing.has(edge.to));
  const linked = new Set(allEdges.flatMap((edge) => [edge.from, edge.to]));
  const visibleIds = mode === 'all'
    ? new Set(allNodes.map((node) => node.id))
    : mode === 'logic'
      ? linked
      : contextIds(snapshot, allNodes, allEdges, agentId);
  const nodes = allNodes.filter((node) => visibleIds.has(node.id));
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = allEdges.filter((edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to));
  const degree = new Map<string, number>();
  edges.forEach((edge) => {
    degree.set(edge.from, (degree.get(edge.from) || 0) + 1);
    degree.set(edge.to, (degree.get(edge.to) || 0) + 1);
  });
  const q = query.trim();
  const current = currentNodeId(snapshot, agentId);

  const watching = new Map<string, string[]>();
  for (const cursor of Object.values(snapshot.cursors || {})) {
    if (!cursor.to || cursor.agentId === agentId) continue;
    watching.set(cursor.to, [...(watching.get(cursor.to) || []), cursor.agentId.replace(/^agent:/, '')]);
  }

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
      agents: watching.get(item.id),
    },
  }));

  // A weak relation is only drawn without a selection when it is all that ties one of its cards to the board.
  const strong = new Set(edges.filter((edge) => !WEAK_RELATIONS.has(edge.kind)).flatMap((edge) => [edge.from, edge.to]));
  const flowEdges: Edge[] = edges.map((edge) => {
    const important = ['proves', 'supports', 'contradicts', 'supersedes', 'resolves'].includes(edge.kind);
    const quiet = WEAK_RELATIONS.has(edge.kind) && strong.has(edge.from) && strong.has(edge.to);
    const group = relationGroup(edge.kind);
    // Passive relations ("conclusion derived-from premise") are laid out premise-first so the board
    // always reads left to right; the arrowhead stays on the relation's own `to` end.
    const reversed = PREMISE_IS_TARGET.has(edge.kind);
    const marker = { type: 'arrowclosed' as const, width: 12, height: 12, color: `var(--edge-${group})` };
    return {
      id: edge.id,
      source: reversed ? edge.to : edge.from,
      target: reversed ? edge.from : edge.to,
      type: 'default',
      label: relationLabel(edge.kind),
      className: `edge edge-${edge.kind} edge-g-${group}`,
      data: { kind: edge.kind, group, reversed, quiet, text: relationLabel(edge.kind) },
      animated: false,
      ...(reversed ? { markerStart: marker } : { markerEnd: marker }),
      style: { strokeWidth: important ? 1.5 : 1.25, strokeDasharray: RELATION_DASH[group] },
    };
  });

  return { nodes: flowNodes, edges: flowEdges, hidden: allNodes.length - nodes.length };
}

export type Positions = ReadonlyMap<string, { x: number; y: number }>;

/**
 * `previous` is where the same view last placed each node. It keeps a growing board steady: cards
 * that already existed keep their order within each column instead of being reshuffled.
 */
export async function layoutGraph(nodes: CanvasNode[], edges: Edge[], direction: 'RIGHT' | 'DOWN' = 'RIGHT', grouped = false, overviewColumns: 1 | 2 = 2, previous?: Positions) {
  if (!nodes.length) return { nodes, edges };
  if (grouped) return layoutOverview(nodes, edges, overviewColumns);
  try {
    return await elkLayout(nodes, edges, direction, previous);
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

/** Relations written "conclusion <kind> premise": the premise is the edge's `to`. */
const PREMISE_IS_TARGET = new Set(['derived-from', 'depends-on', 'caused-by', 'refines', 'supersedes']);

/** Weak links yield: evidence and derivation chains get the straight, short, left-to-right lines. */
const WEAK_RELATIONS = new Set(['related-to', 'duplicates']);
const edgePriority = (kind: string) => {
  const value = WEAK_RELATIONS.has(kind) ? '0' : '10';
  return {
    'elk.layered.priority.direction': value,
    'elk.layered.priority.shortness': value,
    'elk.layered.priority.straightness': value,
  };
};

/**
 * Network-simplex placement draws the straightest lines but grows steeply with the board
 * (≈0.6 s at 120 cards, ≈40 s at 400). Larger boards switch to Brandes–Köpf, which stays around
 * a second even at 1000 cards, and spend less effort on crossing minimisation.
 */
export function placementFor(count: number) {
  if (count <= 120) return { 'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX', 'elk.layered.thoroughness': '40' };
  if (count <= 400) return { 'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF', 'elk.layered.thoroughness': '20' };
  return { 'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF', 'elk.layered.thoroughness': '7' };
}

async function elkLayout(nodes: CanvasNode[], edges: Edge[], direction: 'RIGHT' | 'DOWN', previous?: Positions) {
  const across = direction === 'RIGHT';
  const hasIncoming = new Set(edges.map((edge) => edge.target));
  const inSide = across ? 'WEST' : 'NORTH';
  const outSide = across ? 'EAST' : 'SOUTH';
  // Every edge end gets its own port on the node's input or output side. Edges sharing a single
  // port are merged by ELK into one hyperedge, transitively, so unrelated relations would be drawn
  // on top of each other; separate ports keep every relation traceable on its own line.
  const ports = new Map<string, { id: string; layoutOptions: Record<string, string> }[]>();
  const addPort = (node: string, id: string, side: string) => {
    if (!ports.has(node)) ports.set(node, []);
    ports.get(node)!.push({ id, layoutOptions: { 'elk.port.side': side } });
  };
  for (const edge of edges) {
    addPort(edge.source, `${edge.id}::out`, outSide);
    addPort(edge.target, `${edge.id}::in`, inSide);
  }
  // Creation order makes the first layout of a board deterministic.
  const ordered = [...nodes].sort((a, b) => Number(a.data.item.ts || 0) - Number(b.data.item.ts || 0));
  if (!elk) throw new Error('no layout engine configured');
  const result = await elk.layout({
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': direction,
      'elk.spacing.nodeNode': '36',
      'elk.layered.spacing.nodeNodeBetweenLayers': '96',
      'elk.layered.spacing.edgeEdgeBetweenLayers': '14',
      'elk.layered.spacing.edgeNodeBetweenLayers': '28',
      'elk.spacing.portPort': '14',
      ...placementFor(nodes.length),
      // With previous positions, ELK keeps known nodes in their old order within a layer and only
      // fits new nodes in; crossings are still minimised around them.
      'elk.layered.crossingMinimization.semiInteractive': previous ? 'true' : 'false',
      'elk.edgeRouting': 'ORTHOGONAL',
    },
    children: ordered.map((node) => {
      // Roots of the reasoning (goals, entry points) start the board unless something points into them.
      const first = ['goal', 'start'].includes(node.data.item.type) && !hasIncoming.has(node.id);
      const was = previous?.get(node.id);
      return {
        id: node.id,
        width: NODE_W,
        height: Number(node.style?.height || NODE_H),
        ports: (ports.get(node.id) || []).map((port) => ({ ...port, width: 0, height: 0 })),
        layoutOptions: {
          // ELK may reorder ports along a side to avoid crossings, but keeps them on that side.
          'elk.portConstraints': 'FIXED_SIDE',
          'elk.portAlignment.default': 'CENTER',
          ...(first ? { 'elk.layered.layering.layerConstraint': 'FIRST' } : {}),
          ...(was ? { 'elk.position': `(${was.x},${was.y})` } : {}),
        },
      };
    }),
    edges: edges.map((edge) => ({
      id: edge.id, sources: [`${edge.id}::out`], targets: [`${edge.id}::in`],
      layoutOptions: edgePriority(String((edge.data as { kind?: string } | undefined)?.kind || 'related-to')),
    })),
  });
  const run = ++layoutRuns;
  const positions = new Map((result.children || []).map((node) => [node.id, node]));
  const sections = new Map(((result.edges || []) as ElkExtendedEdge[]).map((edge) => [edge.id, edge.sections?.[0]]));
  const at = (id: string) => ({ x: positions.get(id)?.x || 0, y: positions.get(id)?.y || 0 });
  return {
    nodes: nodes.map((node) => ({ ...node, data: { ...node.data, direction, layoutRun: run }, position: at(node.id) })),
    // ELK's own routes keep long edges clear of the nodes between their ends.
    edges: edges.map((edge) => {
      const section = sections.get(edge.id);
      if (!section) return edge;
      const route: EdgeRoute = {
        points: [section.startPoint, ...(section.bendPoints || []), section.endPoint].map(({ x, y }) => ({ x, y })),
        source: at(edge.source), target: at(edge.target), direction, run,
      };
      return { ...edge, data: { ...edge.data, route } };
    }),
  };
}

/** Relation kinds fall into six families; each family has one colour and stroke in the UI. */
export type RelationGroup = 'support' | 'oppose' | 'derive' | 'produce' | 'replace' | 'link';
export const RELATION_GROUPS: { id: RelationGroup; label: string }[] = [
  { id: 'support', label: t('relationGroup.support') }, { id: 'oppose', label: t('relationGroup.oppose') }, { id: 'derive', label: t('relationGroup.derive') },
  { id: 'produce', label: t('relationGroup.produce') }, { id: 'replace', label: t('relationGroup.replace') }, { id: 'link', label: t('relationGroup.link') },
];
const GROUP_OF: Record<string, RelationGroup> = {
  proves: 'support', prove: 'support', supports: 'support',
  contradicts: 'oppose',
  'derived-from': 'derive', derive: 'derive', refines: 'derive', 'caused-by': 'derive', 'depends-on': 'derive', 'intent-chain': 'derive',
  produce: 'produce', resolves: 'produce',
  supersedes: 'replace', duplicates: 'replace',
};
export const relationGroup = (kind: string): RelationGroup => GROUP_OF[kind] || 'link';

/** Colour alone is not enough to tell the families apart, so each also has its own stroke pattern. */
export const RELATION_DASH: Record<RelationGroup, string | undefined> = {
  support: undefined,
  oppose: '5 4',
  derive: '10 3 2 3',
  produce: '10 4',
  replace: '2 6',
  link: '1 3',
};

/** How connections are drawn; the layout itself is unaffected. */
export type EdgeStyle = 'curve' | 'step' | 'straight';

export function relationLabel(kind: string) {
  return tOptional(`relation.${kind}`) || kind;
}

export function formatTime(value?: number) {
  if (!value || !Number.isFinite(value) || !Number.isFinite(new Date(value).getTime())) return '—';
  return new Intl.DateTimeFormat(locale, {
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
