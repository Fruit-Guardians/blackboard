import fs from 'node:fs';
import { paths } from '../store.js';
import { buildGraphSnapshot } from '../snapshot.js';

const PING = ': ping\n\n';

/** Full snapshots can coalesce while a reader is blocked; event history stays on disk. */
export function createGraphStream(cwd, { writable = true } = {}) {
  const file = paths(cwd).events;
  const clients = new Map();
  let poll = null;
  let heartbeat = null;
  let lastMtime = null;
  let lastSize = null;
  const frame = () => `event: graph\ndata: ${JSON.stringify(buildGraphSnapshot(cwd, { writable }))}\n\n`;

  function stopTimers() {
    clearInterval(poll);
    clearInterval(heartbeat);
    poll = heartbeat = null;
  }

  function remove(client) {
    clients.delete(client.res);
    client.res.off('close', client.close);
    client.res.off('drain', client.drain);
    client.pending = null;
    if (!clients.size) stopTimers();
  }

  function send(client, data) {
    if (client.res.destroyed || client.res.writableEnded) {
      remove(client);
      return;
    }
    if (client.blocked) {
      if (data !== PING) client.pending = data;
      return;
    }
    try {
      client.blocked = !client.res.write(data);
    } catch {
      remove(client);
      client.res.destroy();
    }
  }

  function tick() {
    if (!clients.size) return;
    try {
      const stat = fs.statSync(file);
      if (stat.mtimeMs === lastMtime && stat.size === lastSize) return;
      const data = frame();
      // A failed projection must not mark an unseen revision as delivered.
      lastMtime = stat.mtimeMs;
      lastSize = stat.size;
      for (const client of clients.values()) send(client, data);
    } catch { /* Keep the last delivered revision until a snapshot can be read. */ }
  }

  function subscribe(_req, res) {
    // Build before sending headers so a read failure can still return an HTTP error.
    const first = clients.size === 0;
    const stat = first ? fs.statSync(file) : null;
    const data = frame();
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    const client = { res, blocked: false, pending: null, close: null, drain: null };
    client.close = () => remove(client);
    client.drain = () => {
      client.blocked = false;
      const pending = client.pending;
      client.pending = null;
      if (pending !== null) send(client, pending);
    };
    clients.set(res, client);
    res.once('close', client.close);
    res.on('drain', client.drain);
    send(client, data);
    if (first && clients.size) {
      lastMtime = stat.mtimeMs;
      lastSize = stat.size;
      poll = setInterval(tick, 250);
      heartbeat = setInterval(() => {
        for (const entry of clients.values()) send(entry, PING);
      }, 15000);
    }
  }

  function close() {
    for (const client of clients.values()) {
      remove(client);
      client.res.end();
    }
    stopTimers();
  }

  return { subscribe, close };
}
