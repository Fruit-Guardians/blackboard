import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const CLI = path.join(ROOT, 'bin/blackboard.js');
const SOURCE = path.join(ROOT, 'skills/blackboard');
const THREAT_MODEL = 'references/threat-model.md';

function files(dir, prefix = '') {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const relative = path.join(prefix, entry.name);
    return entry.isDirectory() ? files(path.join(dir, entry.name), relative) : [relative];
  }).sort();
}

function checkReferences(dir) {
  for (const relative of files(dir).filter((file) => file.endsWith('.md'))) {
    const file = path.join(dir, relative);
    const text = fs.readFileSync(file, 'utf8');
    for (const [, target] of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
      if (/^[a-z][a-z0-9+.-]*:|^#/i.test(target)) continue;
      const destination = path.resolve(path.dirname(file), target.split('#')[0]);
      const local = path.relative(dir, destination);
      assert.ok(local && !local.startsWith('..') && !path.isAbsolute(local), `${relative}: ${target} escapes the Skill package`);
      assert.ok(fs.statSync(destination).isFile(), `${relative}: ${target}`);
    }
  }
}

test('the optional threat-model reference is reachable inside the self-contained Skill package', () => {
  const entry = fs.readFileSync(path.join(SOURCE, 'SKILL.md'), 'utf8');
  const targets = [...entry.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)].map((match) => match[1]);
  assert.ok(targets.includes(THREAT_MODEL));
  assert.ok(fs.statSync(path.join(SOURCE, THREAT_MODEL)).isFile());
  checkReferences(SOURCE);
});

for (const agent of ['claude', 'codex']) {
  for (const scope of ['project', 'user']) {
    test(`${agent}/${scope} installs the complete optional reference without initializing a board or hooks`, (t) => {
      const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'blackboard skill package '));
      t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
      const project = path.join(temp, 'project');
      const home = path.join(temp, 'home');
      fs.mkdirSync(project); fs.mkdirSync(home);
      const base = scope === 'user' ? home : project;
      const destination = path.join(base, agent === 'codex' ? '.agents' : '.claude', 'skills', 'blackboard');
      fs.mkdirSync(destination, { recursive: true });
      fs.writeFileSync(path.join(destination, 'personal-note.md'), 'keep my note\n');
      const env = { PATH: process.env.PATH, HOME: home, TMPDIR: os.tmpdir(), BLACKBOARD_CWD: project };
      const result = spawnSync(process.execPath, [CLI, 'skill', 'install', `--${scope}`, ...(agent === 'codex' ? ['--codex'] : [])], {
        cwd: project, env, encoding: 'utf8', timeout: 10000,
      });
      assert.equal(result.status, 0, result.stderr);
      for (const relative of files(SOURCE)) {
        const original = fs.readFileSync(path.join(SOURCE, relative));
        const expected = relative.endsWith('.md')
          ? Buffer.from(original.toString().replaceAll('__BLACKBOARD_CLI__', CLI)) : original;
        assert.deepEqual(fs.readFileSync(path.join(destination, relative)), expected, relative);
      }
      assert.equal(fs.readFileSync(path.join(destination, 'personal-note.md'), 'utf8'), 'keep my note\n');
      checkReferences(destination);
      for (const dir of [home, project]) {
        for (const relative of ['.blackboard', '.claude/settings.json', '.claude/settings.local.json', '.local']) {
          assert.equal(fs.existsSync(path.join(dir, relative)), false, relative);
        }
      }
    });
  }
}
