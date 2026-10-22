// Use the real DSH metadata reader without importing or activating this plugin.
// Run under the desktop's ELECTRON_RUN_AS_NODE runtime, or an npm-installed DSH SDK.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(process.env.DSH_RUNTIME_MANIFEST || new URL('../package.json', import.meta.url));
const { readPluginMeta } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-app-boot')).href);
const fixture = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-blackboard-metadata-'));
const expected = {};
for (const language of ['en', 'zh']) {
  expected[language] = JSON.parse(await fs.readFile(path.join(root, 'locale', `${language}.json`), 'utf8')).meta;
}
const icon = await fs.readFile(path.join(root, 'assets/blackboard-icon.svg'));

async function probe(label, packageRoot) {
  const base = path.join(fixture, label);
  await fs.mkdir(path.join(base, 'node_modules'), { recursive: true });
  await fs.symlink(packageRoot, path.join(base, 'node_modules/dsh-blackboard'), 'dir');
  const meta = readPluginMeta('dsh-blackboard', pathToFileURL(path.join(base, 'entry.mjs')).href);
  assert.ok(meta, `${label}: missing display metadata`);
  assert.equal(meta.error, undefined, `${label}: ${meta.error}`);
  for (const language of ['en', 'zh']) {
    assert.equal(meta.title[language], expected[language].title);
    assert.equal(meta.description[language], expected[language].description);
  }
  assert.equal(meta.icon, `data:image/svg+xml;base64,${icon.toString('base64')}`);
  console.log(`DSH_METADATA_${label.toUpperCase()}: ${meta.title.zh}; en/zh description; SVG ${icon.length} bytes PASS`);
}

try {
  await probe('linked', root);
  const [packed] = JSON.parse(execFileSync('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', fixture], {
    cwd: root, encoding: 'utf8', timeout: 60_000, maxBuffer: 2_097_152,
  }));
  for (const resource of ['locale/en.json', 'locale/zh.json', 'assets/blackboard-icon.svg']) {
    assert.ok(packed.files.some(file => file.path === resource), `npm pack omitted ${resource}`);
  }
  const extracted = path.join(fixture, 'extracted');
  await fs.mkdir(extracted);
  execFileSync('tar', ['-xzf', path.join(fixture, packed.filename), '-C', extracted], { timeout: 10_000 });
  await probe('packed', path.join(extracted, 'package'));
  console.log('DSH_METADATA: linked source + npm tarball; zh/en title/description; SVG data URL; no diagnostics PASS');
} finally {
  await fs.rm(fixture, { recursive: true, force: true });
}
