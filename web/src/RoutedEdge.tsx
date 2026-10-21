import { memo, useMemo } from 'react';
import { BaseEdge, getBezierPath, getStraightPath, useStore, useStoreApi, type EdgeProps } from '@xyflow/react';
import { labelPoint, roundedPath, routeValid, type EdgeRoute } from './edge-route';
import { routeAround, type Rect } from './router';
import type { EdgeStyle } from './graph';

type RoutedData = { route?: EdgeRoute; style?: EdgeStyle };

/**
 * Follows ELK's route while the nodes are where the layout put them. Once a card has been dragged,
 * the edge is re-routed around the other cards instead of being drawn straight through them.
 */
export const RoutedEdge = memo(function RoutedEdge(props: EdgeProps) {
  const { source, target, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerStart, markerEnd, style, label, interactionWidth } = props;
  const { route, style: shape = 'curve' } = (props.data || {}) as RoutedData;
  const sourcePos = useStore((state) => state.nodeLookup.get(source)?.internals.positionAbsolute);
  const targetPos = useStore((state) => state.nodeLookup.get(target)?.internals.positionAbsolute);
  const laidOut = routeValid(route, sourcePos, targetPos);
  const detour = shape !== 'straight' && !laidOut;
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
  return <BaseEdge path={path} labelX={labelX} labelY={labelY} label={label} markerStart={markerStart} markerEnd={markerEnd} style={style} interactionWidth={interactionWidth} />;
});
