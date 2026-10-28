import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ensure, appendEvent, addNode, addCheckpoint, moveCursor, patchNode, paths, getReceipt } from '../lib/store.js';
import { startServer } from '../lib/server.js';

const CLI = fileURLToPath(new URL('../bin/blackboard.js', import.meta.url));
const FIELDS = ['status', 'severity', 'confidence'];
const unset = (node) => {
  for (const field of FIELDS) assert.equal(node[field], null, `${node.id}.${field}`);
};
function fixture(t) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'blackboard-node-json-'));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  ensure(cwd);
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('BLACKBOARD_')) delete env[key];
  const run = (...args) => {
    const r = spawnSync(process.execPath, [CLI, ...args, '--cwd', cwd, '--json'], { cwd, env, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    return JSON.parse(r.stdout);
  };
  return { cwd, run, log: () => fs.readFileSync(paths(cwd).events, 'utf8') };
}

test('legacy nodes have the same nullable dimensions through CLI reads and history without rewriting events', (t) => {
  const { cwd, run, log } = fixture(t);
  appendEvent({ op: 'node', node: { id: 'n1', type: 'note', title: 'Original', example: { id: 'example', type: 'note' }, ts: 1 } }, cwd);
  addCheckpoint({ summary: 'Before edit' }, cwd);
  patchNode('n1', { title: 'Revised' }, cwd);
  moveCursor('n1', {}, cwd);
  const before = log();
  const nodes = [run('ls', '--all')[0], run('show', 'n1').node, run('here').node,
    run('status').latestNode, run('search', 'Revised').items[0].node];
  const context = run('context', '--budget', '64000');
  for (const node of [context.currentFocus, ...context.notes]) unset(node);
  const history = run('history', 'n1');
  nodes.push(history.entries[0].changes.$node.after);
  const changes = run('changes', '--since', 'cp1');
  nodes.push(changes.nodes.updated[0].before, changes.nodes.updated[0].after,
    changes.events[0].nodes.updated[0].before, changes.events[0].nodes.updated[0].after);
  for (const node of nodes) {
    unset(node);
    assert.deepEqual(node.example, { id: 'example', type: 'note' });
  }
  assert.deepEqual(changes.nodes.updated[0].fields, ['title', 'updated']);
  assert.equal(context.schema, 'blackboard.context.v2');
  assert.equal(run('show', 'n1').schema, 'blackboard.show.v2');
  assert.equal(log(), before);
});

test('write responses project missing dimensions but stored events and request receipts remain original', (t) => {
  const { cwd, run, log } = fixture(t);
  const args = ['node', 'add', 'note', 'Written claim', '--request-id', 'write-1'];
  const first = run(...args);
  unset(first.node);
  assert.equal(first.schema, 'blackboard.node-add.v2');
  const stored = getReceipt('write-1', cwd).result.node;
  for (const field of FIELDS) assert.equal(Object.hasOwn(stored, field), false);
  const before = log();
  assert.deepEqual(run(...args), first);
  const receipt = run('receipt', 'write-1');
  assert.deepEqual(receipt.result.node, stored);
  assert.equal(receipt.schema, 'blackboard.receipt.v1');
  assert.equal(log(), before);
  const vuln = run('node', 'add', 'vuln', 'Existing defaults');
  assert.equal(vuln.node.severity, null, 'an unrated vuln is not given a severity from its type');
  assert.equal(vuln.node.status, null);
  assert.equal(vuln.node.confidence, null);
});

test('recorded dimensions are preserved independently rather than inferred from other fields', (t) => {
  const { cwd, run, log } = fixture(t);
  const node = addNode({ type: 'vuln', title: 'Retired', status: 'refuted', severity: 'high', confidence: 'reproduced' }, cwd).node;
  const before = log();
  const output = run('show', node.id).node;
  assert.equal(output.status, 'refuted');
  assert.equal(output.severity, 'high');
  assert.equal(output.confidence, 'reproduced');
  assert.equal(log(), before);
});

test('HTTP graph, SSE, context and mutation results use nullable fields while receipts retain raw results', async (t) => {
  const { cwd, log } = fixture(t);
  const node = addNode({ type: 'note', title: 'Legacy note' }, cwd).node;
  moveCursor(node.id, {}, cwd);
  const server = await startServer({ cwd, port: 0 });
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const before = log();
  const graph = await (await fetch(`${base}/api/graph`)).json();
  assert.equal(graph.schema, 'blackboard.graph.v2');
  unset(graph.nodes[node.id]);
  const packet = await (await fetch(`${base}/api/context?budget=64000`)).json();
  unset(packet.currentFocus);
  const stream = await fetch(`${base}/events`);
  const reader = stream.body.getReader();
  let frame = '';
  while (!frame.includes('\n\n')) frame += new TextDecoder().decode((await reader.read()).value);
  const event = JSON.parse(frame.split('\n').find((line) => line.startsWith('data: ')).slice(6));
  unset(event.nodes[node.id]);
  await reader.cancel();
  assert.equal(log(), before);
  const headers = { Origin: base, 'Content-Type': 'application/json' };
  const response = await fetch(`${base}/api/nodes`, { method: 'POST', headers,
    body: JSON.stringify({ type: 'note', title: 'New note', requestId: 'http-write' }) });
  const created = await response.json();
  assert.equal(response.status, 201);
  unset(created.node);
  const receipt = await (await fetch(`${base}/api/receipt?requestId=http-write`)).json();
  assert.equal(Object.hasOwn(receipt.receipt.result.node, 'confidence'), false);
  const patch = await fetch(`${base}/api/nodes/${created.node.id}`, { method: 'PATCH', headers,
    body: JSON.stringify({ title: 'Updated note', expected: { title: 'New note' } }) });
  assert.equal(patch.status, 200);
  unset(await patch.json());
  const conflict = await fetch(`${base}/api/nodes/${created.node.id}`, { method: 'PATCH', headers,
    body: JSON.stringify({ title: 'Stale edit', expected: { title: 'New note' } }) });
  assert.equal(conflict.status, 409);
});
