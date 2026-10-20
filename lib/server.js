// Live server: serves the viewer, the graph snapshot, and an SSE stream that
// ticks whenever the event log grows.

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { paths, isInitialized, replay, readEvents, readState, stats } from './store.js';
import { buildDigest } from './digest.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(HERE, '..', 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

function snapshot(cwd) {
  const g = replay(cwd);
  const state = readState(cwd);
  return {
    meta: {
      ...g.meta,
      title: g.meta.title || state.title,
      focus: g.meta.focus || state.focus,
      session: state.session,
    },
    nodes: g.nodes,
    edges: g.edges,
    cursors: g.cursors,
    cursorTrail: g.cursorTrail.slice(-100),
    activities: g.activities,
    checkpoints: g.checkpoints,
    stats: stats(g),
    digest: buildDigest(g, cwd),
  };
}

export function startServer({ cwd = process.cwd(), port = 4317, open = false }) {
  if (!isInitialized(cwd)) {
    throw new Error('当前目录没有 .flow/，先运行 blackboard init');
  }
  const clients = new Set();
  let lastMtime = 0;
  let lastSize = 0;

  const tick = () => {
    try {
      const p = paths(cwd);
      const st = fs.statSync(p.events);
      if (st.mtimeMs === lastMtime && st.size === lastSize) return;
      lastMtime = st.mtimeMs;
      lastSize = st.size;
      const data = JSON.stringify(snapshot(cwd));
      for (const res of clients) {
        res.write(`event: graph\ndata: ${data}\n\n`);
      }
    } catch {}
  };

  setInterval(tick, 250);

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const p = url.pathname;

    if (p === '/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      res.write(`event: graph\ndata: ${JSON.stringify(snapshot(cwd))}\n\n`);
      clients.add(res);
      const ping = setInterval(() => res.write(': ping\n\n'), 15000);
      req.on('close', () => {
        clearInterval(ping);
        clients.delete(res);
      });
      return;
    }

    if (p === '/api/graph' || p === '/api/digest') {
      const snap = snapshot(cwd);
      const body = p === '/api/digest' ? JSON.stringify({ digest: snap.digest }) : JSON.stringify(snap);
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      return res.end(body);
    }

    let file = p === '/' ? '/index.html' : p;
    const abs = path.join(PUBLIC_DIR, path.normalize(file).replace(/^(\.\.[/\\])+/, ''));
    if (!abs.startsWith(PUBLIC_DIR)) {
      res.writeHead(403);
      return res.end('forbidden');
    }
    if (!fs.existsSync(abs)) {
      res.writeHead(404);
      return res.end('not found');
    }
    const ext = path.extname(abs);
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    fs.createReadStream(abs).pipe(res);
  });

  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      const addr = `http://127.0.0.1:${port}`;
      console.log(`blackboard 服务已启动  ${addr}`);
      console.log(`  图快照 ${addr}/api/graph · 摘要 ${addr}/api/digest · SSE ${addr}/events`);
      if (open) {
        import('node:child_process').then(({ exec }) => {
          const cmd =
            process.platform === 'darwin'
              ? `open "${addr}"`
              : process.platform === 'win32'
              ? `start "" "${addr}"`
              : `xdg-open "${addr}"`;
          exec(cmd);
        });
      }
      resolve(server);
    });
  });
}
