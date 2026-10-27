import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { INDEX_FILE, METHODS_DIR, parseFrontmatter, readMethods, relationsOf, renderIndex } from '../scripts/method-index.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const SKILL = path.join(ROOT, 'skills/blackboard/SKILL.md');
const SPEC_FIELDS = new Set(['name', 'description', 'license', 'compatibility', 'metadata', 'allowed-tools']);
// Wording that turns a recording method into a procedure the Agent must follow.
const PRESCRIPTIVE = /下一步(?:应当|应该|要|是)|必经|完成标准|必须先|应当先|第一步/;
const NO_STEPS = /不(?:规定|是)[^。；]{0,12}(?:步骤|顺序|流程)/;

const methods = readMethods();

test('there is at least one method and names are unique', () => {
  assert.ok(methods.length > 0);
  assert.equal(new Set(methods.map((m) => m.name)).size, methods.length);
});

for (const method of methods) {
  test(`${method.file}: frontmatter follows the Agent Skills format`, () => {
    for (const key of Object.keys(method).filter((k) => !['file', 'body'].includes(k))) {
      assert.ok(SPEC_FIELDS.has(key), `unknown field ${key}`);
    }
    assert.match(method.name, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    assert.ok(method.name.length <= 64);
    assert.equal(`${method.name}.md`, method.file);
    assert.ok(method.description.length >= 1 && method.description.length <= 1024);
    for (const value of Object.values(method.metadata)) assert.equal(typeof value, 'string');
    assert.match(method.metadata.version, /^\d+$/);
    assert.ok(['agent', 'user'].includes(method.metadata.invocation), 'invocation is agent or user');
  });

  test(`${method.file}: declared relations match the relations the text uses`, () => {
    const declared = relationsOf(method);
    for (const [, used] of method.body.matchAll(/--rel ([a-z][a-z0-9-]*)/g)) {
      assert.ok(declared.includes(used), `--rel ${used} is not declared in metadata.relations`);
    }
    for (const name of declared) {
      assert.ok(method.body.includes(`\`${name}\``) || method.body.includes(`--rel ${name}`), `${name} is declared but never mentioned`);
    }
  });

  test(`${method.file}: stays optional and does not prescribe steps`, () => {
    const text = `${method.description}\n${method.body}`;
    assert.ok(method.body.includes('可选'), 'the text says it is optional');
    assert.match(method.body, NO_STEPS, 'the text says it does not prescribe steps');
    assert.doesNotMatch(text, PRESCRIPTIVE);
  });
}

test('INDEX.md is generated from the current frontmatter', () => {
  assert.equal(fs.readFileSync(path.join(METHODS_DIR, INDEX_FILE), 'utf8'), renderIndex(methods));
});

test('the frontmatter parser rejects shapes it does not understand', () => {
  assert.throws(() => parseFrontmatter('# no frontmatter\n'), /missing frontmatter/);
  assert.throws(() => parseFrontmatter('---\nname: x\n- list\n---\n'), /unsupported/);
  assert.deepEqual(parseFrontmatter('---\nname: x\nmetadata:\n  version: "1"\n---\nbody').data,
    { name: 'x', metadata: { version: '1' } });
});

test('SKILL.md links the index and only user-invoked methods directly', () => {
  const targets = [...fs.readFileSync(SKILL, 'utf8').matchAll(/\]\((methods\/[^)#]+)/g)].map((m) => m[1]);
  assert.ok(targets.includes(`methods/${INDEX_FILE}`));
  for (const target of targets.filter((t) => t !== `methods/${INDEX_FILE}`)) {
    const method = methods.find((m) => `methods/${m.file}` === target);
    assert.equal(method?.metadata.invocation, 'user', `${target} should be reached through the index`);
  }
});

test('the kernel does not read methods', () => {
  const sources = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? sources(file) : /\.[cm]?js$/.test(entry.name) ? [file] : [];
  });
  for (const file of [...sources(path.join(ROOT, 'bin')), ...sources(path.join(ROOT, 'lib'))]) {
    const text = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(text, /methods\//, path.relative(ROOT, file));
    for (const method of methods) assert.ok(!text.includes(`method:${method.name}`), path.relative(ROOT, file));
  }
});
