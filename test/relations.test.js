import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ensure, addNode, paths, replay } from '../lib/store.js';
import { startServer } from '../lib/server.js';

// Relation names are conventions: unknown ones are saved as written by every write path,
// and the relation a node is created with can carry its label like `link` does.
const CLI = fileURLToPath(new URL('../bin/blackboard.js', import.meta.url));
function fixture(t) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'blackboard-relations-'));
  ensure(cwd);
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  return cwd;
}
const log = (cwd) => fs.readFileSync(paths(cwd).events, 'utf8');
const cli = (cwd, args) => spawnSync(process.execPath, [CLI, ...args, '--cwd', cwd, '--no-init'], {
  encoding: 'utf8', env: { ...process.env, BLACKBOARD_DEBUG: '', BLACKBOARD_QUIET: '', NO_COLOR: '1' },
});

async function server(t, cwd) {
  const running = await startServer({ cwd, port: 0 });
  t.after(() => new Promise((resolve) => { running.close(resolve); running.closeAllConnections(); }));
  const port = running.address().port;
  return (method, url, body) => new Promise((resolve, reject) => {
    const request = http.request({ hostname: '127.0.0.1', port, method, path: url,
      headers: { Origin: `http://127.0.0.1:${port}`, 'Content-Type': 'application/json' } }, (response) => {
      let data = '';
      response.setEncoding('utf8'); response.on('data', (chunk) => { data += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(data) }));
    });
    request.on('error', reject); request.end(body === undefined ? undefined : JSON.stringify(body));
  });
}

test('the viewer server saves unknown relations as written, like the CLI', async (t) => {
  const cwd = fixture(t);
  const call = await server(t, cwd);
  const question = addNode({ type: 'question', title: 'Synthetic question' }, cwd).node;
  const candidate = addNode({ type: 'hypothesis', title: 'Synthetic candidate' }, cwd).node;

  const edge = await call('POST', '/api/edges', { from: candidate.id, to: question.id, kind: 'answers' });
  assert.equal(edge.status, 201, JSON.stringify(edge.body));
  assert.equal(edge.body.kind, 'answers');

  const created = await call('POST', '/api/nodes', { type: 'note', title: 'Synthetic follow-up', parent: question.id, relation: 'x-custom' });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.edge.kind, 'x-custom');

  const kinds = Object.values(replay(cwd).edges).map((e) => e.kind).sort();
  assert.deepEqual(kinds, ['answers', 'x-custom']);
  const snapshot = await call('GET', '/api/graph');
  assert.ok(JSON.stringify(snapshot.body).includes('"x-custom"'));

  // An empty name still falls back to the default relation, as on the CLI.
  const fallback = await call('POST', '/api/edges', { from: question.id, to: candidate.id, kind: '' });
  assert.equal(fallback.status, 201);
  assert.equal(fallback.body.kind, 'related-to');
});

test('node add --label writes the label on the relation it creates', (t) => {
  const cwd = fixture(t);
  const question = addNode({ type: 'question', title: 'Synthetic question' }, cwd).node;
  const json = cli(cwd, ['node', 'add', 'hypothesis', 'Synthetic candidate', '--to', question.id, '--rel', 'answers', '--label', 'why it answers', '--json']);
  assert.equal(json.status, 0, json.stderr);
  const { edge } = JSON.parse(json.stdout);
  assert.equal(edge.kind, 'answers');
  assert.equal(edge.label, 'why it answers');
  assert.equal(replay(cwd).edges[edge.id].label, 'why it answers');

  const text = cli(cwd, ['fact', 'Synthetic evidence', '--to', edge.from, '--rel', 'supports', '--label', 'same input, same loss']);
  assert.equal(text.status, 0, text.stderr);
  assert.match(text.stdout, /（same input, same loss）/);

  const capabilities = spawnSync(process.execPath, [CLI, 'capabilities', '--json'], { encoding: 'utf8' });
  assert.equal(JSON.parse(capabilities.stdout).features.nodeEdgeLabel, true);
});

test('a label without a relation is refused before anything is written', (t) => {
  const cwd = fixture(t);
  const before = log(cwd);
  const loose = cli(cwd, ['node', 'add', 'note', 'Synthetic note', '--label', 'no relation']);
  assert.equal(loose.status, 1);
  assert.match(loose.stderr, /label/);
  assert.equal(log(cwd), before);

  // relateHere with no cursor creates no relation either.
  assert.throws(() => addNode({ type: 'note', title: 'Synthetic note', relateHere: true, label: 'x', agentId: 'agent:fresh' }, cwd), /no cursor/);
  assert.equal(log(cwd), before);
});

test('an over-long label is clipped and recorded, or refused with --no-truncate', (t) => {
  const cwd = fixture(t);
  const goal = addNode({ type: 'goal', title: 'Synthetic goal' }, cwd).node;
  const long = 'x'.repeat(501);

  const before = log(cwd);
  const strict = cli(cwd, ['fact', 'Synthetic fact', '--to', goal.id, '--label', long, '--no-truncate', '--json']);
  assert.equal(strict.status, 1);
  assert.match(strict.stderr, /label/);
  assert.equal(log(cwd), before, 'a refused label must not save the node either');

  const clipped = cli(cwd, ['fact', 'Synthetic fact', '--to', goal.id, '--label', long, '--json']);
  assert.equal(clipped.status, 0, clipped.stderr);
  const result = JSON.parse(clipped.stdout);
  assert.equal(result.edge.label.length, 500);
  assert.deepEqual(result.edge.inputTruncation, { label: { originalLength: 501, storedLength: 500 } });
  assert.equal(result.node.inputTruncation, undefined);
  assert.deepEqual(result.truncated, ['label']);
});

test('a retried request id with a different label is a different request', (t) => {
  const cwd = fixture(t);
  const goal = addNode({ type: 'goal', title: 'Synthetic goal' }, cwd).node;
  const args = ['fact', 'Synthetic fact', '--to', goal.id, '--request-id', 'label-retry', '--json'];
  assert.equal(cli(cwd, [...args, '--label', 'first']).status, 0);
  assert.equal(cli(cwd, [...args, '--label', 'first']).status, 0, 'an identical retry replays');
  const changed = cli(cwd, [...args, '--label', 'second']);
  assert.equal(changed.status, 1);
  assert.match(changed.stderr, /request_id_conflict/);
});
