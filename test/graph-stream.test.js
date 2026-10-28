import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { setImmediate as flush } from 'node:timers/promises';

// Compile the controller using the same portable Node 18+ pattern as the viewer tests.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blackboard-graph-stream-'));
after(() => fs.rmSync(dir, { recursive: true, force: true }));
const root = fileURLToPath(new URL('../', import.meta.url));
execFileSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '--target', 'ES2022', '--module', 'ESNext', '--moduleResolution', 'Bundler', '--skipLibCheck', '--outDir', dir, path.join(root, 'web/src/workspace/graph-stream.ts')], { cwd: dir });
function resolveModuleExtensions(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const p = path.join(directory, entry.name);
    if (entry.isDirectory()) resolveModuleExtensions(p);
    else if (entry.name.endsWith('.js')) fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace(/from '(\.\.?\/[^']+)'/g, (_all, name) => `from '${name}.js'`));
  }
}
resolveModuleExtensions(dir);
fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ type: 'module' }));
const { createGraphSubscription } = await import(pathToFileURL(path.join(dir, 'workspace/graph-stream.js')).href);
const { t: translate } = await import(pathToFileURL(path.join(dir, 'i18n.js')).href);

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function graph(title, arrays = false) {
  const node = { id: 'n1', type: 'authored-type', title, author: 'agent:synthetic', custom: { evidence: true } };
  const edge = { id: 'e1', from: 'n1', to: 'n1', kind: 'authored-relation', custom: ['preserved'] };
  return { meta: { title, authored: true }, nodes: arrays ? [node] : { n1: node }, edges: arrays ? [edge] : { e1: edge }, extension: { source: 'synthetic' } };
}
function response(data, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => data };
}
function fixture(context, options = {}) {
  const calls = [];
  const updates = [];
  let graphListener;
  let clock = 100;
  let streamUrl;
  const stream = {
    onopen: null,
    onerror: null,
    closed: 0,
    addEventListener(type, listener) { assert.equal(type, 'graph'); graphListener = listener; },
    close() { this.closed++; },
    open() { this.onopen?.(); },
    fail() { this.onerror?.(); },
    raw(data) { graphListener?.({ data }); },
    graph(data) { this.raw(JSON.stringify(data)); },
  };
  const ports = {
    fetch(url, { signal }) {
      const pending = deferred();
      calls.push({ url, signal, ...pending });
      return pending.promise;
    },
    openStream(url) { streamUrl = url; return stream; },
    now() { return ++clock; },
  };
  const subscription = createGraphSubscription((state) => updates.push(state), { ports, ...options });
  context.after(() => subscription.dispose());
  return { subscription, calls, updates, stream, get streamUrl() { return streamUrl; } };
}

test('a slow initial read cannot roll back a newer graph event or its sync time', async (context) => {
  const { subscription, calls, stream, streamUrl } = fixture(context);
  assert.equal(calls[0].url, '/api/graph');
  assert.equal(streamUrl, '/events');
  stream.graph(graph('newer'));
  const latest = subscription.getState();
  calls[0].resolve(response(graph('older')));
  await flush();
  assert.equal(subscription.getState(), latest);
  assert.equal(latest.snapshot.meta.title, 'newer');
  assert.equal(latest.connection, 'live');
  assert.equal(latest.syncedAt, 101);
});

test('overlapping reloads use request-start order and later events supersede pending reads', async (context) => {
  const { subscription, calls, stream } = fixture(context);
  calls[0].resolve(response(graph('initial')));
  await flush();
  const first = subscription.reload();
  const second = subscription.reload();
  calls[2].resolve(response(graph('second')));
  await second;
  const newer = subscription.getState();
  calls[1].resolve(response(graph('first')));
  await first;
  assert.equal(subscription.getState(), newer);
  const third = subscription.reload();
  stream.graph(graph('event'));
  const event = subscription.getState();
  calls[3].resolve(response(graph('third')));
  await third;
  assert.equal(subscription.getState(), event);
});

test('opening the stream does not mark data synced or recover a disconnected viewer', async (context) => {
  const { subscription, calls, stream } = fixture(context);
  stream.open();
  assert.deepEqual(subscription.getState(), { snapshot: null, connection: 'connecting', syncedAt: null, isStatic: false });
  calls[0].reject(new Error('Synthetic disconnect'));
  await flush();
  stream.open();
  assert.equal(subscription.getState().connection, 'offline');
  assert.equal(subscription.getState().syncedAt, null);
  stream.graph(graph('received'));
  const received = subscription.getState();
  stream.fail();
  stream.open();
  assert.equal(subscription.getState().connection, 'offline');
  assert.equal(subscription.getState().snapshot, received.snapshot);
  assert.equal(subscription.getState().syncedAt, received.syncedAt);
});

test('malformed graph events retain the last valid snapshot until valid data recovers', async (context) => {
  const { subscription, calls, stream } = fixture(context);
  calls[0].resolve(response(graph('initial')));
  await flush();
  const malformed = [
    null, [], 'graph', 7, true, {},
    { nodes: {}, edges: {} }, { meta: null, nodes: {}, edges: {} },
    { meta: [], nodes: {}, edges: {} }, { meta: 'meta', nodes: {}, edges: {} },
    { meta: {}, edges: {} }, { meta: {}, nodes: null, edges: {} },
    { meta: {}, nodes: 'nodes', edges: {} }, { meta: {}, nodes: 1, edges: {} },
    { meta: {}, nodes: {} }, { meta: {}, nodes: {}, edges: null },
    { meta: {}, nodes: {}, edges: false }, { meta: {}, nodes: {}, edges: 'edges' },
    { meta: {}, nodes: [null], edges: {} }, { meta: {}, nodes: { n: [] }, edges: {} },
    { meta: {}, nodes: {}, edges: [false] }, { meta: {}, nodes: {}, edges: { e: null } },
  ];
  for (const [index, value] of malformed.entries()) {
    const valid = subscription.getState();
    stream.graph(value);
    assert.equal(subscription.getState().snapshot, valid.snapshot, JSON.stringify(value));
    assert.equal(subscription.getState().syncedAt, valid.syncedAt);
    assert.equal(subscription.getState().connection, 'offline');
    stream.open();
    assert.equal(subscription.getState().connection, 'offline');
    const recovered = graph(`recovered-${index}`, index % 2 === 0);
    stream.graph(recovered);
    assert.deepEqual(subscription.getState().snapshot, recovered);
    assert.equal(subscription.getState().connection, 'live');
    assert.ok(subscription.getState().syncedAt > valid.syncedAt);
  }
  const valid = subscription.getState();
  stream.raw('{');
  assert.equal(subscription.getState().snapshot, valid.snapshot);
  assert.equal(subscription.getState().syncedAt, valid.syncedAt);
  assert.equal(subscription.getState().connection, 'offline');
  stream.graph(graph('recovered from syntax error'));
  assert.equal(subscription.getState().connection, 'live');
});

test('invalid newer stream data cannot be repaired by an older in-flight HTTP snapshot', async (context) => {
  const { subscription, calls, stream } = fixture(context);
  stream.graph(null);
  calls[0].resolve(response(graph('stale')));
  await flush();
  assert.deepEqual(subscription.getState(), { snapshot: null, connection: 'offline', syncedAt: null, isStatic: false });
  stream.graph(graph('current'));
  assert.equal(subscription.getState().snapshot.meta.title, 'current');
  assert.equal(subscription.getState().connection, 'live');
});

test('dictionary and array snapshots preserve authored fields without coercion or fabricated data', async (context) => {
  const { subscription, calls, stream } = fixture(context);
  const authored = graph('dictionary');
  calls[0].resolve(response(authored));
  await flush();
  assert.equal(subscription.getState().snapshot, authored);
  const arrays = graph('arrays', true);
  stream.graph(arrays);
  assert.deepEqual(subscription.getState().snapshot, arrays);
  stream.graph({ meta: {}, nodes: [], edges: {} });
  assert.deepEqual(subscription.getState().snapshot, { meta: {}, nodes: [], edges: {} });
});

test('an invalid initial HTTP graph stays offline until a valid reload arrives', async (context) => {
  const { subscription, calls, stream } = fixture(context);
  calls[0].resolve(response({ meta: {}, nodes: [], edges: null }));
  await flush();
  stream.open();
  assert.deepEqual(subscription.getState(), { snapshot: null, connection: 'offline', syncedAt: null, isStatic: false });
  assert.equal(calls.length, 1, 'invalid data must not start an automatic retry');
  const recovery = subscription.reload();
  const valid = graph('valid reload');
  calls[1].resolve(response(valid));
  await recovery;
  assert.equal(subscription.getState().snapshot, valid);
  assert.equal(subscription.getState().connection, 'live');
});

test('reload errors reject without discarding a snapshot and malformed responses mark it offline', async (context) => {
  const { subscription, calls, stream } = fixture(context);
  calls[0].resolve(response(graph('valid')));
  await flush();
  const valid = subscription.getState();
  const network = subscription.reload();
  calls[1].reject(new Error('Synthetic network failure'));
  await assert.rejects(network, { message: translate('api.noResponse') });
  assert.equal(subscription.getState(), valid);
  const http = subscription.reload();
  calls[2].resolve(response(null, 503));
  await assert.rejects(http, { message: translate('api.failed', { status: 503 }) });
  assert.equal(subscription.getState(), valid);
  const invalid = subscription.reload();
  calls[3].resolve(response({ meta: {}, nodes: null, edges: [] }));
  await assert.rejects(invalid, { message: translate('api.invalidResponse', { status: 200 }) });
  assert.equal(subscription.getState().snapshot, valid.snapshot);
  assert.equal(subscription.getState().syncedAt, valid.syncedAt);
  assert.equal(subscription.getState().connection, 'offline');
  stream.graph(graph('recovered'));
  const recovered = subscription.getState();
  const brokenBody = subscription.reload();
  const syntaxError = new SyntaxError('Synthetic malformed JSON');
  calls[4].resolve({ ok: true, status: 200, json: async () => { throw syntaxError; } });
  await assert.rejects(brokenBody, (error) => error === syntaxError);
  assert.equal(subscription.getState().snapshot, recovered.snapshot);
  assert.equal(subscription.getState().syncedAt, recovered.syncedAt);
  assert.equal(subscription.getState().connection, 'offline');
  const successful = subscription.reload();
  calls[5].resolve(response(graph('HTTP recovery')));
  await successful;
  assert.equal(subscription.getState().connection, 'live');
  assert.equal(subscription.getState().snapshot.meta.title, 'HTTP recovery');
});

test('obsolete malformed HTTP results and initial failures cannot disconnect newer valid data', async (context) => {
  const { subscription, calls, stream } = fixture(context);
  stream.graph(graph('current'));
  const current = subscription.getState();
  calls[0].reject(new Error('Late initial failure'));
  await flush();
  assert.equal(subscription.getState(), current);
  const stale = subscription.reload();
  stream.graph(graph('newest'));
  const newest = subscription.getState();
  calls[1].resolve(response(null));
  await stale;
  assert.equal(subscription.getState(), newest);
  const staleBody = subscription.reload();
  stream.graph(graph('latest'));
  const latest = subscription.getState();
  calls[2].resolve({ ok: true, status: 200, json: async () => { throw new SyntaxError('Obsolete body'); } });
  await assert.rejects(staleBody, SyntaxError);
  assert.equal(subscription.getState(), latest);
});

test('disposal aborts every outstanding read and ignores late bodies and stream callbacks', async (context) => {
  const { subscription, calls, updates, stream } = fixture(context);
  const body = deferred();
  calls[0].resolve({ ok: true, status: 200, json: () => body.promise });
  await flush();
  const pending = subscription.reload();
  const before = subscription.getState();
  const updateCount = updates.length;
  subscription.dispose();
  subscription.dispose();
  assert.equal(stream.closed, 1);
  assert.ok(calls.every(({ signal }) => signal.aborted));
  stream.open();
  stream.graph(graph('late event'));
  stream.raw('{');
  stream.fail();
  body.resolve(graph('late body'));
  calls[1].resolve(response(graph('late response')));
  await pending;
  await flush();
  await subscription.reload();
  assert.equal(calls.length, 2, 'disposed subscriptions cannot start more reads');
  assert.equal(updates.length, updateCount);
  assert.equal(subscription.getState(), before);
});

test('aborting a pending fetch cannot publish an offline state after disposal', async (context) => {
  const { subscription, calls, updates } = fixture(context);
  calls[0].signal.addEventListener('abort', () => calls[0].reject(new Error('Synthetic abort')));
  const before = subscription.getState();
  subscription.dispose();
  await flush();
  assert.equal(subscription.getState(), before);
  assert.equal(updates.length, 1);
});

test('embedded snapshots use no network, including malformed embedded exports', async (context) => {
  for (const embedded of [graph('embedded'), graph('embedded arrays', true), null, [], 0, false, {}, { meta: {}, nodes: null, edges: {} }]) {
    const { subscription, calls, stream, streamUrl } = fixture(context, { embedded });
    await subscription.reload();
    const state = subscription.getState();
    assert.equal(calls.length, 0);
    assert.equal(streamUrl, undefined);
    assert.equal(state.isStatic, true);
    assert.equal(state.syncedAt, null);
    const valid = Boolean(embedded?.meta?.title);
    assert.equal(state.snapshot, valid ? embedded : null);
    assert.equal(state.connection, valid ? 'live' : 'offline');
    subscription.dispose();
    assert.equal(stream.closed, 0);
  }
});
