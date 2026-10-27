import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ensure, addNode, paths, replay, getReceipt } from '../lib/store.js';
import { startServer } from '../lib/server.js';

const CLI = fileURLToPath(new URL('../bin/blackboard.js', import.meta.url));
function fixture(t) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'blackboard-input-api-'));
  ensure(cwd);
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  return cwd;
}
const log = (cwd) => fs.readFileSync(paths(cwd).events, 'utf8');
const cli = (cwd, args) => spawnSync(process.execPath, [CLI, ...args, '--cwd', cwd], {
  encoding: 'utf8', env: { ...process.env, BLACKBOARD_DEBUG: '', NO_COLOR: '1' },
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

test('CLI explicitly protects text writes and advertises the optional input contract', (t) => {
  const cwd = fixture(t);
  // capabilities is project-independent and does not take --cwd.
  const advertised = spawnSync(process.execPath, [CLI, 'capabilities', '--json'], { encoding: 'utf8' });
  assert.equal(advertised.status, 0);
  assert.equal(JSON.parse(advertised.stdout).features.rejectTruncation, true);
  assert.equal(JSON.parse(advertised.stdout).features.inputTruncationMetadata, true);
  const base = addNode({ type: 'goal', title: 'Synthetic goal' }, cwd).node;
  for (const [args, field] of [
    [['node', 'add', 'finding', 'Synthetic claim', '--detail', 'x'.repeat(20001), '--to', base.id, '--enter', '--request-id', 'strict-create'], 'detail'],
    [['edit', base.id, '--title', 'x'.repeat(501)], 'title'],
    [['checkpoint', '--summary', 'x'.repeat(12001)], 'summary'],
  ]) {
    const before = log(cwd);
    const result = cli(cwd, [...args, '--no-init', '--no-truncate', '--json']);
    assert.equal(result.status, 1);
    assert.match(result.stderr, new RegExp(field));
    assert.doesNotMatch(result.stderr, /未知选项/);
    assert.equal(log(cwd), before, 'rejected input must not save a partial node, edge, cursor or receipt');
  }
  const peer = addNode({ type: 'fact', title: 'Synthetic evidence' }, cwd).node;
  const before = log(cwd);
  const edge = cli(cwd, ['link', peer.id, base.id, '--label', 'x'.repeat(501), '--no-init', '--no-truncate']);
  assert.equal(edge.status, 1); assert.match(edge.stderr, /label/); assert.equal(log(cwd), before);
});

test('legacy CLI truncation stays compatible but its warning survives later reads', (t) => {
  const cwd = fixture(t);
  const result = cli(cwd, ['fact', 'x'.repeat(501), '--no-init', '--json']);
  assert.equal(result.status, 0); assert.match(result.stderr, /500/);
  const written = JSON.parse(result.stdout);
  assert.deepEqual(written.truncated, ['title']);
  assert.deepEqual(written.node.inputTruncation, { title: { originalLength: 501, storedLength: 500 } });
  const read = cli(cwd, ['show', written.node.id, '--json']);
  assert.equal(read.status, 0);
  assert.deepEqual(JSON.parse(read.stdout).node.inputTruncation, written.node.inputTruncation);
});

test('HTTP opt-in rejects oversized creates and edits without changing the event log', async (t) => {
  const cwd = fixture(t); const request = await server(t, cwd);
  const base = addNode({ type: 'note', title: 'Original', detail: 'Original details' }, cwd).node;
  const before = log(cwd);
  const rejected = await request('POST', '/api/nodes', { type: 'finding', title: 'Synthetic claim', detail: 'x'.repeat(20000) + 'UNVERIFIED', rejectTruncation: true, requestId: 'strict-http' });
  assert.equal(rejected.status, 422);
  assert.equal(rejected.body.code, 'input_too_long');
  assert.deepEqual(rejected.body.fields, ['detail']);
  assert.deepEqual(rejected.body.limits.detail, { originalLength: 20010, storedLength: 20000 });
  assert.doesNotMatch(JSON.stringify(rejected.body), /UNVERIFIED/);
  assert.equal(log(cwd), before); assert.equal(getReceipt('strict-http', cwd), null);
  const edited = await request('PATCH', `/api/nodes/${base.id}`, { title: 'x'.repeat(501), expected: { title: 'Original' }, rejectTruncation: true });
  assert.equal(edited.status, 422); assert.equal(log(cwd), before);
  assert.equal(replay(cwd).nodes[base.id].title, 'Original');
});

test('HTTP old clients keep bounded writes while explicit strict saves deduplicate normally', async (t) => {
  const cwd = fixture(t); const request = await server(t, cwd);
  const old = await request('POST', '/api/nodes', { type: 'note', title: 'x'.repeat(501) });
  assert.equal(old.status, 201);
  assert.deepEqual(old.body.node.inputTruncation, { title: { originalLength: 501, storedLength: 500 } });
  const input = { type: 'note', title: 'Complete title', detail: 'Line one\nLimit: not verified.', rejectTruncation: true, requestId: 'complete-http' };
  const first = await request('POST', '/api/nodes', input); const before = log(cwd);
  const retry = await request('POST', '/api/nodes', input);
  assert.equal(first.status, 201); assert.deepEqual(retry, first); assert.equal(log(cwd), before);
  assert.equal(getReceipt('complete-http', cwd).status, 'committed');
  const bad = await request('PATCH', `/api/nodes/${first.body.node.id}`, { title: 'Other', rejectTruncation: 'true' });
  assert.equal(bad.status, 400); assert.equal(log(cwd), before);
});
