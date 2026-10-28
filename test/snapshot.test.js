import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ensure, addNode, moveCursor, paths } from '../lib/store.js';
import { startServer } from '../lib/server.js';
import { renderExport } from '../lib/export.js';

// Exercise both public consumers so changing one projection cannot silently fork them.
test('live and offline snapshots agree on surviving focus and graph while offline tool material stays private', async (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'blackboard-snapshot-'));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  ensure(cwd);
  const node = addNode({ type: 'note', title: 'Synthetic surviving note' }, cwd).node;
  moveCursor(node.id, { agentId: 'agent:reviewer' }, cwd);
  const board = paths(cwd);
  const activity = {
    id: 'fixture-activity', tool: 'Read', status: 'done', at: 1, linkedNodeIds: [node.id],
    input: 'SYNTHETIC_PRIVATE_INPUT', output: 'SYNTHETIC_PRIVATE_OUTPUT', summary: 'SYNTHETIC_PRIVATE_SUMMARY',
  };
  fs.appendFileSync(board.events, `${JSON.stringify({ eventVersion: 1, op: 'activity', activity })}\n`);
  const state = JSON.parse(fs.readFileSync(board.state, 'utf8'));
  fs.writeFileSync(board.state, JSON.stringify({ ...state, focus: 'missing-node' }));
  const beforeEvents = fs.readFileSync(board.events);
  const beforeState = fs.readFileSync(board.state);
  const server = await startServer({ cwd, port: 0 });
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/graph`);
    assert.equal(response.status, 200);
    const live = await response.json();
    const html = renderExport({ cwd });
    const offline = JSON.parse(html.match(/window\.__BLACKBOARD_DATA__ = (.*);/)[1]);
    assert.equal(live.meta.focus, null);
    assert.equal(offline.meta.focus, null, 'a missing cached focus must not survive in the offline projection');
    assert.equal(live.meta.writable, true);
    assert.equal(Object.hasOwn(offline.meta, 'writable'), false);
    assert.equal(live.schema, 'blackboard.graph.v2');
    assert.equal(offline.schema, live.schema);
    for (const field of ['nodes', 'edges', 'cursors', 'cursorTrail', 'checkpoints', 'stats', 'digest', 'digests']) {
      assert.deepEqual(offline[field], live[field], field);
    }
    assert.deepEqual(live.activities[activity.id], activity);
    assert.deepEqual(offline.activities[activity.id], {
      id: activity.id, tool: 'Read', status: 'done', at: 1, linkedNodeIds: [node.id],
    });
    assert.doesNotMatch(html, /SYNTHETIC_PRIVATE_(?:INPUT|OUTPUT|SUMMARY)/);
    assert.deepEqual(fs.readFileSync(board.events), beforeEvents);
    assert.deepEqual(fs.readFileSync(board.state), beforeState);
  } finally {
    await new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); });
  }
});
