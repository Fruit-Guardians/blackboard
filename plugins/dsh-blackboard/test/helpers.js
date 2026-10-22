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

export async function fakeRuntime(root) {
  const runtime = path.join(root, 'runtime');
  await fs.mkdir(path.join(runtime, 'bin'), { recursive: true });
  await fs.writeFile(path.join(runtime, 'package.json'), JSON.stringify({ name: 'blackboard', version: '0.6.0' }));
  const cli = path.join(runtime, 'bin/blackboard.js');
  await fs.writeFile(cli, `
const args = process.argv.slice(2);
switch (args[0]) {
  case 'bad-json': process.stdout.write('not json'); break;
  case 'scalar': process.stdout.write('42'); break;
  case 'failure': process.stderr.write('fixture failure'); process.exitCode=7; break;
  case 'sleep': setTimeout(()=>console.log('{}'), 30000); break;
  case 'flood': process.stdout.write('x'.repeat(4096)); break;
  case 'warning': process.stderr.write('field truncated'); console.log('{}'); break;
  default: console.log(JSON.stringify({ args, cwd: process.cwd(), board: process.env.BLACKBOARD_CWD, agent: process.env.BLACKBOARD_AGENT }));
}
`);
  return cli;
}
