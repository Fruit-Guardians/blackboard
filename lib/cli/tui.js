// `blackboard tui`: a read-only terminal view for people. It replays the log and
// draws; nothing here writes events, moves a cursor or creates a board.
// Agents and scripts use context/search/show --json instead.
import fs from 'node:fs';
import { CONFIDENCE_LABEL, EDGE_LABEL, TYPE_LABEL, currentCursor } from '../model.js';
import { neighborsOf } from '../digest.js';
import { isCurrentFinding, isOpenThread, isRetiredInterpretation } from '../semantics.js';
import { paths, replay } from '../store.js';
import { C, paintSeverity, paintType } from './format.js';

const VIEWS = [
  { id: 'context', label: '现场' }, { id: 'open', label: '开放' },
  { id: 'findings', label: '发现' }, { id: 'all', label: '全部' },
];
const EMPTY = {
  context: '当前视角没有游标；按 4 查看全部', open: '没有开放的假设或问题',
  findings: '没有发现', all: '黑板还是空的',
};
const SEVERITY_CELL = { critical: 'CRIT', high: 'HIGH', medium: 'MED', low: 'LOW', info: 'INFO' };
const MIN_WIDTH = 60;
const MIN_HEIGHT = 8;
const SPLIT_WIDTH = 100;
const POLL_MS = 1000;
const HELP = [
  'j/k 或方向键   移动；详情里滚动', 'PgUp/PgDn g/G  翻页、到首尾', 'Enter 或 l     打开详情',
  'h 或 Esc       回到列表', '[ ]            在详情里选择关系', 'Enter          跳到选中的关系',
  '1-4 或 Tab     切换视图', '/              搜索；Enter 确认，Esc 清除', 'a              切换 Agent 视角，不移动游标',
  'f              跟随当前视角的游标', 'q              退出',
];

const clamp = (value, min, max) => Math.max(min, Math.min(value, max));

/** Node text comes from Agents, so control sequences must never reach the terminal. */
export const clean = (text) => String(text ?? '').replace(/\r\n?/g, '\n').replace(/\t/g, '  ').replace(/[^\P{Cc}\n]|\p{Cf}/gu, '');
const oneLine = (text) => clean(text).replace(/\s+/g, ' ').trim();

function charWidth(char) {
  const code = char.codePointAt(0);
  if (/\p{Mn}|\p{Me}/u.test(char)) return 0;
  return code >= 0x1100 && (code <= 0x115f || (code >= 0x2e80 && code <= 0xa4cf && code !== 0x303f)
    || (code >= 0xac00 && code <= 0xd7a3) || (code >= 0xf900 && code <= 0xfaff)
    || (code >= 0xfe30 && code <= 0xfe6f) || (code >= 0xff00 && code <= 0xff60)
    || (code >= 0xffe0 && code <= 0xffe6) || (code >= 0x1f300 && code <= 0x1faff)
    || (code >= 0x20000 && code <= 0x3fffd)) ? 2 : 1;
}

export function displayWidth(text) {
  let width = 0;
  for (const char of text) width += charWidth(char);
  return width;
}

/** Exactly `width` terminal cells: padded, or cut with an ellipsis. */
export function fit(text, width) {
  const total = displayWidth(text);
  if (total <= width) return text + ' '.repeat(width - total);
  let out = '';
  let used = 0;
  for (const char of text) {
    if (used + charWidth(char) > width - 1) break;
    out += char;
    used += charWidth(char);
  }
  return `${out}…${' '.repeat(Math.max(0, width - used - 1))}`;
}

function wrap(text, width) {
  const lines = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    let used = 0;
    for (const char of paragraph) {
      if (used + charWidth(char) > width) { lines.push(line); line = ''; used = 0; }
      line += char;
      used += charWidth(char);
    }
    lines.push(line);
  }
  return lines;
}

const KEYS = {
  '[A': 'up', '[B': 'down', '[C': 'right', '[D': 'left', '[H': 'home', '[F': 'end', '[1~': 'home', '[4~': 'end',
  '[5~': 'pageup', '[6~': 'pagedown', '[Z': 'shift-tab', OA: 'up', OB: 'down', OC: 'right', OD: 'left', OH: 'home', OF: 'end',
};

/** One stdin chunk can hold several keys; unknown escape sequences are dropped whole. */
export function parseKeys(input) {
  const keys = [];
  for (let i = 0; i < input.length;) {
    if (input[i] === '\x1b') {
      const sequence = /^\x1b(\[[0-9;]*[A-Za-z~]|O[A-Za-z])/.exec(input.slice(i));
      if (sequence) {
        if (KEYS[sequence[1]]) keys.push(KEYS[sequence[1]]);
        i += sequence[0].length;
      } else { keys.push('esc'); i++; }
      continue;
    }
    const char = String.fromCodePoint(input.codePointAt(i));
    i += char.length;
    if (char === '\r' || char === '\n') keys.push('enter');
    else if (char === '\t') keys.push('tab');
    else if (char === '\x7f' || char === '\b') keys.push('backspace');
    else if (char === '\x03') keys.push('ctrl-c');
    else if (!/\p{Cc}/u.test(char)) keys.push(char);
  }
  return keys;
}

export const createState = (agentId = 'agent:primary') => ({
  agentId, view: null, selected: null, index: 0, focus: 'list', detailScroll: 0, relation: 0,
  query: '', searching: false, follow: false, help: false, quit: false,
});

/** Newest first: the order things were recorded in, never a ranking of what matters. */
function viewNodes(graph, view, agentId) {
  const nodes = Object.values(graph.nodes).sort((a, b) => (b.ts || 0) - (a.ts || 0));
  if (view === 'open') return nodes.filter(isOpenThread);
  if (view === 'findings') return nodes.filter(isCurrentFinding);
  if (view === 'all') return nodes;
  const current = currentCursor(graph, agentId);
  if (!current) return [];
  return [...new Set([graph.nodes[current], ...neighborsOf(graph, current).map((entry) => entry.node)])];
}

function matches(node, query) {
  const text = [node.id, node.title, node.detail, node.type, TYPE_LABEL[node.type], node.status, node.severity, ...(Array.isArray(node.tags) ? node.tags : [])]
    .filter(Boolean).join(' ').toLocaleLowerCase();
  return query.toLocaleLowerCase().split(/\s+/).filter(Boolean).every((term) => text.includes(term));
}

const rowsOf = (graph, state) => viewNodes(graph, state.view, state.agentId).filter((node) => matches(node, state.query));

function select(state, id) {
  if (id === state.selected) return;
  state.selected = id;
  state.detailScroll = 0;
  state.relation = 0;
}

/** Reconcile the selection with the current log; called after every key and every reload. */
export function sync(state, graph) {
  const current = currentCursor(graph, state.agentId);
  state.view ??= current ? 'context' : 'all';
  const rows = rowsOf(graph, state);
  if (state.follow && rows.some((node) => node.id === current)) select(state, current);
  let index = rows.findIndex((node) => node.id === state.selected);
  if (index < 0) {
    index = clamp(state.index, 0, Math.max(0, rows.length - 1));
    select(state, rows[index]?.id ?? null);
  }
  state.index = index;
  if (!state.selected) state.focus = 'list';
  return rows;
}

function panes({ width, height }) {
  const split = width >= SPLIT_WIDTH;
  const listWidth = split ? Math.floor(width * 0.5) : width;
  return { split, listWidth, detailWidth: split ? width - listWidth - 3 : width, bodyHeight: height - 3 };
}

function detailLayout(graph, node, state, width) {
  const lines = [];
  const add = (text, paint = (s) => s) => { for (const line of wrap(text, width)) lines.push({ text: line, paint }); };
  add(clean(node.title).trim() || '（无标题）', C.bold);
  add([node.id, oneLine(TYPE_LABEL[node.type] || node.type), oneLine(node.severity).toUpperCase(), oneLine(node.status),
    oneLine(CONFIDENCE_LABEL[node.confidence] || node.confidence)].filter(Boolean).join(' · '), C.dim);
  if (node.author) add(`作者 ${oneLine(node.author)}`, C.dim);
  if (node.loc?.path) add(`位置 ${oneLine(node.loc.path)}${node.loc.line ? `:${node.loc.line}` : ''}`, C.dim);
  if (Array.isArray(node.tags) && node.tags.length) add(`标签 ${node.tags.map(oneLine).join(', ')}`, C.dim);
  const time = node.updated || node.ts;
  if (time) add(`更新 ${new Date(time).toISOString().slice(0, 19).replace('T', ' ')}Z`, C.dim);
  if (node.inputTruncation && Object.keys(node.inputTruncation).length) add('写入时文本被截断，这里不是完整原文', C.yel);
  if (node.detail) { add(''); add(clean(node.detail)); }
  const neighbors = neighborsOf(graph, node.id);
  if (neighbors.length) { add(''); add(`关系 ${neighbors.length}`, C.bold); }
  neighbors.forEach(({ direction, edge, node: other }, relation) => {
    const kind = oneLine(EDGE_LABEL[edge.kind] || edge.kind);
    const chosen = state.focus === 'detail' && relation === state.relation;
    const text = `${chosen ? '>' : ' '} ${direction === 'out' ? '->' : '<-'} ${kind} ${other.id} ${oneLine(other.title)}${edge.label ? ` (${oneLine(edge.label)})` : ''}`;
    lines.push({ text: fit(text, width), paint: chosen ? C.inv : (s) => s, relation });
  });
  return { lines, neighbors };
}

function pressSearch(state, key) {
  if (key === 'esc') { state.query = ''; state.searching = false; }
  else if (key === 'enter') state.searching = false;
  else if (key === 'backspace') state.query = [...state.query].slice(0, -1).join('');
  else if ([...key].length === 1) state.query += key;
}

function pressDetail(state, key, graph, size) {
  const { detailWidth, bodyHeight } = panes(size);
  const { lines, neighbors } = detailLayout(graph, graph.nodes[state.selected], state, detailWidth);
  const scrollTo = (value) => { state.detailScroll = clamp(value, 0, Math.max(0, lines.length - bodyHeight)); };
  if (key === 'esc' || key === 'left' || key === 'h') state.focus = 'list';
  else if (key === 'down' || key === 'j') scrollTo(state.detailScroll + 1);
  else if (key === 'up' || key === 'k') scrollTo(state.detailScroll - 1);
  else if (key === 'pagedown') scrollTo(state.detailScroll + bodyHeight);
  else if (key === 'pageup') scrollTo(state.detailScroll - bodyHeight);
  else if ((key === ']' || key === '[') && neighbors.length) {
    state.relation = (state.relation + (key === ']' ? 1 : neighbors.length - 1)) % neighbors.length;
    const line = lines.findIndex((entry) => entry.relation === state.relation);
    if (line < state.detailScroll) scrollTo(line);
    else if (line >= state.detailScroll + bodyHeight) scrollTo(line - bodyHeight + 1);
  } else if (key === 'enter' && neighbors.length) {
    const { id } = neighbors[state.relation].node;
    if (!rowsOf(graph, state).some((node) => node.id === id)) { state.view = 'all'; state.query = ''; }
    state.follow = false;
    select(state, id);
  }
}

function pressList(state, key, rows, size) {
  const { bodyHeight } = panes(size);
  const move = (index) => {
    state.follow = false;
    state.index = clamp(index, 0, Math.max(0, rows.length - 1));
    select(state, rows[state.index]?.id ?? null);
  };
  if (key === 'down' || key === 'j') move(state.index + 1);
  else if (key === 'up' || key === 'k') move(state.index - 1);
  else if (key === 'pagedown') move(state.index + bodyHeight);
  else if (key === 'pageup') move(state.index - bodyHeight);
  else if (key === 'home' || key === 'g') move(0);
  else if (key === 'end' || key === 'G') move(rows.length - 1);
  else if ((key === 'enter' || key === 'right' || key === 'l') && state.selected) state.focus = 'detail';
  else if (key === 'esc') state.query = '';
}

/** Only changes what this reader is looking at; the graph is never touched. */
export function press(state, key, graph, size) {
  const rows = sync(state, graph);
  if (key === 'ctrl-c') state.quit = true;
  else if (state.help) state.help = false;
  else if (state.searching) pressSearch(state, key);
  else if (key === 'q') state.quit = true;
  else if (key === '?') state.help = true;
  else if (key === '/') { state.searching = true; state.focus = 'list'; }
  else if (key === 'f') state.follow = !state.follow;
  else if (key === 'a') {
    const agents = [...new Set(['agent:primary', state.agentId, ...Object.keys(graph.cursors || {})])].sort();
    state.agentId = agents[(agents.indexOf(state.agentId) + 1) % agents.length];
  } else if (/^[1-4]$/.test(key) || key === 'tab' || key === 'shift-tab') {
    const at = VIEWS.findIndex((view) => view.id === state.view);
    const next = /^[1-4]$/.test(key) ? Number(key) - 1 : (at + (key === 'tab' ? 1 : VIEWS.length - 1)) % VIEWS.length;
    state.view = VIEWS[next].id;
    state.focus = 'list';
  } else if (state.focus === 'detail') pressDetail(state, key, graph, size);
  else pressList(state, key, rows, size);
  sync(state, graph);
}

function listRow(node, { width, selected, current }) {
  const statusWidth = width >= 72 ? 11 : 0;
  const titleWidth = Math.max(1, width - 3 - 7 - 7 - 5 - statusWidth);
  const severity = node.severity ? SEVERITY_CELL[node.severity] || oneLine(node.severity) : '';
  const cells = {
    id: fit(oneLine(node.id), 7), type: fit(oneLine(TYPE_LABEL[node.type] || node.type), 7),
    severity: fit(severity, 5), status: statusWidth ? fit(oneLine(node.status), statusWidth) : '', title: fit(oneLine(node.title), titleWidth),
  };
  // The marker keeps the selection visible without colour.
  if (selected) return C.inv(`>${current ? '*' : ' '} ${cells.id}${cells.type}${cells.severity}${cells.status}${cells.title}`);
  return ` ${current ? C.grn('*') : ' '} ${C.dim(cells.id)}${paintType(node.type, cells.type)}`
    + `${paintSeverity(node.severity, cells.severity)}${C.dim(cells.status)}${isRetiredInterpretation(node) ? C.dim(cells.title) : cells.title}`;
}

function listPane(graph, state, rows, { width, height }) {
  if (!rows.length) return [C.dim(fit(state.query ? '没有匹配的节点' : EMPTY[state.view], width))];
  const current = currentCursor(graph, state.agentId);
  const top = clamp(state.index - Math.floor(height / 2), 0, Math.max(0, rows.length - height));
  return rows.slice(top, top + height).map((node, offset) => listRow(node, {
    width, selected: top + offset === state.index, current: node.id === current,
  }));
}

function detailPane(graph, state, { width, height }) {
  const node = graph.nodes[state.selected];
  if (!node) return [];
  const { lines } = detailLayout(graph, node, state, width);
  const top = clamp(state.detailScroll, 0, Math.max(0, lines.length - height));
  return lines.slice(top, top + height).map(({ text, paint }) => paint(text));
}

function warningOf(graph) {
  const { corruptLines = 0, rejected = 0, futureEvents = 0 } = graph.integrity || {};
  const skipped = corruptLines + rejected + futureEvents;
  return skipped ? `日志有 ${skipped} 条记录未能回放，这里看不到它们；运行 blackboard lint 查看` : '';
}

/** One frame as exactly `height` lines; each fits in `width` cells. Pure, so it can be tested without a terminal. */
export function renderFrame(graph, state, { width, height }) {
  if (width < MIN_WIDTH || height < MIN_HEIGHT) return [fit(`终端太小：至少 ${MIN_WIDTH}x${MIN_HEIGHT}`, width)];
  const rows = sync(state, graph);
  const { split, listWidth, detailWidth, bodyHeight } = panes({ width, height });
  const right = `${Object.keys(graph.nodes).length} 节点 ${Object.keys(graph.edges).length} 关系 | 视角 ${oneLine(state.agentId).replace(/^agent:/, '')}${state.follow ? ' | 跟随' : ''}`;
  const rightCell = fit(right, Math.min(displayWidth(right), Math.floor(width / 2)));
  const header = `${C.bold('blackboard')} 只读 | ${fit(oneLine(graph.meta?.title), width - displayWidth(rightCell) - 19)} ${C.dim(rightCell)}`;

  const tabs = VIEWS.map((view, index) => {
    const label = ` ${index + 1} ${view.label} ${viewNodes(graph, view.id, state.agentId).length} `;
    return { width: displayWidth(label), text: view.id === state.view ? C.inv(label) : C.dim(label) };
  });
  const tabsWidth = tabs.reduce((sum, tab) => sum + tab.width, 0);
  const search = state.query && !state.searching ? fit(` / ${oneLine(state.query)}`, Math.max(0, width - tabsWidth)) : '';

  let body;
  if (state.help) body = HELP.map((line) => fit(line, width));
  else if (!split) body = state.focus === 'detail' ? detailPane(graph, state, { width, height: bodyHeight }) : listPane(graph, state, rows, { width: listWidth, height: bodyHeight });
  else {
    const left = listPane(graph, state, rows, { width: listWidth, height: bodyHeight });
    const detail = detailPane(graph, state, { width: detailWidth, height: bodyHeight });
    body = Array.from({ length: bodyHeight }, (_, line) => `${left[line] ?? ' '.repeat(listWidth)} ${C.dim('|')} ${detail[line] ?? ''}`);
  }
  body = [...body, ...Array(Math.max(0, bodyHeight - body.length)).fill('')].slice(0, bodyHeight);

  const hints = state.focus === 'detail'
    ? 'j/k 滚动  [ ] 选关系  Enter 跳转  h 返回  1-4 视图  ? 帮助  q 退出'
    : 'j/k 移动  Enter 详情  1-4 视图  / 搜索  a 视角  f 跟随  ? 帮助  q 退出';
  const warning = warningOf(graph);
  const footer = state.searching ? fit(`/${oneLine(state.query)}_`, width) : warning ? C.yel(fit(warning, width)) : C.dim(fit(hints, width));
  return [header, tabs.map((tab) => tab.text).join('') + search, ...body, footer];
}

const logStamp = (file) => {
  try {
    const { size, mtimeMs } = fs.statSync(file);
    return `${size}:${mtimeMs}`;
  } catch { return ''; }
};

/** Owns the terminal until the reader quits; every exit path gives it back. */
export function runTui({ cwd, agentId, stdin = process.stdin, stdout = process.stdout }) {
  return new Promise((resolve, reject) => {
    const file = paths(cwd).events;
    const state = createState(agentId);
    let graph = replay(cwd);
    let stamp = logStamp(file);
    let shown = null;
    let left = false;
    let timer = null;

    const size = () => ({ width: (stdout.columns || 80) - 1, height: stdout.rows || 24 });
    const draw = () => {
      // One column stays free: erasing to end of line in the last column would eat its character.
      const frame = `\x1b[H${renderFrame(graph, state, size()).map((line) => `${line}\x1b[K`).join('\r\n')}\x1b[J`;
      if (frame !== shown) stdout.write(frame);
      shown = frame;
    };
    const restore = () => {
      if (left) return;
      left = true;
      clearInterval(timer);
      stdin.off('data', onData);
      stdout.off('resize', onResize);
      process.off('exit', restore);
      for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.off(signal, onSignal);
      stdin.setRawMode(false);
      stdin.pause();
      stdout.write('\x1b[?25h\x1b[?1049l');
    };
    const finish = (error) => {
      restore();
      if (error) reject(error); else resolve();
    };
    const guarded = (fn) => (...args) => {
      try { fn(...args); } catch (error) { finish(error); }
    };
    const onSignal = () => finish();
    const onResize = guarded(draw);
    const onData = guarded((chunk) => {
      for (const key of parseKeys(chunk)) press(state, key, graph, size());
      if (state.quit) finish(); else draw();
    });
    const onTick = guarded(() => {
      const next = logStamp(file);
      if (next === stamp) return;
      stamp = next;
      graph = replay(cwd);
      draw();
    });

    process.on('exit', restore);
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, onSignal);
    stdout.write('\x1b[?1049h\x1b[?25l');
    stdin.setRawMode(true);
    stdin.setEncoding('utf8');
    stdin.on('data', onData);
    stdin.resume();
    stdout.on('resize', onResize);
    timer = setInterval(onTick, POLL_MS);
    guarded(draw)();
  });
}
