import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { emptyGraph } from '../lib/model.js';
import { buildExportData } from '../lib/export-data.js';

const CLI = fileURLToPath(new URL('../bin/blackboard.js', import.meta.url));
function graph() {
  const g = emptyGraph();
  g.meta.title = 'Synthetic report';
  g.nodes = {
    v1: { id: 'v1', type: 'vuln', title: 'High claim', detail: 'Only the recorded input was tested.', severity: 'high', confidence: 'reproduced', tags: ['site=app.example', 'auth'], loc: { path: 'src/login.js', line: 12 }, ts: 2 },
    v2: { id: 'v2', type: 'vuln', title: 'Low candidate', severity: 'low', status: 'open', confidence: 'suspected', tags: ['site=other.example'], ts: 3 },
    f1: { id: 'f1', type: 'fact', title: 'Recorded supporting evidence', detail: 'FULL SUPPORT', ts: 1 },
    f2: { id: 'f2', type: 'fact', title: 'Recorded limitation', detail: 'FULL COUNTEREXAMPLE', ts: 4 },
    n1: { id: 'n1', type: 'note', title: 'Unrelated material', ts: 5 },
  };
  g.edges = {
    support: { id: 'support', from: 'f1', to: 'v1', kind: 'supports' },
    counter: { id: 'counter', from: 'f2', to: 'v1', kind: 'contradicts' },
    weak: { id: 'weak', from: 'v1', to: 'v2', kind: 'related-to' },
  };
  g.activities.a1 = { id: 'a1', input: 'SYNTHETIC_ACTIVITY_INPUT', output: 'SYNTHETIC_ACTIVITY_OUTPUT', summary: 'SYNTHETIC_ACTIVITY_SUMMARY' };
  return g;
}
function fixture(t, g = graph()) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blackboard-export-'));
  t.after(() => fs.rmSync(root, { force: true, recursive: true }));
  const cwd = path.join(root, 'board');
  fs.mkdirSync(cwd);
  const board = path.join(cwd, '.blackboard');
  fs.mkdirSync(board);
  const events = [{ op: 'meta', set: g.meta }, ...Object.values(g.nodes).map((node) => ({ op: 'node', node })),
    ...Object.values(g.edges).map((edge) => ({ op: 'edge', edge })), ...Object.values(g.activities).map((activity) => ({ op: 'activity', activity }))];
  const file = path.join(board, 'events.jsonl');
  const log = events.map((event) => JSON.stringify({ eventVersion: 1, ...event })).join('\n') + '\n';
  fs.writeFileSync(file, log);
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('BLACKBOARD_')) delete env[key];
  const run = (...args) => spawnSync(process.execPath, [CLI, ...args, '--cwd', cwd], { cwd: root, env, encoding: 'utf8' });
  return { root, cwd, file, log, run };
}

test('report selection reuses independent filters and keeps explicit support and counterevidence outside them', () => {
  const g = graph();
  const before = structuredClone(g);
  const data = buildExportData(g, { type: 'vuln', severity: 'high', confidence: 'reproduced', tags: ['site=app.example', 'auth'], groupBy: 'tag:site,status' });
  assert.deepEqual(data.nodes.map((node) => node.id), ['v1']);
  assert.equal(data.nodes[0].status, null);
  assert.deepEqual(data.relatedNodes.map((node) => node.id), ['f1', 'f2', 'v2']);
  assert.deepEqual(data.edges.map((edge) => edge.kind), ['contradicts', 'supports', 'related-to']);
  assert.deepEqual(data.groups, [{ values: { 'tag:site': 'app.example', status: null }, nodeIds: ['v1'] }]);
  assert.equal(buildExportData(g, { type: 'vuln', severity: 'high', status: 'open' }).nodes.length, 0);
  assert.equal(JSON.stringify(data).includes('SYNTHETIC_ACTIVITY'), false);
  assert.deepEqual(g, before);
});

test('reports retain more than a thousand matching records and sort deterministically', () => {
  const g = emptyGraph();
  for (let i = 0; i < 1005; i++) {
    const id = `n${String(i).padStart(4, '0')}`;
    g.nodes[id] = { id, type: 'note', title: id, ts: i, ...(i % 2 ? { severity: 'high' } : {}) };
  }
  const data = buildExportData(g);
  assert.equal(data.nodes.length, 1005);
  assert.equal(data.nodes[0].id, 'n0001');
  assert.equal(data.nodes.at(-1).id, 'n1004');
  assert.equal(buildExportData(g, { sort: 'time' }).nodes[0].id, 'n1004');
  assert.equal(buildExportData(g, { sort: 'id' }).nodes[0].id, 'n0000');
});

test('CLI exports Markdown, Mermaid and SARIF through the same filters without modifying the board', (t) => {
  const { root, run, file, log } = fixture(t);
  for (const [format, extension] of [['markdown', 'md'], ['mermaid', 'mmd'], ['sarif', 'sarif']]) {
    const output = path.join(root, `report.${extension}`);
    const response = run('export', '--format', format, '--type', 'vuln', '--sev', 'high', '--confidence', 'reproduced', '--tag', 'site=app.example', '--sort', 'severity', '--out', output, '--json');
    assert.equal(response.status, 0, response.stderr);
    assert.deepEqual(JSON.parse(response.stdout), { schema: 'blackboard.export.v1', file: output, format });
    const content = fs.readFileSync(output, 'utf8');
    assert.match(content, /High claim/);
    assert.doesNotMatch(content, /Unrelated material|SYNTHETIC_ACTIVITY/);
    if (format === 'markdown') {
      assert.match(content, /FULL SUPPORT/);
      assert.match(content, /FULL COUNTEREXAMPLE/);
    } else if (format === 'sarif') {
      const sarif = JSON.parse(content);
      assert.equal(sarif.runs[0].results.length, 1);
      assert.equal(sarif.runs[0].results[0].level, 'error');
      assert.equal(sarif.runs[0].results[0].properties.node.status, null);
    }
    assert.equal(fs.readFileSync(file, 'utf8'), log);
  }
});

test('default HTML export stays self-contained and contains projected nodes without raw activity text', (t) => {
  const { root, run, file, log } = fixture(t);
  const output = path.join(root, 'snapshot.html');
  const response = run('export', '--out', output);
  assert.equal(response.status, 0, response.stderr);
  const content = fs.readFileSync(output, 'utf8');
  const snapshot = JSON.parse(content.match(/window\.__BLACKBOARD_DATA__ = (.*);/)[1]);
  assert.equal(snapshot.schema, 'blackboard.graph.v2');
  assert.equal(snapshot.nodes.f1.status, null);
  assert.equal(snapshot.nodes.f1.severity, null);
  assert.equal(snapshot.nodes.f1.confidence, null);
  assert.doesNotMatch(content, /SYNTHETIC_ACTIVITY/);
  assert.equal(fs.readFileSync(file, 'utf8'), log);
});

test('export rejects missing boards, unknown formats, ignored options and output aliases of event data', (t) => {
  const { root, cwd, run, file, log } = fixture(t);
  const output = path.join(root, 'rejected.md');
  for (const args of [
    ['--format', 'unknown'], ['--format', 'markdown', '--sort', 'unknown'],
    ['--format', 'html', '--sev', 'high'], ['--format', 'markdown', '--max-nodes', '1'],
    ['--format', 'sarif', '--group-by', 'status'],
  ]) {
    assert.equal(run('export', ...args, '--out', output).status, 1);
    assert.equal(fs.existsSync(output), false);
  }
  const alias = path.join(root, 'event-alias.md');
  fs.linkSync(file, alias);
  for (const outputPath of [file, alias]) {
    assert.equal(run('export', '--format', 'markdown', '--out', outputPath).status, 1);
    assert.equal(fs.readFileSync(file, 'utf8'), log);
  }
  fs.renameSync(path.join(cwd, '.blackboard'), path.join(cwd, 'saved-board'));
  assert.equal(run('export', '--format', 'markdown', '--out', output).status, 1);
  assert.equal(fs.existsSync(path.join(cwd, '.blackboard')), false);
  assert.equal(fs.existsSync(output), false);
});
