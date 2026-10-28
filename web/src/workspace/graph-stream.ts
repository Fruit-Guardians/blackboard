import type { GraphSnapshot } from '../types';
import { t } from '../i18n';

export type Connection = 'connecting' | 'live' | 'offline';
export type GraphStreamState = {
  snapshot: GraphSnapshot | null;
  connection: Connection;
  syncedAt: number | null;
  isStatic: boolean;
};

export type GraphSubscription = {
  getState(): GraphStreamState;
  reload(): Promise<void>;
  dispose(): void;
};

type GraphResponse = { ok: boolean; status: number; json(): Promise<unknown> };
type GraphEventStream = Pick<EventSource, 'addEventListener' | 'onerror' | 'close'>;
export type GraphStreamPorts = {
  fetch(url: string, init: { signal: AbortSignal }): Promise<GraphResponse>;
  openStream(url: string): GraphEventStream;
  now(): number;
};

const browserPorts: GraphStreamPorts = {
  fetch: (url, init) => fetch(url, init),
  openStream: (url) => new EventSource(url),
  now: () => Date.now(),
};

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/** Check the envelope consumed by the viewer, without rewriting authored data. */
function isGraphSnapshot(value: unknown): value is GraphSnapshot {
  return record(value) && record(value.meta) && [value.nodes, value.edges].every((items) =>
    (Array.isArray(items) || record(items)) && Object.values(items).every(record));
}

/** An embedded export stays static even if its embedded data is malformed. */
export function initialGraphStreamState(embedded?: unknown): GraphStreamState {
  const isStatic = embedded !== undefined;
  const snapshot = isGraphSnapshot(embedded) ? embedded : null;
  return { snapshot, connection: isStatic ? snapshot ? 'live' : 'offline' : 'connecting', syncedAt: null, isStatic };
}

/** One workspace subscription; React only owns its state and disposal. */
export function createGraphSubscription(
  onChange: (state: GraphStreamState) => void,
  { embedded, ports = browserPorts }: { embedded?: unknown; ports?: GraphStreamPorts } = {},
): GraphSubscription {
  let state = initialGraphStreamState(embedded);
  let disposed = false;
  let sequence = 0;
  let appliedSequence = 0;
  const reads = new Set<AbortController>();
  const publish = (next: GraphStreamState) => {
    if (disposed) return;
    state = next;
    onChange(state);
  };
  const offline = () => publish({ ...state, connection: 'offline' });
  const invalid = (order: number) => {
    if (disposed || order < appliedSequence) return;
    // Invalid newer input also supersedes an older pending HTTP snapshot.
    appliedSequence = order;
    offline();
  };
  const apply = (value: unknown, order: number) => {
    if (disposed || order < appliedSequence) return;
    if (!isGraphSnapshot(value)) {
      invalid(order);
      return false;
    }
    appliedSequence = order;
    publish({ ...state, snapshot: value, connection: 'live', syncedAt: ports.now() });
    return true;
  };
  const reload = async () => {
    if (disposed || state.isStatic) return;
    // Reserve order at request start: a graph event during this read is newer.
    const order = ++sequence;
    const controller = new AbortController();
    reads.add(controller);
    try {
      let response: GraphResponse;
      try { response = await ports.fetch('/api/graph', { signal: controller.signal }); }
      catch { throw new Error(t('api.noResponse')); }
      if (disposed) return;
      if (!response.ok) throw new Error(t('api.failed', { status: response.status }));
      let data: unknown;
      try { data = await response.json(); }
      catch (error) {
        invalid(order);
        throw error;
      }
      if (apply(data, order) === false) throw new Error(t('api.invalidResponse', { status: response.status }));
    } finally {
      reads.delete(controller);
    }
  };

  onChange(state);
  let stream: GraphEventStream | undefined;
  if (!state.isStatic) {
    void reload().catch(() => { if (!disposed && appliedSequence === 0) offline(); });
    stream = ports.openStream('/events');
    stream.addEventListener('graph', (event) => {
      if (disposed) return;
      const order = ++sequence;
      let data: unknown;
      try { data = JSON.parse((event as MessageEvent).data); }
      catch { invalid(order); return; }
      apply(data, order);
    });
    // Opening a transport is not evidence that any valid data was received.
    stream.onerror = () => { if (!disposed) offline(); };
  }

  return {
    getState: () => state,
    reload,
    dispose() {
      if (disposed) return;
      disposed = true;
      stream?.close();
      for (const controller of reads) controller.abort();
      reads.clear();
    },
  };
}
