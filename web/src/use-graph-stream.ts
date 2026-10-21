import { useEffect, useState } from 'react';
import type { GraphSnapshot } from './types';

export type Connection = 'connecting' | 'live' | 'offline';

/** Live snapshot over SSE, or the embedded snapshot of a static export. */
export function useGraphStream() {
  const embedded = window.__BLACKBOARD_DATA__ || null;
  const [snapshot, setSnapshot] = useState<GraphSnapshot | null>(embedded);
  const [connection, setConnection] = useState<Connection>(embedded ? 'live' : 'connecting');
  const [syncedAt, setSyncedAt] = useState<number | null>(null);

  useEffect(() => {
    if (embedded) return;
    let alive = true;
    // Snapshots from the initial fetch and the SSE stream can arrive in any
    // order; only ever apply the newest one, or a slow initial fetch would
    // roll the board back to an older state.
    let lastSyncedAt = 0;
    const apply = (data: GraphSnapshot, at: number) => {
      if (!alive || at < lastSyncedAt) return;
      lastSyncedAt = at;
      setSnapshot(data);
      setSyncedAt(at);
      setConnection('live');
    };
    fetch('/api/graph')
      .then((response) => response.json())
      .then((data) => { if (alive) apply(data, Date.now()); })
      .catch(() => setConnection('offline'));
    const stream = new EventSource('/events');
    stream.addEventListener('graph', (event) => {
      if (!alive) return;
      try { apply(JSON.parse((event as MessageEvent).data), Date.now()); }
      catch { setConnection('offline'); }
    });
    stream.onopen = () => setConnection('live');
    stream.onerror = () => setConnection('offline');
    return () => {
      alive = false;
      stream.close();
    };
  }, [embedded]);
  return { snapshot, connection, syncedAt, isStatic: Boolean(embedded) };
}
