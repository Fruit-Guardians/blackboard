// Export the whole viewer as one self-contained HTML file: chrome, renderer and
// the current graph snapshot inlined. No server, no network.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { replay, readState, stats } from './store.js';
import { buildAgentDigests } from './digest.js';
import { projectNodeMap } from './model.js';
import { buildExportData } from './export-data.js';
import { renderMarkdown, renderMermaid } from './export-text.js';
import { renderSarif } from './export-sarif.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(HERE, '..', 'public');

function read(name) {
  return fs.readFileSync(path.join(PUBLIC_DIR, name), 'utf8');
}

// The layout engine runs in a Web Worker, which the viewer loads by URL. A file opened from disk has
// no server to fetch it from, so every worker asset the entry script references becomes a blob URL.
function inlineWorkers(js) {
  const dir = path.join(PUBLIC_DIR, 'assets');
  if (!fs.existsSync(dir)) return js;
  let output = js;
  for (const name of fs.readdirSync(dir).filter((file) => /^elk-worker.*\.js$/.test(file))) {
    const source = JSON.stringify(fs.readFileSync(path.join(dir, name), 'utf8'));
    const blob = `URL.createObjectURL(new Blob([${source}],{type:'text/javascript'}))`;
    output = output.split(`\`/assets/${name}\``).join(blob).split(`"/assets/${name}"`).join(blob);
  }
  return output;
}

function inlineBuiltAssets(html) {
  let output = html;
  output = output.replace(/<link rel="stylesheet"[^>]*href="\/([^"?]+)"[^>]*>/g, (_tag, href) => {
    return `<style>\n${read(href)}\n</style>`;
  });
  output = output.replace(/<script[^>]*src="\/([^"?]+)"[^>]*><\/script>/g, (_tag, src) => {
    const js = inlineWorkers(read(src)).replace(/<\/script/gi, '<\\/script');
    // Preserve module/deferred execution: Vite places the entry in <head>,
    // so an eager classic script would run before #root exists.
    return `<script type="module">\n${js}\n</script>`;
  });
  return output;
}

export function renderExport(options = {}) {
  const { cwd = process.cwd(), format = 'html', maxNodes, ...selection } = options;
  if (!['html', 'markdown', 'mermaid', 'sarif'].includes(format)) throw new Error('export format must be html, markdown, mermaid or sarif');
  if (maxNodes !== undefined && format !== 'mermaid') throw new Error('max-nodes is only supported for mermaid');
  const grouped = Array.isArray(selection.groupBy) ? selection.groupBy.length : selection.groupBy;
  if (format === 'sarif' && grouped) throw new Error('group-by is only supported for markdown and mermaid');
  if (format !== 'html') {
    const data = buildExportData(replay(cwd), { cwd, ...selection });
    if (format === 'markdown') return renderMarkdown(data);
    if (format === 'mermaid') return renderMermaid(data, { maxNodes });
    return renderSarif(data);
  }
  if (['query', 'type', 'tags', 'status', 'severity', 'confidence', 'relation', 'relatedTo', 'sort', 'groupBy']
    .some((key) => Array.isArray(selection[key]) ? selection[key].length : selection[key] !== undefined && selection[key] !== '')) {
    throw new Error('HTML exports the complete board; filters, sorting and grouping require a report format');
  }
  const g = replay(cwd);
  const state = readState(cwd);
  const digests = buildAgentDigests(g, cwd);
  const snap = {
    schema: 'blackboard.graph.v2',
    meta: {
      ...g.meta,
      title: g.meta.title || state.title,
      focus: g.meta.focus || state.focus,
      session: state.session,
    },
    nodes: projectNodeMap(g.nodes),
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
    digest: digests['agent:primary'],
    digests,
  };

  const html = read('index.html');

  const data = JSON.stringify(snap).replace(/</g, '\\u003c');
  const inline = `<script>
window.__BLACKBOARD_DATA__ = ${data};
try { document.documentElement.setAttribute('data-theme', 'light'); } catch (e) {}
</script>`;

  return inlineBuiltAssets(html)
    .replace('<head>', `<head>\n${inline}`)
    .replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(snap.meta.title || 'blackboard')} — 思考工作台</title>`);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
