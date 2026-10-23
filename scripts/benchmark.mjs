#!/usr/bin/env node
// Synthetic, disposable boards only. No server, user board or installed release is touched.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SELF = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(SELF), '..');

export function percentile(values, fraction) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
}

export function summary(samples) {
  return { samples, p50: percentile(samples, .5), p95: percentile(samples, .95), unit: 'ms' };
}

// Stable ids, timestamps and bytes allow baseline/modified comparisons on identical inputs.
export function fixtureEvents(nodes, eventCount, eventVersion = 1) {
  assert.ok(Number.isInteger(nodes) && nodes >= 2, 'nodes must be at least 2');
  assert.ok(Number.isInteger(eventCount) && eventCount >= nodes + 2, 'events must exceed nodes by at least 2');
  const events = [];
  const record = (event) => events.push({ eventVersion, eventId: `bench-${String(events.length).padStart(7, '0')}`, ...event });
  const types = ['goal', 'hypothesis', 'observation', 'finding', 'question', 'note', 'experiment'];
  for (let i = 0; i < nodes; i++) {
    record({ op: 'node', node: {
      id: `n${i + 1}`, type: types[i % types.length], title: `Synthetic research ${i + 1}`,
      detail: `Deterministic benchmark fixture ${i + 1}; not a real research record.`,
      ts: 1700000000000 + i, status: i % 9 === 0 ? 'refuted' : 'open',
      ...(i % 3 === 0 ? { confidence: 'suspected' } : {}), tags: [`group-${i % 10}`],
    } });
  }
  record({ op: 'cursor', cursor: { id: 'benchmark-cursor', agentId: 'agent:primary', to: 'n2', from: null, at: 1700001000000 } });
  record({ op: 'checkpoint', checkpoint: { id: 'benchmark-checkpoint', agentId: 'agent:primary', summary: 'Synthetic handoff', at: 1700001000001 } });
  while (events.length < eventCount) {
    const i = events.length;
    const index = (i * 17) % nodes;
    if (i % 5 === 0) {
      const from = `n${index + 1}`;
      const to = `n${(index + 1) % nodes + 1}`;
      record({ op: 'edge', edge: { id: `${from}|supports|${to}`, from, to, kind: 'supports', ts: 1700002000000 + i } });
    } else {
      record({ op: 'patch', id: `n${index + 1}`, set: { detail: `Synthetic revision ${i}`, updatedAt: 1700002000000 + i } });
    }
  }
  return events;
}

function argsOf(args) {
  const opts = {};
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (['--full', '--quick', '--no-concurrency', '--help'].includes(key)) opts[key.slice(2)] = true;
    else if (['--source', '--output', '--runs', '--nodes', '--events', '--worker', '--board', '--count', '--worker-id'].includes(key)) {
      assert.ok(args[i + 1] && !args[i + 1].startsWith('--'), `${key} requires a value`);
      opts[key.slice(2)] = args[++i];
    } else throw new Error(`unknown option: ${key}`);
  }
  return opts;
}

function positive(value, fallback, name) {
  const result = value === undefined ? fallback : Number(value);
  assert.ok(Number.isInteger(result) && result > 0, `${name} must be a positive integer`);
  return result;
}
const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const logPath = (board) => path.join(board, '.blackboard', 'events.jsonl');
const fingerprint = (graph) => sha(JSON.stringify(graph));
const sourceFingerprint = (source) => sha(['package.json', 'lib/store.js', 'lib/model.js', 'lib/context.js']
  .map((name) => `${name}\n${fs.readFileSync(path.join(source, name), 'utf8')}`).join('\n'));
function isolatedEnv() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('BLACKBOARD_')) delete env[key];
  return { ...env, BLACKBOARD_LOCK_TIMEOUT_MS: '120000', BLACKBOARD_QUIET: '1' };
}
async function modules(source) {
  const store = await import(pathToFileURL(path.join(source, 'lib/store.js')).href);
  const context = await import(pathToFileURL(path.join(source, 'lib/context.js')).href);
  const model = await import(pathToFileURL(path.join(source, 'lib/model.js')).href);
  return { store, context, model };
}
function validate(graph, count) {
  assert.equal(Object.keys(graph.nodes).length, count);
  for (const field of ['corruptLines', 'futureEvents', 'rejected', 'unknownOps']) assert.equal(graph.integrity[field] || 0, 0, field);
}
function subprocess(options) {
  return [SELF, '--source', options.source, '--worker', options.mode, '--board', options.board,
    '--count', String(options.count || 1), '--worker-id', String(options.id || 0)];
}
function startWorker(options) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, subprocess(options), { env: isolatedEnv(), stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000 });
    let out = '', err = '';
    child.stdout.on('data', (data) => { out += data; });
    child.stderr.on('data', (data) => { err += data; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) reject(new Error(`benchmark worker exit ${code}: ${err}`));
      else { try { resolve(JSON.parse(out)); } catch (error) { reject(error); } }
    });
  });
}

async function worker(opts) {
  const { store } = await modules(opts.source);
  const start = performance.now();
  if (opts.worker === 'replay') {
    const graph = store.replay(opts.board);
    return { elapsedMs: performance.now() - start, nodes: Object.keys(graph.nodes).length, fingerprint: fingerprint(graph), rssBytes: process.memoryUsage().rss };
  }
  assert.equal(opts.worker, 'write');
  const samples = [];
  for (let i = 0; i < Number(opts.count); i++) {
    const tick = performance.now();
    store.addNode({ type: 'note', title: `benchmark-writer-${opts['worker-id']}-${i}` }, opts.board);
    samples.push(performance.now() - tick);
  }
  return { samples, elapsedMs: performance.now() - start, rssBytes: process.memoryUsage().rss };
}

export async function runBenchmark(options = {}) {
  const source = fs.realpathSync(path.resolve(options.source || ROOT));
  const sourceSha256Start = sourceFingerprint(source);
  const { store, context, model } = await modules(source);
  const full = Boolean(options.full);
  const runs = positive(options.runs, full ? 5 : 3, 'runs');
  const sizes = options.nodes ? [positive(options.nodes, 0, 'nodes')] : full ? [1000, 10000] : [1000];
  const eventCount = positive(options.events, full ? 100000 : 10000, 'events');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'blackboard-benchmark-'));
  const results = [];
  try {
    for (const nodes of sizes) {
      const board = path.join(tmp, `board-${nodes}`);
      store.ensure(board);
      const input = fixtureEvents(nodes, eventCount, model.EVENT_VERSION || 1);
      const bytes = Buffer.from(input.map((event) => JSON.stringify(event)).join('\n') + '\n');
      fs.writeFileSync(logPath(board), bytes);
      const fixtureHash = sha(bytes);
      const graph = store.replay(board);
      validate(graph, nodes);
      const expected = fingerprint(graph);
      const samples = { processColdReplay: [], fullReplay: [], contextProjection: [], recoveryContext: [], write: [] };
      const rss = [process.memoryUsage().rss];
      const clone = (name) => {
        const dir = path.join(tmp, `${nodes}-${name}`);
        store.ensure(dir);
        fs.copyFileSync(logPath(board), logPath(dir));
        return dir;
      };
      for (let i = 0; i < runs; i++) {
        let tick = performance.now();
        const cold = spawnSync(process.execPath, subprocess({ source, mode: 'replay', board }), { env: isolatedEnv(), encoding: 'utf8', timeout: 120000, maxBuffer: 1024 * 1024 });
        samples.processColdReplay.push(performance.now() - tick);
        assert.equal(cold.status, 0, cold.stderr);
        const result = JSON.parse(cold.stdout);
        assert.equal(result.fingerprint, expected, 'fresh process must reproduce the graph');
        rss.push(result.rssBytes);
        tick = performance.now();
        const replayed = store.replay(board);
        samples.fullReplay.push(performance.now() - tick);
        assert.equal(fingerprint(replayed), expected);
        tick = performance.now();
        const packet = context.buildAgentContext(replayed, { budgetTokens: 4000, maxItems: 24, focus: 'n2' });
        samples.contextProjection.push(performance.now() - tick);
        assert.equal(packet.policy.readOnly, true);
        tick = performance.now();
        const current = store.replay(board);
        context.buildAgentContext(current, { budgetTokens: 4000, maxItems: 24, focus: 'n2' });
        samples.recoveryContext.push(performance.now() - tick);
        const writeBoard = clone(`write-${i}`);
        tick = performance.now();
        store.addNode({ type: 'note', title: 'benchmark-single-write' }, writeBoard);
        samples.write.push(performance.now() - tick);
        validate(store.replay(writeBoard), nodes + 1);
        const written = fs.readFileSync(logPath(writeBoard));
        assert.equal(sha(written.subarray(0, bytes.length)), fixtureHash, 'write must preserve the original event prefix');
        assert.equal(store.readEvents(writeBoard).events.length, eventCount + 1, 'one explicit node write adds exactly one event');
        rss.push(process.memoryUsage().rss);
      }
      const reads = [];
      let concurrency = null;
      if (!options['no-concurrency']) {
        const concurrentBoard = clone('concurrent');
        const workers = 2, writesPerWorker = full ? 3 : 2;
        let active = true;
        const tick = performance.now();
        const pending = Promise.all(Array.from({ length: workers }, (_, id) => startWorker({ source, mode: 'write', board: concurrentBoard, count: writesPerWorker, id })));
        pending.then(() => { active = false; }, () => { active = false; });
        while (active) {
          const readStart = performance.now();
          const current = store.replay(concurrentBoard);
          reads.push(performance.now() - readStart);
          assert.ok(Object.keys(current.nodes).length >= nodes);
          for (const field of ['corruptLines', 'futureEvents', 'rejected']) assert.equal(current.integrity[field] || 0, 0);
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        const writers = await pending;
        const elapsedMs = performance.now() - tick;
        const final = store.replay(concurrentBoard);
        validate(final, nodes + workers * writesPerWorker);
        const events = store.readEvents(concurrentBoard).events;
        assert.equal(events.length, eventCount + workers * writesPerWorker);
        assert.equal(new Set(events.map((event) => event.eventId)).size, events.length, 'event ids must remain unique');
        assert.equal(sha(fs.readFileSync(logPath(concurrentBoard)).subarray(0, bytes.length)), fixtureHash);
        for (let id = 0; id < workers; id++) for (let i = 0; i < writesPerWorker; i++) {
          assert.equal(Object.values(final.nodes).filter((node) => node.title === `benchmark-writer-${id}-${i}`).length, 1, 'no concurrent write may be lost or duplicated');
        }
        concurrency = { workers, writesPerWorker, elapsedMs, write: summary(writers.flatMap((writer) => writer.samples)), concurrentRead: summary(reads) };
        rss.push(...writers.map((writer) => writer.rssBytes));
      }
      assert.equal(sha(fs.readFileSync(logPath(board))), fixtureHash, 'all read operations must leave the source log byte-identical');
      results.push({ nodes, events: eventCount, eventBytes: bytes.length, fixtureSha256: fixtureHash,
        metrics: Object.fromEntries(Object.entries(samples).map(([key, value]) => [key, summary(value)])),
        concurrency, rssBytes: { observedMax: Math.max(...rss), samples: rss },
        integrity: { sourceUnchanged: true, fullReplayEqual: true, writePrefixPreserved: true, concurrentWritesExact: concurrency ? true : null } });
    }
    const pkg = JSON.parse(fs.readFileSync(path.join(source, 'package.json'), 'utf8'));
    return { schemaVersion: 1, measuredAt: new Date().toISOString(), mode: full ? 'full' : 'quick', source, packageVersion: pkg.version, runs,
      sourceFingerprint: { start: sourceSha256Start, end: sourceFingerprint(source), changedDuringRun: sourceSha256Start !== sourceFingerprint(source) },
      machine: { platform: process.platform, arch: process.arch, node: process.version, cpu: os.cpus()[0]?.model || null, logicalCpus: os.cpus().length, memoryBytes: os.totalmem() },
      methodology: { clock: 'performance.now()', quantile: 'nearest-rank', cold: 'fresh Node process; includes startup and graph fingerprint; OS page cache is NOT cleared',
        replay: 'full events.jsonl read, parse and projection; fingerprint/assertions outside timed section', contextProjection: 'bounded context from already replayed graph',
        recoveryContext: 'full replay plus bounded context', write: 'one addNode under lock against a cloned fixture, including state cache; cloning/validation not timed',
        concurrency: 'two child writers plus parent full replay reads; samples are contention-inclusive, not independent repeated runs',
        rss: 'observed process.memoryUsage().rss samples, not OS peak RSS; not additive across processes', fixtures: 'synthetic deterministic events only; temp directories removed on success or failure' }, results };
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === SELF) {
  try {
    const opts = argsOf(process.argv.slice(2));
    if (opts.help) console.log('Usage: node scripts/benchmark.mjs [--quick|--full] [--source DIR] [--output FILE] [--runs N] [--nodes N --events N] [--no-concurrency]\nDefault quick: 1k nodes / 10k events / 3 samples. Full: 1k and 10k nodes / 100k events / 5 samples.');
    else {
      assert.ok(!(opts.quick && opts.full), 'choose --quick or --full, not both');
      const result = opts.worker ? await worker({ ...opts, source: path.resolve(opts.source || ROOT) }) : await runBenchmark(opts);
      const json = JSON.stringify(result, null, 2) + '\n';
      if (opts.output) fs.writeFileSync(path.resolve(opts.output), json);
      process.stdout.write(json);
    }
  } catch (error) { console.error(`benchmark: ${error.message}`); process.exitCode = 1; }
}
