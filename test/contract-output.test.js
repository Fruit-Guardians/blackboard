// Fixed `--json` outputs: every command in docs/CONTRACT.md runs against the
// fixture boards and must match its baseline in test/fixtures/contract/outputs/.
// A failing baseline means machine-readable output changed. Adding a field is
// compatible; regenerate with UPDATE_CONTRACT=1 and review the diff. Changing a
// meaning or type, or removing a field, needs a new schema version first.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const CLI = path.join(REPO, 'bin', 'blackboard.js');
const FIXTURES = path.join(HERE, 'fixtures', 'contract');
const OUTPUTS = path.join(FIXTURES, 'outputs');
const CONTRACT_DOC = path.join(REPO, 'docs', 'CONTRACT.md');
const UPDATE = process.env.UPDATE_CONTRACT === '1';
const PACKAGE_VERSION = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8')).version;

// Fixture times sit on 2026-01-01; anything later was written by the run itself.
const FIXTURE_TIME_LIMIT = Date.UTC(2026, 0, 2);
const TIME_KEYS = new Set(['ts', 'at', 'updated']);
const RUNTIME_ID = /^(event|cursor|session)_[0-9a-z]+(_[0-9a-z]+)?$/;

/**
 * Every case runs on a fresh copy of its board. `board: null` starts from an
 * empty directory. Args may use <root> and <board>; `--json` and `--cwd <board>`
 * are appended unless `cwd: false`. `before` runs setup commands first.
 */
const CASES = {
  init: [
    { board: null, args: ['init', '--title', 'New board'] },
  ],
  status: [
    { board: 'research', args: ['status'] },
    { board: 'research', args: ['status', '--agent', 'agent:reviewer'] },
    { board: 'empty', args: ['status'] },
    { board: 'integrity', args: ['status'] },
  ],
  node: [
    { board: 'research', args: ['node', 'add', 'note', 'A plain note', '--detail', 'Body.', '--tag', 'x'] },
    { board: 'research', args: ['node', 'add', 'experiment', 'Unknown type', '--to', 'g1', '--rel', 'inspired-by', '--enter'] },
    { board: 'research', args: ['start', 'Start here'] },
    { board: 'research', args: ['goal', 'Second goal', '--status', 'active'] },
    { board: 'research', args: ['intent', 'Try the logout path', '--relate-here'] },
    { board: 'research', args: ['fact', 'Logout keeps the id', '--confidence', 'reproduced', '--at', 'src/auth.js:42'] },
    { board: 'research', args: ['vuln', 'Cookie scope too wide', '--sev', 'medium', '--parent', 'f2'] },
    { board: 'research', args: ['hint', 'Compare with the SSO handler', '--agent', 'agent:reviewer'] },
    { board: 'research', args: ['fact', 'x', '--request-id', 'req-new-1'] },
    { board: null, args: ['goal', 'No board yet', '--no-init'] },
  ],
  checkpoint: [
    { board: 'research', args: ['checkpoint', '--summary', 'Third pass.'] },
    { board: 'research', args: ['compact', '--summary', 'Before compaction.', '--trigger', 'pre-compact'] },
  ],
  cursor: [
    { board: 'research', args: ['cursor', 'f1', '--reason', 'look again'] },
    { board: 'research', args: ['cursor', 'none'] },
    { board: 'research', args: ['focus', 'q1', '--agent', 'agent:reviewer'] },
    { board: 'research', args: ['cursor', 'nope'] },
  ],
  here: [
    { board: 'research', args: ['here'] },
    { board: 'research', args: ['here', '--agent', 'agent:reviewer'] },
  ],
  activity: [
    { board: 'research', args: ['activity'] },
    { board: 'research', args: ['activity', 'show', 'act1'] },
  ],
  promote: [
    { board: 'research', args: ['promote', 'act1', '--kind', 'observation', '--title', 'Same id twice'] },
  ],
  done: [{ board: 'research', args: ['done', 'q1'] }],
  block: [{ board: 'research', args: ['block', 'h1'] }],
  revive: [{ board: 'research', args: ['revive', 'i1'] }],
  edit: [
    { board: 'research', args: ['edit', 'v1', '--title', 'Session fixation', '--sev', 'critical', '--tag', 'auth'] },
    { board: 'research', args: ['edit', 'nope', '--title', 'x'] },
  ],
  link: [
    { board: 'research', args: ['link', 'h1', 'q1', '--rel', 'depends-on', '--label', 'same handler'] },
    { board: 'research', args: ['link', 'q1', 'g1'] },
  ],
  unlink: [
    { board: 'research', args: ['unlink', 'f1', 'f2', '--rel', 'supersedes'] },
  ],
  remove: [
    { board: 'research', args: ['remove', 'h1', '--reason', 'answered'] },
    { board: 'research', args: ['rm', 'q1'] },
  ],
  ls: [
    { board: 'research', args: ['ls'] },
    { board: 'research', args: ['list', '--type', 'fact'] },
    { board: 'research', args: ['ls', '--open-only', '--limit', '2'] },
    { board: 'empty', args: ['ls'] },
    { board: 'integrity', args: ['ls'] },
    { board: 'research', args: ['ls', '--all', '--type', 'fact'] },
  ],
  show: [
    { board: 'research', args: ['show', 'v1'] },
    { board: 'integrity', args: ['show', 'x1'] },
    { board: 'research', args: ['show', 'nope'] },
  ],
  digest: [
    { board: 'research', args: ['digest'] },
    { board: 'research', args: ['digest', '--agent', 'agent:reviewer'] },
    { board: 'research', args: ['digest', '--write'] },
  ],
  context: [
    { board: 'research', args: ['context'] },
    { board: 'research', args: ['context', '--since', 'cp1'] },
    { board: 'research', args: ['context', '--focus', 'v1', '--depth', '1', '--budget', '600'] },
    { board: 'empty', args: ['context'] },
  ],
  lint: [
    { board: 'research', args: ['lint'] },
    { board: 'integrity', args: ['lint'] },
  ],
  tail: [{ board: 'research', args: ['tail'] }],
  export: [{ board: 'research', args: ['export', '--out', '<root>/out.html'] }],
  reset: [{ board: 'research', args: ['reset', '--yes'] }],
  search: [
    { board: 'research', args: ['search', 'session'] },
    { board: 'research', args: ['search', '--type', 'fact', '--rel', 'supports', '--related-to', 'v1'] },
    { board: 'research', args: ['search', '--type', 'vuln', '--sev', 'high', '--confidence', 'static-confirmed', '--group-by', 'severity,status', '--limit', '1'] },
    { board: 'research', args: ['search', '--group-by', 'tag:site,status', '--limit', '1'] },
    { board: 'empty', args: ['search', '--group-by', 'severity'] },
  ],
  history: [
    { board: 'research', args: ['history', 'v1'] },
    { board: 'research', args: ['history', 'f4'] },
    { board: 'integrity', args: ['history', 'n1'] },
  ],
  changes: [
    { board: 'research', args: ['changes', '--since', 'cp1'] },
    { board: 'research', args: ['changes', '--since', 'cp2'] },
  ],
  backup: [{ board: 'research', args: ['backup', '--out', '<root>/backup'] }],
  restore: [
    {
      board: 'research', cwd: false,
      before: [['backup', '--out', '<root>/backup', '--cwd', '<board>']],
      args: ['restore', '<root>/backup', '--into', '<root>/restored'],
    },
  ],
  receipt: [
    { board: 'research', args: ['receipt', 'req-fixture-1'] },
    { board: 'research', args: ['receipt', 'req-missing'] },
    { board: 'research', args: ['receipt'] },
  ],
  capabilities: [
    { board: null, cwd: false, args: ['capabilities'] },
    { board: null, args: ['capabilities'] },
  ],
};

let PORT;

/** A port nothing listens on, so `status` reports the viewer offline. */
function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function tmp(t) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'blackboard-contract-out-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function prepare(t, boardName) {
  const root = tmp(t);
  const board = path.join(root, 'board');
  fs.mkdirSync(board);
  fs.mkdirSync(path.join(root, 'home'));
  if (boardName) {
    fs.mkdirSync(path.join(board, '.blackboard'));
    fs.copyFileSync(path.join(FIXTURES, `${boardName}.events.jsonl`), path.join(board, '.blackboard', 'events.jsonl'));
  }
  return { root, board };
}

function fill(args, { root, board }) {
  return args.map((a) => a.replaceAll('<root>', root).replaceAll('<board>', board));
}

function cli(args, { root }) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('BLACKBOARD_')) delete env[key];
  // digest prints times in the local zone, so every machine renders them as UTC.
  Object.assign(env, { HOME: path.join(root, 'home'), BLACKBOARD_QUIET: '1', BLACKBOARD_PORT: String(PORT), TZ: 'UTC' });
  return spawnSync(process.execPath, [CLI, ...args], { cwd: root, env, encoding: 'utf8' });
}

function readLog(board) {
  try {
    return fs.readFileSync(path.join(board, '.blackboard', 'events.jsonl'), 'utf8').split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

/** Replace what a run cannot reproduce (temp paths, clock, generated ids, port) with placeholders. */
function normalize(value, root, key) {
  if (Array.isArray(value)) return value.map((v) => normalize(v, root, key));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, normalize(v, root, k)]));
  }
  if (typeof value === 'number') {
    if (TIME_KEYS.has(key) && value > FIXTURE_TIME_LIMIT) return '<now>';
    if (key === 'port' && value === PORT) return '<port>';
    return value;
  }
  if (typeof value !== 'string') return value;
  // lint wording is for people; only its place and type are contract.
  if (key === 'message') return '<human-text>';
  const id = RUNTIME_ID.exec(value);
  if (id) return `<${id[1]}-id>`;
  if (key === 'version' && value === PACKAGE_VERSION) return '<package-version>';
  if (/^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(value) && Date.parse(value) > FIXTURE_TIME_LIMIT) return '<now-iso>';
  // Paths under the temp root read the same on every platform.
  if (value.includes(root)) return value.replaceAll(root, '<root>').replaceAll('\\', '/');
  return value.replaceAll(`127.0.0.1:${PORT}`, '127.0.0.1:<port>');
}

/** Path and values of the first difference, so a CI log names the field that changed. */
function firstDiff(actual, expected, at = '') {
  if (Object.is(actual, expected)) return null;
  const isObject = (v) => v && typeof v === 'object';
  if (!isObject(actual) || !isObject(expected) || Array.isArray(actual) !== Array.isArray(expected)) {
    return `${at || '(root)'}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`;
  }
  for (const key of new Set([...Object.keys(expected), ...Object.keys(actual)])) {
    const sub = Array.isArray(actual) ? `${at}[${key}]` : `${at}.${key}`;
    if (!(key in actual)) return `${sub}: missing (expected ${JSON.stringify(expected[key])})`;
    if (!(key in expected)) return `${sub}: unexpected ${JSON.stringify(actual[key])}`;
    const diff = firstDiff(actual[key], expected[key], sub);
    if (diff) return diff;
  }
  return null;
}

/** Every file under `dir` with its contents, so a run's writes can be listed. */
function snapshot(dir, base = dir, files = {}) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return files; }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) snapshot(full, base, files);
    else files[path.relative(base, full).split(path.sep).join('/')] = fs.readFileSync(full, 'utf8');
  }
  return files;
}

/** Files the run created, changed or removed. */
function touched(before, after) {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((file) => before[file] !== after[file]).sort();
}

/** Run one case; the files it wrote under the project root are pushed onto `writes`. */
function runCase(t, spec, writes = []) {
  const dirs = prepare(t, spec.board);
  for (const args of spec.before || []) {
    const r = cli([...fill(args, dirs), '--json'], dirs);
    assert.equal(r.status, 0, `${args.join(' ')}\n${r.stderr}`);
  }
  const before = readLog(dirs.board).length;
  const files = snapshot(dirs.board);
  const args = [...spec.args, ...(spec.cwd === false ? [] : ['--cwd', '<board>']), '--json'];
  const r = cli(fill(args, dirs), dirs);
  writes.push(...touched(files, snapshot(dirs.board)));
  let output = null;
  if (r.stdout.trim()) {
    try {
      output = JSON.parse(r.stdout);
    } catch {
      assert.fail(`${spec.args.join(' ')} --json printed non-JSON:\n${r.stdout}`);
    }
  }
  const result = { board: spec.board, args, exitCode: r.status, output: normalize(output, dirs.root) };
  const appended = readLog(dirs.board).slice(before).map((line) => JSON.parse(line));
  if (appended.length) result.events = normalize(appended, dirs.root);
  return result;
}

test.before(async () => {
  PORT = await freePort();
});

for (const [command, cases] of Object.entries(CASES)) {
  test(`contract output: ${command}`, (t) => {
    const actual = { command, cases: cases.map((spec) => runCase(t, spec)) };
    const file = path.join(OUTPUTS, `${command}.json`);
    if (UPDATE) {
      fs.mkdirSync(OUTPUTS, { recursive: true });
      fs.writeFileSync(file, `${JSON.stringify(actual, null, 2)}\n`);
      return;
    }
    assert.ok(fs.existsSync(file), `missing baseline ${path.relative(REPO, file)}; run UPDATE_CONTRACT=1 npm test`);
    const expected = JSON.parse(fs.readFileSync(file, 'utf8'));
    const diff = firstDiff(actual, expected);
    assert.ok(!diff, `${command} --json output changed at ${diff}\nSee docs/CONTRACT.md before updating the baseline.`);
  });
}

test('contract output: runs are deterministic after normalization', (t) => {
  for (const spec of [CASES.status[0], CASES.context[1], CASES.node[0]]) {
    assert.deepEqual(runCase(t, spec), runCase(t, spec), spec.args.join(' '));
  }
});

/** Rows of the markdown table that follows `heading` in CONTRACT.md. */
function tableRows(doc, heading) {
  const start = doc.indexOf(heading);
  assert.ok(start >= 0, `CONTRACT.md lacks heading ${heading}`);
  const rows = [];
  for (const line of doc.slice(start + heading.length).split('\n')) {
    if (line.startsWith('#')) break;
    if (!line.startsWith('|')) { if (rows.length) break; continue; }
    const cells = line.slice(1, -1).split('|').map((c) => c.trim());
    if (cells.every((c) => /^-+$/.test(c))) continue;
    rows.push(cells);
  }
  return rows.slice(1);
}

function capabilities() {
  return JSON.parse(spawnSync(process.execPath, [CLI, 'capabilities', '--json'], { encoding: 'utf8' }).stdout);
}

/** The capabilities.outputs entry a case answers to; `activity show` has its own. */
const outputKey = (command, spec) => (command === 'activity' && spec.args[1] === 'show' ? 'activity show' : command);

test('contract output: every output matches the schema capabilities declares', () => {
  const { outputs } = capabilities();
  const answered = new Set();
  for (const [command, cases] of Object.entries(CASES)) {
    const baseline = JSON.parse(fs.readFileSync(path.join(OUTPUTS, `${command}.json`), 'utf8'));
    cases.forEach((spec, i) => {
      const { exitCode, output } = baseline.cases[i];
      if (exitCode !== 0) return;
      const key = outputKey(command, spec);
      const declared = outputs[key];
      answered.add(key);
      assert.ok(declared, `capabilities.outputs lacks ${key}`);
      if (declared.shape === 'array') {
        assert.ok(Array.isArray(output), `${spec.args.join(' ')} prints an array`);
        assert.match(declared.items, /^blackboard\.[a-z-]+\.v\d+$/);
      } else {
        assert.equal(declared.shape, 'object');
        assert.equal(output?.schema, declared.schema, `${spec.args.join(' ')} prints the schema capabilities declares`);
      }
    });
  }
  assert.deepEqual([...answered].sort(), Object.keys(outputs).sort(), 'every declared output has a case');
});

test('contract output: commands write only declared targets inside the project', (t) => {
  const declared = new Set(capabilities().writeTargets.map((target) => target.path));
  for (const [command, cases] of Object.entries(CASES)) {
    for (const spec of cases) {
      const writes = [];
      runCase(t, spec, writes);
      for (const file of writes) {
        assert.ok(declared.has(file), `${spec.args.join(' ')} (${command}) wrote ${file}, which capabilities.writeTargets does not declare`);
      }
    }
  }
});

const codeNames = (cell) => [...cell.matchAll(/`([^`]+)`/g)].map((m) => m[1]);

test('contract doc: command table matches baselines and capabilities', () => {
  const doc = fs.readFileSync(CONTRACT_DOC, 'utf8');
  const covered = tableRows(doc, '## 命令与固定输出');
  const uncovered = tableRows(doc, '## 不在 v1 固定输出内的命令');

  const files = fs.readdirSync(OUTPUTS).filter((f) => f.endsWith('.json')).sort();
  const docFiles = covered.map((cells) => codeNames(cells[2])[0]).sort();
  assert.deepEqual(docFiles, files.map((f) => `outputs/${f}`), 'every baseline file has exactly one table row');
  assert.deepEqual(files.map((f) => f.slice(0, -5)).sort(), Object.keys(CASES).sort(), 'every baseline has cases in this test');

  const named = [];
  for (const cells of covered) {
    const [command, ...aliases] = [...codeNames(cells[0]), ...codeNames(cells[1])];
    named.push(command, ...aliases);
    const used = new Set(CASES[command].map((spec) => spec.args[0]));
    for (const name of [command, ...aliases]) {
      assert.ok(used.has(name), `${name} (row ${command}) needs at least one case in ${command}.json`);
    }
  }
  for (const cells of uncovered) named.push(...codeNames(cells[0]));

  const { outputs } = capabilities();
  for (const cells of covered) {
    const command = codeNames(cells[0])[0];
    const declared = outputs[command];
    assert.equal(codeNames(cells[3])[0], declared.schema || declared.items, `${command} row names the schema capabilities declares`);
  }

  assert.deepEqual([...named].sort(), [...capabilities().commands].sort(),
    'every command in capabilities appears once in CONTRACT.md, covered or explicitly not covered');
});
