import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';

const manifestURL = new URL('../package.json', import.meta.url);
const pkg = JSON.parse(await fs.readFile(manifestURL, 'utf8'));
const require = createRequire(manifestURL);

test('DSH display resources are exported without changing the runtime entry or plugin identity', () => {
  assert.equal(pkg.name, 'dsh-blackboard');
  assert.equal(pkg.exports['.'], './src/index.js');
  assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml');
  for (const resource of ['package.json', 'locale/en.json', 'locale/zh.json', 'icon']) {
    assert.ok(require.resolve(`${pkg.name}/${resource}`));
  }
  assert.equal(pkg.exports['./icon'], pkg.icon);
  assert.ok(pkg.files.includes('assets/'));
  assert.ok(pkg.files.includes('locale/'));
});

test('English and Chinese display metadata describe recovery rather than workflow control', async () => {
  const dictionaries = {};
  for (const language of ['en', 'zh']) {
    const dictionary = JSON.parse(await fs.readFile(new URL(`../locale/${language}.json`, import.meta.url), 'utf8'));
    assert.deepEqual(Object.keys(dictionary.meta).sort(), ['description', 'title']);
    for (const text of Object.values(dictionary.meta)) {
      assert.equal(typeof text, 'string');
      assert.ok(text.trim().length > 10);
      assert.notEqual(text, pkg.name);
    }
    dictionaries[language] = dictionary.meta;
  }
  assert.equal(dictionaries.zh.title, 'blackboard · 外置黑板');
  assert.match(dictionaries.zh.description, /跨会话恢复研究现场，不替你决定下一步/);
  assert.equal(dictionaries.en.title, 'blackboard · External Blackboard');
  assert.match(dictionaries.en.description, /without choosing your next step/);
});

test('brand icon is a small self-contained package asset and project links point to the main repository', async () => {
  const icon = await fs.readFile(new URL(`../${pkg.icon}`, import.meta.url), 'utf8');
  assert.ok(Buffer.byteLength(icon) <= 256 * 1024);
  assert.match(icon, /<svg\b/);
  assert.match(icon, /viewBox="0 0 512 512"/);
  assert.match(icon, /#090D0C/);
  assert.match(icon, /#66E0AE/);
  assert.doesNotMatch(icon, /<script\b|<foreignObject\b|(?:xlink:)?href\s*=|url\s*\(/i);
  assert.equal(pkg.repository.directory, 'plugins/dsh-blackboard');
  assert.equal(pkg.repository.url, 'git+https://github.com/Fruit-Guardians/blackboard.git');
  assert.equal(pkg.homepage, 'https://github.com/Fruit-Guardians/blackboard#readme');
  assert.equal(pkg.bugs.url, 'https://github.com/Fruit-Guardians/blackboard/issues');
});
