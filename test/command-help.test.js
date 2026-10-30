// Each command answers `--help` on its own: options, examples and output shape.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { COMMAND_FLAGS } from '../lib/cli/args.js';
import { commandHelp, commandHelpFor } from '../lib/cli/command-help.js';
import { OUTPUTS } from '../lib/contracts.js';

const CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'blackboard.js');
const COMMANDS = Object.keys(COMMAND_FLAGS).filter((key) => !key.startsWith('-'));

function cli(...args) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blackboard-help-'));
  try {
    const result = spawnSync(process.execPath, [CLI, ...args], { cwd: dir, encoding: 'utf8' });
    assert.deepEqual(fs.readdirSync(dir), [], `${args.join(' ')} created files`);
    return result;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('every command documents every option it accepts', () => {
  for (const command of COMMANDS) {
    assert.ok(commandHelpFor(command), `${command} has no help`);
    const help = commandHelp(command);
    assert.doesNotMatch(help, /undefined/, `${command} has an undescribed option`);
    for (const flag of COMMAND_FLAGS[command].split(' ').filter(Boolean)) {
      assert.ok(help.includes(`--${flag}`), `${command} help omits --${flag}`);
    }
  }
});

test('every contract output is named by its command help', () => {
  for (const [command, output] of Object.entries(OUTPUTS)) {
    if (!COMMANDS.includes(command)) continue;
    assert.ok(commandHelp(command).includes(output.schema || output.items), `${command} help omits its schema`);
  }
});

test('--help and help <command> agree, differ per command and leave the directory alone', () => {
  const batch = cli('batch', '--help');
  assert.equal(batch.status, 0);
  assert.equal(cli('help', 'batch').stdout, batch.stdout);
  assert.notEqual(cli('node', 'add', '--help').stdout, batch.stdout);
  assert.notEqual(cli('edit', '-h').stdout, batch.stdout);
  assert.equal(cli('goal', '--help').stdout, cli('node', '--help').stdout);
  assert.notEqual(cli('help').stdout, batch.stdout);
  assert.equal(cli('help', 'no-such-command').status, 1);
});
