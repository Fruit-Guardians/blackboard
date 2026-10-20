// Export the whole viewer as one self-contained HTML file: chrome, renderer and
// the current graph snapshot inlined. No server, no network.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { replay, readState, stats } from './store.js';
import { buildDigest } from './digest.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(HERE, '..', 'public');

function read(name) {
  return fs.readFileSync(path.join(PUBLIC_DIR, name), 'utf8');
}

export function renderExport({ cwd = process.cwd() } = {}) {
  const g = replay(cwd);
  const state = readState(cwd);
  const snap = {
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
    // Export activity metadata only; raw tool input/output may contain secrets.
    activities: Object.fromEntries(
      Object.values(g.activities).map((a) => [a.id, {
        id: a.id,
        tool: a.tool,
        status: a.status,
        at: a.at,
        linkedNodeIds: a.linkedNodeIds,
      }]),
    ),
    checkpoints: g.checkpoints,
    stats: stats(g),
    digest: buildDigest(g, cwd),
  };

  const html = read('index.html');
  const css = read('style.css');
  const js = read('app.js');

  const data = JSON.stringify(snap).replace(/</g, '\\u003c');
  const inline = `<script>
window.__FLOW_STATIC__ = true;
window.__FLOW_DATA__ = ${data};
try { document.documentElement.setAttribute('data-theme', 'light'); } catch (e) {}
</script>`;

  return html
    .replace('<link rel="stylesheet" href="/style.css">', `<style>\n${css}\n</style>`)
    .replace('<script src="/app.js"></script>', `${inline}\n<script>\n${js}\n</script>`)
    .replace('<title>blackboard — Agent 外置黑板</title>', `<title>${escapeHtml(snap.meta.title || 'blackboard')} — Agent 外置黑板</title>`);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
