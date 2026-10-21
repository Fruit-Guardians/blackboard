/** Writes a person makes from the viewer. The server stamps them as human and checks where they came from. */
export type NodeInput = { type: string; title: string; detail?: string; parent?: string; relation?: string };
export type NodePatch = Partial<Record<'title' | 'detail' | 'status' | 'severity' | 'confidence', string>>;

async function send<T>(method: string, url: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new Error('黑板服务没有响应');
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error === 'read_only' ? '黑板以只读方式运行' : data.error || `请求失败（${response.status}）`);
  return data as T;
}

export const addNode = (input: NodeInput) => send<{ node: { id: string } }>('POST', '/api/nodes', input);
export const patchNode = (id: string, set: NodePatch) => send<unknown>('PATCH', `/api/nodes/${encodeURIComponent(id)}`, set);
export const removeNode = (id: string) => send<unknown>('DELETE', `/api/nodes/${encodeURIComponent(id)}`);
export const addEdge = (from: string, to: string, kind: string) => send<unknown>('POST', '/api/edges', { from, to, kind });
export const removeEdge = (id: string) => send<unknown>('DELETE', `/api/edges?id=${encodeURIComponent(id)}`);

/** How a new card relates to the selected one. Each reads "new <relation> current" except the last. */
export const LINKS = [
  { id: 'supports', label: '支持当前节点', from: 'new', kind: 'supports' },
  { id: 'contradicts', label: '反驳当前节点', from: 'new', kind: 'contradicts' },
  { id: 'derived-from', label: '由当前节点推出', from: 'new', kind: 'derived-from' },
  { id: 'related-to', label: '仅相关', from: 'current', kind: 'related-to' },
] as const;

export const CREATABLE_TYPES = ['fact', 'observation', 'hypothesis', 'question', 'action', 'result', 'finding', 'note', 'goal'] as const;
export const SETTABLE_STATUSES = ['open', 'active', 'done', 'blocked', 'dead', 'confirmed', 'refuted', 'deferred', 'superseded'] as const;
