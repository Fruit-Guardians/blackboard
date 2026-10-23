import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { fixtureEvents, percentile, runBenchmark, summary } from '../scripts/benchmark.mjs';
import { applyAll, emptyGraph } from '../lib/model.js';

const root = fileURLToPath(new URL('../', import.meta.url));

test('benchmark fixtures are deterministic, valid and contain unknown types without rejecting them', () => {
  const first = fixtureEvents(100, 1000);
  assert.deepEqual(first, fixtureEvents(100, 1000));
  assert.equal(first.length, 1000);
  assert.equal(new Set(first.map((event) => event.eventId)).size, 1000);
  const graph = applyAll(emptyGraph(), first);
  assert.equal(Object.keys(graph.nodes).length, 100);
  assert.ok(Object.values(graph.nodes).some((node) => node.type === 'experiment'));
  assert.equal(graph.integrity.rejected, 0);
  assert.equal(Object.keys(graph.checkpoints).length, 1);
  assert.equal(graph.cursors['agent:primary'].to, 'n2');
  assert.throws(() => fixtureEvents(1, 100), /at least 2/);
  assert.throws(() => fixtureEvents(100, 101), /at least 2/);
});

test('benchmark percentiles use nearest-rank without mutating samples', () => {
  const samples = [100, 1, 4, 8, 3];
  assert.equal(percentile(samples, .5), 4);
  assert.equal(percentile(samples, .95), 100);
  assert.equal(percentile([], .5), null);
  assert.deepEqual(summary(samples), { samples, p50: 4, p95: 100, unit: 'ms' });
  assert.deepEqual(samples, [100, 1, 4, 8, 3]);
});

test('small benchmark exercises cold/read/context/write/concurrency and validates every log', async () => {
  const result = await runBenchmark({ source: root, nodes: 30, events: 100, runs: 2 });
  assert.equal(result.schemaVersion, 1);
  assert.equal(result.machine.node, process.version);
  assert.match(result.methodology.cold, /OS page cache is NOT cleared/);
  const [sample] = result.results;
  assert.equal(sample.nodes, 30);
  assert.equal(sample.events, 100);
  assert.match(sample.fixtureSha256, /^[a-f0-9]{64}$/);
  for (const metric of Object.values(sample.metrics)) {
    assert.equal(metric.samples.length, 2);
    assert.ok(metric.p95 >= metric.p50 && metric.p50 >= 0);
  }
  assert.equal(sample.concurrency.workers, 2);
  assert.equal(sample.concurrency.write.samples.length, 4);
  assert.ok(sample.concurrency.concurrentRead.samples.length > 0);
  assert.deepEqual(sample.integrity, { sourceUnchanged: true, fullReplayEqual: true, writePrefixPreserved: true, concurrentWritesExact: true });
  assert.ok(sample.rssBytes.observedMax > 0);
});

test('benchmark CLI supports source/output and rejects accidental unknown options', (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'blackboard-benchmark-cli-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const script = path.join(root, 'scripts', 'benchmark.mjs');
  const output = path.join(tmp, 'result.json');
  const result = spawnSync(process.execPath, [script, '--source', root, '--nodes', '10', '--events', '30', '--runs', '1', '--no-concurrency', '--output', output], { cwd: tmp, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), JSON.parse(fs.readFileSync(output, 'utf8')));
  assert.equal(JSON.parse(result.stdout).results[0].concurrency, null);
  const invalid = spawnSync(process.execPath, [script, '--board-root', '/not-a-board'], { encoding: 'utf8' });
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /unknown option/);
  assert.deepEqual(fs.readdirSync(tmp), ['result.json'], 'the working directory is never treated as a board');
});
