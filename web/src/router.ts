/** Orthogonal routing around cards for edges whose layout route went stale (after a drag). */
import type { Pt } from './edge-route';

export type Rect = { x: number; y: number; width: number; height: number };
export type Side = 'left' | 'right' | 'top' | 'bottom';

// Directions: 0 right, 1 down, 2 left, 3 up.
const DX = [1, 0, -1, 0];
const DY = [0, 1, 0, -1];
const OUT: Record<Side, number> = { right: 0, bottom: 1, left: 2, top: 3 };

/** Simple min-heap of [priority, id] pairs. */
class Heap {
  private items: [number, number][] = [];
  get size() { return this.items.length; }
  push(item: [number, number]) {
    const a = this.items; a.push(item);
    for (let i = a.length - 1; i > 0;) {
      const p = (i - 1) >> 1;
      if (a[p][0] <= a[i][0]) break;
      [a[p], a[i]] = [a[i], a[p]]; i = p;
    }
  }
  pop(): [number, number] {
    const a = this.items; const top = a[0]; const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      for (let i = 0; ;) {
        const l = 2 * i + 1, r = l + 1; let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]]; i = m;
      }
    }
    return top;
  }
}

/** Drops points that sit in the middle of a straight run. */
export function simplify(points: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of points) {
    const n = out.length;
    if (n && Math.abs(out[n - 1].x - p.x) < 0.5 && Math.abs(out[n - 1].y - p.y) < 0.5) continue;
    if (n >= 2) {
      const a = out[n - 2], b = out[n - 1];
      const collinear = (Math.abs(a.x - b.x) < 0.5 && Math.abs(b.x - p.x) < 0.5) || (Math.abs(a.y - b.y) < 0.5 && Math.abs(b.y - p.y) < 0.5);
      if (collinear) { out[n - 1] = p; continue; }
    }
    out.push(p);
  }
  return out;
}

/**
 * Shortest orthogonal path from `start` (leaving through `startSide`) to `end` (entering through
 * `endSide`) that keeps `clearance` away from every obstacle, trading length against bends.
 *
 * A* runs on the sparse grid made of the obstacles' inflated borders, so the search grows with the
 * number of cards near the two ends rather than with the canvas size. Returns null when no way exists.
 */
export function routeAround(start: Pt, startSide: Side, end: Pt, endSide: Side, obstacles: Rect[], clearance = 18, bendCost = 48): Pt[] | null {
  // The stubs reach a little past the clearance so a handle drawn on the border is never boxed in by its own card.
  const stub = clearance + 2;
  const a = { x: start.x + DX[OUT[startSide]] * stub, y: start.y + DY[OUT[startSide]] * stub };
  const b = { x: end.x + DX[OUT[endSide]] * stub, y: end.y + DY[OUT[endSide]] * stub };
  const inside = (box: { l: number; t: number; r: number; b: number }, x: number, y: number) => x > box.l + 0.5 && x < box.r - 0.5 && y > box.t + 0.5 && y < box.b - 0.5;

  // Only cards around the two ends matter; the window leaves room to detour around a blocking column.
  const margin = 360;
  const win = { l: Math.min(a.x, b.x) - margin, t: Math.min(a.y, b.y) - margin, r: Math.max(a.x, b.x) + margin, b: Math.max(a.y, b.y) + margin };
  const boxes = obstacles
    .map((o) => ({ l: o.x - clearance, t: o.y - clearance, r: o.x + o.width + clearance, b: o.y + o.height + clearance }))
    .filter((box) => box.r > win.l && box.l < win.r && box.b > win.t && box.t < win.b)
    // Cards dropped on top of each other must not wall the ends in.
    .filter((box) => !inside(box, a.x, a.y) && !inside(box, b.x, b.y));

  const axis = (pick: (box: typeof win) => number[], ends: number[]) =>
    [...new Set([...ends, ...pick(win), ...boxes.flatMap(pick)].map((v) => Math.round(v)))].sort((p, q) => p - q);
  const xs = axis((box) => [box.l, box.r], [a.x, b.x, (a.x + b.x) / 2].map(Math.round));
  const ys = axis((box) => [box.t, box.b], [a.y, b.y, (a.y + b.y) / 2].map(Math.round));
  const nx = xs.length, ny = ys.length;
  const free = (x: number, y: number) => !boxes.some((box) => inside(box, x, y));
  const open = new Uint8Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) open[j * nx + i] = free(xs[i], ys[j]) ? 1 : 0;

  const si = xs.indexOf(Math.round(a.x)), sj = ys.indexOf(Math.round(a.y));
  const ti = xs.indexOf(Math.round(b.x)), tj = ys.indexOf(Math.round(b.y));
  const finalDir = (OUT[endSide] + 2) % 4;
  const states = nx * ny * 4;
  const GOAL = states;
  const g = new Float64Array(states + 1).fill(Infinity);
  const parent = new Int32Array(states + 1).fill(-1);
  const h = (i: number, j: number) => Math.abs(xs[i] - xs[ti]) + Math.abs(ys[j] - ys[tj]);
  const heap = new Heap();
  const first = (sj * nx + si) * 4 + OUT[startSide];
  g[first] = 0;
  heap.push([h(si, sj), first]);

  while (heap.size) {
    const [f, id] = heap.pop();
    if (id === GOAL) break;
    const d = id & 3, cell = id >> 2, i = cell % nx, j = (cell - i) / nx;
    if (f - h(i, j) > g[id] + 1e-6) continue; // stale heap entry
    if (i === ti && j === tj) {
      const cost = g[id] + (d === finalDir ? 0 : bendCost);
      if (cost < g[GOAL]) { g[GOAL] = cost; parent[GOAL] = id; heap.push([cost, GOAL]); }
      continue;
    }
    for (let d2 = 0; d2 < 4; d2++) {
      if (d2 === (d + 2) % 4) continue;
      const i2 = i + DX[d2], j2 = j + DY[d2];
      if (i2 < 0 || j2 < 0 || i2 >= nx || j2 >= ny || !open[j2 * nx + i2]) continue;
      // Grid lines include every border, so a segment is clear exactly when its midpoint is.
      if (!free((xs[i] + xs[i2]) / 2, (ys[j] + ys[j2]) / 2)) continue;
      const next = (j2 * nx + i2) * 4 + d2;
      const cost = g[id] + Math.abs(xs[i2] - xs[i]) + Math.abs(ys[j2] - ys[j]) + (d2 === d ? 0 : bendCost);
      if (cost < g[next]) { g[next] = cost; parent[next] = id; heap.push([cost + h(i2, j2), next]); }
    }
  }
  if (parent[GOAL] < 0) return null;
  const path: Pt[] = [];
  for (let id = parent[GOAL]; id >= 0; id = parent[id]) {
    const cell = id >> 2, i = cell % nx;
    path.push({ x: xs[i], y: ys[(cell - i) / nx] });
  }
  return simplify([start, a, ...path.reverse(), b, end]);
}
