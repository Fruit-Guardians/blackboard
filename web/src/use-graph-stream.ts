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
    fetch('/api/graph')
      .then((response) => response.json())
      .then((data) => { if (alive) { setSnapshot(data); setSyncedAt(Date.now()); } })
      .catch(() => setConnection('offline'));
    const stream = new EventSource('/events');
    stream.addEventListener('graph', (event) => {
      if (!alive) return;
      try {
        setSnapshot(JSON.parse((event as MessageEvent).data));
        setSyncedAt(Date.now());
        setConnection('live');
      } catch {
        setConnection('offline');
      }
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
