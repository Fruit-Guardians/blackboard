import { useMemo } from 'react';
import { project, type RelationGroup } from '../graph';
import { filterActive, filterNodes, type NodeFilter } from '../presentation';
import type { GraphSnapshot, ViewMode } from '../types';
import { selectWorkspaceAgent, selectWorkspaceSnapshot } from './selectors';

/** Keep snapshot catalogues stable when only the reader's view, selection or filters change. */
export function useWorkspaceData(snapshot: GraphSnapshot | null, mode: ViewMode, agentId: string, filter: NodeFilter) {
  const board = useMemo(() => selectWorkspaceSnapshot(snapshot), [snapshot]);
  const agent = useMemo(() => selectWorkspaceAgent(snapshot, board, agentId), [snapshot, board, agentId]);
  const projection = useMemo(() => snapshot ? project(snapshot, mode, '', agentId) : null, [snapshot, mode, agentId]);
  const results = useMemo(() => filterActive(filter) ? filterNodes(board.paletteNodes, filter) : null, [board.paletteNodes, filter]);
  const legend = useMemo(() => {
    const types = new Set<string>();
    projection?.nodes.forEach((node) => { if (!node.data.group) types.add(node.data.item.type); });
    const groups = new Set<RelationGroup>();
    projection?.edges.forEach((edge) => {
      // project() assigns every rendered edge a relation family.
      const data = edge.data as { group: RelationGroup };
      groups.add(data.group);
    });
    return { types: [...types].sort(), groups: [...groups] };
  }, [projection]);

  return { board, agent, projection, results, legend };
}
