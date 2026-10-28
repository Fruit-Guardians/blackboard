import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { ensure, addNode, patchNode } from '../lib/store.js';
import { createGraphStream } from '../lib/http/graph-stream.js';

function board(t) {
  const cwd = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'blackboard-sse-')));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  ensure(cwd);
  return cwd;
}

/** A response whose socket never accepts more data until it drains. */
class Reader extends EventEmitter {
  constructor({ blocked = false } = {}) {
    super();
    this.blocked = blocked;
    this.frames = [];
    this.destroyed = false;
    this.writableEnded = false;
  }
  writeHead() {}
  write(chunk) { this.frames.push(String(chunk)); return !this.blocked; }
  end() { this.writableEnded = true; }
  destroy() { this.destroyed = true; }
  graphs() { return this.frames.filter((frame) => frame.startsWith('event: graph')).map((frame) => JSON.parse(frame.slice(frame.indexOf('data: ') + 6))); }
}

const title = (graph, id) => Object.values(graph.nodes).find((node) => node.id === id)?.title;

async function until(condition, timeout = 5000) {
  const deadline = Date.now() + timeout;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('condition not reached');
    await delay(25);
  }
}

test('a blocked reader receives one newest snapshot per drain instead of every intermediate revision', async (t) => {
  const cwd = board(t);
  const id = addNode({ type: 'note', title: 'Synthetic initial' }, cwd).node.id;
  const stream = createGraphStream(cwd);
  t.after(() => stream.close());
  const reader = new Reader({ blocked: true });
  stream.subscribe({}, reader);
  assert.equal(reader.graphs().length, 1, 'the current snapshot is sent on subscribe');

  for (let i = 1; i <= 3; i++) {
    patchNode(id, { title: `Synthetic update ${i}` }, cwd);
    await delay(300);
  }
  assert.equal(reader.graphs().length, 1, 'nothing more is written while the reader is blocked');

  let drains = 0;
  await until(() => {
    reader.emit('drain');
    drains++;
    return title(reader.graphs().at(-1), id) === 'Synthetic update 3';
  });
  assert.ok(reader.graphs().length - 1 <= drains, 'at most one snapshot is released per drain');
  assert.equal(reader.graphs().length, 2, 'intermediate revisions coalesce into the newest one');
});

test('readers that join after an idle period see writes made while nobody was subscribed', async (t) => {
  const cwd = board(t);
  const id = addNode({ type: 'note', title: 'Synthetic first' }, cwd).node.id;
  const stream = createGraphStream(cwd);
  t.after(() => stream.close());
  const first = new Reader();
  stream.subscribe({}, first);
  first.emit('close');

  patchNode(id, { title: 'Synthetic while idle' }, cwd);
  const later = new Reader();
  stream.subscribe({}, later);
  assert.equal(title(later.graphs()[0], id), 'Synthetic while idle');
  assert.equal(first.graphs().length, 1, 'a closed reader receives nothing further');

  patchNode(id, { title: 'Synthetic after rejoin' }, cwd);
  await until(() => title(later.graphs().at(-1), id) === 'Synthetic after rejoin');
  stream.close();
  assert.equal(later.writableEnded, true, 'closing the stream ends active readers');
});

test('a reader that already went away is removed instead of written to', async (t) => {
  const cwd = board(t);
  const id = addNode({ type: 'note', title: 'Synthetic gone' }, cwd).node.id;
  const stream = createGraphStream(cwd);
  t.after(() => stream.close());
  const gone = new Reader();
  const present = new Reader();
  stream.subscribe({}, gone);
  stream.subscribe({}, present);
  gone.destroyed = true;
  patchNode(id, { title: 'Synthetic delivered' }, cwd);
  await until(() => title(present.graphs().at(-1), id) === 'Synthetic delivered');
  assert.equal(gone.graphs().length, 1);
});
