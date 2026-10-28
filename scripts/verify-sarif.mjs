#!/usr/bin/env node
// Offline SARIF conformance and CLI checks using disposable synthetic boards.
// This validates the OASIS format and local semantics; it does not upload SARIF.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isolatedBlackboardEnv } from './lib/environment.mjs';
import { SARIF_SCHEMA_URL as SCHEMA, validateSarif as validate, sarifValidationErrors } from './lib/sarif-validator.mjs';

const CLI = fileURLToPath(new URL('../bin/blackboard.js', import.meta.url));
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blackboard-sarif-'));
const env = isolatedBlackboardEnv();
let exportsChecked = 0;

function cli(cwd, ...args) {
  const response = spawnSync(process.execPath, [CLI, ...args, '--cwd', cwd, '--json'], {
    cwd: root, env, encoding: 'utf8', timeout: 30000, maxBuffer: 8 * 1024 * 1024,
  });
  assert.ifError(response.error);
  assert.equal(response.status, 0, `CLI ${args[0]} failed: ${response.stderr}`);
  return JSON.parse(response.stdout);
}

function fixture(name, nodes = [], edges = []) {
  const cwd = path.join(root, name);
  const board = path.join(cwd, '.blackboard');
  fs.mkdirSync(board, { recursive: true });
  const events = path.join(board, 'events.jsonl');
  const entries = [{ op: 'meta', set: { title: 'Synthetic SARIF consumer fixture' } },
    ...nodes.map((node) => ({ op: 'node', node })), ...edges.map((edge) => ({ op: 'edge', edge }))];
  fs.writeFileSync(events, entries.map((event) => JSON.stringify({ eventVersion: 1, ...event })).join('\n') + '\n');
  return { cwd, events };
}

function exportBoard(board) {
  const before = fs.readFileSync(board.events);
  const output = path.join(root, `report-${++exportsChecked}.sarif`);
  const response = cli(board.cwd, 'export', '--format', 'sarif', '--out', output);
  assert.deepEqual(response, { schema: 'blackboard.export.v1', file: output, format: 'sarif' });
  assert.deepEqual(fs.readFileSync(board.events), before, 'Export changed event bytes');
  const log = JSON.parse(fs.readFileSync(output, 'utf8'));
  assert.ok(validate(log), sarifValidationErrors());
  assert.equal(log.$schema, SCHEMA);
  assert.equal(log.version, '2.1.0');
  assert.equal(log.runs.length, 1);
  const run = log.runs[0];
  assert.equal(run.properties.coverage.resultCount, run.results.length);
  assert.equal(run.properties.coverage.skippedNodeCount, run.properties.skippedNodes.length);
  assert.equal(run.properties.coverage.selectedNodeCount, run.results.length + run.properties.skippedNodes.length);
  for (const result of run.results) {
    assert.equal(run.tool.driver.rules[result.ruleIndex].id, result.ruleId);
    assert.match(result.partialFingerprints['blackboardNodeId/v1'], /^[a-f0-9]{64}$/);
    for (const key of ['baselineState', 'suppressions', 'taxa']) assert.equal(Object.hasOwn(result, key), false);
  }
  return run;
}

function finding(id, overrides = {}) {
  return {
    id, type: 'finding', title: 'Synthetic authored claim', detail: 'Recorded evidence only.',
    status: null, severity: null, confidence: null, ts: 1, ...overrides,
  };
}

function resolvedUri(run, result) {
  assert.equal(result.locations.length, 1);
  const artifact = result.locations[0].physicalLocation.artifactLocation;
  const base = artifact.uriBaseId ? run.originalUriBaseIds[artifact.uriBaseId].uri : undefined;
  const resolved = new URL(artifact.uri, base);
  assert.equal(resolved.protocol, 'file:');
  return resolved.href;
}

try {
  const empty = exportBoard(fixture('empty board'));
  assert.deepEqual(empty.results, []);
  assert.deepEqual(empty.properties.coverage, { selectedNodeCount: 0, relatedNodeCount: 0, resultCount: 0, skippedNodeCount: 0 });
  assert.equal(Object.hasOwn(empty, 'originalUriBaseIds'), false);

  const missing = exportBoard(fixture('no location board', [
    finding('missing', { title: 'CWE-79 in src/not-authored.js:42', detail: 'confirmed high severity', tags: ['path=src/not-authored.js'] }),
    finding('null', { type: 'vuln', loc: null }),
    finding('invalid', { loc: 'https://alpha.example/code.js' }),
  ]));
  assert.deepEqual(missing.results, []);
  assert.deepEqual(missing.properties.skippedNodes, [
    { nodeId: 'invalid', type: 'finding', reason: 'invalid-location' },
    { nodeId: 'missing', type: 'finding', reason: 'missing-location' },
    { nodeId: 'null', type: 'vuln', reason: 'missing-location' },
  ]);
  assert.equal(Object.hasOwn(missing, 'originalUriBaseIds'), false);

  const locatedCwd = path.join(root, 'located board');
  const stable = finding('stable', {
    type: 'vuln', title: 'Literal {0} and {{already doubled}}', detail: 'Authored JSON {"key": "value"}.',
    severity: 'high', status: 'refuted', confidence: 'suspected', author: 'fixture:author',
    tags: ['site=alpha.example', 'CWE-79'], loc: { path: 'src/a b#?%é.js', line: 12, column: 3 },
    authoredCustom: { explanation: 'Preserve this property verbatim.' },
  });
  const evidence = { id: 'evidence', type: 'observation', title: 'Synthetic counterevidence', detail: 'Complete authored supporting content.', ts: 2, status: null, severity: null, confidence: null };
  const edge = { id: 'support', from: 'evidence', to: 'stable', kind: 'custom-relation', label: 'Authored direction and label' };
  const board = fixture('located board', [
    stable, evidence,
    finding('inside', { loc: path.join(locatedCwd, 'src', 'inside#?.js'), severity: 'info' }),
    finding('outside', { loc: path.join(root, 'outside folder', 'a #?.js') }),
    finding('windows', { loc: 'D:\\synthetic\\a b#?.js' }),
    finding('unc', { loc: '\\\\files.example\\share\\a b#?.js' }),
    finding('unknown', { loc: 'src/unknown.js', severity: 'unknown', status: 'confirmed', confidence: 'reproduced' }),
  ], [edge]);
  const first = exportBoard(board);
  const results = new Map(first.results.map((result) => [result.properties.nodeId, result]));
  assert.equal(first.results.length, 6);
  assert.deepEqual(first.originalUriBaseIds, { '%SRCROOT%': { uri: `${pathToFileURL(locatedCwd).href}/` } });
  const result = results.get('stable');
  assert.equal(result.ruleId, 'blackboard/vuln');
  assert.equal(result.level, 'error');
  assert.deepEqual(result.properties.node, stable);
  assert.equal(result.properties.status, 'refuted');
  assert.equal(result.properties.severity, 'high');
  assert.equal(result.properties.confidence, 'suspected');
  assert.deepEqual(result.properties.relationships, [edge]);
  assert.deepEqual(result.properties.relatedNodeIds, ['evidence']);
  assert.deepEqual(result.properties.relatedNodes, [evidence]);
  assert.equal(result.message.text, 'Literal {{0}} and {{{{already doubled}}}}\n\nAuthored JSON {{"key": "value"}}.');
  assert.deepEqual(result.locations[0].physicalLocation.region, { startLine: 12, startColumn: 3 });
  assert.equal(resolvedUri(first, result), pathToFileURL(path.join(board.cwd, stable.loc.path)).href);
  assert.equal(resolvedUri(first, results.get('inside')), pathToFileURL(path.join(board.cwd, 'src', 'inside#?.js')).href);
  assert.equal(resolvedUri(first, results.get('outside')), pathToFileURL(path.join(root, 'outside folder', 'a #?.js')).href);
  assert.equal(resolvedUri(first, results.get('windows')), 'file:///D:/synthetic/a%20b%23%3F.js');
  assert.equal(resolvedUri(first, results.get('unc')), 'file://files.example/share/a%20b%23%3F.js');
  assert.equal(results.get('unknown').level, 'none');
  assert.equal(results.get('unknown').kind, 'review');
  assert.equal(results.get('unknown').properties.severity, 'unknown');
  assert.equal(results.get('unknown').properties.status, 'confirmed');
  assert.equal(results.get('unknown').properties.confidence, 'reproduced');
  assert.notDeepEqual(result.partialFingerprints, results.get('inside').partialFingerprints);
  assert.deepEqual(exportBoard(board), first, 'Repeated exports should be deterministic');

  const edited = cli(board.cwd, 'edit', stable.id, '--title', 'Reworded synthetic claim', '--sev', 'info', '--agent', 'fixture:editor');
  const changedRun = exportBoard(board);
  const changed = changedRun.results.find((entry) => entry.properties.nodeId === stable.id);
  assert.deepEqual(changed.partialFingerprints, result.partialFingerprints);
  assert.equal(changed.ruleId, result.ruleId);
  assert.equal(changed.ruleIndex, result.ruleIndex);
  assert.equal(changed.level, 'note');
  assert.equal(changed.message.text, 'Reworded synthetic claim\n\nAuthored JSON {{"key": "value"}}.');
  const { schema: outputSchema, ...editedNode } = edited;
  assert.equal(outputSchema, 'blackboard.node.v2');
  assert.deepEqual(changed.properties.node, editedNode);
  assert.deepEqual(changed.properties.node.authoredCustom, stable.authoredCustom);
  assert.equal(changed.properties.status, stable.status);
  assert.equal(changed.properties.confidence, stable.confidence);
  assert.deepEqual(changed.properties.relationships, [edge]);
  assert.equal(resolvedUri(changedRun, changed), resolvedUri(first, result));
  console.log(`SARIF PASS exports=${exportsChecked} officialSchema=2.1.0 eventBytesUnchanged=true identityStable=true`);
  console.log('External viewer rendering and hosted code-scanning ingestion are not exercised; no uploads were made.');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
