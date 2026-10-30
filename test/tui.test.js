// The terminal view is for people: pure rendering and key handling here, the
// refusal to run without a terminal at the CLI. It must never change the board.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { addEdge, addNode, ensure, moveCursor, patchNode, paths, removeNode, replay } from '../lib/store.js';
import { clean, createState, displayWidth, fit, parseKeys, press, renderFrame, sync } from '../lib/cli/tui.js';

const CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'blackboard.js');
const WIDE = { width: 120, height: 24 };

function board(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blackboard-tui-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  ensure(dir);
  return dir;
}

function seeded(t) {
  const dir = board(t);
  const goal = addNode({ type: 'goal', title: '合成目标：检查授权边界' }, dir).node;
  const hypothesis = addNode({ type: 'hypothesis', title: 'Reader may skip the check', confidence: 'suspected' }, dir).node;
  const finding = addNode({ type: 'finding', title: '匿名读取用户列表', detail: '第一行\n第二行', severity: 'high' }, dir).node;
  const other = addNode({ type: 'note', title: 'Unrelated note' }, dir).node;
  addEdge({ from: hypothesis.id, to: finding.id, kind: 'supports', label: 'same handler' }, dir);
  addEdge({ from: goal.id, to: hypothesis.id, kind: 'related-to' }, dir);
  moveCursor(hypothesis.id, {}, dir);
  moveCursor(other.id, { agentId: 'agent:review' }, dir);
  return { dir, goal, hypothesis, finding, other, graph: replay(dir) };
}

const keys = (state, graph, ...names) => { for (const key of names) press(state, key, graph, WIDE); };
const started = (graph, agentId) => { const state = createState(agentId); sync(state, graph); return state; };
const text = (state, graph, size = WIDE) => renderFrame(graph, state, size).join('\n');

test('cells are counted by display width, so wide text never overflows a column', () => {
  assert.equal(displayWidth('审计 ab'), 7);
  assert.equal(displayWidth(fit('审计导出接口', 7)), 7);
  assert.equal(displayWidth(fit('ab', 5)), 5);
});

test('recorded text cannot send control sequences to the terminal', (t) => {
  assert.equal(clean('a\x1b[2Jb\x07\u202ec\x9b'), 'a[2Jbc');
  const dir = board(t);
  const node = addNode({ type: 'note', title: 'title\x1b]0;owned\x07', detail: 'detail\x1b[2J' }, dir).node;
  const graph = replay(dir);
  const state = started(graph);
  assert.equal(state.selected, node.id);
  assert.doesNotMatch(text(state, graph), /[\x00-\x09\x0b-\x1f\x7f]/);
});

test('every frame is exactly as tall as the terminal and no line is wider than it', (t) => {
  const { graph } = seeded(t);
  for (const size of [{ width: 60, height: 8 }, { width: 99, height: 12 }, { width: 100, height: 12 }, { width: 200, height: 50 }]) {
    for (const prepare of [[], ['enter'], ['?']]) {
      const state = started(graph);
      for (const key of prepare) press(state, key, graph, size);
      const lines = renderFrame(graph, state, size);
      assert.equal(lines.length, size.height);
      for (const line of lines) assert.ok(displayWidth(line) <= size.width, `${size.width}: ${line}`);
    }
  }
  assert.equal(renderFrame(graph, createState(), { width: 30, height: 5 }).length, 1);
});

test('the view opens on the cursor, without one on everything; views keep the recorded fields', (t) => {
  const { graph, hypothesis, finding, goal, other } = seeded(t);
  const state = started(graph);
  assert.equal(state.view, 'context');
  assert.equal(state.selected, hypothesis.id);
  const context = text(state, graph);
  for (const id of [finding.id, goal.id]) assert.ok(context.includes(id));
  assert.ok(!context.includes(other.id));

  keys(state, graph, '3');
  assert.match(text(state, graph), /匿名读取用户列表/);
  assert.match(text(state, graph), /HIGH/);
  assert.equal(started(replay(board(t))).view, 'all');
});

test('moving, searching and following change only what this reader sees', (t) => {
  const { dir, graph, hypothesis, finding } = seeded(t);
  const before = fs.readFileSync(paths(dir).events);
  const state = started(graph);
  keys(state, graph, '4', 'g', 'down');
  const second = state.selected;
  keys(state, graph, 'up');
  assert.notEqual(state.selected, second);

  keys(state, graph, '/', ...'匿名', 'enter');
  assert.equal(state.selected, finding.id);
  assert.match(text(state, graph), /\/ 匿名/);
  keys(state, graph, 'esc');
  assert.equal(state.query, '');

  keys(state, graph, 'f');
  assert.equal(state.selected, hypothesis.id);
  keys(state, graph, 'down');
  assert.equal(state.follow, false);

  keys(state, graph, 'a');
  assert.equal(state.agentId, 'agent:review');
  assert.deepEqual(replay(dir).cursors, graph.cursors);
  assert.deepEqual(fs.readFileSync(paths(dir).events), before);
});

test('relations in the detail pane name their direction and lead to the node', (t) => {
  const { graph, hypothesis, finding, goal } = seeded(t);
  const state = started(graph);
  keys(state, graph, 'enter');
  assert.equal(state.focus, 'detail');
  const detail = text(state, graph);
  assert.ok(detail.includes(`> -> 支持 ${finding.id}`));
  assert.ok(detail.includes(`<- 相关 ${goal.id}`));
  assert.ok(detail.includes('same handler'));

  keys(state, graph, ']', 'enter');
  assert.equal(state.selected, goal.id);
  keys(state, graph, 'h');
  assert.equal(state.focus, 'list');
  assert.notEqual(state.selected, hypothesis.id);
});

test('a jump to a node outside the current view widens the view', (t) => {
  const { graph, hypothesis } = seeded(t);
  const state = started(graph);
  keys(state, graph, '3', 'enter', 'enter');
  assert.equal(state.selected, hypothesis.id);
  assert.equal(state.view, 'all');
});

test('the selection survives a reload and moves on when its node is removed', (t) => {
  const { dir, graph, finding } = seeded(t);
  const state = started(graph);
  keys(state, graph, '4', '/', ...'匿名', 'enter', 'esc');
  assert.equal(state.selected, finding.id);
  patchNode(finding.id, { status: 'refuted' }, dir);
  sync(state, replay(dir));
  assert.equal(state.selected, finding.id);
  removeNode(finding.id, {}, dir);
  const after = replay(dir);
  sync(state, after);
  assert.ok(after.nodes[state.selected]);
});

test('skipped log lines stay visible', (t) => {
  const { dir } = seeded(t);
  fs.appendFileSync(paths(dir).events, 'not json\n');
  const graph = replay(dir);
  assert.match(text(started(graph), graph), /1 条记录未能回放/);
});

test('keys are split from a chunk and unknown sequences are dropped whole', () => {
  assert.deepEqual(parseKeys('\x1b[Aj\r'), ['up', 'j', 'enter']);
  assert.deepEqual(parseKeys('\x1b[5~\x1b[99~\x1bOB'), ['pageup', 'down']);
  assert.deepEqual(parseKeys('\x1b'), ['esc']);
  assert.deepEqual(parseKeys('授权\x7f\x03'), ['授', '权', 'backspace', 'ctrl-c']);
});

test('without a terminal the command fails at once instead of waiting for keys', (t) => {
  const { dir } = seeded(t);
  const before = fs.readFileSync(paths(dir).events);
  const result = spawnSync(process.execPath, [CLI, 'tui', '--cwd', dir], { encoding: 'utf8', input: 'q', timeout: 5000 });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /context/);
  assert.deepEqual(fs.readFileSync(paths(dir).events), before);

  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'blackboard-tui-'));
  t.after(() => fs.rmSync(empty, { recursive: true, force: true }));
  assert.equal(spawnSync(process.execPath, [CLI, 'tui', '--cwd', empty], { encoding: 'utf8', timeout: 5000 }).status, 1);
  assert.deepEqual(fs.readdirSync(empty), []);
});
