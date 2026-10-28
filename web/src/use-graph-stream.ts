import { useCallback, useEffect, useRef, useState } from 'react';
import { createGraphSubscription, initialGraphStreamState, type GraphSubscription } from './workspace/graph-stream';

export type { Connection } from './workspace/graph-stream';

/** Live snapshot over SSE, or the embedded snapshot of a static export. */
export function useGraphStream() {
  const embedded = window.__BLACKBOARD_DATA__;
  const [state, setState] = useState(() => initialGraphStreamState(embedded));
  const subscription = useRef<GraphSubscription | null>(null);
  const reload = useCallback(async () => {
    await subscription.current?.reload();
  }, []);

  useEffect(() => {
    const active = createGraphSubscription(setState, { embedded });
    subscription.current = active;
    return () => {
      active.dispose();
      if (subscription.current === active) subscription.current = null;
    };
  }, [embedded]);
  return { ...state, reload };
}
