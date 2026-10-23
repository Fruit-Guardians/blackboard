import { useCallback, useEffect, useRef, useState } from 'react';
import type { GraphSnapshot } from './types';
import { t } from './i18n';

export type Connection = 'connecting' | 'live' | 'offline';

/** Live snapshot over SSE, or the embedded snapshot of a static export. */
export function useGraphStream() {
  const embedded = window.__BLACKBOARD_DATA__ || null;
  const [snapshot, setSnapshot] = useState<GraphSnapshot | null>(embedded);
  const [connection, setConnection] = useState<Connection>(embedded ? 'live' : 'connecting');
  const [syncedAt, setSyncedAt] = useState<number | null>(null);
  const readSnapshot = useRef<(() => Promise<void>) | null>(null);
  const reload = useCallback(async () => {
    if (embedded) return;
    await readSnapshot.current?.();
  }, [embedded]);

  useEffect(() => {
    if (embedded) return;
    let alive = true;
    // Snapshots from the initial fetch and the SSE stream can arrive in any
    // order; only ever apply the newest one, or a slow initial fetch would
    // roll the board back to an older state.
    let sequence = 0;
    let appliedSequence = 0;
    const apply = (data: GraphSnapshot, order: number) => {
      if (!alive || order < appliedSequence) return;
      appliedSequence = order;
      setSnapshot(data);
      setSyncedAt(Date.now());
      setConnection('live');
    };
    const read = async () => {
      // Reserve the ordering at request start, not response arrival: an SSE
      // snapshot received while this request is pending is always newer.
      const order = ++sequence;
      let response: Response;
      try { response = await fetch('/api/graph'); }
      catch { throw new Error(t('api.noResponse')); }
      if (!response.ok) throw new Error(t('api.failed', { status: response.status }));
      apply(await response.json(), order);
    };
    readSnapshot.current = read;
    read().catch(() => { if (alive && appliedSequence === 0) setConnection('offline'); });
    const stream = new EventSource('/events');
    stream.addEventListener('graph', (event) => {
      if (!alive) return;
      try { apply(JSON.parse((event as MessageEvent).data), ++sequence); }
      catch { setConnection('offline'); }
    });
    stream.onopen = () => setConnection('live');
    stream.onerror = () => setConnection('offline');
    return () => {
      alive = false;
      stream.close();
      if (readSnapshot.current === read) readSnapshot.current = null;
    };
  }, [embedded]);
  return { snapshot, connection, syncedAt, isStatic: Boolean(embedded), reload };
}
