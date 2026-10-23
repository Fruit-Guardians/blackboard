import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertPackageLayout, filesBelow, verifyPackage } from '../scripts/verify-package.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));

test('release tarball installs without runtime/dev dependencies and runs outside the checkout', { timeout: 120000 }, () => {
  const result = verifyPackage({ source: root });
  assert.equal(result.result, 'PASS');
  assert.equal(result.node, process.version);
  assert.ok(result.skillFiles >= 3);
  assert.ok(result.checks.includes('read-only-event-integrity'));
  assert.ok(result.checks.includes('built-assets-resolve'));
});

test('package layout rejects missing assets and leaked plugin directories', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blackboard-layout-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const entries = {
    'package.json': JSON.stringify({ name: 'blackboard' }),
    'bin/blackboard.js': '', 'lib/model.js': '', 'lib/store.js': '',
    'skills/blackboard/SKILL.md': '', 'skills/blackboard/agents/openai.yaml': '',
    'README.md': '', 'public/assets/app.js': '', 'public/assets/app.css': '',
    'public/index.html': '<script src="/assets/app.js"></script><link href="/assets/app.css">',
  };
  for (const [name, text] of Object.entries(entries)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), text);
  }
  assert.equal(assertPackageLayout(dir).files.length, Object.keys(entries).length);
  fs.unlinkSync(path.join(dir, 'public/assets/app.js'));
  fs.writeFileSync(path.join(dir, 'public/assets/other.js'), '');
  assert.throws(() => assertPackageLayout(dir), /missing asset/);
  fs.writeFileSync(path.join(dir, 'public/assets/app.js'), '');
  fs.mkdirSync(path.join(dir, 'plugins'));
  fs.writeFileSync(path.join(dir, 'plugins/host.js'), '');
  assert.throws(() => assertPackageLayout(dir), /unexpected runtime package member/);
  assert.ok(filesBelow(dir).includes('plugins/host.js'));
});
