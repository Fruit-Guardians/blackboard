/* blackboard viewer — canvas renderer.
 *
 * Layout: longest-path depth becomes the column (x); nodes pack vertically
 * within their column. Compact anchors are pulled out of the flow so causal
 * chains stay readable. One canvas with a viewport transform keeps 5k nodes
 * smooth.
 */
'use strict';

// Color slots follow the categorical theme order: violet, aqua, blue, orange,
// red, magenta. Start/compact share the two outer slots because they are
// structural anchors rather than work items.
const TYPE = {
  start: { label: '起点', color: '--c-start', size: 0.82 },
  goal: { label: '目标', color: '--c-goal', size: 0.95 },
  intent: { label: '意图', color: '--c-intent', size: 1.0 },
  observation: { label: '观察', color: '--c-fact', size: 1.0 },
  fact: { label: '事实', color: '--c-fact', size: 1.0 },
  hypothesis: { label: '猜测', color: '--c-hint', size: 1.0 },
  question: { label: '问题', color: '--c-compact', size: 0.95 },
  action: { label: '行动', color: '--c-intent', size: 0.95 },
  result: { label: '结果', color: '--c-fact', size: 1.0 },
  finding: { label: '发现', color: '--c-vuln', size: 1.12 },
  vuln: { label: '漏洞', color: '--c-vuln', size: 1.12 },
  hint: { label: '提示', color: '--c-hint', size: 0.9 },
  summary: { label: '摘要', color: '--c-compact', size: 0.85 },
  note: { label: '记录', color: '--ink-3', size: 0.85 },
  compact: { label: '压缩', color: '--c-compact', size: 0.8 },
};

const LEGEND_ORDER = [
  'start', 'goal', 'intent', 'observation', 'fact', 'hypothesis', 'question',
  'action', 'result', 'finding', 'vuln', 'hint', 'summary', 'note', 'compact',
];

const EDGE = {
  'related-to': { label: '相关', color: '--ink-3', dash: [3, 4], width: 1, alpha: 0.36 },
  'derived-from': { label: '派生自', color: '--c-intent', dash: [], width: 1.2, alpha: 0.56 },
  supports: { label: '支持', color: '--c-goal', dash: [], width: 1.5, alpha: 0.7 },
  contradicts: { label: '反驳', color: '--c-vuln', dash: [6, 3], width: 1.6, alpha: 0.78 },
  'depends-on': { label: '依赖', color: '--c-intent', dash: [2, 3], width: 1.3, alpha: 0.62 },
  proves: { label: '证明', color: '--c-vuln', dash: [2, 3], width: 1.9, alpha: 0.9 },
  'caused-by': { label: '因果', color: '--c-fact', dash: [], width: 1.5, alpha: 0.68 },
  refines: { label: '细化', color: '--c-compact', dash: [], width: 1.2, alpha: 0.55 },
  duplicates: { label: '重复', color: '--ink-3', dash: [1, 3], width: 1, alpha: 0.4 },
  supersedes: { label: '取代', color: '--c-compact', dash: [7, 3], width: 1.8, alpha: 0.82 },
  resolves: { label: '解决', color: '--c-goal', dash: [5, 3], width: 1.5, alpha: 0.72 },
  derive: { label: '派生', color: '--ink-3', dash: [], width: 1, alpha: 0.42 },
  'intent-chain': { label: '意图链', color: '--c-intent', dash: [], width: 1.4, alpha: 0.62 },
  produce: { label: '产出', color: '--c-intent-2', dash: [5, 4], width: 1.2, alpha: 0.55 },
  prove: { label: '证明', color: '--c-vuln', dash: [2, 3], width: 1.9, alpha: 0.9 },
};

// Nodes narrower than this are drawn as rails; they expand on hover so a
// large graph can stay dense without hiding what a node is.
const DETAIL_K = 0.62;
const NODE_W = 242;
const RAIL_W = 132;
const NODE_H = 42;
const COL_GAP = 100;
const ROW_GAP = 14;
const PAD = 90;

const state = {
  raw: null,
  nodes: [],
  byId: new Map(),
  edges: [],
  displayNodes: [],
  displayEdges: [],
  displayIds: new Set(),
  inboxNodes: [],
  cols: [],
  bounds: { x0: 0, y0: 0, x1: 0, y1: 0 },
  view: { x: 0, y: 0, k: 1 },
  hiddenTypes: new Set(),
  hiddenEdges: new Set(),
  frontierOnly: false,
  query: '',
  selected: null,
  hovered: null,
  cursorIds: new Set(),
  trailPairs: [],
  showTrail: true,
  viewMode: ['context', 'logic', 'timeline', 'all'].includes(new URLSearchParams(location.search).get('view'))
    ? new URLSearchParams(location.search).get('view') : 'context',
  dragging: null,
  dragMoved: false,
  needsRender: true,
  dpr: 1,
};

const $ = (id) => document.getElementById(id);
const canvas = $('canvas');
const ctx = canvas.getContext('2d');
const mini = $('miniCanvas');
const mctx = mini.getContext('2d');

const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function roundRect(c, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  c.beginPath();
  c.moveTo(x + rr, y);
  c.arcTo(x + w, y, x + w, y + h, rr);
  c.arcTo(x + w, y + h, x, y + h, rr);
  c.arcTo(x, y + h, x, y, rr);
  c.arcTo(x, y, x + w, y, rr);
  c.closePath();
}

/* ------------------------------ data ------------------------------ */

function normalize(raw) {
  const nodes = Object.values(raw.nodes || {});
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const edges = Object.values(raw.edges || {}).filter((e) => byId.has(e.from) && byId.has(e.to));
  return { ...raw, nodes, byId, edges };
}

function currentNodeId() {
  return state.raw?.cursors?.['agent:primary']?.to || state.raw?.meta?.focus || [...state.cursorIds][0] || null;
}

function shortTitle(node, limit = 52) {
  const raw = String(node?.title || node?.id || '').replace(/\s+/g, ' ').trim();
  if (raw.length <= limit) return raw;
  const first = raw.split(/[。；\n]/)[0];
  const useful = first.length >= 12 ? first : raw;
  return `${useful.slice(0, limit - 1)}…`;
}

function deriveInbox() {
  const linked = new Set(state.edges.flatMap((e) => [e.from, e.to]));
  state.inboxNodes = state.nodes
    .filter((n) => !linked.has(n.id))
    .sort((a, b) => (b.ts || 0) - (a.ts || 0));
  $('inboxCount').textContent = String(state.inboxNodes.length);
  renderInbox();
}

function nodesForView() {
  const all = state.nodes;
  if (state.viewMode === 'all' || state.viewMode === 'timeline') return all;
  const linked = new Set(state.edges.flatMap((e) => [e.from, e.to]));
  if (state.viewMode === 'logic') return all.filter((n) => linked.has(n.id));

  // Current scene is a derived projection only. It never writes an edge or
  // changes cursor state, so the Agent remains entirely unconstrained.
  const ids = new Set();
  const cur = currentNodeId();
  const adjacency = new Map(all.map((n) => [n.id, []]));
  for (const e of state.edges) {
    adjacency.get(e.from)?.push(e.to);
    adjacency.get(e.to)?.push(e.from);
  }
  if (cur && adjacency.has(cur)) {
    ids.add(cur);
    let wave = [cur];
    for (let depth = 0; depth < 2; depth += 1) {
      const next = [];
      for (const id of wave) for (const to of adjacency.get(id) || []) {
        if (!ids.has(to)) { ids.add(to); next.push(to); }
      }
      wave = next;
    }
  }
  for (const n of all) {
    if (n.type === 'goal') ids.add(n.id);
    if (['intent', 'hypothesis', 'question'].includes(n.type) &&
        ['open', 'active', 'blocked'].includes(n.status || 'open')) ids.add(n.id);
  }
  const checkpoints = Object.values(state.raw?.checkpoints || {})
    .sort((a, b) => (a.at || 0) - (b.at || 0)).slice(-2);
  for (const c of checkpoints) if (c.cursorNodeId && state.byId.has(c.cursorNodeId)) ids.add(c.cursorNodeId);
  for (const n of all.slice(-10)) ids.add(n.id);
  if (state.query.trim()) for (const n of all) if (matchesQuery(n, state.query.trim().toLowerCase())) ids.add(n.id);
  return all.filter((n) => ids.has(n.id));
}

function setData(raw) {
  const data = normalize(raw);
  state.raw = data;
  state.nodes = data.nodes;
  state.byId = data.byId;
  state.edges = data.edges;
  state.cursorIds = new Set([
    ...Object.values(raw.cursors || {}).map((c) => c && c.to).filter(Boolean),
    ...(raw.meta?.focus ? [raw.meta.focus] : []),
  ]);
  const trail = raw.cursorTrail || [];
  state.trailPairs = trail
    .filter((c) => c && c.from && c.to && data.byId.has(c.from) && data.byId.has(c.to))
    .slice(-10)
    .map((c, i, a) => ({ from: c.from, to: c.to, alpha: (i + 1) / a.length }));
  deriveInbox();
  layout();
  renderViewButtons();
  renderLegend();
  renderStats();
  renderDigest();
  updateEmpty();
  state.needsRender = true;
}

/* ------------------------------ layout ------------------------------ */

function layout() {
  const display = nodesForView();
  state.displayNodes = display;
  state.displayIds = new Set(display.map((n) => n.id));
  state.displayEdges = state.edges.filter((e) => state.displayIds.has(e.from) && state.displayIds.has(e.to));
  if (state.viewMode === 'timeline') state.displayEdges = [];

  const setBounds = () => {
    if (!display.length) {
      state.bounds = { x0: 0, y0: 0, x1: 1, y1: 1 };
      return;
    }
    const xs = display.map((n) => n._x || 0);
    const ys = display.map((n) => n._y || 0);
    state.bounds = {
      x0: Math.min(...xs) - PAD,
      y0: Math.min(...ys) - PAD,
      x1: Math.max(...xs) + NODE_W + PAD,
      y1: Math.max(...ys) + NODE_H + PAD,
    };
  };

  if (state.viewMode === 'timeline') {
    const ordered = display.slice().sort((a, b) => (a.ts || 0) - (b.ts || 0));
    const rows = Math.min(16, Math.max(1, Math.ceil(Math.sqrt(ordered.length * 2.2))));
    ordered.forEach((n, i) => {
      n._x = PAD + Math.floor(i / rows) * (NODE_W + 44);
      n._y = PAD + (i % rows) * (NODE_H + 14);
      n._w = NODE_W; n._h = NODE_H;
    });
    state.cols = [];
    state.colCount = Math.ceil(ordered.length / rows);
    setBounds();
    deriveFrontier();
    return;
  }

  const degree = new Map(display.map((n) => [n.id, 0]));
  for (const e of state.displayEdges) {
    degree.set(e.from, (degree.get(e.from) || 0) + 1);
    degree.set(e.to, (degree.get(e.to) || 0) + 1);
  }
  const core = display.filter((n) => (degree.get(n.id) || 0) > 0);
  const loose = display.filter((n) => (degree.get(n.id) || 0) === 0);

  let coreBottom = 0;
  if (core.length) {
    const outgoing = new Map(core.map((n) => [n.id, []]));
    const incoming = new Map(core.map((n) => [n.id, []]));
    for (const e of state.displayEdges) {
      outgoing.get(e.from)?.push(e.to);
      incoming.get(e.to)?.push(e.from);
    }

    // Longest-path layering is used only as presentation. Cycles and arbitrary
    // relations remain valid data and are still drawn.
    const depth = new Map();
    const color = new Map();
    const dfs = (startId) => {
      const stack = [{ id: startId, i: 0 }];
      color.set(startId, 1);
      depth.set(startId, Math.max(depth.get(startId) || 0, 0));
      while (stack.length) {
        const frame = stack[stack.length - 1];
        const kids = outgoing.get(frame.id) || [];
        if (frame.i >= kids.length) { color.set(frame.id, 2); stack.pop(); continue; }
        const to = kids[frame.i++];
        const c = color.get(to) || 0;
        if (c === 1) continue;
        depth.set(to, Math.max(depth.get(to) || 0, (depth.get(frame.id) || 0) + 1));
        if (c === 0) { color.set(to, 1); stack.push({ id: to, i: 0 }); }
      }
    };
    for (const n of core.filter((n) => !(incoming.get(n.id) || []).length)) if (!color.get(n.id)) dfs(n.id);
    for (const n of core) if (!color.get(n.id)) dfs(n.id);

    const colMap = new Map();
    for (const n of core) {
      const d = depth.get(n.id) || 0;
      if (!colMap.has(d)) colMap.set(d, []);
      colMap.get(d).push(n);
    }
    const cols = [...colMap.keys()].sort((a, b) => a - b);
    for (const d of cols) colMap.get(d).sort((a, b) => (a.ts || 0) - (b.ts || 0));

    const pos = new Map();
    const reindex = () => cols.forEach((d) => colMap.get(d).forEach((n, i) => pos.set(n.id, i)));
    const median = (values) => {
      if (!values.length) return null;
      const v = values.slice().sort((a, b) => a - b), m = Math.floor(v.length / 2);
      return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
    };
    reindex();
    for (let sweep = 0; sweep < 6; sweep += 1) {
      const ltr = sweep % 2 === 0;
      for (const d of ltr ? cols : cols.slice().reverse()) {
        const list = colMap.get(d);
        const keyed = list.map((n) => {
          const neighbours = ltr ? incoming.get(n.id) : outgoing.get(n.id);
          const m = median((neighbours || []).filter((id) => pos.has(id)).map((id) => pos.get(id)));
          return { n, key: m ?? pos.get(n.id), tie: pos.get(n.id) };
        });
        keyed.sort((a, b) => (a.key - b.key) || (a.tie - b.tie));
        colMap.set(d, keyed.map((x) => x.n));
        reindex();
      }
    }

    const yOf = new Map();
    for (const d of cols) {
      let cursorY = PAD;
      for (const n of colMap.get(d)) {
        const parents = (incoming.get(n.id) || []).filter((id) => yOf.has(id));
        const aim = parents.length ? parents.reduce((sum, id) => sum + yOf.get(id), 0) / parents.length : cursorY;
        n._y = Math.max(PAD, aim, cursorY);
        n._x = PAD + d * (NODE_W + COL_GAP);
        n._w = NODE_W; n._h = NODE_H;
        yOf.set(n.id, n._y);
        cursorY = n._y + NODE_H + ROW_GAP;
        coreBottom = Math.max(coreBottom, cursorY);
      }
    }
    state.cols = cols.map((d) => ({ depth: d, x: PAD + d * (NODE_W + COL_GAP), count: colMap.get(d).length }));
    state.colCount = cols.length;
  } else {
    state.cols = [];
    state.colCount = 0;
  }

  // Unlinked nodes remain first-class data, but a compact grid keeps them from
  // stretching one column and shrinking the useful logic graph to unreadable size.
  if (loose.length) {
    const columns = Math.min(5, Math.max(1, Math.ceil(Math.sqrt(loose.length * 1.6))));
    const top = core.length ? coreBottom + PAD * 0.8 : PAD;
    loose.sort((a, b) => (b.ts || 0) - (a.ts || 0)).forEach((n, i) => {
      n._x = PAD + (i % columns) * (NODE_W + 28);
      n._y = top + Math.floor(i / columns) * (NODE_H + 12);
      n._w = NODE_W; n._h = NODE_H;
    });
  }
  setBounds();
  deriveFrontier();
}

function deriveFrontier() {
  const incoming = new Map(state.nodes.map((n) => [n.id, []]));
  const outgoing = new Map(state.nodes.map((n) => [n.id, []]));
  for (const e of state.edges) {
    incoming.get(e.to)?.push(e.from);
    outgoing.get(e.from)?.push(e.to);
  }
  const openNodes = state.nodes.filter((n) =>
    ['intent', 'hypothesis', 'question'].includes(n.type) &&
    ['open', 'active', 'blocked'].includes(n.status || 'open'));
  const frontier = new Set();
  const walk = (seed, map) => {
    const stack = [...(map.get(seed) || [])];
    while (stack.length) {
      const id = stack.pop();
      if (frontier.has(id)) continue;
      frontier.add(id); stack.push(...(map.get(id) || []));
    }
  };
  for (const n of openNodes) { frontier.add(n.id); walk(n.id, incoming); walk(n.id, outgoing); }
  state.frontier = frontier;
}

/* ------------------------------ viewport ------------------------------ */

function resize() {
  const wrap = $('canvasWrap');
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  state.dpr = dpr;
  const w = wrap.clientWidth;
  const h = wrap.clientHeight;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  const mr = mini.getBoundingClientRect();
  mini.width = Math.round(mr.width * dpr);
  mini.height = Math.round(mr.height * dpr);
  state.needsRender = true;
}

function fit(animate) {
  if (!state.displayNodes.length) return;
  const wrap = $('canvasWrap');
  const w = wrap.clientWidth;
  const h = wrap.clientHeight;
  const b = state.bounds;
  const bw = Math.max(1, b.x1 - b.x0);
  const bh = Math.max(1, b.y1 - b.y0);
  const k = clamp(Math.min((w - 40) / bw, (h - 40) / bh), 0.04, 1.25);
  const target = {
    k,
    x: (w - bw * k) / 2 - b.x0 * k,
    y: (h - bh * k) / 2 - b.y0 * k,
  };
  if (animate) animateView(target, 260);
  else {
    Object.assign(state.view, target);
    state.needsRender = true;
  }
}

let anim = null;
function animateView(target, ms) {
  if (anim) cancelAnimationFrame(anim);
  const start = { ...state.view };
  const t0 = performance.now();
  const step = (now) => {
    const t = clamp((now - t0) / ms, 0, 1);
    const e = 1 - Math.pow(1 - t, 3);
    state.view.k = start.k + (target.k - start.k) * e;
    state.view.x = start.x + (target.x - start.x) * e;
    state.view.y = start.y + (target.y - start.y) * e;
    scheduleRender();
    if (t < 1) anim = requestAnimationFrame(step);
    else anim = null;
  };
  anim = requestAnimationFrame(step);
}

let topbarH = 0;
function chromeHeight() {
  const top = document.querySelector('.topbar');
  const legend = document.querySelector('.legend');
  return (top?.offsetHeight || 0) + (legend?.offsetHeight || 0);
}

function centerOn(node) {
  const wrap = $('canvasWrap');
  const k = Math.max(state.view.k, 0.75);
  animateView(
    {
      k,
      x: wrap.clientWidth / 2 - (node._x + NODE_W / 2) * k,
      y: wrap.clientHeight / 2 - (node._y + NODE_H / 2) * k,
    },
    320,
  );
}

/* ------------------------------ hit testing ------------------------------ */

function visibleNodes() {
  return state.displayNodes.filter((n) => !state.hiddenTypes.has(n.type));
}

function screenToWorld(sx, sy) {
  return { x: (sx - state.view.x) / state.view.k, y: (sy - state.view.y) / state.view.k };
}

function nodeAt(sx, sy) {
  const p = screenToWorld(sx, sy);
  const list = visibleNodes();
  const lod = state.view.k < 0.14 ? 'dots' : state.view.k < 0.34 ? 'rail' : 'full';
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const n = list[i];
    const w = lod === 'full' || n.id === state.hovered || n.id === state.selected ? NODE_W : RAIL_W;
    if (p.x >= n._x && p.x <= n._x + w && p.y >= n._y && p.y <= n._y + NODE_H) return n;
  }
  return null;
}

function matchesQuery(n, q) {
  if (!q) return false;
  const s = `${n.id} ${n.title || ''} ${n.detail || ''}`.toLowerCase();
  return s.includes(q);
}

/* ------------------------------ render ------------------------------ */

function draw() {
  const wrap = $('canvasWrap');
  const w = wrap.clientWidth;
  const h = wrap.clientHeight;
  const dpr = state.dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const v = state.view;
  const q = state.query.trim().toLowerCase();
  const matchIds = new Set();
  if (q) for (const n of state.nodes) if (matchesQuery(n, q)) matchIds.add(n.id);

  const dim = (n) => {
    if (state.hiddenTypes.has(n.type)) return true;
    if (n.status === 'superseded') return true;
    if (state.frontierOnly && !state.frontier.has(n.id)) return true;
    if (q && !matchIds.has(n.id)) return true;
    return false;
  };

  ctx.save();
  ctx.translate(v.x, v.y);
  ctx.scale(v.k, v.k);

  const k = v.k;
  const lod = k < 0.14 ? 'dots' : k < 0.34 ? 'rail' : 'full';
  const widthOf = (n) => (lod === 'full' || n.id === state.hovered || n.id === state.selected ? NODE_W : RAIL_W);

  // ---- edges ----
  ctx.lineCap = 'round';
  for (const e of state.displayEdges) {
    if (state.hiddenEdges.has(e.kind)) continue;
    const a = state.byId.get(e.from);
    const b = state.byId.get(e.to);
    if (!a || !b) continue;
    if (state.hiddenTypes.has(a.type) || state.hiddenTypes.has(b.type)) continue;
    const style = EDGE[e.kind] || EDGE.derive;
    const faded = dim(a) || dim(b);
    const ax = a._x + widthOf(a);
    const ay = a._y + NODE_H / 2;
    const bx = b._x;
    const by = b._y + NODE_H / 2;
    const mx = (ax + bx) / 2;
    ctx.globalAlpha = faded ? style.alpha * 0.18 : style.alpha;
    ctx.strokeStyle = cssVar(style.color) || cssVar('--ink-3');
    ctx.lineWidth = Math.max(0.6, style.width / Math.max(k, 0.5)) * Math.min(Math.max(k, 0.4), 1.2);
    if (style.dash.length) ctx.setLineDash(style.dash.map((d) => d / Math.min(Math.max(k, 0.35), 1)));
    else ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.bezierCurveTo(mx, ay, mx, by, bx, by);
    ctx.stroke();
    if ((e.kind === 'prove' || e.kind === 'proves') && k > 0.5) {
      // arrowhead at the target end
      ctx.setLineDash([]);
      ctx.fillStyle = ctx.strokeStyle;
      const s = 4.5 / k;
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.lineTo(bx - s, by - s * 0.55);
      ctx.lineTo(bx - s, by + s * 0.55);
      ctx.closePath();
      ctx.fill();
    }
  }
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;

  // Agent movement is a separate attention layer, not a logical relation.
  for (const step of state.showTrail && state.viewMode !== 'timeline' ? state.trailPairs : []) {
    if (!state.displayIds.has(step.from) || !state.displayIds.has(step.to)) continue;
    const a = state.byId.get(step.from);
    const b = state.byId.get(step.to);
    if (!a || !b) continue;
    const ax = a._x + widthOf(a) / 2;
    const ay = a._y + NODE_H / 2;
    const bx = b._x + widthOf(b) / 2;
    const by = b._y + NODE_H / 2;
    ctx.globalAlpha = 0.12 + step.alpha * 0.42;
    ctx.strokeStyle = cssVar('--accent');
    ctx.lineWidth = (1.2 + step.alpha * 1.8) / Math.max(k, 0.35);
    ctx.setLineDash([7 / Math.max(k, 0.35), 5 / Math.max(k, 0.35)]);
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;

  // ---- nodes ----
  const list = state.displayNodes;
  for (const n of list) {
    if (state.hiddenTypes.has(n.type)) continue;
    const faded = dim(n);
    const t = TYPE[n.type] || TYPE.fact;
    const color = cssVar(t.color) || cssVar('--ink-3');
    const x = n._x;
    const y = n._y;
    const selected = state.selected === n.id;
    const hovered = state.hovered === n.id;
    const matched = q && matchIds.has(n.id);
    const isCurrent = state.cursorIds.has(n.id);
    const open = ['intent', 'hypothesis', 'question'].includes(n.type) &&
      ['open', 'active', 'blocked'].includes(n.status || 'open');

    ctx.globalAlpha = faded ? 0.16 : 1;

    if (lod === 'dots') {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x + 5, y + NODE_H / 2, Math.max(2.2, 3 / k * 0.35), 0, Math.PI * 2);
      ctx.fill();
      if (isCurrent) {
        ctx.strokeStyle = cssVar('--accent');
        ctx.lineWidth = 2.4 / k;
        ctx.beginPath();
        ctx.arc(x + 5, y + NODE_H / 2, 8 / k, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (matched) {
        ctx.strokeStyle = color;
        ctx.lineWidth = 2 / k;
        ctx.beginPath();
        ctx.arc(x + 5, y + NODE_H / 2, 6 / k, 0, Math.PI * 2);
        ctx.stroke();
      }
      continue;
    }

    // card
    const expanded = lod === 'full' || (lod === 'rail' && (hovered || selected));
    const curW = expanded ? NODE_W : RAIL_W;
    const showRailText = !expanded && k > 0.24;
    const showCardText = expanded && (k > 0.26 || hovered || selected);
    const surface = cssVar('--surface-1');
    const border = hovered || selected ? color : cssVar('--border');
    ctx.shadowColor = 'rgba(0,0,0,0.10)';
    ctx.shadowBlur = selected || hovered ? 10 / k : 0;
    ctx.shadowOffsetY = 1 / k;
    roundRect(ctx, x, y, curW, NODE_H, 6);
    ctx.fillStyle = surface;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
    ctx.strokeStyle = border;
    ctx.lineWidth = (selected ? 2 : 1) / Math.max(k, 0.35);
    ctx.stroke();

    if (isCurrent) {
      ctx.strokeStyle = cssVar('--accent');
      ctx.lineWidth = 3 / Math.max(k, 0.35);
      ctx.globalAlpha = faded ? 0.34 : 0.95;
      roundRect(ctx, x - 5, y - 5, curW + 10, NODE_H + 10, 10);
      ctx.stroke();
      ctx.globalAlpha = faded ? 0.16 : 1;
    }

    // left color rail
    ctx.save();
    roundRect(ctx, x, y, curW, NODE_H, 6);
    ctx.clip();
    ctx.fillStyle = color;
    ctx.fillRect(x, y, expanded ? 3 : 4, NODE_H);
    if (n.type === 'vuln' || !expanded) {
      ctx.globalAlpha = faded ? 0.1 : n.type === 'vuln' ? 0.1 : 0.075;
      ctx.fillRect(x, y, curW, NODE_H);
      ctx.globalAlpha = faded ? 0.16 : 1;
    }
    if (open && expanded) {
      ctx.fillStyle = cssVar('--accent');
      ctx.fillRect(x + curW - 3, y, 3, NODE_H);
    }
    ctx.restore();

    if (expanded) {
      // A compact two-level card: semantic metadata stays scannable while the
      // full, unconstrained title remains available in tooltip/detail.
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x + 13, y + 12, 2.6, 0, Math.PI * 2);
      ctx.fill();

      if (showCardText) {
        ctx.textBaseline = 'middle';
        ctx.font = '9.5px system-ui, -apple-system, "PingFang SC", sans-serif';
        ctx.fillStyle = cssVar('--ink-3');
        ctx.fillText(`${t.label}${n.status ? ` · ${n.status}` : ''}`, x + 22, y + 12);
        ctx.fillStyle = cssVar('--ink-1');
        ctx.font = `${n.type === 'vuln' ? '600 ' : ''}11.5px system-ui, -apple-system, "PingFang SC", sans-serif`;
        const textX = x + 12;
        const maxW = NODE_W - 24;
        let title = shortTitle(n);
        if (ctx.measureText(title).width > maxW) {
          while (title.length > 4 && ctx.measureText(`${title}…`).width > maxW) title = title.slice(0, -1);
          title = `${title}…`;
        }
        ctx.fillText(title, textX, y + 29);
      }
    } else if (showRailText) {
      // rail: a shortened title plus the id, enough to scan at medium zoom
      ctx.textBaseline = 'middle';
      ctx.fillStyle = cssVar('--ink-1');
      ctx.font = `10.5px system-ui, -apple-system, "PingFang SC", sans-serif`;
      let title = shortTitle(n, 36);
      const maxW = RAIL_W - 24;
      if (ctx.measureText(title).width > maxW) {
        while (title.length > 2 && ctx.measureText(`${title}…`).width > maxW) title = title.slice(0, -1);
        title = `${title}…`;
      }
      ctx.fillText(title, x + 12, y + NODE_H / 2 + 0.5);
      ctx.font = '9px ui-monospace, SFMono-Regular, Menlo, monospace';
      ctx.fillStyle = cssVar('--ink-3');
      ctx.fillText(n.id, x + 12, y + NODE_H - 7);
    }

    if (matched) {
      ctx.strokeStyle = color;
      ctx.lineWidth = 2 / Math.max(k, 0.35);
      roundRect(ctx, x - 3, y - 3, curW + 6, NODE_H + 6, 8);
      ctx.stroke();
    }
    if (open && !expanded) {
      ctx.fillStyle = cssVar('--accent');
      ctx.beginPath();
      ctx.arc(x + 5, y + 5, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
  ctx.restore();

  drawMinimap();
}

function drawMinimap() {
  const dpr = state.dpr;
  const w = mini.clientWidth;
  const h = mini.clientHeight;
  mctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  mctx.clearRect(0, 0, w, h);
  if (!state.displayNodes.length) return;
  const b = state.bounds;
  const bw = b.x1 - b.x0;
  const bh = b.y1 - b.y0;
  const k = Math.min(w / bw, h / bh) * 0.92;
  const ox = (w - bw * k) / 2 - b.x0 * k;
  const oy = (h - bh * k) / 2 - b.y0 * k;
  for (const n of state.displayNodes) {
    if (state.hiddenTypes.has(n.type)) continue;
    const t = TYPE[n.type] || TYPE.fact;
    mctx.fillStyle = cssVar(t.color);
    mctx.globalAlpha = 0.75;
    mctx.fillRect(ox + n._x * k, oy + n._y * k, Math.max(1.5, NODE_W * k), Math.max(1.5, NODE_H * k));
  }
  mctx.globalAlpha = 1;
  // viewport rectangle
  const v = state.view;
  const wrap = $('canvasWrap');
  const vx = ox + ((-v.x / v.k) * k);
  const vy = oy + ((-v.y / v.k) * k);
  const vw = (wrap.clientWidth / v.k) * k;
  const vh = (wrap.clientHeight / v.k) * k;
  mctx.strokeStyle = cssVar('--ink-1');
  mctx.globalAlpha = 0.55;
  mctx.lineWidth = 1;
  mctx.strokeRect(vx, vy, vw, vh);
  mctx.globalAlpha = 1;
}

let raf = 0;
function scheduleRender() {
  if (raf) return;
  raf = requestAnimationFrame(() => {
    raf = 0;
    draw();
  });
}

/* ------------------------------ chrome ------------------------------ */

function renderLegend() {
  const tl = $('typeLegend');
  const el = $('edgeLegend');
  const counts = {};
  for (const n of state.nodes) counts[n.type] = (counts[n.type] || 0) + 1;
  tl.innerHTML = '';
  const visibleKinds = [
    ...LEGEND_ORDER.filter((key) => counts[key]),
    ...Object.keys(counts).filter((key) => !LEGEND_ORDER.includes(key)),
  ];
  for (const key of visibleKinds) {
    const t = TYPE[key] || { label: key, color: '--ink-3' };
    const b = document.createElement('button');
    b.className = 'legend-item';
    b.setAttribute('aria-pressed', String(!state.hiddenTypes.has(key)));
    b.innerHTML = `<span class="swatch" style="background:var(${t.color})"></span>${t.label}<span class="legend-count">${counts[key] || 0}</span>`;
    b.addEventListener('click', () => {
      if (state.hiddenTypes.has(key)) state.hiddenTypes.delete(key);
      else state.hiddenTypes.add(key);
      renderLegend();
      state.needsRender = true;
      scheduleRender();
    });
    tl.appendChild(b);
  }
  const ec = {};
  for (const e of state.edges) ec[e.kind] = (ec[e.kind] || 0) + 1;
  el.innerHTML = '';
  const visibleRelations = [
    ...Object.keys(EDGE).filter((key) => ec[key]),
    ...Object.keys(ec).filter((key) => !EDGE[key]),
  ];
  for (const key of visibleRelations) {
    const t = EDGE[key] || { label: key, color: '--ink-3', dash: [3, 3] };
    const b = document.createElement('button');
    b.className = 'legend-item';
    b.setAttribute('aria-pressed', String(!state.hiddenEdges.has(key)));
    b.innerHTML = `<span class="edge-swatch" style="border-top-color:var(${t.color});border-top-style:${t.dash.length ? 'dashed' : 'solid'}"></span>${t.label}<span class="legend-count">${ec[key] || 0}</span>`;
    b.addEventListener('click', () => {
      if (state.hiddenEdges.has(key)) state.hiddenEdges.delete(key);
      else state.hiddenEdges.add(key);
      renderLegend();
      state.needsRender = true;
      scheduleRender();
    });
    el.appendChild(b);
  }
}

function renderViewButtons() {
  document.querySelectorAll('#viewSwitcher [data-view]').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.view === state.viewMode));
  });
}

function renderInbox() {
  const list = $('inboxList');
  if (!list) return;
  if (!state.inboxNodes.length) {
    list.innerHTML = '<p class="inbox-empty">所有节点都已进入逻辑关系。</p>';
    return;
  }
  list.innerHTML = state.inboxNodes.map((n) => {
    const t = TYPE[n.type] || { label: n.type, color: '--ink-3' };
    return `<button class="inbox-item" data-id="${n.id}">
      <span class="swatch" style="background:var(${t.color})"></span>
      <span class="inbox-copy"><b>${escapeHtml(shortTitle(n, 72))}</b><small>${t.label} · ${n.id}${n.status ? ` · ${n.status}` : ''}</small></span>
    </button>`;
  }).join('');
}

function renderStats() {
  const s = (state.raw && state.raw.stats) || {};
  const currentId = currentNodeId();
  const focus = state.byId.get(currentId);
  const rows = [
    ['当前视图', `${state.displayNodes.length}/${s.total ?? state.nodes.length}`, ''],
    ['可见关系', state.displayEdges.length, ''],
    ['开放节点', s.frontier ?? 0, 'warn'],
    ['未整理', state.inboxNodes.length, state.inboxNodes.length ? 'warn' : ''],
    ['检查点', s.checkpoints ?? 0, ''],
  ];
  $('stats').innerHTML =
    rows
      .map(
        ([label, value, cls]) =>
          `<div class="stat"><span class="stat-label">${label}</span><span class="stat-value ${cls}">${value}</span></div>`,
      )
      .join('') +
    (focus
      ? `<div class="stat stat-current"><span class="stat-label">当前节点</span><span class="stat-value stat-node" title="${escapeHtml(focus.title || focus.id)}"><b>${focus.id}</b>${escapeHtml(shortTitle(focus, 42))}</span></div>`
      : '<div class="stat stat-current"><span class="stat-label">当前节点</span><span class="stat-value stat-node muted-value">未设置</span></div>');
  const currentButton = $('btnCurrent');
  currentButton.disabled = !focus;
  currentButton.dataset.nodeId = focus?.id || '';
  currentButton.title = focus ? `回到 ${focus.id} · ${focus.title || ''}` : '尚未设置当前节点';
  const trailButton = $('btnTrail');
  trailButton.disabled = state.trailPairs.length === 0;
  trailButton.setAttribute('aria-pressed', String(state.showTrail));
}

function renderDigest() {
  const d = (state.raw && state.raw.digest) || '';
  $('digestBody').textContent = d || '（暂无摘要）';
  window.__digest = d;
}

function updateEmpty() {
  $('empty').hidden = state.nodes.length > 0;
}

function setTitle() {
  const meta = state.raw?.meta || {};
  $('title').textContent = meta.title || 'Agent 外置黑板';
  $('session').textContent = meta.session || '';
  document.title = `${meta.title || 'blackboard'} — Agent 外置黑板`;
}

function setConnection(stateName, label) {
  const el = $('connectionStatus');
  if (!el) return;
  el.dataset.state = stateName;
  const text = el.querySelector('span');
  if (text) text.textContent = label;
}

/* ------------------------------ panel ------------------------------ */

function showPanel(n) {
  if (!n) {
    $('panel').hidden = true;
    state.selected = null;
    scheduleRender();
    return;
  }
  state.selected = n.id;
  const t = TYPE[n.type] || TYPE.fact;
  $('panel').hidden = false;
  $('panelBadge').innerHTML = `<span class="swatch" style="background:var(${t.color})"></span>${t.label}`;
  $('panelId').textContent = n.id;
  $('panelTitle').textContent = n.title || n.id;
  const pills = [];
  if (state.cursorIds.has(n.id)) pills.push('<span class="pill">当前节点</span>');
  if (n.status) pills.push(`<span class="pill">${n.status}</span>`);
  if (n.severity) pills.push(`<span class="pill sev-${n.severity}">${n.severity.toUpperCase()}</span>`);
  if (n.auto) pills.push('<span class="pill">自动</span>');
  if (n.tags && n.tags.length) for (const tag of n.tags) pills.push(`<span class="pill">${escapeHtml(tag)}</span>`);
  if (n.loc) {
    pills.push(
      `<span class="pill loc" title="${escapeHtml(n.loc.path)}">${escapeHtml(
        n.loc.path.split('/').slice(-2).join('/'),
      )}${n.loc.line ? `:${n.loc.line}` : ''}</span>`,
    );
  }
  if (n.ts) pills.push(`<span class="pill">${new Date(n.ts).toLocaleString('zh-CN', { hour12: false })}</span>`);
  $('panelMeta').innerHTML = pills.join('');

  const detail = n.detail || '';
  $('panelDetail').textContent = detail;
  $('panelDetail').hidden = !detail;

  const parents = state.edges.filter((e) => e.to === n.id).map((e) => ({ e, n: state.byId.get(e.from) })).filter((x) => x.n);
  const children = state.edges.filter((e) => e.from === n.id).map((e) => ({ e, n: state.byId.get(e.to) })).filter((x) => x.n);
  const relHtml = (items, arrow) =>
    items
      .map(
        ({ e, n: m }) =>
          `<button class="rel" data-id="${m.id}"><span class="rel-id">${m.id}</span><span class="rel-kind">${
            (EDGE[e.kind] || { label: e.kind }).label
          }${arrow}</span><span class="rel-title">${escapeHtml(m.title || '')}</span></button>`,
      )
      .join('');
  $('panelParents').innerHTML = parents.length ? `<h3>上游</h3>${relHtml(parents, '→')}` : '';
  $('panelChildren').innerHTML = children.length ? `<h3>下游</h3>${relHtml(children, '→')}` : '';
  $('panelParents').hidden = !parents.length;
  $('panelChildren').hidden = !children.length;
  scheduleRender();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ------------------------------ tooltip ------------------------------ */

function showTooltip(n, sx, sy) {
  const tt = $('tooltip');
  if (!n) {
    tt.hidden = true;
    return;
  }
  const t = TYPE[n.type] || TYPE.fact;
  tt.innerHTML = `<div class="tt-head"><span class="swatch" style="background:var(${t.color})"></span><span class="tt-type">${t.label}</span><span class="tt-id">${n.id}</span>${
    n.status ? `<span class="tt-type">· ${n.status}</span>` : ''
  }</div><div class="tt-title">${escapeHtml(n.title || '')}</div>${
    n.detail ? `<div class="tt-detail">${escapeHtml(n.detail.slice(0, 220))}</div>` : ''
  }`;
  tt.hidden = false;
  const wrap = $('canvasWrap').getBoundingClientRect();
  const tw = tt.offsetWidth;
  const th = tt.offsetHeight;
  tt.style.left = `${clamp(sx + 14, 8, wrap.width - tw - 8)}px`;
  tt.style.top = `${clamp(sy + 16, 8, wrap.height - th - 8)}px`;
}

/* ------------------------------ events ------------------------------ */

canvas.addEventListener('mousedown', (e) => {
  const rect = canvas.getBoundingClientRect();
  const sx = e.clientX - rect.left;
  const sy = e.clientY - rect.top;
  state.dragging = { sx, sy, vx: state.view.x, vy: state.view.y };
  state.dragMoved = false;
  canvas.classList.add('dragging');
});

window.addEventListener('mousemove', (e) => {
  const rect = canvas.getBoundingClientRect();
  const sx = e.clientX - rect.left;
  const sy = e.clientY - rect.top;

  if (state.dragging) {
    const dx = e.clientX - rect.left - state.dragging.sx;
    const dy = e.clientY - rect.top - state.dragging.sy;
    if (Math.abs(dx) + Math.abs(dy) > 3) state.dragMoved = true;
    if (state.dragMoved) {
      state.view.x = state.dragging.vx + dx;
      state.view.y = state.dragging.vy + dy;
      state.needsRender = true;
      scheduleRender();
    }
    return;
  }

  if (sx < 0 || sy < 0 || sx > rect.width || sy > rect.height) {
    if (state.hovered) {
      state.hovered = null;
      showTooltip(null);
      scheduleRender();
    }
    return;
  }
  const n = nodeAt(sx, sy);
  const id = n ? n.id : null;
  if (id !== state.hovered) {
    state.hovered = id;
    canvas.style.cursor = id ? 'pointer' : 'grab';
    scheduleRender();
  }
  showTooltip(n, sx, sy);
});

window.addEventListener('mouseup', (e) => {
  if (!state.dragging) return;
  const wasDrag = state.dragMoved;
  state.dragging = null;
  canvas.classList.remove('dragging');
  if (wasDrag) return;
  const rect = canvas.getBoundingClientRect();
  const n = nodeAt(e.clientX - rect.left, e.clientY - rect.top);
  showPanel(n);
  if (n) centerOnLite(n);
});

function centerOnLite(n) {
  // Keep the selected node visible without yanking the view.
  const wrap = $('canvasWrap');
  const v = state.view;
  const sx = n._x * v.k + v.x;
  const sy = n._y * v.k + v.y;
  const margin = 220;
  if (sx < margin || sx > wrap.clientWidth - margin || sy < 80 || sy > wrap.clientHeight - 80) {
    centerOn(n);
  }
}

canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const before = screenToWorld(sx, sy);
    const factor = Math.exp(-e.deltaY * 0.0016);
    const k = clamp(state.view.k * factor, 0.03, 3.2);
    state.view.k = k;
    state.view.x = sx - before.x * k;
    state.view.y = sy - before.y * k;
    state.needsRender = true;
    scheduleRender();
  },
  { passive: false },
);

mini.addEventListener('mousedown', (e) => {
  const r = mini.getBoundingClientRect();
  const b = state.bounds;
  const bw = b.x1 - b.x0;
  const bh = b.y1 - b.y0;
  const k = Math.min(r.width / bw, r.height / bh) * 0.92;
  const ox = (r.width - bw * k) / 2 - b.x0 * k;
  const oy = (r.height - bh * k) / 2 - b.y0 * k;
  const wx = (e.clientX - r.left - ox) / k;
  const wy = (e.clientY - r.top - oy) / k;
  const wrap = $('canvasWrap');
  animateView(
    {
      k: state.view.k,
      x: wrap.clientWidth / 2 - wx * state.view.k,
      y: wrap.clientHeight / 2 - wy * state.view.k,
    },
    220,
  );
});

$('panelClose').addEventListener('click', () => showPanel(null));
$('panel').addEventListener('click', (e) => {
  const btn = e.target.closest('.rel');
  if (!btn) return;
  const n = state.byId.get(btn.dataset.id);
  if (n) {
    if (!state.displayIds.has(n.id)) {
      setViewMode('all', { focusId: n.id });
      return;
    }
    showPanel(n);
    centerOn(n);
  }
});

$('search').addEventListener('input', (e) => {
  state.query = e.target.value;
  const q = state.query.trim().toLowerCase();
  if (q) {
    const hits = state.nodes.filter((n) => matchesQuery(n, q)).length;
    $('searchCount').textContent = `${hits}`;
  } else {
    $('searchCount').textContent = '';
  }
  if (state.viewMode === 'context') {
    layout();
    renderStats();
  }
  scheduleRender();
});

function setViewMode(mode, { focusId = null } = {}) {
  state.viewMode = mode;
  try {
    const url = new URL(location.href);
    url.searchParams.set('view', mode);
    history.replaceState(null, '', url);
  } catch {}
  layout();
  renderViewButtons();
  renderStats();
  state.needsRender = true;
  fit(true);
  if (focusId) {
    const n = state.byId.get(focusId);
    if (n) { showPanel(n); setTimeout(() => centerOn(n), 280); }
  }
}

$('viewSwitcher').addEventListener('click', (e) => {
  const button = e.target.closest('[data-view]');
  if (button) setViewMode(button.dataset.view);
});

$('btnFit').addEventListener('click', () => fit(true));

$('btnCurrent').addEventListener('click', (e) => {
  const n = state.byId.get(e.currentTarget.dataset.nodeId);
  if (n) {
    if (!state.displayIds.has(n.id)) {
      setViewMode('context', { focusId: n.id });
      return;
    }
    showPanel(n);
    centerOn(n);
  }
});

$('btnInbox').addEventListener('click', () => $('inboxDialog').showModal());
$('btnInboxClose').addEventListener('click', () => $('inboxDialog').close());
$('inboxList').addEventListener('click', (e) => {
  const item = e.target.closest('.inbox-item');
  if (!item) return;
  $('inboxDialog').close();
  setViewMode('all', { focusId: item.dataset.id });
});

$('btnTrail').addEventListener('click', (e) => {
  state.showTrail = !state.showTrail;
  e.currentTarget.setAttribute('aria-pressed', String(state.showTrail));
  state.needsRender = true;
  scheduleRender();
});

$('btnDigest').addEventListener('click', () => {
  $('digestDialog').showModal();
});
$('btnDigestClose').addEventListener('click', () => $('digestDialog').close());
$('btnCopyDigest').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(window.__digest || '');
    const b = $('btnCopyDigest');
    const t = b.textContent;
    b.textContent = '已复制';
    setTimeout(() => (b.textContent = t), 1200);
  } catch {}
});

$('btnTheme').addEventListener('click', () => {
  const root = document.documentElement;
  const cur = root.getAttribute('data-theme');
  const next = cur === 'dark' ? 'light' : cur === 'light' ? 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches ? 'light' : 'dark';
  root.setAttribute('data-theme', next);
  try {
    localStorage.setItem('blackboard-theme', next);
  } catch {}
  state.needsRender = true;
  scheduleRender();
  renderLegend();
});
try {
  const saved = localStorage.getItem('blackboard-theme') || localStorage.getItem('flow-theme');
  if (saved) document.documentElement.setAttribute('data-theme', saved);
} catch {}

window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  if (e.key === 'f' || e.key === 'F') fit(true);
  if (e.key === 'c' || e.key === 'C') $('btnCurrent').click();
  if (e.key === 't' || e.key === 'T') $('btnTrail').click();
  if (e.key === 'Escape') {
    showPanel(null);
    if ($('digestDialog').open) $('digestDialog').close();
    if ($('inboxDialog').open) $('inboxDialog').close();
  }
  if (e.key === '/') {
    e.preventDefault();
    $('search').focus();
  }
});

window.addEventListener('resize', () => {
  resize();
  scheduleRender();
});

/* ------------------------------ boot ------------------------------ */

function applySnapshot(snap) {
  state.raw = normalize(snap);
  state.raw.stats = snap.stats;
  setData(snap);
  setTitle();
  scheduleRender();
}

function connect() {
  if (window.__FLOW_STATIC__) {
    // exported single-file view: data is inlined
    setConnection('offline', '离线快照');
    return;
  }
  setConnection('connecting', '连接中');
  const es = new EventSource('/events');
  es.onopen = () => setConnection('live', '实时');
  es.addEventListener('graph', (ev) => {
    try {
      const snap = JSON.parse(ev.data);
      const first = !state.raw;
      applySnapshot(snap);
      if (first) {
        if (state.nodes.length) fit(false);
        else state.view = { x: 0, y: 0, k: 1 };
      }
    } catch {}
  });
  es.onerror = () => {
    // EventSource retries on its own.
    setConnection('retrying', '重连中');
  };
}

function boot() {
  resize();
  if (window.__FLOW_STATIC__ && window.__FLOW_DATA__) {
    applySnapshot(window.__FLOW_DATA__);
    state.view = { x: 0, y: 0, k: 1 };
    fit(false);
  } else if (window.__FLOW_DATA__) {
    applySnapshot(window.__FLOW_DATA__);
    if (state.nodes.length) fit(false);
  }
  connect();
  requestAnimationFrame(() => {
    draw();
    setTimeout(() => $('hint').classList.add('fade'), 6000);
  });
}

boot();
