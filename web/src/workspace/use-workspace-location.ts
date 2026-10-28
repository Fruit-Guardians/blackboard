import { useEffect, useRef, useState } from 'react';
import type { ViewMode } from '../types';

/** Reader navigation lives in the address bar; restoring it never writes board events. */
export function useWorkspaceLocation() {
  const [initial] = useState(() => {
    const params = new URLSearchParams(location.search);
    const view = params.get('view');
    const mode: ViewMode = view === 'logic' || view === 'all' ? view : 'context';
    return { agentId: params.get('agent') || 'agent:primary', mode, node: params.get('node') };
  });
  const [agentId, setAgentId] = useState(initial.agentId);
  const [mode, setMode] = useState(initial.mode);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Workspace resolves this once the snapshot and visible projection have arrived.
  const deepLink = useRef(initial.node);

  useEffect(() => {
    const url = new URL(location.href);
    url.searchParams.set('view', mode);
    url.searchParams.set('agent', agentId);
    history.replaceState(null, '', url);
  }, [mode, agentId]);

  useEffect(() => {
    if (deepLink.current && !selectedId) return;
    const url = new URL(location.href);
    if (selectedId) url.searchParams.set('node', selectedId); else url.searchParams.delete('node');
    history.replaceState(null, '', url);
  }, [selectedId]);

  return { agentId, setAgentId, mode, setMode, selectedId, setSelectedId, deepLink };
}
