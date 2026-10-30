// The CLI's first reader is an Agent: JSON costs no more than it must, and a
// failure says what went wrong in fields, without parsing prose.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { closest } from '../lib/cli/args.js';
import { ERROR_CODES, ERROR_SCHEMA } from '../lib/contracts.js';
import { ensure } from '../lib/store.js';

const CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'blackboard.js');

function tempDir(t) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'blackboard-agent-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function cli(dir, args, input) {
  const env = { ...process.env, BLACKBOARD_QUIET: '1' };
  for (const key of Object.keys(env)) if (key.startsWith('BLACKBOARD_') && key !== 'BLACKBOARD_QUIET') delete env[key];
  return spawnSync(process.execPath, [CLI, ...args], { cwd: dir, env, input, encoding: 'utf8' });
}

function seeded(t) {
  const dir = tempDir(t);
  ensure(dir);
  assert.equal(cli(dir, ['goal', 'Audit synthetic-lib']).status, 0);
  assert.equal(cli(dir, ['fact', 'First']).status, 0);
  assert.equal(cli(dir, ['fact', 'Second']).status, 0);
  return dir;
}

/** Failure contract: exit 1, nothing on stdout, one parseable error line on stderr. */
function failure(dir, args, input) {
  const result = cli(dir, args, input);
  assert.equal(result.status, 1, args.join(' '));
  assert.equal(result.stdout, '', args.join(' '));
  assert.equal(result.stderr.trim().split('\n').length, 1, result.stderr);
  const error = JSON.parse(result.stderr);
  assert.equal(error.schema, ERROR_SCHEMA);
  assert.ok(ERROR_CODES.includes(error.code), error.code);
  assert.ok(error.message);
  return error;
}

test('--json prints one line, the size the context budget was measured on', (t) => {
  const dir = seeded(t);
  for (const args of [['status', '--json'], ['ls', '--json'], ['context'], ['fact', 'x', '--json']]) {
    const { stdout } = cli(dir, args);
    assert.equal(stdout.trimEnd().split('\n').length, 1, args.join(' '));
    assert.equal(stdout.trimEnd(), JSON.stringify(JSON.parse(stdout)));
  }
  const packet = JSON.parse(cli(dir, ['context', '--budget', '300']).stdout);
  assert.ok(packet.estimatedTokens <= 300);
});

test('failures carry stable codes and the data to act on', (t) => {
  const dir = seeded(t);
  const empty = tempDir(t);
  const cases = [
    [dir, ['serach', 'x', '--json'], { code: 'unknown_command', suggestion: 'search' }],
    [dir, ['help', 'serach', '--json'], { code: 'unknown_option' }],
    [dir, ['ls', '--typ', 'fact', '--json'], { code: 'unknown_option', suggestion: '--type' }],
    [dir, ['node', 'add', 'note', 'x', '--confidance', 'suspected', '--json'], { code: 'unknown_option', suggestion: '--confidence' }],
    [dir, ['edit', 'g1', '--status', '--json'], { code: 'missing_value' }],
    [dir, ['edit', 'g1', '--status', 'opn', '--json'], { code: 'invalid_value', suggestion: 'open' }],
    [dir, ['ls', '--all', '--limit', '2', '--json'], { code: 'conflicting_options' }],
    [dir, ['show', 'nope', '--json'], { code: 'not_found' }],
    [dir, ['show', 'f', '--json'], { code: 'ambiguous_ref', candidates: ['f1', 'f2'] }],
    [dir, ['batch', '--json'], { code: 'invalid_usage' }],
    [empty, ['status', '--json'], { code: 'board_missing', cwd: empty }],
    [empty, ['goal', 'x', '--no-init', '--json'], { code: 'board_missing', cwd: empty }],
  ];
  for (const [cwd, args, expected] of cases) {
    const error = failure(cwd, args);
    for (const [key, value] of Object.entries(expected)) assert.deepEqual(error[key], value, args.join(' '));
  }
  assert.deepEqual(fs.readdirSync(empty), []);
});

test('batch failures point at the line and column', (t) => {
  const dir = seeded(t);
  const first = '{"op":"node","type":"note","title":"a"}';
  const glued = failure(dir, ['batch', '--request-id', 'a', '--json'], `${first}${first}\n`);
  assert.deepEqual([glued.code, glued.line, glued.column], ['invalid_batch', 1, first.length + 1]);

  const typo = failure(dir, ['batch', '--check', '--json'], `${first}\n{"op":"node","type":"note","title":"b","severty":"high"}\n`);
  assert.deepEqual([typo.code, typo.line, typo.suggestion], ['invalid_batch', 2, 'severity']);

  const dangling = failure(dir, ['batch', '--check', '--json'], '{"op":"link","from":"nope","to":"g1"}\n');
  assert.deepEqual([dangling.code, dangling.line], ['not_found', 1]);
});

test('a reused request id reports its conflict by code', (t) => {
  const dir = seeded(t);
  assert.equal(cli(dir, ['fact', 'one', '--request-id', 'dup', '--json']).status, 0);
  assert.equal(failure(dir, ['fact', 'other', '--request-id', 'dup', '--json']).code, 'request_id_conflict');
});

test('context reports failures as JSON because its output is, unless Markdown was asked for', (t) => {
  const dir = seeded(t);
  assert.equal(failure(dir, ['context', '--focus', 'nope']).schema, ERROR_SCHEMA);
  const markdown = cli(dir, ['context', '--markdown', '--depth', '9']);
  assert.equal(markdown.status, 1);
  assert.throws(() => JSON.parse(markdown.stderr));
});

test('without --json a failure stays one readable sentence', (t) => {
  const dir = seeded(t);
  const result = cli(dir, ['ls', '--typ', 'fact']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /^blackboard: .*--type/);
});

test('batch maps its local names to the ids they became', (t) => {
  const dir = seeded(t);
  const input = '{"op":"node","ref":"h","type":"hypothesis","title":"H"}\n{"op":"node","ref":"o","type":"observation","title":"O","to":"$h","rel":"supports"}\n{"op":"node","type":"note","title":"unnamed"}\n';
  const checked = JSON.parse(cli(dir, ['batch', '--check', '--json'], input).stdout);
  const written = JSON.parse(cli(dir, ['batch', '--request-id', 'refs', '--json'], input).stdout);
  assert.deepEqual(written.refs, { h: written.results[0].node.id, o: written.results[1].node.id });
  assert.deepEqual(checked.refs, written.refs);
});

test('capabilities publish how failures look', () => {
  const caps = JSON.parse(spawnSync(process.execPath, [CLI, 'capabilities', '--json'], { encoding: 'utf8' }).stdout);
  assert.equal(caps.features.jsonErrors, true);
  assert.deepEqual(caps.errors, { stream: 'stderr', schema: ERROR_SCHEMA, codes: ERROR_CODES });
});

test('typo suggestions stay close to what was typed', () => {
  assert.equal(closest('--typ', ['--type', '--limit']), '--type');
  assert.equal(closest('serach', ['search', 'show']), 'search');
  assert.equal(closest('--zzzzzzzz', ['--type', '--limit']), null);
  assert.equal(closest('x', ['status']), null);
});
