/** Geometry for edges that follow the route ELK computed, so long edges go around nodes instead of behind them. */
export type Pt = { x: number; y: number };
export type Direction = 'RIGHT' | 'DOWN';

export type EdgeRoute = {
  /** Start, bend points…, end — in canvas coordinates at layout time. Each end sits on its own port on the node border. */
  points: Pt[];
  /** Where the source and target nodes sat when the route was computed. */
  source: Pt;
  target: Pt;
  direction: Direction;
  /** The layout run that produced this route; its cards carry the same number. */
  run?: number;
};

const same = (a: Pt, b: Pt) => Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5;

/** A route is only trustworthy while both of its nodes are where the layout put them. */
export const routeValid = (route: EdgeRoute | undefined, source: Pt | undefined, target: Pt | undefined): route is EdgeRoute =>
  Boolean(route && source && target && same(route.source, source) && same(route.target, target));

/** Polyline with every corner rounded by up to `radius`; the radius never exceeds half a segment. */
export function roundedPath(points: Pt[], radius: number): string {
  if (points.length < 2) return '';
  const fmt = (n: number) => Math.round(n * 100) / 100;
  let path = `M${fmt(points[0].x)},${fmt(points[0].y)}`;
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1], corner = points[i], next = points[i + 1];
    const inLen = Math.hypot(corner.x - prev.x, corner.y - prev.y);
    const outLen = Math.hypot(next.x - corner.x, next.y - corner.y);
    const r = Math.min(radius, inLen / 2, outLen / 2);
    if (r < 0.5) { path += `L${fmt(corner.x)},${fmt(corner.y)}`; continue; }
    const enter = { x: corner.x - ((corner.x - prev.x) / inLen) * r, y: corner.y - ((corner.y - prev.y) / inLen) * r };
    const leave = { x: corner.x + ((next.x - corner.x) / outLen) * r, y: corner.y + ((next.y - corner.y) / outLen) * r };
    path += `L${fmt(enter.x)},${fmt(enter.y)}Q${fmt(corner.x)},${fmt(corner.y)} ${fmt(leave.x)},${fmt(leave.y)}`;
  }
  const last = points[points.length - 1];
  return `${path}L${fmt(last.x)},${fmt(last.y)}`;
}

/** Midpoint of the middle segment, where the relation label sits. */
export function labelPoint(points: Pt[]): Pt {
  const i = Math.max(1, Math.floor(points.length / 2));
  const a = points[i - 1], b = points[Math.min(i, points.length - 1)];
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}
