import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml');
assert.equal(pkg.engines.dsh, '0.2.1-rc.2');
assert.equal(pkg.dependencies, undefined, 'host SDK instances are peer dependencies');
assert.ok(!pkg.files.includes('test/'));
for (const dir of ['src', 'scripts', 'test']) {
  for (const name of await fs.readdir(path.join(root, dir))) {
    if (!/\.[cm]?js$/.test(name)) continue;
    execFileSync(process.execPath, ['--check', path.join(root, dir, name)], {
      env: { ...process.env, ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {}) },
    });
  }
}
for (const entry of [pkg.main, pkg.dsh.bundle.patch, 'README.md', 'LICENSE']) await fs.access(path.join(root, entry));
console.log('CHECK: syntax, bundle manifest, peer-only SDK boundary and package files PASS');
