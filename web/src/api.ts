import { t } from './i18n';

/** Writes a person makes from the viewer. The server stamps them as human and checks where they came from. */
export type NodeInput = { type: string; title: string; detail?: string; parent?: string; relation?: string };
type PatchFields = Partial<Record<'title' | 'detail' | 'status' | 'severity' | 'confidence', string>>;
export type NodePatch = PatchFields & { expected?: PatchFields };

export class NodeConflict extends Error {
  constructor(public fields: string[]) {
    super(t('edit.conflict'));
  }
}

async function send<T>(method: string, url: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new Error(t('api.noResponse'));
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 409 && data.error === 'node_conflict') throw new NodeConflict(Array.isArray(data.fields) ? data.fields : []);
    if (data.code === 'input_too_long' || data.error === 'input_too_long') {
      const labels: Record<string, string> = { title: t('edit.title'), detail: t('edit.detail') };
      const fields = Array.isArray(data.fields) ? data.fields.filter((field: unknown): field is string => typeof field === 'string').map((field: string) => labels[field] || field).join(', ') : '';
      throw new Error(t('api.inputTooLong', { fields }));
    }
    throw new Error(data.error === 'read_only' ? t('api.readOnly') : data.error || t('api.failed', { status: response.status }));
  }
  return data as T;
}

export const addNode = (input: NodeInput) => send<{ node: { id: string } }>('POST', '/api/nodes', { ...input, rejectTruncation: true });
export const patchNode = (id: string, set: NodePatch) => send<unknown>('PATCH', `/api/nodes/${encodeURIComponent(id)}`, { ...set, rejectTruncation: true });
export const removeNode = (id: string) => send<unknown>('DELETE', `/api/nodes/${encodeURIComponent(id)}`);
export const addEdge = (from: string, to: string, kind: string) => send<unknown>('POST', '/api/edges', { from, to, kind });
export const removeEdge = (id: string) => send<unknown>('DELETE', `/api/edges?id=${encodeURIComponent(id)}`);

/** How a new card relates to the selected one. Each reads "new <relation> current" except the last. */
export const LINKS = [
  { id: 'supports', label: t('link.supports'), from: 'new', kind: 'supports' },
  { id: 'contradicts', label: t('link.contradicts'), from: 'new', kind: 'contradicts' },
  { id: 'derived-from', label: t('link.derived-from'), from: 'new', kind: 'derived-from' },
  { id: 'related-to', label: t('link.related-to'), from: 'current', kind: 'related-to' },
] as const;

export const CREATABLE_TYPES = ['fact', 'observation', 'hypothesis', 'question', 'action', 'result', 'finding', 'note', 'goal'] as const;
export const SETTABLE_STATUSES = ['open', 'active', 'done', 'blocked', 'dead', 'confirmed', 'refuted', 'deferred', 'superseded'] as const;

/** Read projections from this server only; static exports never call these. */
export const getNodeHistory = (id: string) => send<import('./types').NodeHistory>('GET', `/api/history?node=${encodeURIComponent(id)}`);
export const getCheckpointChanges = (id: string) => send<import('./types').CheckpointChanges>('GET', `/api/changes?since=${encodeURIComponent(id)}`);
export const SETTABLE_SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'] as const;
export const SETTABLE_CONFIDENCES = ['suspected', 'static-confirmed', 'reproduced', 'confirmed'] as const;
