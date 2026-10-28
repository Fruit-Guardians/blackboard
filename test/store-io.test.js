import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { addNode, appendEvent, ensure, paths, readEvents, replay, withLock } from '../lib/store.js';

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blackboard-store-io-'));
  ensure(dir);
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function replace(t, method, implementation) {
  const original = fs[method];
  fs[method] = implementation(original);
  const restore = () => { fs[method] = original; };
  t.after(restore);
  return restore;
}

function observeOpen(t, file, flags) {
  let descriptor;
  replace(t, 'openSync', (original) => function(target, mode, ...args) {
    const fd = original.call(this, target, mode, ...args);
    if (target === file && mode === flags) descriptor = fd;
    return fd;
  });
  t.after(() => {
    if (descriptor !== undefined) {
      try { fs.closeSync(descriptor); } catch {}
    }
  });
  return () => descriptor;
}

for (const failingMethod of ['fstatSync', 'readSync']) {
  test(`readEvents closes its descriptor when ${failingMethod} fails`, (t) => {
    const dir = fixture(t);
    addNode({ title: 'Synthetic event' }, dir);
    const opened = observeOpen(t, paths(dir).events, 'r');
    const stat = fs.fstatSync;
    const restore = replace(t, failingMethod, (original) => function(fd, ...args) {
      if (fd === opened()) throw Object.assign(new Error('synthetic read failure'), { code: 'EIO' });
      return original.call(this, fd, ...args);
    });
    try {
      assert.deepEqual(readEvents(dir), {
        events: [], corrupt: 0, future: 0, offset: 0, truncated: false,
      });
      assert.notEqual(opened(), undefined);
      assert.throws(() => stat(opened()), { code: 'EBADF' });
    } finally {
      restore();
    }
    assert.equal(Object.values(replay(dir).nodes)[0].title, 'Synthetic event');
  });
}

test('short event reads preserve complete UTF-8 events, integrity counts and byte cursors', (t) => {
  const dir = fixture(t);
  addNode({ title: 'Synthetic 中文 event' }, dir);
  addNode({ title: 'Second synthetic event' }, dir);
  fs.appendFileSync(paths(dir).events, 'invalid JSON\n');
  appendEvent({ op: 'node', eventVersion: 2, node: { id: 'n3', title: 'Future event', type: 'note' } }, dir);
  fs.appendFileSync(paths(dir).events, '{"unfinished":');
  const bytes = fs.readFileSync(paths(dir).events);
  const fromByte = bytes.indexOf(0x0a) + 1;
  const expected = readEvents(dir);
  const expectedTail = readEvents(dir, fromByte);
  const opened = observeOpen(t, paths(dir).events, 'r');
  replace(t, 'readSync', (original) => function(fd, buffer, offset, length, position) {
    return original.call(this, fd, buffer, offset, fd === opened() ? Math.min(5, length) : length, position);
  });
  const log = readEvents(dir);
  assert.deepEqual(log, expected);
  assert.deepEqual(log.events.map((event) => event.node.title), ['Synthetic 中文 event', 'Second synthetic event']);
  assert.equal(log.corrupt, 1);
  assert.equal(log.future, 1);
  assert.equal(log.offset, bytes.lastIndexOf(0x0a) + 1);
  assert.deepEqual(readEvents(dir, fromByte), expectedTail);
  assert.deepEqual(Object.values(replay(dir).nodes).map((node) => node.title), [
    'Synthetic 中文 event', 'Second synthetic event',
  ]);
});

test('event reads stop at EOF if the observed file size exceeds the available bytes', (t) => {
  const dir = fixture(t);
  addNode({ title: 'Available event' }, dir);
  const expected = readEvents(dir);
  const opened = observeOpen(t, paths(dir).events, 'r');
  replace(t, 'fstatSync', (original) => function(fd, ...args) {
    const stat = original.call(this, fd, ...args);
    if (fd === opened()) stat.size += 20;
    return stat;
  });
  assert.deepEqual(readEvents(dir), expected);
});

for (const partial of [false, true]) {
  test(`a failed ${partial ? 'partial ' : ''}lock-token write closes and releases its own acquisition`, (t) => {
    const dir = fixture(t);
    const lock = paths(dir).lock;
    const opened = observeOpen(t, lock, 'wx');
    const restore = replace(t, 'writeFileSync', (original) => function(file, content, ...args) {
      if (file === opened()) {
        if (partial) original.call(this, file, content.slice(0, 4), ...args);
        throw Object.assign(new Error('synthetic token write failure'), { code: 'ENOSPC' });
      }
      return original.call(this, file, content, ...args);
    });
    try {
      assert.throws(() => addNode({ title: 'Failed acquisition' }, dir), { code: 'ENOSPC' });
      assert.notEqual(opened(), undefined);
      assert.throws(() => fs.fstatSync(opened()), { code: 'EBADF' });
      assert.equal(fs.existsSync(lock), false);
      assert.equal(readEvents(dir).events.length, 0);
    } finally {
      restore();
    }
    const { node } = addNode({ title: 'Next write succeeds' }, dir);
    assert.equal(replay(dir).nodes[node.id].title, 'Next write succeeds');
    assert.equal(fs.existsSync(lock), false);
  });
}

for (const replaceInode of [false, true]) {
  test(`a failed token write preserves another owner's ${replaceInode ? 'replacement file' : 'token'}`, (t) => {
    const dir = fixture(t);
    const lock = paths(dir).lock;
    const opened = observeOpen(t, lock, 'wx');
    const otherToken = `${process.pid}\n1\nother-owner\n`;
    const restore = replace(t, 'writeFileSync', (original) => function(file, content, ...args) {
      if (file === opened()) {
        if (replaceInode) fs.unlinkSync(lock);
        original.call(this, lock, otherToken);
        throw Object.assign(new Error('synthetic token write failure'), { code: 'ENOSPC' });
      }
      return original.call(this, file, content, ...args);
    });
    try {
      assert.throws(() => addNode({ title: 'Failed acquisition' }, dir), { code: 'ENOSPC' });
      assert.throws(() => fs.fstatSync(opened()), { code: 'EBADF' });
      assert.equal(fs.readFileSync(lock, 'utf8'), otherToken);
    } finally {
      restore();
    }
    assert.throws(() => withLock(() => assert.fail('live owner must keep its lock'), dir, 1), /lock timeout/);
    assert.equal(fs.readFileSync(lock, 'utf8'), otherToken);
  });
}

test('writable locks validate the acquired log and read-only locks remain available for newer events', (t) => {
  const dir = fixture(t);
  const lock = paths(dir).lock;
  const opened = observeOpen(t, lock, 'wx');
  let appended = false;
  const restore = replace(t, 'writeFileSync', (original) => function(file, content, ...args) {
    const result = original.call(this, file, content, ...args);
    if (file === opened() && !appended) {
      appended = true;
      appendEvent({ op: 'node', eventVersion: 2, node: { id: 'n1', type: 'note', title: 'Newer event' } }, dir);
    }
    return result;
  });
  try {
    assert.throws(() => withLock(() => assert.fail('future events must block writing'), dir), /eventVersion > 1/);
    assert.equal(fs.existsSync(lock), false);
  } finally {
    restore();
  }
  assert.equal(withLock((log) => {
    assert.equal(log, undefined);
    assert.equal(fs.existsSync(lock), true);
    return 'read-only snapshot';
  }, dir, null, { readOnly: true }), 'read-only snapshot');
  assert.equal(readEvents(dir).future, 1);
  assert.equal(fs.existsSync(lock), false);
});

test('writable lock callbacks receive the current log while holding the lock', (t) => {
  const dir = fixture(t);
  const { node } = addNode({ title: 'Current event' }, dir);
  const result = withLock((log) => {
    assert.equal(fs.existsSync(paths(dir).lock), true);
    assert.equal(log.events[0].node.id, node.id);
    assert.equal(log.future, 0);
    return node.id;
  }, dir);
  assert.equal(result, node.id);
  assert.equal(fs.existsSync(paths(dir).lock), false);
});

test('event reads preserve empty, exhausted, incomplete and missing-file cursor results', (t) => {
  const dir = fixture(t);
  const empty = (offset, truncated = false) => ({ events: [], corrupt: 0, future: 0, offset, truncated });
  assert.deepEqual(readEvents(dir), empty(0));
  addNode({ title: 'Complete event' }, dir);
  const size = fs.statSync(paths(dir).events).size;
  assert.deepEqual(readEvents(dir, size), empty(size));
  assert.deepEqual(readEvents(dir, size + 10), empty(size));
  fs.appendFileSync(paths(dir).events, '{"incomplete":');
  assert.deepEqual(readEvents(dir, size), empty(size, true));
  fs.unlinkSync(paths(dir).events);
  assert.deepEqual(readEvents(dir, size), empty(size));
});
