import { memo } from 'react';
import { BaseEdge, getBezierPath, getSmoothStepPath, getStraightPath, useStore, type EdgeProps } from '@xyflow/react';
import { adaptRoute, labelPoint, roundedPath, routeValid, type EdgeRoute } from './edge-route';
import type { EdgeStyle } from './graph';

type RoutedData = { route?: EdgeRoute; style?: EdgeStyle };

/** Follows ELK's route (so edges avoid nodes) while the nodes are where the layout put them; otherwise falls back to a plain path. */
export const RoutedEdge = memo(function RoutedEdge(props: EdgeProps) {
  const { source, target, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd, style, label, interactionWidth } = props;
  const { route, style: shape = 'curve' } = (props.data || {}) as RoutedData;
  const sourcePos = useStore((state) => state.nodeLookup.get(source)?.internals.positionAbsolute);
  const targetPos = useStore((state) => state.nodeLookup.get(target)?.internals.positionAbsolute);

  let path: string;
  let labelX: number;
  let labelY: number;
  if (shape !== 'straight' && routeValid(route, sourcePos, targetPos)) {
    const points = adaptRoute(route, { x: sourceX, y: sourceY }, { x: targetX, y: targetY });
    path = roundedPath(points, shape === 'curve' ? 44 : 8);
    ({ x: labelX, y: labelY } = labelPoint(points));
  } else if (shape === 'straight') {
    [path, labelX, labelY] = getStraightPath({ sourceX, sourceY, targetX, targetY });
  } else if (shape === 'step') {
    [path, labelX, labelY] = getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  } else {
    [path, labelX, labelY] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  }
  return <BaseEdge path={path} labelX={labelX} labelY={labelY} label={label} markerEnd={markerEnd} style={style} interactionWidth={interactionWidth} />;
});
