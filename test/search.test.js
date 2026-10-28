import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { emptyGraph } from '../lib/model.js';
import { searchGraph } from '../lib/search.js';

function graph() {
  const g = emptyGraph();
  g.nodes = {
    hy1: { id: 'hy1', type: 'hypothesis', title: 'Session cookie', detail: 'Candidate only', tags: ['auth', 'web'], status: 'open', ts: 1 },
    o1: { id: 'o1', type: 'observation', title: 'Header result', detail: 'Cookie exists', loc: {path:'src/session.js',line:42}, tags: ['auth'], status: 'done', ts: 2 },
    x1: { id: 'x1', type: 'experiment', title: 'Cookie candidate', status: 'refuted', ts: 2 },
  };
  g.edges.e1 = {id:'e1',from:'o1',to:'hy1',kind:'supports'};
  return g;
}

test('search returns stable IDs, matching fields and pointers, without mutation', () => {
  const g = graph(); const before = JSON.stringify(g);
  const result = searchGraph(g, {query:'COOKIE'});
  assert.deepEqual(result.items.map((x) => x.id), ['o1','x1','hy1']);
  assert.equal(result.readOnly, true); assert.equal(result.prescriptive, false);
  assert.ok(result.items.find((x) => x.id === 'o1').matches.some((m) => m.field === 'detail'));
  assert.equal(result.items[0].node.loc.line,42);
  assert.equal(JSON.stringify(g),before);
});

test('search combines text, independent fields, tags and explicit graph filters', () => {
  const g=graph();
  assert.deepEqual(searchGraph(g,{query:'session cookie',tags:['auth','web'],type:'hypothesis',status:'open',relation:'supports',relatedTo:'o1'}).items.map((x)=>x.id),['hy1']);
  assert.equal(searchGraph(g,{query:'src/session.js'}).items[0].matches[0].field,'loc.path');
  assert.equal(searchGraph(g,{query:'Cookie',type:'experiment',status:'refuted'}).items[0].id,'x1');
  assert.equal(searchGraph(g,{tags:['absent']}).total,0);
});

test('search exposes truncation, rejects invalid limits and treats regex as literal', () => {
  assert.equal(searchGraph(graph(),{limit:1}).truncated,true);
  for(const limit of [0,-1,1.1,1001,'bad']) assert.throws(()=>searchGraph(graph(),{limit}));
  assert.equal(searchGraph(graph(),{query:'.*'}).total,0);
});

function findings() {
  const g = emptyGraph();
  g.nodes = {
    v1: { id: 'v1', type: 'vuln', title: 'Cookie scope', severity: 'high', confidence: 'reproduced', tags: ['site=alpha.example', 'site=beta.example', 'site=alpha.example', 'auth'], ts: 1 },
    v2: { id: 'v2', type: 'vuln', title: 'Cookie candidate', severity: 'high', confidence: 'suspected', status: 'open', tags: ['site=alpha.example', 'auth,session'], ts: 2 },
    v3: { id: 'v3', type: 'vuln', title: 'Header observation', severity: 'low', confidence: 'reproduced', status: 'open', tags: ['site=beta.example'], ts: 3 },
    v4: { id: 'v4', type: 'vuln', title: 'Retired cookie claim', severity: 'high', confidence: 'reproduced', status: 'refuted', ts: 4 },
    v5: { id: 'v5', type: 'vuln', title: 'Undeclared dimensions', tags: ['alpha.example', 'team=blue'], ts: 5 },
  };
  g.edges.e1 = { id: 'e1', from: 'v3', to: 'v1', kind: 'supports' };
  return g;
}

test('severity and confidence filters do not infer status or exclude refuted records', () => {
  const g = findings();
  const options = { severity: 'high', confidence: 'reproduced' };
  assert.deepEqual(searchGraph(g, options).items.map((item) => item.id), ['v4', 'v1']);
  assert.equal(searchGraph(g, { ...options, status: 'open' }).total, 0);
  assert.deepEqual(searchGraph(g, { ...options, query: 'cookie', tags: ['site=alpha.example', 'auth'], relation: 'supports', relatedTo: 'v3' }).items.map((item) => item.id), ['v1']);
  assert.equal(searchGraph(g, { tags: ['auth', 'session'] }).total, 0, 'a comma inside one tag does not declare two tags');
});

test('group counts cover every match before limiting details and preserve unset values', () => {
  const g = findings();
  const before = structuredClone(g);
  const result = searchGraph(g, { groupBy: ['status'], limit: 1 });
  assert.equal(result.total, 5);
  assert.deepEqual(result.items.map((item) => item.id), ['v5']);
  assert.equal(result.truncated, true);
  assert.deepEqual(result.groupBy, ['status']);
  assert.deepEqual(result.groups, [
    { values: { status: 'open' }, count: 2 },
    { values: { status: 'refuted' }, count: 1 },
    { values: { status: null }, count: 2 },
  ]);
  const reversed = { ...g, nodes: Object.fromEntries(Object.entries(g.nodes).reverse()) };
  assert.deepEqual(searchGraph(reversed, { groupBy: ['status'], limit: 1 }).groups, result.groups);
  assert.deepEqual(g, before);
});

test('tag groups count a node once per explicit value and compose with field groups', () => {
  const g = findings();
  assert.deepEqual(searchGraph(g, { groupBy: ['tag:site', 'severity'], limit: 1 }).groups, [
    { values: { 'tag:site': 'alpha.example', severity: 'high' }, count: 2 },
    { values: { 'tag:site': 'beta.example', severity: 'high' }, count: 1 },
    { values: { 'tag:site': 'beta.example', severity: 'low' }, count: 1 },
    { values: { 'tag:site': null, severity: 'high' }, count: 1 },
    { values: { 'tag:site': null, severity: null }, count: 1 },
  ]);
  assert.deepEqual(searchGraph(g, { groupBy: ['tag:team'] }).groups, [
    { values: { 'tag:team': 'blue' }, count: 1 },
    { values: { 'tag:team': null }, count: 4 },
  ]);
  const filtered = searchGraph(g, { query: 'cookie', tags: ['site=alpha.example'], severity: 'high', confidence: 'reproduced', relation: 'supports', relatedTo: 'v3', groupBy: ['severity', 'status'] });
  assert.deepEqual(filtered.groups, [{ values: { severity: 'high', status: null }, count: 1 }]);
  assert.deepEqual(searchGraph(g, { query: 'absent', groupBy: ['status'] }).groups, []);
  for (const groupBy of ['severity,,status', 'status,status', 'title', 'tag:']) {
    assert.throws(() => searchGraph(g, { groupBy }));
  }
});

function cliFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blackboard-query-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const board = path.join(root, '.blackboard');
  fs.mkdirSync(board);
  const nodes = Object.values(findings().nodes);
  for (let i = 1; i <= 30; i++) nodes.push({ id: `f${i}`, type: 'fact', title: `Observation ${i}`, ts: i + 5 });
  const file = path.join(board, 'events.jsonl');
  const log = nodes.map((node) => JSON.stringify({ eventVersion: 1, op: 'node', node })).join('\n') + '\n';
  fs.writeFileSync(file, log);
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('BLACKBOARD_')) delete env[key];
  const cli = fileURLToPath(new URL('../bin/blackboard.js', import.meta.url));
  const run = (...args) => spawnSync(process.execPath, [cli, ...args, '--cwd', root], { cwd: root, env, encoding: 'utf8' });
  return { run, file, log };
}

test('CLI combines field filters and grouped counts while keeping the board read-only', (t) => {
  const { run, file, log } = cliFixture(t);
  const response = run('search', '--type', 'vuln', '--sev', 'high', '--confidence', 'reproduced', '--group-by', 'severity,status', '--limit', '1', '--json');
  assert.equal(response.status, 0, response.stderr);
  const result = JSON.parse(response.stdout);
  assert.equal(result.total, 2);
  assert.equal(result.truncated, true);
  assert.deepEqual(result.items.map((item) => item.id), ['v4']);
  assert.deepEqual(result.groups, [
    { values: { severity: 'high', status: 'refuted' }, count: 1 },
    { values: { severity: 'high', status: null }, count: 1 },
  ]);
  assert.equal(fs.readFileSync(file, 'utf8'), log);
});

test('CLI list reports truncation on stderr and explicitly returns all filtered records', (t) => {
  const { run, file, log } = cliFixture(t);
  const limited = run('ls', '--json');
  assert.equal(limited.status, 0, limited.stderr);
  assert.deepEqual(JSON.parse(limited.stdout).map((node) => node.id), Array.from({ length: 30 }, (_, i) => `f${i + 1}`));
  assert.deepEqual(limited.stderr.match(/\d+/g).map(Number), [35, 30, 5]);
  const filtered = run('ls', '--type', 'vuln', '--limit', '2', '--json');
  assert.equal(filtered.status, 0, filtered.stderr);
  assert.deepEqual(JSON.parse(filtered.stdout).map((node) => node.id), ['v4', 'v5']);
  assert.deepEqual(filtered.stderr.match(/\d+/g).map(Number), [5, 2, 3]);
  const all = run('list', '--all', '--type', 'vuln', '--json');
  assert.equal(all.status, 0, all.stderr);
  assert.equal(all.stderr, '');
  assert.deepEqual(JSON.parse(all.stdout).map((node) => node.id), ['v1', 'v2', 'v3', 'v4', 'v5']);
  const conflict = run('ls', '--all', '--limit', '1', '--json');
  assert.equal(conflict.status, 1);
  assert.equal(conflict.stdout, '');
  assert.equal(fs.readFileSync(file, 'utf8'), log);
});
