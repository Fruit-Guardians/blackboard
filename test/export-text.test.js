import test from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown, renderMermaid } from '../lib/export-text.js';

function node(id, overrides = {}) {
  return { id, type: 'note', title: `Synthetic ${id}`, status: null, severity: null, confidence: null, ...overrides };
}

function payload(overrides = {}) {
  return {
    title: 'Synthetic board', nodes: [], relatedNodes: [], edges: [],
    filters: {}, cwd: '/synthetic/project', version: '0.7.0',
    integrity: { corruptLines: 0, rejected: 0, futureEvents: 0, unknownOps: 0 },
    ...overrides,
  };
}

function decodeMarkdown(value) {
  return value.replace(/&#(\d+);/g, (_entity, code) => String.fromCodePoint(Number(code)));
}

function decodeMermaid(value) {
  return value.replace(/<br\/>/g, '').replace(/#(\d+);/g, (_entity, code) => String.fromCodePoint(Number(code)));
}

function diagramNodes(source) {
  return [...source.matchAll(/^  (n_[a-f0-9_]+|n_empty)\["(.*)"\]$/gm)]
    .map((match) => ({ id: match[1], label: decodeMermaid(match[2]) }));
}

function diagramEdges(source) {
  return [...source.matchAll(/^  (n_[a-f0-9_]+|n_empty) (-\.->|-->)\|"(.*)"\| (n_[a-f0-9_]+|n_empty)$/gm)]
    .map((match) => ({ from: match[1], arrow: match[2], label: decodeMermaid(match[3]), to: match[4] }));
}

test('Markdown preserves grouped records and explicit evidence across filters without traversing recursively', () => {
  const finding = node('finding', {
    type: 'finding', title: 'Synthetic issue', detail: 'Authored observation only.',
    status: 'active', severity: 'high', confidence: 'suspected',
    tags: ['site=app.example', 'topic=synthetic'], loc: { path: 'src/example.js', line: 7 }, author: 'agent:synthetic',
  });
  const evidence = node('evidence', { type: 'fact', detail: 'FULL SUPPORTING CONTENT' });
  const counter = node('counter', { type: 'fact', detail: 'FULL REFUTING CONTENT' });
  const custom = node('custom', { title: 'Unknown relation context' });
  const data = payload({
    nodes: [finding], relatedNodes: [evidence, counter, custom],
    edges: [
      { id: 'e1', from: 'evidence', to: 'finding', kind: 'supports', label: 'Recorded support' },
      { id: 'e2', from: 'counter', to: 'finding', kind: 'contradicts', label: 'Recorded contradiction' },
      { id: 'e3', from: 'finding', to: 'custom', kind: 'x-custom', label: 'Unknown kind survives' },
    ],
    filters: { severity: 'high', q: 'Synthetic' },
    groups: [
      { values: { severity: 'high', status: 'active' }, nodeIds: ['finding'] },
      { values: { 'tag:site': 'app.example' }, nodeIds: ['finding'] },
    ],
  });
  const markdown = renderMarkdown(data);
  const decoded = decodeMarkdown(markdown);
  assert.match(markdown, /^# Synthetic board\n/);
  assert.match(markdown, /Selected nodes: 1/);
  assert.match(markdown, /Related context nodes: 3/);
  assert.match(markdown, /Recorded incident edges: 3/);
  assert.match(decoded, /Group 1: severity=high, status=active/);
  assert.match(decoded, /Group 2: tag:site=app.example/);
  assert.equal(markdown.split('Authored observation only.').length - 1, 1);
  assert.equal(markdown.split('FULL SUPPORTING CONTENT').length - 1, 1);
  assert.equal(markdown.split('FULL REFUTING CONTENT').length - 1, 1);
  assert.match(markdown, /Additional group membership: \[Synthetic issue\]\(#node-66_69_6e_64_69_6e_67\)/);
  assert.match(decoded, /Recorded supporting relations: 1 incoming, 0 outgoing/);
  assert.match(decoded, /Recorded contradicting relations: 1 incoming, 0 outgoing/);
  assert.match(decoded, /\[Synthetic evidence\]\(#node-65_76_69_64_65_6e_63_65\) \(evidence\) → \[Synthetic issue\]\(#node-66_69_6e_64_69_6e_67\) \(finding\)/);
  assert.match(decoded, /kind: x-custom; label: Unknown kind survives/);
  assert.match(decoded, /Status: active\n- Severity: high\n- Confidence: suspected/);
  assert.match(decoded, /Tags: \["site=app.example","topic=synthetic"\]/);
  assert.match(decoded, /Location: \{"path":"src\/example.js","line":7\}/);
  assert.match(decoded, /Author: agent:synthetic/);
  assert.match(markdown, /Explicit filters:/);
  assert.match(markdown, /- corruptLines: 0/);
  assert.match(markdown, /context is not traversed recursively/);
  assert.equal((markdown.match(/^#### Recorded relations$/gm) || []).length, 1);
});

test('Markdown represents unset independent fields and missing evidence as structural facts', () => {
  const markdown = renderMarkdown(payload({ nodes: [node('v1', { type: 'vuln', status: 'confirmed' })] }));
  assert.match(markdown, /Status: confirmed\n- Severity: unset\n- Confidence: unset/);
  assert.match(markdown, /No recorded incident supporting relations\./);
  assert.match(markdown, /No recorded incident contradicting relations\./);
  assert.match(markdown, /No recorded incident edges\./);
  assert.match(markdown, /Detail: unset\./);
  assert.doesNotMatch(markdown, /remediation|proof.of.concept|POC/i);
});

test('Markdown preserves outgoing derivation evidence, attribution changes and recorded input loss', () => {
  const loss = { detail: { originalLength: 900, storedLength: 20 } };
  const selected = node('finding', { type: 'finding', title: 'Bounded claim', detail: 'Clipped description.', updatedBy: 'agent:reviewer', inputTruncation: loss });
  const source = node('source', { type: 'fact', title: 'Original source' });
  const markdown = renderMarkdown(payload({ nodes: [selected], relatedNodes: [source],
    edges: [{ id: 'derive', from: 'finding', to: 'source', kind: 'derived-from' }] }));
  const decoded = decodeMarkdown(markdown);
  assert.ok(decoded.includes(JSON.stringify(loss)));
  assert.ok(decoded.includes('agent:reviewer'));
  assert.match(markdown, /Recorded supporting relations: 0 incoming, 1 outgoing/);
  assert.doesNotMatch(markdown, /No recorded incident supporting relations/);
  assert.ok(decoded.includes('kind: derived-from'));
});

test('Markdown fences full authored titles and details without executable markup or fence breakout', () => {
  const attack = '# heading\n<script>alert("synthetic")</script>\n```\n````````\n[link](https://docs.example)\n`tail`\n';
  const detail = `${attack}${'Full synthetic detail. '.repeat(2000)}FINAL CHARACTER`;
  const title = '<img src=x onerror=alert(1)>\n# heading';
  const markdown = renderMarkdown(payload({
    title,
    nodes: [node('node\n## forged', {
      title: attack, detail, author: '<script>author</script>',
      tags: ['[tag](https://tags.example)'], loc: { path: '<script>.js' },
    })],
    filters: { '[filter]': '<script>filter</script>\n## forged' },
    groups: [{ values: { 'tag:site': 'x\n## forged' }, nodeIds: ['node\n## forged'] }],
  }));
  assert.equal(decodeMarkdown(markdown.split('\n')[0].slice(2)), title);
  assert.ok(markdown.includes(`\`\`\`\`\`\`\`\`\`text\n${attack}\n\`\`\`\`\`\`\`\`\``));
  assert.ok(markdown.includes(detail), 'the full detail remains byte-for-byte inside its fence');
  assert.doesNotMatch(markdown, /^## forged$/m);
  assert.doesNotMatch(markdown, /Author: <script>/);
  assert.doesNotMatch(markdown, /- \[filter\]/);
  assert.match(markdown, /FINAL CHARACTER\n`{9}\n/);
});

test('Markdown keeps incomplete direct-call groups from hiding selected records and handles empty reports', () => {
  const markdown = renderMarkdown(payload({
    nodes: [node('a'), node('b')], groups: [{ values: { severity: null }, nodeIds: ['a', 'missing'] }],
  }));
  assert.match(decodeMarkdown(markdown), /Group 1: severity=\(unset\)/);
  assert.match(markdown, /## Other selected nodes/);
  assert.match(markdown, /Synthetic b/);
  const empty = renderMarkdown(payload());
  assert.match(empty, /Selected nodes: 0/);
  assert.match(empty, /No selected nodes\./);
  assert.ok(empty.endsWith('\n'));
});

test('Markdown headings show authored titles with explicit ID anchors stable across sorting and context selection', () => {
  const a = node('a', { title: 'Duplicate [title] <b>literal</b>' });
  const b = node('b', { title: a.title });
  const first = renderMarkdown(payload({ nodes: [a, b], edges: [{ from: 'b', to: 'a', kind: 'supports' }] }));
  const reordered = renderMarkdown(payload({ nodes: [b], relatedNodes: [a], edges: [{ from: 'b', to: 'a', kind: 'supports' }] }));
  for (const markdown of [first, reordered]) {
    assert.match(markdown, /<a id="node-61"><\/a>\n\n### Duplicate &#91;title&#93; &#60;b&#62;literal&#60;&#47;b&#62;/);
    assert.match(markdown, /<a id="node-62"><\/a>/);
    assert.match(markdown, /\]\(#node-61\)/);
    assert.match(markdown, /\]\(#node-62\)/);
    assert.equal((markdown.match(/id="node-61"/g) || []).length, 1);
    assert.doesNotMatch(markdown, /### Node \d|### Related node \d/);
  }
});

test('Mermaid wraps long node, group and relation labels while preserving complete authored text', () => {
  const title = `${'Long authored 中文😀 [literal] '.repeat(16)}FINAL TITLE`;
  const relation = `${'evidence detail '.repeat(24)}FINAL LABEL`;
  const group = `${'group value '.repeat(20)}FINAL GROUP`;
  const source = renderMermaid(payload({ nodes: [node('a', { title }), node('b')],
    edges: [{ from: 'a', to: 'b', kind: 'supports', label: relation }],
    groups: [{ values: { status: group }, nodeIds: ['a', 'b'] }],
  }));
  assert.ok(source.includes('<br/>'));
  assert.equal(diagramNodes(source)[0].label, `a: ${title}`);
  assert.equal(diagramEdges(source)[0].label, `supports: ${relation}`);
  assert.ok(decodeMermaid(source).includes(`status=${group}`));
});

test('Mermaid accepts the default 500-edge boundary and rejects excess visible edges with actionable guidance', () => {
  const edges = Array.from({ length: 501 }, (_, index) => ({ id: `e${index}`, from: 'a', to: 'b', kind: 'supports' }));
  const data = payload({ nodes: [node('a'), node('b')], edges });
  assert.equal(diagramEdges(renderMermaid({ ...data, edges: edges.slice(0, 500) })).length, 500);
  assert.throws(() => renderMermaid(data), /501 displayed edges.*maxEdges limit is 500.*--max-nodes.*filters.*Markdown/);
  assert.equal(diagramEdges(renderMermaid(data, { maxNodes: 1 })).length, 0);
});

test('Mermaid enforces the default source-size boundary without truncating authored text', () => {
  const data = payload({ title: 'B', nodes: [node('a')] });
  const baseLength = renderMermaid(data).length;
  const boundary = { ...data, title: 'B'.repeat(50000 - baseLength + 1) };
  assert.equal(renderMermaid(boundary).length, 50000);
  assert.throws(() => renderMermaid({ ...boundary, title: `${boundary.title}B` }), /50001 characters.*maxTextSize limit is 50000.*--max-nodes.*filters.*Markdown/);
  const title = '中文 [authored] '.repeat(3000);
  assert.throws(() => renderMermaid(payload({ nodes: [node('a', { title })] })), /maxTextSize/);
  assert.ok(renderMarkdown(payload({ nodes: [node('a', { title })] })).includes(title));
});

test('Mermaid encodes arbitrary authored identifiers, titles and edge labels as inert full text', () => {
  const hostileId = 'end\nclick x "https://attack.example"';
  const hostileTitle = '" ] --> hacked["<script>\\`\n%%{init: {"securityLevel":"loose"}}%%\n#quot;😀';
  const label = '"| B --> C\nclick B callback\n<svg> [brackets] `code` #10;';
  const data = payload({
    nodes: [node(hostileId, { title: hostileTitle }), node('end')],
    edges: [{ from: hostileId, to: 'end', kind: 'x-unknown', label }],
    groups: [{ values: { 'tag:site': hostileTitle }, nodeIds: [hostileId, 'end'] }],
  });
  const source = renderMermaid(data);
  const records = diagramNodes(source);
  assert.equal(records.length, 2);
  assert.equal(records[0].label, `${hostileId}: ${hostileTitle}`);
  assert.match(records[0].id, /^n_[a-f0-9_]+$/);
  assert.notEqual(records[0].id, hostileId);
  assert.equal(diagramEdges(source)[0].label, `x-unknown: ${label}`);
  assert.doesNotMatch(source, /<script>|<svg>|`|https:|%%\{|^\s*click\b|hacked\[/m);
  assert.ok(source.endsWith('\n'));
});

test('Mermaid preserves direction and weak versus strong relations, with stable IDs after reordering', () => {
  const a = node('a');
  const b = node('b');
  const evidence = node('evidence');
  const edges = [
    { from: 'a', to: 'b', kind: 'related-to', label: 'weak' },
    { from: 'evidence', to: 'a', kind: 'supports' },
    { from: 'b', to: 'a', kind: 'x-custom', label: 'new semantics' },
  ];
  const first = renderMermaid(payload({ nodes: [a, b], relatedNodes: [evidence], edges }));
  const records = diagramNodes(first);
  const ids = new Map(records.map((record) => [record.label.split(':')[0], record.id]));
  assert.deepEqual(records.map((record) => record.label), ['a: Synthetic a', 'b: Synthetic b', 'evidence: Synthetic evidence']);
  assert.deepEqual(diagramEdges(first), [
    { from: ids.get('a'), arrow: '-.->', label: 'related-to: weak', to: ids.get('b') },
    { from: ids.get('evidence'), arrow: '-->', label: 'supports', to: ids.get('a') },
    { from: ids.get('b'), arrow: '-->', label: 'x-custom: new semantics', to: ids.get('a') },
  ]);
  const reordered = diagramNodes(renderMermaid(payload({ nodes: [b], relatedNodes: [a, evidence], edges })));
  for (const record of reordered) assert.equal(record.id, ids.get(record.label.split(':')[0]));
  assert.match(first, /subgraph related_context\["Related context"\]/);
});

test('Mermaid caps selected nodes before related context and reports all omitted edges without dangling links', () => {
  const data = payload({
    nodes: [node('first'), node('second'), node('third')], relatedNodes: [node('context')],
    edges: [
      { from: 'first', to: 'second', kind: 'supports' },
      { from: 'third', to: 'first', kind: 'contradicts' },
      { from: 'context', to: 'first', kind: 'related-to' },
    ],
  });
  const source = renderMermaid(data, { maxNodes: 2 });
  assert.deepEqual(diagramNodes(source).map((record) => record.label), ['first: Synthetic first', 'second: Synthetic second']);
  assert.match(source, /%% Omitted nodes: 2; omitted edges: 2; maxNodes: 2/);
  const ids = new Set(diagramNodes(source).map((record) => record.id));
  const edges = diagramEdges(source);
  assert.equal(edges.length, 1);
  for (const edge of edges) assert.ok(ids.has(edge.from) && ids.has(edge.to));
  const zero = renderMermaid(data, { maxNodes: 0 });
  assert.equal(diagramNodes(zero).length, 0);
  assert.equal(diagramEdges(zero).length, 0);
  assert.match(zero, /Omitted nodes: 4; omitted edges: 3/);
});

test('Mermaid uses the 200-node default and includes related nodes when the cap has room', () => {
  const nodes = Array.from({ length: 201 }, (_, index) => node(`node-${index}`));
  const data = payload({ nodes, relatedNodes: [node('context')] });
  const source = renderMermaid(data);
  assert.equal(diagramNodes(source).length, 200);
  assert.match(source, /Omitted nodes: 2; omitted edges: 0; maxNodes: 200/);
  const full = renderMermaid(data, { maxNodes: 202 });
  assert.equal(diagramNodes(full).length, 202);
  assert.doesNotMatch(full, /Omitted nodes:/);
  assert.throws(() => renderMermaid(data, { maxNodes: -1 }), RangeError);
  assert.throws(() => renderMermaid(data, { maxNodes: 1.5 }), RangeError);
  assert.throws(() => renderMermaid(data, { maxNodes: Infinity }), RangeError);
});

test('Mermaid places overlapping groups once and exposes additional memberships and empty groups', () => {
  const source = renderMermaid(payload({
    nodes: [node('a'), node('b')],
    groups: [
      { values: { 'tag:site': 'one.example' }, nodeIds: ['a', 'b'] },
      { values: { 'tag:site': 'two.example' }, nodeIds: ['a'] },
      { values: { status: null }, nodeIds: [] },
    ],
  }));
  assert.equal(diagramNodes(source).length, 2);
  assert.match(decodeMermaid(source), /subgraph group_0\["tag:site=one.example"\]/);
  assert.match(decodeMermaid(source), /Additional membership in group 2 \(tag:site=two.example\)/);
  assert.match(decodeMermaid(source), /Group 3: status=\(unset\); no newly placed nodes/);
  const empty = renderMermaid(payload());
  assert.match(empty, /^flowchart TD\n/);
  assert.match(empty, /No displayed nodes\./);
  assert.equal(diagramEdges(empty).length, 0);
});

test('both renderers leave the shared selected payload unchanged and are deterministic', () => {
  const data = payload({
    nodes: [node('a')], relatedNodes: [node('b')],
    edges: [{ id: 'e', from: 'b', to: 'a', kind: 'contradicts' }],
    groups: [{ values: { severity: null }, nodeIds: ['a'] }],
  });
  const before = JSON.stringify(data);
  const markdown = renderMarkdown(data);
  const mermaid = renderMermaid(data);
  assert.equal(renderMarkdown(data), markdown);
  assert.equal(renderMermaid(data), mermaid);
  assert.equal(JSON.stringify(data), before);
});
