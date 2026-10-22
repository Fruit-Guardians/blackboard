import { memo, useMemo } from 'react';
import { BaseEdge, getBezierPath, getStraightPath, useStore, useStoreApi, type EdgeProps } from '@xyflow/react';
import { labelPoint, roundedPath, routeValid, type EdgeRoute } from './edge-route';
import { routeAround, type Rect } from './router';
import type { EdgeStyle } from './graph';

type RoutedData = { route?: EdgeRoute; style?: EdgeStyle; text?: string; group?: string; quiet?: boolean };

/** From here on a card is legible, so the relation it hangs on is worth naming too. */
const LABEL_ZOOM = .6;

/**
 * Follows ELK's route while the nodes are where the layout put them. Once a card has been dragged,
 * the edge is re-routed around the other cards instead of being drawn straight through them.
 */
export const RoutedEdge = memo(function RoutedEdge(props: EdgeProps) {
  const { source, target, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerStart, markerEnd, style, label, interactionWidth } = props;
  const { route, style: shape = 'curve', text, group, quiet } = (props.data || {}) as RoutedData;
  // Weak, quiet links stay unnamed until focused; the strong families say what they are once readable.
  const named = useStore((state) => state.transform[2] >= LABEL_ZOOM);
  const shown = label ?? (named && text && group !== 'link' && !quiet ? text : undefined);
  const sourcePos = useStore((state) => state.nodeLookup.get(source)?.internals.positionAbsolute);
  const targetPos = useStore((state) => state.nodeLookup.get(target)?.internals.positionAbsolute);
  const sourceRun = useStore((state) => state.nodeLookup.get(source)?.data.layoutRun as number | undefined);
  const targetRun = useStore((state) => state.nodeLookup.get(target)?.data.layoutRun as number | undefined);
  const laidOut = routeValid(route, sourcePos, targetPos);
  // While a new layout lands, an edge can hold the new route for a frame or two while its cards are
  // still at their old places. That is not a drag; re-routing every edge for it stalls a big board.
  const settling = route?.run !== undefined && (sourceRun !== route.run || targetRun !== route.run);
  const detour = shape !== 'straight' && !laidOut && !settling;
  // Only stale edges subscribe to the node list, so a drag re-renders just the lines it affects.
  const nodes = useStore((state) => (detour ? state.nodes : null));
  const store = useStoreApi();
  const around = useMemo(() => {
    if (!nodes) return null;
    const obstacles: Rect[] = [];
    for (const node of store.getState().nodeLookup.values()) {
      const width = node.measured?.width, height = node.measured?.height;
      if (node.hidden || node.type === 'boardGroup' || !width || !height) continue;
      obstacles.push({ ...node.internals.positionAbsolute, width, height });
    }
    return routeAround({ x: sourceX, y: sourceY }, sourcePosition, { x: targetX, y: targetY }, targetPosition, obstacles);
  }, [nodes, store, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition]);

  let path: string;
  let labelX: number;
  let labelY: number;
  const points = laidOut && shape !== 'straight' ? route!.points : around;
  if (points) {
    path = roundedPath(points, shape === 'curve' ? 44 : 8);
    ({ x: labelX, y: labelY } = labelPoint(points));
  } else if (shape === 'straight') {
    [path, labelX, labelY] = getStraightPath({ sourceX, sourceY, targetX, targetY });
  } else {
    // Boxed in on every side: a plain curve is the last resort.
    [path, labelX, labelY] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  }
  return <BaseEdge path={path} labelX={labelX} labelY={labelY} label={shown} markerStart={markerStart} markerEnd={markerEnd} style={style} interactionWidth={interactionWidth} />;
});
