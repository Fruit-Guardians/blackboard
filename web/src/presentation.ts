import type { BoardNode } from './types';
import { t, tOptional } from './i18n';
import { sourceLocation } from './research-state';

/** Stored values outside the known vocabulary are shown as they are. */
export const typeLabel = (type: string) => tOptional(`type.${type}`) || type;
export const statusLabel = (status?: string) => status ? tOptional(`status.${status}`) || status : t('status.unset');
export const severityLabel = (severity?: string) => severity ? tOptional(`severity.${severity}`) || severity : t('severity.unset');
export const confidenceLabel = (confidence?: string) => confidence ? tOptional(`confidence.${confidence}`) || confidence : t('confidence.unset');

/** All stored dimensions survive display; confidence never replaces a recorded status. */
export function nodeStateSummary(node: Pick<BoardNode, 'status' | 'severity' | 'confidence'>) {
  return [node.status ? statusLabel(node.status) : '', node.severity ? severityLabel(node.severity) : '', node.confidence ? confidenceLabel(node.confidence) : ''].filter(Boolean).join(' · ');
}

/** Preserve the authored text: only split the first sentence from its evidence. */
export function presentNode(node: Pick<BoardNode, 'title' | 'detail'>) {
  const title = node.title.trim() || t('node.untitled');
  const boundary = title.search(/[。！？\n]/u);
  const headline = boundary > 0 ? title.slice(0, boundary) : title;
  const continuation = boundary > 0 ? title.slice(boundary + 1).trim() : '';
  const detail = node.detail?.trim() || '';
  return { headline, summary: continuation || detail, detail: continuation && detail && continuation !== detail ? detail : '' };
}

/** Search the full board, including details and human-readable type/status labels. */
export function matchesNode(node: BoardNode, query: string) {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const haystack = `${node.id} ${node.title} ${node.detail || ''} ${sourceLocation(node)} ${Array.isArray(node.tags) ? node.tags.join(' ') : ''} ${typeof node.author === 'string' ? node.author : ''} ${node.type} ${typeLabel(node.type)} ${statusLabel(node.status)} ${severityLabel(node.severity)} ${confidenceLabel(node.confidence)}`.toLocaleLowerCase();
  return terms.every((term) => haystack.includes(term));
}

export type NodeFilter = { types: string[]; statuses: string[]; confidences: string[]; riskOnly: boolean };
export const EMPTY_FILTER: NodeFilter = { types: [], statuses: [], confidences: [], riskOnly: false };
export const filterActive = (filter: NodeFilter) => filter.types.length > 0 || filter.statuses.length > 0 || filter.confidences.length > 0 || filter.riskOnly;

/** Values within one facet are alternatives (OR); facets narrow each other (AND). */
export function filterNodes(nodes: BoardNode[], filter: NodeFilter) {
  return nodes.filter((node) =>
    (!filter.types.length || filter.types.includes(node.type)) &&
    (!filter.statuses.length || filter.statuses.includes(node.status || '')) &&
    (!filter.confidences.length || filter.confidences.includes(node.confidence || '')) &&
    (!filter.riskOnly || node.severity === 'critical' || node.severity === 'high'));
}
