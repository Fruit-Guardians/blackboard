import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Background, BackgroundVariant, MiniMap, ReactFlow, ReactFlowProvider, getNodesBounds, getViewportForBounds,
  useEdgesState, useNodesInitialized, useNodesState, useReactFlow, useUpdateNodeInternals,
  type Edge, type NodeMouseHandler, type OnNodesChange,
} from '@xyflow/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { BoardGroup } from './BoardGroup';
import { BrandMark } from './BrandMark';
import { SecurityNode } from './SecurityNode';
import { focusedIds, frameStrategy, neighborInDirection, pickFocus, type ArrowKey } from './canvas-state';
import { exportCanvasPng } from './export-image';
import { RoutedEdge } from './RoutedEdge';
import { currentNodeId, layoutGraph, NODE_H, NODE_W, project, typeLabel as typeLabelOf, type CanvasNode, type EdgeStyle, type Positions, type RelationGroup } from './graph';
import { EMPTY_FILTER, filterActive, filterNodes, type NodeFilter } from './presentation';
import type { ViewMode } from './types';
import { values } from './types';
import { useGraphStream } from './use-graph-stream';
import { usePref } from './use-pref';
import { CanvasToolbar } from './panels/CanvasToolbar';
import { CommandPalette } from './panels/CommandPalette';
import { DigestDialog } from './panels/DigestDialog';
import { EmptyBoard } from './panels/EmptyBoard';
import { Legend } from './panels/Legend';
import { ShortcutsDialog } from './panels/ShortcutsDialog';
import { Inspector } from './panels/Inspector';
import { NewNodeDialog } from './panels/EditPanel';
import { Sidebar } from './panels/Sidebar';
import { Topbar } from './panels/Topbar';
import { locale, t } from './i18n';
import { SessionDrafts } from './session-drafts';

const nodeTypes = { security: SecurityNode, boardGroup: BoardGroup };
const edgeTypes = { routed: RoutedEdge };
const severityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
const INSPECTOR_W = 372;
/** Colour of a focused edge's arrowhead: its relation family, or ink when unclassified. */
const focusColor = (group?: string) => group && group !== 'link' ? `var(--rel-${group})` : 'var(--ink)';
const THEME_KEY = 'blackboard-theme-v3';

const initialTheme = (): 'light' | 'dark' => {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === 'dark' || saved === 'light') return saved;
  } catch { /* storage can be unavailable in sandboxed exports */ }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
};

function Workspace() {
  const { snapshot, connection, syncedAt, isStatic, reload } = useGraphStream();
  const [agentId, setAgentId] = useState(() => new URLSearchParams(location.search).get('agent') || 'agent:primary');
  const [mode, setMode] = useState<ViewMode>(() => {
    const view = new URLSearchParams(location.search).get('view');
    return view === 'logic' || view === 'all' ? view : 'context';
  });
  const [theme, setTheme] = useState<'light' | 'dark'>(initialTheme);
  const [direction, setDirection] = usePref<'RIGHT' | 'DOWN'>('direction', 'RIGHT');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(() => window.matchMedia('(min-width: 1024px)').matches);
  const [showMap, setShowMap] = usePref('minimap', false);
  // Closed by default: it covers cards, and the toolbar opens it when a reader wants the key.
  const [showLegend, setShowLegend] = usePref('legend-open', false);
  const [edgeStyle, setEdgeStyle] = usePref<EdgeStyle>('edge-style', 'curve');
  const [follow, setFollow] = usePref('follow', false);
  const [fresh, setFresh] = useState<ReadonlySet<string>>(new Set());
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [digestOpen, setDigestOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [filter, setFilter] = useState<NodeFilter>(EMPTY_FILTER);
  const [notice, setNotice] = useState<string | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [offlineShown, setOfflineShown] = useState(false);
  const [copied, setCopied] = useState(false);
  const [overviewColumns, setOverviewColumns] = useState<1 | 2>(() => window.innerWidth > 1100 ? 2 : 1);
  const [layoutRevision, setLayoutRevision] = useState(0);
  const [laying, setLaying] = useState(0);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const digestTrigger = useRef<HTMLButtonElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const layoutKey = useRef('');
  // Identity cache for display nodes: see displayNodes below.
  const displayNodesCache = useRef(new Map<string, { source: CanvasNode; built: CanvasNode }>());
  const lastPositions = useRef(new Map<string, Positions>());
  const pendingFocus = useRef<string | null>(null);
  const framedRevision = useRef(0);
  const stamps = useRef<Map<string, number> | null>(null);
  const freshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const linkTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const deepLink = useRef<string | null>(new URLSearchParams(location.search).get('node'));
  const lastCurrent = useRef<string | null>(null);
  const live = useRef({ follow: false, currentId: null as string | null, selectedId: null as string | null });
  const initialized = useNodesInitialized();
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 350;
  const [nodes, setNodes, onNodesChange] = useNodesState<CanvasNode>([]);
  const [edges, setEdges] = useEdgesState<Edge>([]);
  const { fitView, getNode, getNodes, setCenter } = useReactFlow<CanvasNode>();
  const updateNodeInternals = useUpdateNodeInternals();
  const laidOutDirection = useRef<string | null>(null);

  const projection = useMemo(() => snapshot ? project(snapshot, mode, '', agentId) : null, [snapshot, mode, agentId]);
  const agentIds = useMemo(() => {
    const ids = new Set(['agent:primary', ...Object.keys(snapshot?.cursors || {})]);
    values(snapshot?.checkpoints).forEach((checkpoint) => { if (checkpoint.agentId) ids.add(checkpoint.agentId); });
    // Keep an explicit URL identity selected even before that Agent has a cursor or checkpoint.
    ids.add(agentId);
    return [...ids].sort((a, b) => a === 'agent:primary' ? -1 : b === 'agent:primary' ? 1 : a.localeCompare(b));
  }, [snapshot, agentId]);
  const digest = snapshot?.digests?.[agentId] ?? (agentId === 'agent:primary' ? snapshot?.digest || '' : '');

  useEffect(() => {
    setCopied(false);
    clearTimeout(copyTimer.current ?? undefined);
  }, [digest, agentId]);

  const allNodes = useMemo(() => snapshot ? values(snapshot.nodes) : [], [snapshot]);
  const allEdges = useMemo(() => snapshot ? values(snapshot.edges) : [], [snapshot]);
  const activities = useMemo(() => snapshot ? values(snapshot.activities).sort((a, b) => Number(b.at || 0) - Number(a.at || 0)) : [], [snapshot]);
  const byId = useMemo(() => new Map(allNodes.map((node) => [node.id, node])), [allNodes]);
  const selected = selectedId ? byId.get(selectedId) || null : null;
  const currentId = snapshot ? currentNodeId(snapshot, agentId) : null;
  const current = currentId ? byId.get(currentId) || null : null;
  const findings = useMemo(() => allNodes
    .filter((node) => node.id !== currentId && ['finding', 'vuln'].includes(node.type) && node.status !== 'superseded')
    .sort((a, b) => (severityOrder[a.severity || 'info'] ?? 5) - (severityOrder[b.severity || 'info'] ?? 5)), [allNodes, currentId]);
  const openItems = useMemo(() => allNodes
    // Same notion of open as stats.frontier / context.openThreads (deferred is closed).
    .filter((node) => node.id !== currentId && ['intent', 'hypothesis', 'question'].includes(node.type) && ['open', 'active', 'blocked'].includes(node.status || 'open'))
    .slice(-8).reverse(), [allNodes, currentId]);
  const inbox = useMemo(() => {
    const linked = new Set(allEdges.flatMap((edge) => [edge.from, edge.to]));
    return allNodes.filter((node) => !linked.has(node.id)).reverse();
  }, [allNodes, allEdges]);
  const paletteNodes = useMemo(() => [...allNodes].sort((a, b) => Number(b.ts || 0) - Number(a.ts || 0)), [allNodes]);

  const filterOptions = useMemo(() => {
    const tally = (pick: (node: typeof allNodes[number]) => string) => {
      const counts = new Map<string, number>();
      allNodes.forEach((node) => counts.set(pick(node), (counts.get(pick(node)) || 0) + 1));
      return [...counts].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count);
    };
    return {
      types: tally((node) => node.type),
      statuses: tally((node) => node.status || ''),
      confidences: tally((node) => node.confidence || ''),
      riskCount: allNodes.filter((node) => node.severity === 'critical' || node.severity === 'high').length,
    };
  }, [allNodes]);
  const results = useMemo(() => filterActive(filter) ? filterNodes(paletteNodes, filter) : null, [paletteNodes, filter]);

  const legend = useMemo(() => {
    const types = new Set<string>();
    projection?.nodes.forEach((node) => { if (!node.data.group) types.add(node.data.item.type); });
    const groups = new Set<RelationGroup>();
    projection?.edges.forEach((edge) => groups.add((edge.data as { group: RelationGroup }).group));
    return { types: [...types].sort(), groups: [...groups] };
  }, [projection]);

  const highlighted = useMemo(() => focusedIds(selectedId, edges), [selectedId, edges]);
  // Rebuild only what actually changed, so React Flow memoized cards keep their
  // identity across selection switches and content-only stream ticks.
  const displayNodes = useMemo(() => {
    const cache = displayNodesCache.current;
    let changed = false;
    const next = nodes.map((node) => {
      const selected = !node.data.group && node.id === selectedId;
      const muted = !node.data.group && Boolean(selectedId) && !highlighted.has(node.id);
      const freshFlag = fresh.has(node.id);
      const hit = cache.get(node.id);
      // Keyed on the node object itself: a drag replaces only the dragged node, and its new
      // position must reach React Flow or the card snaps back.
      if (hit && hit.source === node && hit.built.selected === selected && hit.built.data.muted === muted && hit.built.data.fresh === freshFlag) return hit.built;
      changed = true;
      return { ...node, selected, data: { ...node.data, muted, fresh: freshFlag } };
    });
    if (changed) {
      displayNodesCache.current = new Map(next.map((built, i) => [built.id, { source: nodes[i], built }]));
    }
    return next;
  }, [nodes, selectedId, highlighted, fresh]);
  const displayEdges = useMemo(() => edges.map((edge) => {
    const active = Boolean(selectedId) && (edge.source === selectedId || edge.target === selectedId);
    const recolor = (marker: Edge['markerEnd']) => marker && selectedId
      ? { ...(marker as object), color: active ? focusColor((edge.data as { group?: string } | undefined)?.group) : 'var(--line)' } as Edge['markerEnd']
      : marker;
    return {
      ...edge,
      type: 'routed',
      data: { ...edge.data, style: edgeStyle },
      // Arrowheads live outside the path, so they are recoloured here to follow focus and muting.
      markerEnd: recolor(edge.markerEnd),
      markerStart: recolor(edge.markerStart),
      className: `${edge.className || ''} ${active ? 'is-focused' : selectedId ? 'is-muted' : ''}`,
      // Labels only name the relations of the selected card; colour already tells the families apart.
      label: active ? edge.label : undefined,
      // The overview is a catalogue laid out in a grid, where every line would cut across cards;
      // it only draws the relations of the selected node. Elsewhere weak links that would only add
      // noise wait for a selection.
      hidden: !active && (mode === 'all' || (!selectedId && Boolean((edge.data as { quiet?: boolean } | undefined)?.quiet))),
      zIndex: active ? 10 : 0,
      style: { ...edge.style, opacity: selectedId ? active ? 1 : .12 : mode === 'all' ? .3 : 1, strokeWidth: active ? 1.75 : 1.25 },
    };
  }), [edges, selectedId, mode, edgeStyle]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem(THEME_KEY, theme); } catch { /* ignore */ }
  }, [theme]);

  live.current = { follow: follow && mode !== 'all', currentId, selectedId };

  // Mark nodes the Agent just wrote or changed, so a live board shows where work happened.
  useEffect(() => {
    if (!snapshot) return;
    const next = new Map(allNodes.map((node) => [node.id, Number(node.updated || node.ts || 0)]));
    const previous = stamps.current;
    stamps.current = next;
    if (!previous) return;
    const changed = new Set<string>();
    next.forEach((stamp, id) => { if (previous.get(id) !== stamp) changed.add(id); });
    if (!changed.size) return;
    setFresh(changed);
    if (freshTimer.current) clearTimeout(freshTimer.current);
    freshTimer.current = setTimeout(() => setFresh(new Set()), 4000);
  }, [snapshot, allNodes]);

  useEffect(() => {
    const url = new URL(location.href);
    url.searchParams.set('view', mode);
    url.searchParams.set('agent', agentId);
    history.replaceState(null, '', url);
  }, [mode, agentId]);

  // Keep the selected node in the address so the view can be shared and survives reloads.
  useEffect(() => {
    if (deepLink.current && !selectedId) return; // wait for the deep link to be applied
    const url = new URL(location.href);
    if (selectedId) url.searchParams.set('node', selectedId); else url.searchParams.delete('node');
    history.replaceState(null, '', url);
  }, [selectedId]);

  useEffect(() => {
    const target = deepLink.current;
    if (!target || !snapshot) return;
    deepLink.current = null;
    if (!byId.has(target)) { const url = new URL(location.href); url.searchParams.delete('node'); history.replaceState(null, '', url); return; }
    pendingFocus.current = target;
    setSelectedId(target);
    if (!projection?.nodes.some((node) => node.id === target)) setMode('all');
  }, [snapshot, byId, projection]);

  // A card removed from the board (by a person, from any open page) cannot stay selected.
  useEffect(() => {
    if (snapshot && selectedId && !byId.has(selectedId)) setSelectedId(null);
  }, [snapshot, byId, selectedId]);

  // A dropped connection is only worth announcing if it lasts; EventSource usually recovers within a second.
  useEffect(() => {
    if (connection !== 'offline' || isStatic) { setOfflineShown(false); return; }
    const timer = setTimeout(() => setOfflineShown(true), 1500);
    return () => clearTimeout(timer);
  }, [connection, isStatic]);

  const flash = useCallback((message: string) => {
    setNotice(message);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 2600);
  }, []);

  const exportImage = useCallback(async () => {
    if (exporting) return;
    setExporting(true);
    try {
      await exportCanvasPng(getNodes(), `blackboard-${mode}-${new Date().toISOString().slice(0, 10)}.png`);
      flash(t('app.exported'));
    } catch { flash(t('app.exportFailed')); }
    finally { setExporting(false); }
  }, [exporting, getNodes, mode, flash]);

  const copyNodeLink = async () => {
    try {
      await navigator.clipboard.writeText(location.href);
      setLinkCopied(true);
      if (linkTimer.current) clearTimeout(linkTimer.current);
      linkTimer.current = setTimeout(() => setLinkCopied(false), 2000);
    } catch { flash(t('app.clipboardFailed')); }
  };

  useEffect(() => {
    const resize = () => setOverviewColumns(window.innerWidth > 1100 ? 2 : 1);
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);

  const handleNodesChange: OnNodesChange<CanvasNode> = useCallback((changes) => {
    onNodesChange(changes);
    const selectedChange = changes.find((change) => change.type === 'select' && change.selected);
    if (selectedChange?.type === 'select' && !selectedChange.id.startsWith('__display_group_')) setSelectedId(selectedChange.id);
    // Deselect notifications can arrive from a previous layout. Pane click and
    // Escape are the explicit clear actions; do not let stale events clear focus.
  }, [onNodesChange]);

  const centerOnNode = useCallback((id: string, reserveInspector = true, duration = motion) => {
    const node = getNode(id);
    if (!node) return;
    const width = viewportRef.current?.clientWidth || 700;
    // The inspector floats over the right edge; centre inside the remaining space.
    const overlay = reserveInspector && width >= 640 ? Math.min(INSPECTOR_W, width * .5) : 0;
    const zoom = Math.min(1, Math.max(.55, (width - overlay) / (NODE_W + 48)));
    const parent = node.parentId ? getNode(node.parentId) : null;
    setCenter(
      node.position.x + (parent?.position.x || 0) + (node.data.compact ? 120 : NODE_W / 2) + overlay / (2 * zoom),
      node.position.y + (parent?.position.y || 0) + Number(node.style?.height || NODE_H) / 2,
      { zoom, duration },
    );
  }, [getNode, setCenter, motion]);

  const focusNode = useCallback((id: string) => {
    setSelectedId(id);
    if (window.innerWidth < 1024) setSidebarOpen(false);
    if (!projection?.nodes.some((node) => node.id === id)) {
      pendingFocus.current = id;
      setMode('all');
    } else requestAnimationFrame(() => centerOnNode(id));
  }, [projection, centerOnNode]);

  const onNodeClick: NodeMouseHandler<CanvasNode> = useCallback((_event, node) => { if (!node.data.group) focusNode(node.id); }, [focusNode]);

  useEffect(() => {
    if (!projection) return;
    const key = JSON.stringify([mode, direction, overviewColumns, projection.nodes.map((node) => node.id), projection.edges.map((edge) => [edge.id, edge.source, edge.target])]);
    // Content-only stream updates must not discard dragged positions or reset zoom.
    if (layoutKey.current === key) {
      const fresh = new Map(projection.nodes.map((node) => [node.id, node]));
      setNodes((previous) => previous.map((node) => {
        const next = fresh.get(node.id);
        if (!next) return node;
        // A card's height follows its content (title-only vs title+summary);
        // content-only updates must carry that style, not just the data.
        return { ...node, style: next.style, data: { ...node.data, ...next.data } };
      }));
      // Keep each edge's computed route; only content changed, not the layout.
      setEdges((previous) => {
        const routes = new Map(previous.map((edge) => [edge.id, (edge.data as { route?: unknown } | undefined)?.route]));
        return projection.edges.map((edge) => ({ ...edge, data: { ...edge.data, route: routes.get(edge.id) } }));
      });
      return;
    }
    let cancelled = false;
    const viewKey = `${mode}:${direction}`;
    // Only a layout that keeps the canvas waiting is worth announcing.
    const slow = setTimeout(() => setLaying(projection.nodes.length), 300);
    layoutGraph(projection.nodes, projection.edges, direction, mode === 'all', overviewColumns, lastPositions.current.get(viewKey)).then((layouted) => {
      if (cancelled) return;
      lastPositions.current.set(viewKey, new Map(layouted.nodes.map((node) => [node.id, node.position])));
      layoutKey.current = key;
      setNodes(layouted.nodes);
      setEdges(layouted.edges);
      setLayoutRevision((revision) => revision + 1);
      // Handles move between the sides of a card when the direction flips; React Flow only re-measures
      // them when asked. One batched request instead of one per card keeps a big board from stalling.
      if (laidOutDirection.current && laidOutDirection.current !== direction) updateNodeInternals(layouted.nodes.map((node) => node.id));
      laidOutDirection.current = direction;
    }).finally(() => { clearTimeout(slow); if (!cancelled) setLaying(0); });
    return () => { cancelled = true; clearTimeout(slow); };
  }, [projection, mode, direction, overviewColumns, setNodes, setEdges, updateNodeInternals]);

  useEffect(() => {
    if (!initialized || !layoutRevision || framedRevision.current === layoutRevision) return;
    const frame = requestAnimationFrame(() => {
      // The first framing of a page load jumps into place; only later re-framings animate.
      const duration = framedRevision.current === 0 ? 0 : motion;
      framedRevision.current = layoutRevision;
      const following = live.current.follow && live.current.currentId && getNode(live.current.currentId) ? live.current.currentId : null;
      // A requested node that this layout does not contain yet (a view switch is pending) stays queued.
      const requested = pendingFocus.current && getNode(pendingFocus.current) ? pendingFocus.current : null;
      if (requested) {
        centerOnNode(requested, true, duration);
        pendingFocus.current = null;
      } else if (following) centerOnNode(following, Boolean(live.current.selectedId), duration);
      else {
        // A board that only fits at an unreadable zoom opens where reading starts; "fit" still shows it all.
        const cards = getNodes().filter((node) => !node.data.group);
        const box = viewportRef.current;
        const fitZoom = mode !== 'all' && cards.length && box
          ? getViewportForBounds(getNodesBounds(cards), box.clientWidth, box.clientHeight, .08, 1, .14).zoom
          : 1;
        const start = frameStrategy(fitZoom) === 'focus'
          ? pickFocus(cards.map((node) => ({ id: node.id, degree: node.data.degree, ts: node.data.item.ts })), live.current.currentId)
          : null;
        if (start) centerOnNode(start, false, duration);
        else fitView({ padding: .14, duration, minZoom: .08, maxZoom: 1 });
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [initialized, layoutRevision, centerOnNode, fitView, getNode, getNodes, mode, motion]);

  // Follow mode: when the Agent's cursor moves, bring the new position into view.
  useEffect(() => {
    const previous = lastCurrent.current;
    lastCurrent.current = currentId;
    if (!currentId || previous === currentId || !follow || mode === 'all') return;
    const frame = requestAnimationFrame(() => centerOnNode(currentId, Boolean(live.current.selectedId)));
    return () => cancelAnimationFrame(frame);
  }, [currentId, follow, mode, centerOnNode]);

  // Arrow keys walk the explicit one-hop neighbours of the selected node.
  useEffect(() => {
    const onArrow = (event: KeyboardEvent) => {
      if (!selectedId || event.metaKey || event.ctrlKey || event.altKey || !event.key.startsWith('Arrow')) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable], [role="dialog"], [role="slider"], [role="menu"]')) return;
      const boxes = nodes.filter((node) => !node.data.group).map((node) => {
        const parent = node.parentId ? nodes.find((candidate) => candidate.id === node.parentId) : null;
        return { id: node.id, x: node.position.x + (parent?.position.x || 0), y: node.position.y + (parent?.position.y || 0), w: Number(node.style?.width || NODE_W), h: Number(node.style?.height || NODE_H) };
      });
      const next = neighborInDirection(selectedId, boxes, edges, event.key as ArrowKey);
      // Capture phase, and also when there is no neighbour: React Flow would otherwise nudge the focused node by a few pixels.
      event.preventDefault();
      event.stopPropagation();
      if (!next) return;
      focusNode(next);
      requestAnimationFrame(() => document.querySelector<HTMLElement>(`.react-flow__node[data-id="${CSS.escape(next)}"]`)?.focus({ preventScroll: true }));
    };
    window.addEventListener('keydown', onArrow, true);
    return () => window.removeEventListener('keydown', onArrow, true);
  }, [selectedId, nodes, edges, focusNode]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      } else if (!event.metaKey && !event.ctrlKey && !event.altKey && !(event.target as HTMLElement | null)?.closest('input, textarea, select, [contenteditable]') && !document.querySelector('[role="dialog"]') && (event.key === '/' || event.key === '[' || event.key === '?')) {
        event.preventDefault();
        if (event.key === '/') setPaletteOpen(true); else if (event.key === '?') setShortcutsOpen(true); else setSidebarOpen((open) => !open);
      } else if (event.key === 'Escape' && !document.querySelector('[role="dialog"], [role="menu"]')) setSelectedId(null);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      if (freshTimer.current) clearTimeout(freshTimer.current);
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
      if (linkTimer.current) clearTimeout(linkTimer.current);
    };
  }, []);

  const copyDigest = async () => {
    try {
      await navigator.clipboard.writeText(digest);
      setCopied(true);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 2000);
    } catch { setCopied(false); }
  };

  const switchMode = (next: ViewMode) => {
    if (next === mode) return;
    pendingFocus.current = null;
    setSelectedId(null);
    setMode(next);
  };

  if (!snapshot) {
    return (
      <main className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
        <BrandMark size={32} />
        <strong className="text-sm font-semibold text-foreground">blackboard</strong>
        <span className="text-xs">{connection === 'offline' ? t('app.waitingService') : t('app.restoring')}</span>
      </main>
    );
  }

  const writable = !isStatic && snapshot.meta.writable === true;
  const stats = snapshot.stats || {};
  const risk = Number(stats.vulns?.critical || 0) + Number(stats.vulns?.high || 0);
  const counts = {
    nodes: allNodes.length,
    edges: allEdges.length,
    risk,
    open: Number(stats.frontier || 0),
    candidates: Number(stats.candidates || 0),
  };
  const hidden = projection?.hidden || 0;

  return (
    <div className="flex h-full flex-col">
      <Topbar
        title={snapshot.meta.title || t('app.untitledTask')}
        mode={mode}
        onMode={switchMode}
        agentId={agentId}
        agentIds={agentIds}
        onAgent={setAgentId}
        theme={theme}
        onTheme={() => setTheme(theme === 'light' ? 'dark' : 'light')}
        connection={connection}
        isStatic={isStatic}
        sidebarOpen={sidebarOpen}
        onToggleSidebar={() => setSidebarOpen((open) => !open)}
        onSearch={() => setPaletteOpen(true)}
        onDigest={() => setDigestOpen(true)}
        onNew={writable ? () => setNewOpen(true) : undefined}
        digestRef={digestTrigger}
        activities={activities}
        activityTotal={stats.activities || activities.length}
      />

      <div className="relative flex min-h-0 flex-1">
        {sidebarOpen && (
          <>
            <button className="absolute inset-0 z-20 bg-black/20 lg:hidden" aria-label={t('app.closeNav')} onClick={() => setSidebarOpen(false)} />
            <aside className="z-30 w-64 shrink-0 border-r bg-background max-lg:absolute max-lg:inset-y-0 max-lg:left-0 max-lg:shadow-float">
              <Sidebar
                current={current}
                openItems={openItems}
                findings={findings}
                inbox={inbox}
                selectedId={selectedId}
                counts={counts}
                onSelect={focusNode}
                onSearch={() => { setPaletteOpen(true); if (window.innerWidth < 1024) setSidebarOpen(false); }}
                onShortcuts={() => setShortcutsOpen(true)}
                filter={filter}
                onFilter={setFilter}
                filterOptions={filterOptions}
                results={results}
              />
            </aside>
          </>
        )}

        <main ref={viewportRef} className="relative min-w-0 flex-1" aria-label={t('app.canvas')}>
          <ReactFlow
            nodes={displayNodes}
            edges={displayEdges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onNodesChange={handleNodesChange}
            onNodeClick={onNodeClick}
            onPaneClick={() => setSelectedId(null)}
            nodesConnectable={false}
            deleteKeyCode={null}
            autoPanOnNodeFocus={false}
            minZoom={0.08}
            maxZoom={1.8}
            colorMode={theme}
            fitView
            fitViewOptions={{ padding: .14, minZoom: .08, maxZoom: 1 }}
            onMove={(_, viewport) => viewportRef.current?.style.setProperty('--zoom', String(viewport.zoom))}
            proOptions={{ hideAttribution: true }}
          >
            <Background variant={BackgroundVariant.Dots} gap={22} size={1} />
            <CanvasToolbar
              hasCurrent={Boolean(currentId)}
              canFollow={!isStatic}
              canExport={nodes.length > 0 && !exporting}
              onExport={exportImage}
              grouped={mode === 'all'}
              direction={direction}
              showMap={showMap}
              follow={follow}
              onToggleFollow={() => setFollow((value) => !value)}
              motion={motion}
              onLocate={() => currentId && focusNode(currentId)}
              onDirection={() => setDirection(direction === 'RIGHT' ? 'DOWN' : 'RIGHT')}
              onToggleMap={() => setShowMap((open) => !open)}
              showLegend={showLegend}
              onToggleLegend={() => setShowLegend((open) => !open)}
              edgeStyle={edgeStyle}
              onEdgeStyle={setEdgeStyle}
            />
            {showMap && (
              <MiniMap
                position="bottom-left"
                style={{ marginBottom: 64 }}
                pannable
                zoomable
                nodeStrokeWidth={2}
                nodeColor={(node) => (node.data as CanvasNode['data']).group ? 'transparent' : 'var(--ink-3)'}
                nodeStrokeColor={(node) => (node.data as CanvasNode['data']).group ? 'var(--line-strong)' : 'transparent'}
              />
            )}
          </ReactFlow>

          {showLegend && nodes.length > 0 && <Legend types={legend.types} groups={legend.groups} onClose={() => setShowLegend(false)} />}

          {projection && projection.nodes.length === 0 && (
            <EmptyBoard viewEmpty={allNodes.length > 0} isStatic={isStatic} onShowAll={() => switchMode('all')} />
          )}

          <div className="pointer-events-none absolute left-1/2 top-3 flex -translate-x-1/2 flex-col items-center gap-2">
            {offlineShown && (
              <div role="alert" className="whitespace-nowrap rounded-full border border-destructive/40 bg-danger-soft px-3 py-1 text-xs text-destructive shadow-xs">
                {t('app.disconnected')}{syncedAt ? t('app.frozenAt', { time: new Date(syncedAt).toLocaleTimeString(locale, { hour12: false }) }) : ''}
              </div>
            )}
            {hidden > 0 && (
              <button
                className="pointer-events-auto whitespace-nowrap rounded-full border bg-card px-3 py-1 text-xs text-muted-foreground shadow-xs transition-colors hover:border-strong hover:text-foreground"
                onClick={() => switchMode('all')}
              >
                {t('app.hiddenNodes', { n: hidden })}
              </button>
            )}
            {laying > 0 && <div role="status" className="whitespace-nowrap rounded-full border bg-card px-3 py-1 text-xs text-muted-foreground shadow-xs">{t('app.laying', { n: laying })}</div>}
            {notice && <div role="status" className="whitespace-nowrap rounded-full border bg-card px-3 py-1 text-xs shadow-float">{notice}</div>}
          </div>

          <p className="sr-only" role="status" aria-live="polite">{selected ? t('app.selected', { type: typeLabelOf(selected.type), title: selected.title }) : ''}</p>

          {selected && <Inspector node={selected} edges={allEdges} byId={byId} onClose={() => setSelectedId(null)} onFocus={focusNode} onCopyLink={copyNodeLink} linkCopied={linkCopied} writable={writable} onReload={reload} isStatic={isStatic} connected={connection === 'live'} revision={syncedAt} />}
        </main>
      </div>

      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        nodes={paletteNodes}
        theme={theme}
        copied={copied}
        onSelect={focusNode}
        onMode={switchMode}
        onTheme={() => setTheme(theme === 'light' ? 'dark' : 'light')}
        onCopyDigest={copyDigest}
        onExport={nodes.length > 0 ? exportImage : null}
        onShortcuts={() => setShortcutsOpen(true)}
      />
      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
      {writable && <NewNodeDialog open={newOpen} onOpenChange={setNewOpen} />}
      <DigestDialog open={digestOpen} onOpenChange={setDigestOpen} digest={digest} copied={copied} onCopy={copyDigest} returnFocus={digestTrigger} byId={byId} onFocus={focusNode} agentId={agentId} checkpoints={snapshot?.checkpoints} isStatic={isStatic} connected={connection === 'live'} revision={syncedAt} />
    </div>
  );
}

export function App() {
  return <TooltipProvider delayDuration={300}><ReactFlowProvider><SessionDrafts><Workspace /></SessionDrafts></ReactFlowProvider></TooltipProvider>;
}
