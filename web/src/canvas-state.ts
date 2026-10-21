import type { BoardNode } from './types';
import { t } from './i18n';

export type DetailLevel = 'overview' | 'compact' | 'detail';
export const detailLevel = (zoom: number): DetailLevel => zoom < .65 ? 'overview' : zoom < .9 ? 'compact' : 'detail';

export const BOARD_GROUPS = [
  { id: 'purpose', title: t('lane.purpose'), subtitle: t('lane.purposeSub'), color: '#647e72' },
  { id: 'reasoning', title: t('lane.reasoning'), subtitle: t('lane.reasoningSub'), color: '#6b7e95' },
  { id: 'findings', title: t('lane.findings'), subtitle: t('lane.findingsSub'), color: '#af7969' },
  { id: 'inbox', title: t('lane.inbox'), subtitle: t('lane.inboxSub'), color: '#929088' },
] as const;
export type BoardGroupId = typeof BOARD_GROUPS[number]['id'];
export function groupFor(node: BoardNode, connected: Set<string>): BoardGroupId {
  if (['goal', 'start', 'summary', 'compact'].includes(node.type)) return 'purpose';
  if (['finding', 'vuln'].includes(node.type)) return 'findings';
  return connected.has(node.id) ? 'reasoning' : 'inbox';
}

/** Direct neighbours only: highlight real edges, never invent a reasoning path. */
export function focusedIds(selectedId: string | null, edges: { source: string; target: string }[]) {
  const ids = new Set<string>();
  if (!selectedId) return ids;
  ids.add(selectedId);
  for (const edge of edges) {
    if (edge.source === selectedId) ids.add(edge.target);
    if (edge.target === selectedId) ids.add(edge.source);
  }
  return ids;
}

export type ArrowKey = 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown';
export type Box = { id: string; x: number; y: number; w: number; h: number };

/**
 * Keyboard traversal along explicit edges only: of the selected node's one-hop
 * neighbours, pick the one lying most directly in the pressed direction.
 */
export function neighborInDirection(selectedId: string | null, boxes: Box[], edges: { source: string; target: string }[], key: ArrowKey): string | null {
  if (!selectedId) return null;
  const centre = new Map(boxes.map((box) => [box.id, { x: box.x + box.w / 2, y: box.y + box.h / 2 }]));
  const from = centre.get(selectedId);
  if (!from) return null;
  const horizontal = key === 'ArrowLeft' || key === 'ArrowRight';
  const sign = key === 'ArrowRight' || key === 'ArrowDown' ? 1 : -1;
  let best: { id: string; score: number } | null = null;
  const seen = new Set<string>();
  for (const edge of edges) {
    const peer = edge.source === selectedId ? edge.target : edge.target === selectedId ? edge.source : null;
    const at = peer && centre.get(peer);
    if (!peer || !at || seen.has(peer)) continue;
    seen.add(peer);
    const along = ((horizontal ? at.x - from.x : at.y - from.y)) * sign;
    const across = Math.abs(horizontal ? at.y - from.y : at.x - from.x);
    if (along <= 0) continue;
    const score = along + across * 2;
    if (!best || score < best.score) best = { id: peer, score };
  }
  return best?.id ?? null;
}
