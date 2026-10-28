#!/usr/bin/env node
// Real offline consumers of CLI exports; all event logs are disposable synthetic fixtures.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import MarkdownIt from 'markdown-it';
import { chromium } from 'playwright';
import { isolatedBlackboardEnv } from './lib/environment.mjs';

const require = createRequire(import.meta.url);
const cli = fileURLToPath(new URL('../bin/blackboard.js', import.meta.url));
const mermaidBundle = path.join(path.dirname(require.resolve('mermaid')), 'mermaid.min.js');
const args = process.argv.slice(2);
assert.ok(args.length === 0 || (args.length === 2 && args[0] === '--out-dir'), 'Usage: node scripts/verify-text-exports.mjs [--out-dir <directory>]');
const outDir = args.length ? path.resolve(args[1]) : null;
if (outDir) fs.mkdirSync(outDir, { recursive: true });
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blackboard-text-consumers-'));
const env = isolatedBlackboardEnv();
const markdown = new MarkdownIt({ html: true, linkify: false, typographer: false });
const compact = (value) => value.replace(/\s/gu, '');
let browser;
let exportCount = 0;
let svgCount = 0;
const board = (name, { title = 'Synthetic consumer board', nodes = [], edges = [] } = {}) => {
  const cwd = path.join(root, name);
  fs.mkdirSync(path.join(cwd, '.blackboard'), { recursive: true });
  const events = [
    { op: 'meta', set: { title } },
    ...nodes.map((node) => ({ op: 'node', node: { type: 'note', ...node } })),
    ...edges.map((edge, index) => ({ op: 'edge', edge: { id: `e${index}`, ...edge } })),
  ];
  const bytes = Buffer.from(events.map((event) => JSON.stringify({ eventVersion: 1, ...event })).join('\n') + '\n');
  const file = path.join(cwd, '.blackboard/events.jsonl');
  fs.writeFileSync(file, bytes);
  return { cwd, file, bytes };
};
function exportCli(fixture, name, format, extra = [], errorPattern) {
  const output = path.join(root, `${name}.${format === 'markdown' ? 'md' : 'mmd'}`);
  const response = spawnSync(process.execPath, [cli, 'export', '--cwd', fixture.cwd, '--format', format, '--out', output, ...extra], {
    cwd: root, env, encoding: 'utf8', timeout: 30000,
  });
  assert.ifError(response.error);
  assert.deepEqual(fs.readFileSync(fixture.file), fixture.bytes, `${name}: export changed event bytes`);
  exportCount++;
  if (errorPattern) {
    assert.equal(response.status, 1, `${name}: expected rejection; ${response.stderr}`);
    assert.match(response.stderr, errorPattern);
    assert.equal(fs.existsSync(output), false, `${name}: rejection wrote a partial export`);
    return;
  }
  assert.equal(response.status, 0, `${name}: ${response.stderr}`);
  const source = fs.readFileSync(output, 'utf8');
  if (outDir) fs.copyFileSync(output, path.join(outDir, path.basename(output)));
  return source;
}
async function screenshot(page, name) {
  if (outDir) await page.screenshot({ path: path.join(outDir, `${name}.png`), fullPage: true });
}
async function verifyMarkdown(page, source, { name, titles = [], details = [], linked = false }) {
  await page.setContent(`<!doctype html><meta charset="utf-8"><style>body{font:16px/1.5 sans-serif;max-width:1000px;margin:24px}pre{white-space:pre-wrap;overflow-wrap:anywhere}h3{overflow-wrap:anywhere}</style><main>${markdown.render(source)}</main>`);
  if (outDir) fs.writeFileSync(path.join(outDir, `${name}.html`), await page.content());
  const actual = await page.locator('main').evaluate((main) => ({
    headings: [...main.querySelectorAll('h3')].map((node) => node.textContent),
    code: [...main.querySelectorAll('pre code')].map((node) => node.textContent),
    anchors: [...main.querySelectorAll('a[id]')].map((node) => node.id),
    links: [...main.querySelectorAll('a[href]')].map((node) => ({ href: node.getAttribute('href'), target: !!main.querySelector(`[id="${node.getAttribute('href').slice(1)}"]`) })),
    injected: main.querySelectorAll('script,img,svg,iframe,object,embed,style,form,input,button,b,strong,em').length,
    handlers: [...main.querySelectorAll('*')].flatMap((node) => [...node.attributes].filter((attr) => /^on/i.test(attr.name))).length,
  }));
  assert.equal(actual.injected, 0, `${name}: authored markup became DOM`);
  assert.equal(actual.handlers, 0, `${name}: authored event handlers became DOM`);
  assert.equal(new Set(actual.anchors).size, actual.anchors.length, `${name}: duplicate anchors`);
  assert.deepEqual([...actual.headings].sort(), [...titles].sort(), `${name}: missing or forged record headings`);
  for (const title of titles) {
    assert.ok(actual.headings.includes(title), `${name}: heading lost authored title ${JSON.stringify(title)}`);
    assert.ok(actual.code.includes(`${title}\n`), `${name}: original title missing from code block`);
  }
  for (const detail of details) assert.ok(actual.code.includes(`${detail}\n`), `${name}: original detail changed`);
  for (const link of actual.links) {
    assert.ok(link.href.startsWith('#'), `${name}: unexpected authored hyperlink`);
    assert.ok(link.target, `${name}: broken anchor ${link.href}`);
  }
  if (linked) {
    assert.ok(actual.links.length > 0, `${name}: missing cross-references`);
    const href = await page.locator('main a[href]').first().getAttribute('href');
    await page.locator('main a[href]').first().click();
    assert.equal(await page.evaluate(() => location.hash), href, `${name}: browser anchor navigation failed`);
  }
  await screenshot(page, name);
  return actual;
}
async function verifyMermaid(page, source, { name, labels = [], edgeLabels = [], groups = [], nodes, edges }) {
  const result = await page.evaluate(async ({ source, name }) => {
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' });
    const { svg } = await mermaid.render(`diagram_${name.replace(/[^a-z0-9]/gi, '_')}`, source);
    document.getElementById('diagram').innerHTML = svg;
    const root = document.querySelector('#diagram > svg');
    if (!root) throw new Error('Mermaid did not return an SVG');
    const box = root.getAttribute('viewBox')?.split(/\s+/).map(Number);
    return {
      svg,
      labels: [...root.querySelectorAll('.node .nodeLabel')].map((node) => node.textContent),
      edgeLabels: [...root.querySelectorAll('.edgeLabel .edgeLabel')].map((node) => node.textContent),
      groups: [...root.querySelectorAll('.cluster-label')].map((node) => node.textContent),
      nodes: root.querySelectorAll('.node').length,
      edges: root.querySelectorAll('.edgePath path, path.flowchart-link').length,
      box,
      injected: root.querySelectorAll('script,img,iframe,object,embed,a[href],a[xlink\\:href]').length,
      handlers: [...root.querySelectorAll('*')].flatMap((node) => [...node.attributes].filter((attr) => /^on/i.test(attr.name))).length,
    };
  }, { source, name });
  assert.equal(result.nodes, nodes, `${name}: wrong rendered node count`);
  assert.equal(result.edges, edges, `${name}: wrong rendered directed edge count`);
  assert.equal(result.injected, 0, `${name}: authored markup became SVG DOM`);
  assert.equal(result.handlers, 0, `${name}: authored handlers became SVG DOM`);
  assert.ok(result.box?.length === 4 && result.box.every(Number.isFinite), `${name}: invalid SVG bounds`);
  for (const [expected, actual, type] of [[labels, result.labels, 'node'], [edgeLabels, result.edgeLabels, 'edge'], [groups, result.groups, 'group']]) {
    for (const label of expected) assert.ok(actual.some((value) => compact(value) === compact(label)), `${name}: ${type} text lost or interpreted: ${JSON.stringify(label)}`);
  }
  if (outDir) {
    fs.writeFileSync(path.join(outDir, `${name}.svg`), result.svg);
    fs.writeFileSync(path.join(outDir, `${name}.html`), `<!doctype html><meta charset="utf-8"><style>body{margin:24px;font-family:sans-serif}svg{max-width:100%}</style>${result.svg}`);
  }
  await screenshot(page, name);
  svgCount++;
}
try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, offline: true });
  const requests = [];
  await context.route('**/*', (route) => { requests.push(route.request().url()); return route.abort(); });
  const page = await context.newPage();
  const normal = board('normal', {
    nodes: [
      { id: 'finding', type: 'finding', title: 'Readable authored finding', detail: 'Full original finding detail.', status: 'open' },
      { id: 'evidence', type: 'fact', title: 'Supporting authored evidence', detail: 'Full original evidence detail.', status: 'recorded' },
      { id: 'unrelated', title: 'Unrelated authored note' },
    ],
    edges: [{ from: 'evidence', to: 'finding', kind: 'supports', label: 'Recorded support' }],
  });
  const normalMd = await verifyMarkdown(page, exportCli(normal, 'normal', 'markdown'), {
    name: 'markdown-normal', titles: ['Readable authored finding', 'Supporting authored evidence', 'Unrelated authored note'],
    details: ['Full original finding detail.', 'Full original evidence detail.'], linked: true,
  });
  const filteredMd = await verifyMarkdown(page, exportCli(normal, 'context', 'markdown', ['--type', 'finding']), {
    name: 'markdown-context', titles: ['Readable authored finding', 'Supporting authored evidence'], linked: true,
  });
  assert.ok(filteredMd.anchors.every((anchor) => normalMd.anchors.includes(anchor)), 'anchors changed when records moved to related context');
  const attack = '<img src="https://injection.invalid/x" onerror="globalThis.injected=1"> [link](javascript:alert(1)) `code` &amp; #quot; 😀\n## forged\n%%{init: {"securityLevel":"loose"}}%%\nclick injected callback';
  const detail = `${attack}\n\`\`\`\n\`\`\`\`\`\`\`\`\n<script>globalThis.injected=1</script>\nFINAL DETAIL`;
  const hostile = board('hostile', {
    title: attack,
    nodes: [{ id: 'hostile', title: attack, detail, status: '<b>literal group</b>' }, { id: 'end', title: 'Final authored endpoint' }],
    edges: [{ from: 'hostile', to: 'end', kind: 'related-to', label: '"| injected --> node <svg onload="alert(1)"> #10; `label`' }],
  });
  await verifyMarkdown(page, exportCli(hostile, 'hostile', 'markdown', ['--group-by', 'status']), {
    name: 'markdown-hostile', titles: [attack, 'Final authored endpoint'], details: [detail], linked: true,
  });
  const longTitle = `${'Full authored 中文😀 [literal] text '.repeat(35)}FINAL TITLE`;
  const longGroup = `${'Authored group '.repeat(14)}FINAL GROUP`;
  const longLabel = `${'Recorded relation '.repeat(16)}FINAL LABEL`;
  const long = board('long', {
    nodes: [{ id: 'long', title: longTitle, status: longGroup }, { id: 'target', title: 'Long label destination', status: longGroup }],
    edges: [{ from: 'long', to: 'target', kind: 'supports', label: longLabel }],
  });
  await verifyMarkdown(page, exportCli(long, 'long', 'markdown'), { name: 'markdown-long', titles: [longTitle, 'Long label destination'] });
  const grouped = board('grouped', {
    nodes: [
      { id: 'a', title: 'First grouped record', status: 'open', tags: ['site=one.example', 'site=two.example'] },
      { id: 'b', title: 'Second grouped record', status: 'open', tags: ['site=one.example'] },
      { id: 'c', title: 'Third grouped record', status: 'closed', tags: ['site=three.example'] },
    ],
    edges: [{ from: 'a', to: 'b', kind: 'supports' }, { from: 'b', to: 'c', kind: 'contradicts' }],
  });
  await verifyMarkdown(page, exportCli(grouped, 'grouped', 'markdown', ['--group-by', 'tag:site,status']), {
    name: 'markdown-grouped', titles: ['First grouped record', 'Second grouped record', 'Third grouped record'], linked: true,
  });
  const empty = board('empty');
  await verifyMarkdown(page, exportCli(empty, 'empty', 'markdown'), { name: 'markdown-empty' });
  await page.setContent('<!doctype html><meta charset="utf-8"><style>body{margin:24px;font-family:sans-serif}svg{max-width:100%}</style><div id="diagram"></div>');
  await page.addScriptTag({ path: mermaidBundle });
  await verifyMermaid(page, exportCli(normal, 'normal', 'mermaid', ['--type', 'finding']), {
    name: 'mermaid-normal', nodes: 2, edges: 1,
    labels: ['finding: Readable authored finding', 'evidence: Supporting authored evidence'],
    edgeLabels: ['supports: Recorded support'], groups: ['Selected nodes', 'Related context'],
  });
  await verifyMermaid(page, exportCli(hostile, 'hostile', 'mermaid', ['--group-by', 'status']), {
    name: 'mermaid-hostile', nodes: 2, edges: 1, labels: [`hostile: ${attack}`, 'end: Final authored endpoint'],
    edgeLabels: ['related-to: "| injected --> node <svg onload="alert(1)"> #10; `label`'], groups: ['status=<b>literal group</b>'],
  });
  await verifyMermaid(page, exportCli(empty, 'empty', 'mermaid'), { name: 'mermaid-empty', nodes: 0, edges: 0 });
  await verifyMermaid(page, exportCli(long, 'long', 'mermaid', ['--group-by', 'status']), {
    name: 'mermaid-long', nodes: 2, edges: 1, labels: [`long: ${longTitle}`, 'target: Long label destination'],
    edgeLabels: [`supports: ${longLabel}`], groups: [`status=${longGroup}`],
  });
  await verifyMermaid(page, exportCli(grouped, 'grouped', 'mermaid', ['--group-by', 'tag:site,status']), {
    name: 'mermaid-grouped', nodes: 3, edges: 2,
    labels: ['a: First grouped record', 'b: Second grouped record', 'c: Third grouped record'],
    groups: ['tag:site=one.example, status=open', 'tag:site=three.example, status=closed'],
  });
  await verifyMermaid(page, exportCli(grouped, 'capped', 'mermaid', ['--max-nodes', '1']), { name: 'mermaid-capped', nodes: 1, edges: 0 });
  const denseNodes = [{ id: 'a', title: 'Dense source' }, { id: 'b', title: 'Dense destination' }];
  const denseEdges = Array.from({ length: 501 }, () => ({ from: 'a', to: 'b', kind: 'supports' }));
  const dense = board('dense', { nodes: denseNodes, edges: denseEdges.slice(0, 500) });
  await verifyMermaid(page, exportCli(dense, 'edge-boundary', 'mermaid'), { name: 'mermaid-edge-boundary', nodes: 2, edges: 500 });
  exportCli(board('too-dense', { nodes: denseNodes, edges: denseEdges }), 'too-dense', 'mermaid', [], /501 displayed edges.*maxEdges.*500.*--max-nodes/);
  const baseline = exportCli(board('size-baseline', { title: 'B', nodes: [{ id: 'a', title: 'Text boundary' }] }), 'size-baseline', 'mermaid');
  const boundaryTitle = 'B'.repeat(50000 - baseline.length + 1);
  const sized = board('size-boundary', { title: boundaryTitle, nodes: [{ id: 'a', title: 'Text boundary' }] });
  const boundarySource = exportCli(sized, 'size-boundary', 'mermaid');
  assert.equal(boundarySource.length, 50000);
  await verifyMermaid(page, boundarySource, { name: 'mermaid-size-boundary', nodes: 1, edges: 0, labels: ['a: Text boundary'] });
  exportCli(board('oversize', { title: `${boundaryTitle}B`, nodes: [{ id: 'a', title: 'Text boundary' }] }), 'oversize', 'mermaid', [], /50001 characters.*maxTextSize.*50000.*--max-nodes/);
  assert.equal(await page.evaluate(() => globalThis.injected), undefined);
  assert.deepEqual(requests, [], 'consumer verification attempted network access');
  console.log(`TEXT EXPORT CONSUMERS PASS exports=${exportCount} svg=${svgCount} offline=true eventBytesUnchanged=true${outDir ? ` artifacts=${outDir}` : ''}`);
} finally {
  await browser?.close();
  fs.rmSync(root, { recursive: true, force: true });
}
