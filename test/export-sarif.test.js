import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { renderSarif } from '../lib/export-sarif.js';

const SCHEMA = 'https://docs.oasis-open.org/sarif/sarif/v2.1.0/os/schemas/sarif-schema-2.1.0.json';
const schema = JSON.parse(fs.readFileSync(new URL('./fixtures/sarif/sarif-schema-2.1.0.json', import.meta.url), 'utf8'));
// The OASIS schema includes a legacy ECMA-262 pattern invalid with the Unicode flag.
const ajv = new Ajv({ allErrors: true, unicodeRegExp: false });
addFormats(ajv);
const validate = ajv.compile(schema);

function finding(overrides = {}) {
  return {
    id: 'finding-1', type: 'finding', title: 'Synthetic finding', detail: 'Recorded explanation.',
    status: null, severity: null, confidence: null, loc: { path: 'src/example.js' },
    ...overrides,
  };
}

function payload(nodes = [], overrides = {}) {
  return {
    title: 'Synthetic review', nodes, relatedNodes: [], edges: [],
    cwd: '/workspace/synthetic', version: '1.2.3', filters: {}, integrity: {},
    ...overrides,
  };
}

function render(data) {
  const serialized = renderSarif(data);
  assert.ok(serialized.endsWith('\n'));
  const log = JSON.parse(serialized);
  assert.ok(validate(log), ajv.errorsText(validate.errors, { separator: '\n' }));
  assert.equal(log.$schema, SCHEMA);
  assert.equal(log.version, '2.1.0');
  assert.equal(log.runs.length, 1);
  return log.runs[0];
}

function physical(result) {
  assert.equal(result.locations.length, 1);
  return result.locations[0].physicalLocation;
}

// Schema validation cannot check cross-field identities, URI resolution, or the
// authored projection contract; keep those independent assertions explicit.
function assertSemantics(run) {
  for (const rule of run.tool.driver.rules) assert.equal(Object.hasOwn(rule, 'defaultConfiguration'), false);
  for (const result of run.results) {
    assert.equal(run.tool.driver.rules[result.ruleIndex].id, result.ruleId);
    if (result.level === 'none') assert.equal(result.kind, 'review');
    assert.match(result.partialFingerprints['blackboardNodeId/v1'], /^[a-f0-9]{64}$/);
    const artifact = physical(result).artifactLocation;
    assert.doesNotMatch(artifact.uri, /[\s<>"\\#?]/);
    const base = artifact.uriBaseId ? run.originalUriBaseIds[artifact.uriBaseId].uri : undefined;
    assert.equal(new URL(artifact.uri, base).protocol, 'file:');
  }
  const coverage = run.properties.coverage;
  assert.equal(coverage.resultCount, run.results.length);
  assert.equal(coverage.skippedNodeCount, run.properties.skippedNodes.length);
  assert.equal(coverage.selectedNodeCount, coverage.resultCount + coverage.skippedNodeCount);
}

test('official OASIS validation includes URI formats without coercing authored data', () => {
  const log = JSON.parse(renderSarif(payload([finding()])));
  assert.equal(validate(log), true);
  log.runs[0].results[0].locations[0].physicalLocation.artifactLocation.uri = 'src/unescaped space.js';
  assert.equal(validate(log), false);
  assert.ok(validate.errors.some((error) => error.keyword === 'format' && error.instancePath.endsWith('/artifactLocation/uri')));
  assert.equal(log.runs[0].results[0].locations[0].physicalLocation.artifactLocation.uri, 'src/unescaped space.js');
});

test('SARIF uses authored legacy and object locations with full messages and independent fields', () => {
  const nodes = [
    finding({ id: 'legacy', loc: 'src/legacy.js', severity: 'high', status: 'refuted', confidence: 'suspected', tags: ['site=alpha.example'], author: 'synthetic-reviewer' }),
    finding({ id: 'object', type: 'vuln', loc: { path: 'src/current.js', line: 12, column: 3 }, severity: 'low', status: 'confirmed', confidence: 'reproduced' }),
  ];
  const data = payload(nodes, { filters: { status: 'refuted' }, integrity: { corruptLines: 2 }, groups: [{ values: { severity: 'high' }, nodeIds: ['legacy'] }] });
  const before = structuredClone(data);
  const run = render(data);
  assert.equal(run.tool.driver.semanticVersion, '1.2.3');
  assert.deepEqual(run.results.map((result) => result.properties.nodeId), ['legacy', 'object']);
  assert.deepEqual(run.results.map((result) => result.ruleId), ['blackboard/finding', 'blackboard/vuln']);
  assert.equal(run.results[0].message.text, 'Synthetic finding\n\nRecorded explanation.');
  assert.deepEqual(run.results[0].properties.node, nodes[0]);
  assert.equal(run.results[0].properties.status, 'refuted');
  assert.equal(run.results[0].properties.confidence, 'suspected');
  assert.equal(run.results[0].level, 'error');
  assert.equal(Object.hasOwn(run.results[0], 'suppressions'), false);
  assert.equal(Object.hasOwn(physical(run.results[0]), 'region'), false);
  assert.deepEqual(physical(run.results[1]).region, { startLine: 12, startColumn: 3 });
  assert.deepEqual(run.properties.filters, data.filters);
  assert.deepEqual(run.properties.groups, data.groups);
  assert.deepEqual(run.properties.integrity, data.integrity);
  assert.deepEqual(run.originalUriBaseIds, { '%SRCROOT%': { uri: 'file:///workspace/synthetic/' } });
  assert.deepEqual(data, before);
  assertSemantics(run);
});

test('only recorded severity controls the fixed level mapping', () => {
  const severities = ['critical', 'high', 'medium', 'low', 'info', null, 'unknown', 'HIGH', 'toString', ''];
  const nodes = severities.map((severity, index) => finding({ id: `severity-${index}`, severity, status: index % 2 ? 'refuted' : 'confirmed', confidence: 'reproduced' }));
  const run = render(payload(nodes));
  assert.deepEqual(run.results.map((result) => result.level), ['error', 'error', 'warning', 'note', 'note', 'none', 'none', 'none', 'none', 'none']);
  assert.deepEqual(run.results.map((result) => result.properties.severity), severities);
  assert.deepEqual(run.results.map((result) => result.properties.status), nodes.map((node) => node.status));
  const absent = finding({ id: 'absent' });
  delete absent.status;
  delete absent.severity;
  delete absent.confidence;
  const result = render(payload([absent])).results[0];
  assert.equal(result.level, 'none');
  assert.equal(result.properties.status, null);
  assert.equal(result.properties.severity, null);
  assert.equal(result.properties.confidence, null);
  assertSemantics(run);
});

test('fingerprints and rule identities survive wording, severity, status and location changes', () => {
  const original = finding({ id: 'stable-node', severity: 'high' });
  const changed = { ...original, title: 'Different title', detail: 'Different body.', severity: 'info', status: 'refuted', confidence: 'reproduced', loc: 'src/moved.js' };
  const first = render(payload([original])).results[0];
  const second = render(payload([changed])).results[0];
  const third = render(payload([finding({ id: 'different-node' })])).results[0];
  assert.deepEqual(first.partialFingerprints, second.partialFingerprints);
  assert.equal(first.ruleId, second.ruleId);
  assert.notDeepEqual(first.partialFingerprints, third.partialFingerprints);
  assert.equal(renderSarif(payload([original])), renderSarif(payload([original])));
});

test('POSIX paths resolve relative to the explicit cwd and encode URI metacharacters', () => {
  const nodes = [
    finding({ id: 'relative', loc: "src/a b#?%<é>'().js" }),
    finding({ id: 'inside', loc: '/workspace/synthetic/src/inside.js' }),
    finding({ id: 'outside', loc: '/external/a b#?.js' }),
    finding({ id: 'parent', loc: '../sibling/test.js' }),
    finding({ id: 'colon', loc: './scheme:name.js' }),
  ];
  const run = render(payload(nodes));
  assert.deepEqual(run.results.map((result) => physical(result).artifactLocation), [
    { uri: 'src/a%20b%23%3F%25%3C%C3%A9%3E%27%28%29.js', uriBaseId: '%SRCROOT%' },
    { uri: 'src/inside.js', uriBaseId: '%SRCROOT%' },
    { uri: 'file:///external/a%20b%23%3F.js' },
    { uri: '../sibling/test.js', uriBaseId: '%SRCROOT%' },
    { uri: 'scheme%3Aname.js', uriBaseId: '%SRCROOT%' },
  ]);
  assert.equal(new URL(physical(run.results[3]).artifactLocation.uri, run.originalUriBaseIds['%SRCROOT%'].uri).href, 'file:///workspace/sibling/test.js');
  assertSemantics(run);
});

test('Windows paths and drive casing are handled independently of the operating system', () => {
  const nodes = [
    finding({ id: 'inside', loc: 'c:\\WORKSPACE\\synthetic\\src\\a b#?.js' }),
    finding({ id: 'relative', loc: 'src\\nested\\file.js' }),
    finding({ id: 'other-drive', loc: 'D:\\external\\issue.js' }),
    finding({ id: 'unc', loc: '\\\\files.example\\share\\some folder\\a#.js' }),
    finding({ id: 'drive-relative', loc: 'C:ambiguous.js' }),
    finding({ id: 'root-relative', loc: '\\ambiguous.js' }),
  ];
  const run = render(payload(nodes, { cwd: 'C:\\workspace\\synthetic' }));
  assert.deepEqual(run.originalUriBaseIds, { '%SRCROOT%': { uri: 'file:///C:/workspace/synthetic/' } });
  assert.deepEqual(run.results.map((result) => physical(result).artifactLocation), [
    { uri: 'src/a%20b%23%3F.js', uriBaseId: '%SRCROOT%' },
    { uri: 'src/nested/file.js', uriBaseId: '%SRCROOT%' },
    { uri: 'file:///D:/external/issue.js' },
    { uri: 'file://files.example/share/some%20folder/a%23.js' },
  ]);
  assert.deepEqual(run.properties.skippedNodes.map((node) => node.nodeId), ['drive-relative', 'root-relative']);
  assertSemantics(run);
});

test('UNC source roots are recorded with their share and escaped directory names', () => {
  const run = render(payload([
    finding({ id: 'relative', loc: 'src\\module.js' }),
    finding({ id: 'inside', loc: '\\\\files.example\\share\\source tree\\src\\other.js' }),
  ], { cwd: '\\\\files.example\\share\\source tree' }));
  assert.deepEqual(run.originalUriBaseIds, { '%SRCROOT%': { uri: 'file://files.example/share/source%20tree/' } });
  assert.deepEqual(run.results.map((result) => physical(result).artifactLocation.uri), ['src/module.js', 'src/other.js']);
  assertSemantics(run);
});

test('only positive integral authored coordinates become regions and no line is invented', () => {
  const coordinates = [
    {}, { column: 4 }, { line: null, column: 3 }, { line: 0, column: 2 },
    { line: -1 }, { line: 1.5 }, { line: '7', column: '2' }, { line: true },
    { line: 7, column: 0 }, { line: 7, column: -2 }, { line: 7, column: 1.5 },
    { line: 7, column: '2' }, { line: 7, column: null }, { line: 1 }, { line: 2, column: 1 },
  ];
  const nodes = coordinates.map((coordinate, index) => finding({ id: `coordinate-${index}`, loc: { path: 'src/coordinates.js', ...coordinate } }));
  const run = render(payload(nodes));
  assert.equal(run.results.length, coordinates.length);
  for (const result of run.results.slice(0, 8)) assert.equal(Object.hasOwn(physical(result), 'region'), false);
  for (const result of run.results.slice(8, 13)) assert.deepEqual(physical(result).region, { startLine: 7 });
  assert.deepEqual(physical(run.results[13]).region, { startLine: 1 });
  assert.deepEqual(physical(run.results[14]).region, { startLine: 2, startColumn: 1 });
  assertSemantics(run);
});

test('hostile authored text stays plain text and URI content cannot inject SARIF structure', () => {
  const title = '</script><script>alert("synthetic")</script>\n# Heading {0}';
  const detail = '```js\nconst payload = "\\\"}";\n```\n[link](https://alpha.example/)\n\u0000\u2028';
  const node = finding({ id: 'end"}\n<node>', title, detail, loc: 'src/<script>\n[bad]#?.js', tags: ['<tag>'], severity: 'constructor' });
  const run = render(payload([node]));
  assert.equal(run.results.length, 1);
  assert.deepEqual(run.results[0].message, {
    text: '</script><script>alert("synthetic")</script>\n# Heading {{0}}\n\n```js\nconst payload = "\\\"}}";\n```\n[link](https://alpha.example/)\n\u0000\u2028',
  });
  assert.deepEqual(run.results[0].properties.node, node);
  assert.equal(run.results[0].level, 'none');
  assert.equal(physical(run.results[0]).artifactLocation.uri, 'src/%3Cscript%3E%0A%5Bbad%5D%23%3F.js');
  assertSemantics(run);
});

test('SARIF message templates escape literal braces without altering authored content', () => {
  const node = finding({ title: 'Literal {0}, {name}, {{already doubled}}', detail: 'JSON {"key": "value"}; unmatched { and }.' });
  const result = render(payload([node])).results[0];
  assert.equal(result.message.text, 'Literal {{0}}, {{name}}, {{{{already doubled}}}}\n\nJSON {{"key": "value"}}; unmatched {{ and }}.');
  assert.equal(Object.hasOwn(result.message, 'arguments'), false);
  assert.deepEqual(result.properties.node, node);
});

test('only selected finding and vuln nodes become results and all exclusions have reasons', () => {
  const nodes = [
    finding({ id: 'valid', status: 'refuted' }),
    finding({ id: 'observation', type: 'observation' }),
    finding({ id: 'custom', type: 'custom-type' }),
    finding({ id: 'missing', loc: undefined, title: 'At src/not-authored.js:42', detail: 'src/not-authored.js', tags: ['path=src/not-authored.js'] }),
    finding({ id: 'null', loc: null }),
    ...['', '   ', {}, { path: '' }, { path: 123 }, [], 17, 'https://alpha.example/code.js', 'src/bad\0name.js', '\\\\missing-share'].map((loc, index) => finding({ id: `invalid-${index}`, loc })),
  ];
  const run = render(payload(nodes, { relatedNodes: [finding({ id: 'unselected' })] }));
  assert.deepEqual(run.results.map((result) => result.properties.nodeId), ['valid']);
  assert.deepEqual(run.properties.coverage, { selectedNodeCount: nodes.length, relatedNodeCount: 1, resultCount: 1, skippedNodeCount: nodes.length - 1 });
  assert.deepEqual(run.properties.skippedNodes.slice(0, 4), [
    { nodeId: 'observation', type: 'observation', reason: 'unsupported-node-type' },
    { nodeId: 'custom', type: 'custom-type', reason: 'unsupported-node-type' },
    { nodeId: 'missing', type: 'finding', reason: 'missing-location' },
    { nodeId: 'null', type: 'finding', reason: 'missing-location' },
  ]);
  assert.ok(run.properties.skippedNodes.slice(4).every((node) => node.reason === 'invalid-location'));
  assertSemantics(run);
});

test('explicit incident edges preserve direction, labels, unknown kinds and supporting node content', () => {
  const selected = finding({ id: 'selected', status: 'refuted', severity: 'high' });
  const evidence = { id: 'evidence', type: 'observation', title: 'Synthetic evidence', detail: 'Complete supporting text.', status: null, severity: null, confidence: null };
  const counterexample = { ...evidence, id: 'counterexample', title: 'Counterexample' };
  const unrelated = { ...evidence, id: 'unrelated' };
  const edges = [
    { id: 'e1', from: 'evidence', to: 'selected', kind: 'supports', label: 'Recorded support' },
    { id: 'e2', from: 'counterexample', to: 'selected', kind: 'contradicts', label: 'Recorded contradiction' },
    { id: 'e3', from: 'selected', to: 'evidence', kind: 'custom-relation', label: '<exact label>' },
  ];
  const data = payload([selected], { relatedNodes: [evidence, counterexample, unrelated], edges });
  const run = render(data);
  const properties = run.results[0].properties;
  assert.deepEqual(properties.relationships, edges);
  assert.deepEqual(properties.relatedNodeIds, ['evidence', 'counterexample']);
  assert.deepEqual(properties.relatedNodes, [evidence, counterexample]);
  assert.equal(run.results.length, 1);
  assert.equal(properties.status, 'refuted');
  assert.equal(run.results[0].level, 'error');
  assertSemantics(run);
});

test('empty and no-location exports expose complete coverage instead of fabricating findings', () => {
  const empty = render(payload());
  assert.deepEqual(empty.results, []);
  assert.deepEqual(empty.properties.coverage, { selectedNodeCount: 0, relatedNodeCount: 0, resultCount: 0, skippedNodeCount: 0 });
  assert.deepEqual(empty.properties.skippedNodes, []);
  assert.equal(Object.hasOwn(empty, 'originalUriBaseIds'), false);
  const missing = render(payload([finding({ loc: null })]));
  assert.deepEqual(missing.results, []);
  assert.equal(missing.properties.coverage.skippedNodeCount, 1);
  assert.equal(missing.properties.skippedNodes[0].reason, 'missing-location');
  assertSemantics(empty);
  assertSemantics(missing);
});

test('absolute paths need no source base and ambiguous relative paths are excluded without a cwd', () => {
  const run = render(payload([
    finding({ id: 'absolute', loc: '/workspace/synthetic/src/absolute.js' }),
    finding({ id: 'relative', loc: 'src/relative.js' }),
  ], { cwd: undefined }));
  assert.equal(Object.hasOwn(run, 'originalUriBaseIds'), false);
  assert.deepEqual(physical(run.results[0]).artifactLocation, { uri: 'file:///workspace/synthetic/src/absolute.js' });
  assert.deepEqual(run.properties.skippedNodes, [{ nodeId: 'relative', type: 'finding', reason: 'invalid-location' }]);
  assertSemantics(run);
});
