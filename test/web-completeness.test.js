import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Tooltip } from 'radix-ui';
import { ReactFlowProvider } from '@xyflow/react';
import { createServer } from 'vite';

// Render the real components without a browser, a listening server, or a project board.
const root = fileURLToPath(new URL('../', import.meta.url));
const server = await createServer({
  configFile: false,
  root: path.join(root, 'web'),
  resolve: { alias: { '@': path.join(root, 'web/src') } },
  server: { middlewareMode: true, watch: null },
  optimizeDeps: { noDiscovery: true },
  appType: 'custom',
});
after(() => server.close());
const { Inspector } = await server.ssrLoadModule('/src/panels/Inspector.tsx');
const { Sidebar } = await server.ssrLoadModule('/src/panels/Sidebar.tsx');
const { SecurityNode } = await server.ssrLoadModule('/src/SecurityNode.tsx');
const render = (element) => renderToStaticMarkup(createElement(Tooltip.Provider, null, element));
const escape = (value) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#x27;');
const node = {
  id: 'synthetic-finding', type: 'finding', confidence: 'suspected',
  title: '  已观察行为。\n限制：尚未验证！  ',
  detail: `第一行保留换行\n\n${'合成证据 '.repeat(700)}\n末尾限制：实际行为尚未验证。  `,
};
const inspectorProps = {
  node, edges: [], byId: new Map([[node.id, node]]),
  onClose() {}, onFocus() {}, async onReload() {},
  isStatic: true, connected: false, revision: 0,
};

test('Inspector renders the complete authored title and detail, including punctuation and tail conditions', () => {
  const before = JSON.stringify(node);
  const html = render(createElement(Inspector, inspectorProps));
  assert.equal(html.match(/<h2[^>]*>([\s\S]*?)<\/h2>/)?.[1], escape(node.title));
  assert.ok(html.includes(`>${escape(node.detail)}</p>`), 'the entire detail must appear as one authored text, not a trimmed preview');
  assert.equal(JSON.stringify(node), before, 'reading must not alter the source record');
});

test('Inspector preserves line breaks and has a scrollable reading surface without clamping the body', () => {
  const html = render(createElement(Inspector, inspectorProps));
  assert.ok(/<h2[^>]*class="[^"]*whitespace-pre-wrap/.test(html), 'the complete title keeps authored line breaks');
  const paragraph = html.match(/<p[^>]*>[\s\S]*?末尾限制：[\s\S]*?<\/p>/)?.[0] || '';
  assert.ok(paragraph.includes('whitespace-pre-wrap'), 'the complete detail keeps authored line breaks');
  assert.doesNotMatch(paragraph, /line-clamp|text-ellipsis/);
  assert.match(html, /min-h-0 flex-1 overflow-y-auto/);
});

const findings = Array.from({ length: 18 }, (_, i) => ({ id: `synthetic-${i}`, type: 'finding', title: `Synthetic finding ${i}` }));
const openItems = Array.from({ length: 13 }, (_, i) => ({ id: `question-${i}`, type: 'question', title: `Synthetic question ${i}` }));
const sidebarProps = {
  current: null, openItems, findings, inbox: [], selectedId: null,
  counts: { nodes: findings.length + openItems.length, edges: 0, risk: 0, open: openItems.length, candidates: findings.length },
  onSelect() {}, onSearch() {}, onShortcuts() {}, onFilter() {},
  filter: { types: [], statuses: [], confidences: [], riskOnly: false },
  filterOptions: { types: [], statuses: [], confidences: [], riskCount: 0 }, results: null,
};

test('Sidebar keeps all findings reachable behind an explicit disclosure instead of silently cutting after eight', () => {
  const before = JSON.stringify(findings);
  const html = render(createElement(Sidebar, sidebarProps));
  assert.equal((html.match(/title="Synthetic finding \d+"/g) || []).length, findings.length);
  assert.ok(/<details[^>]*>[\s\S]*?<summary[^>]*>[\s\S]*?10[\s\S]*?<\/summary>/.test(html), 'ten more findings have a native disclosure');
  assert.ok(html.includes('title="Synthetic finding 17"'));
  assert.equal(JSON.stringify(findings), before);
});

test('Sidebar open items retain every record and use the same explicit disclosure', () => {
  const html = render(createElement(Sidebar, sidebarProps));
  assert.equal((html.match(/title="Synthetic question \d+"/g) || []).length, openItems.length);
  assert.ok(/<summary[^>]*>[\s\S]*?5[\s\S]*?<\/summary>/.test(html), 'five more questions have a native disclosure');
  const app = fs.readFileSync(path.join(root, 'web/src/App.tsx'), 'utf8');
  const selection = app.match(/const openItems = useMemo\([\s\S]*?\[allNodes, currentId\]\);/)?.[0] || '';
  assert.ok(selection);
  assert.doesNotMatch(selection, /\.slice\(/, 'the list count and disclosure must receive all open records');
});

test('Canvas cards label their compact content as a preview with the existing full-text selection path', () => {
  const html = render(createElement(ReactFlowProvider, null, createElement(SecurityNode, {
    id: node.id, type: 'security', selected: false,
    data: { item: node, current: false, dimmed: false, degree: 0 },
  })));
  assert.ok(html.includes('预览'), 'clamped content must identify itself as a preview');
  assert.ok(html.includes('点击查看完整记录'), 'the existing selection path must be discoverable');
  assert.ok(html.includes('line-clamp'), 'the compact card stays a preview, not an unbounded document');
});

test('Inspector exposes persisted input truncation instead of presenting a partial input as complete', () => {
  const truncated = { ...node, inputTruncation: { detail: { originalLength: 20006, storedLength: 20000 } } };
  const html = render(createElement(Inspector, { ...inspectorProps, node: truncated }));
  assert.ok(html.includes('写入时被截短'), 'the warning distinguishes ingest loss from a card preview');
  assert.ok(html.includes('20006') && html.includes('20000'), 'the saved and original lengths are visible');
});

test('Inspector retains authored relation labels and reports their recorded input loss', () => {
  const peer = { id: 'synthetic-peer', type: 'fact', title: 'Synthetic peer' };
  const label = '第一行关系说明\n限制：仅支持这一项观察。';
  const edge = { id: 'synthetic-edge', from: peer.id, to: node.id, kind: 'supports', label, inputTruncation: { label: { originalLength: 506, storedLength: 500 } } };
  const html = render(createElement(Inspector, { ...inspectorProps, edges: [edge], byId: new Map([[node.id, node], [peer.id, peer]]) }));
  assert.ok(html.includes(`>${escape(label)}</p>`), 'the authored relation label is available alongside the explicit direction');
  assert.ok(html.includes('写入时被截短') && html.includes('506') && html.includes('500'));
});

test('formatted digest prose is not clamped inside the scrollable reading dialog', () => {
  const source = fs.readFileSync(path.join(root, 'web/src/panels/DigestDialog.tsx'), 'utf8');
  const child = source.match(/item\.children\.map\(\(child, i\) => <span[^>]*className="([^"]*)"[^>]*>\{child\}<\/span>/)?.[1] || '';
  assert.ok(child.includes('whitespace-pre-wrap'), 'digest child prose retains line breaks');
  assert.doesNotMatch(child, /line-clamp|text-ellipsis/);
});
