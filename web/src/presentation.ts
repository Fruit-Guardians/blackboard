import type { BoardNode } from './types';

const TYPE_LABELS: Record<string, string> = {
  goal: '目标', intent: '意图', hypothesis: '假设', question: '问题',
  fact: '事实', observation: '观察', action: '行动', result: '结果',
  finding: '发现', vuln: '漏洞', hint: '提示', summary: '摘要',
  note: '记录', compact: '压缩', start: '起点',
};
const STATUS_LABELS: Record<string, string> = {
  active: '进行中', open: '待验证', done: '已完成', confirmed: '已确认',
  dead: '已排除', refuted: '已反驳', blocked: '受阻', superseded: '已取代', deferred: '暂缓', pending: '待处理',
};
const SEVERITY_LABELS: Record<string, string> = {
  critical: '严重', high: '高危', medium: '中危', low: '低危', info: '信息',
};
const CONFIDENCE_LABELS: Record<string, string> = {
  suspected: '待验证', 'static-confirmed': '静态确认', reproduced: '已复现', confirmed: '已确认',
};
export const typeLabel = (type: string) => TYPE_LABELS[type] || type;
export const statusLabel = (status?: string) => status ? STATUS_LABELS[status] || status : '未设置';
export const severityLabel = (severity?: string) => severity ? SEVERITY_LABELS[severity] || severity : '未评估';
export const confidenceLabel = (confidence?: string) => confidence ? CONFIDENCE_LABELS[confidence] || confidence : '未声明';

/** Preserve the authored text: only split the first sentence from its evidence. */
export function presentNode(node: Pick<BoardNode, 'title' | 'detail'>) {
  const title = node.title.trim() || '未命名节点';
  const boundary = title.search(/[。！？\n]/u);
  const headline = boundary > 0 ? title.slice(0, boundary) : title;
  const continuation = boundary > 0 ? title.slice(boundary + 1).trim() : '';
  const detail = node.detail?.trim() || '';
  return { headline, summary: continuation || detail, detail: continuation && detail && continuation !== detail ? detail : '' };
}

/** Search the full board, including details and human-readable type/status labels. */
export function matchesNode(node: BoardNode, query: string) {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const haystack = `${node.id} ${node.title} ${node.detail || ''} ${node.type} ${typeLabel(node.type)} ${statusLabel(node.status)} ${severityLabel(node.severity)} ${confidenceLabel(node.confidence)}`.toLocaleLowerCase();
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
