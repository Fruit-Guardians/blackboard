import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export async function temporary(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-blackboard-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

export async function board(root, name = 'project') {
  const dir = path.join(root, name);
  await fs.mkdir(path.join(dir, '.blackboard'), { recursive: true });
  await fs.writeFile(path.join(dir, '.blackboard/events.jsonl'), '');
  return fs.realpath(dir);
}

export function execution(cwd, id = 'session-a', signal = new AbortController().signal) {
  return { agent: { id, session: { id, header: { cwd } } }, signal };
}

/** The parts of `capabilities --json` this adapter reads; tests vary them to stand for other releases. */
export function capabilities(overrides = {}) {
  const outputs = {
    status: 'blackboard.status.v2', context: 'blackboard.context.v2', show: 'blackboard.show.v2',
    node: 'blackboard.node-add.v2', edit: 'blackboard.node.v2', link: 'blackboard.edge.v1',
    cursor: 'blackboard.cursor.v1', checkpoint: 'blackboard.checkpoint.v1',
  };
  return {
    schema: 'blackboard.capabilities.v1', schemaVersion: 1, version: '9.9.9-fixture',
    commands: Object.keys(outputs),
    features: { writeAttribution: true, cwdFlag: true, noInit: true },
    outputs: Object.fromEntries(Object.entries(outputs).map(([command, schema]) => [command, { shape: 'object', schema }])),
    writeTargets: [
      { path: '.blackboard/events.jsonl', role: 'log' }, { path: '.blackboard/lock', role: 'lock' },
      { path: '.blackboard/state.json', role: 'cache' }, { path: '.blackboard/state.json.tmp', role: 'cache-temp' },
    ],
    ...overrides,
  };
}

export async function fakeRuntime(root, declared = capabilities()) {
  const runtime = path.join(root, 'runtime');
  await fs.mkdir(path.join(runtime, 'bin'), { recursive: true });
  await fs.writeFile(path.join(runtime, 'bin/capabilities.json'), JSON.stringify(declared));
  const cli = path.join(runtime, 'bin/blackboard.js');
  await fs.writeFile(cli, `
const args = process.argv.slice(2);
switch (args[0]) {
  case 'capabilities': process.stdout.write(require('fs').readFileSync(__dirname + '/capabilities.json', 'utf8')); break;
  case 'bad-json': process.stdout.write('not json'); break;
  case 'scalar': process.stdout.write('42'); break;
  case 'failure': process.stderr.write('fixture failure'); process.exitCode=7; break;
  case 'sleep': setTimeout(()=>console.log('{}'), 30000); break;
  case 'flood': process.stdout.write('x'.repeat(4096)); break;
  case 'warning': process.stderr.write('field truncated'); console.log('{}'); break;
  default: console.log(JSON.stringify({ args, cwd: process.cwd(), env: Object.fromEntries(Object.entries(process.env).filter(([k]) => k.startsWith('BLACKBOARD_'))) }));
}
`);
  return cli;
}
