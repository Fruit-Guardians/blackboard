import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Compile only the pure presenter, without requiring a DOM or a specific Node TS loader.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blackboard-presenter-'));
after(() => fs.rmSync(dir, { recursive: true, force: true }));
const root = fileURLToPath(new URL('../', import.meta.url));
execFileSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '--target', 'ES2022', '--module', 'ESNext', '--moduleResolution', 'Bundler', '--skipLibCheck', '--outDir', dir, path.join(root, 'web/src/presentation.ts')], { cwd: dir });
for (const file of fs.readdirSync(dir).filter((name) => name.endsWith('.js'))) {
  const p = path.join(dir, file);
  fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace(/from '(\.\/[^']+)'/g, (_all, name) => `from '${name}.js'`));
}
fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ type: 'module' }));
const modulePath = path.join(dir, 'presentation.js');
const { confidenceLabel, presentNode, matchesNode, statusLabel, severityLabel, typeLabel } = await import(pathToFileURL(modulePath).href);
const node = { id: 'node-7', type: 'hypothesis', title: 'Gateway policy。Verify middleware next.', detail: 'Session boundary', status: 'open', severity: 'high', confidence: 'static-confirmed' };

test('node presenter splits a heading from evidence without rewriting it', () => {
  assert.deepEqual(presentNode(node), { headline: 'Gateway policy', summary: 'Verify middleware next.', detail: 'Session boundary' });
});
test('node presenter preserves route names and decimal punctuation', () => {
  assert.equal(presentNode({ title: '4.1.8 branchEmpList.do uses a route' }).headline, '4.1.8 branchEmpList.do uses a route');
});
test('node presenter uses explicit detail when the title is one sentence', () => {
  assert.equal(presentNode({ title: 'A short finding', detail: 'Evidence' }).summary, 'Evidence');
});
test('node presenter handles multiline and blank authored titles', () => {
  assert.equal(presentNode({ title: 'Heading\nBody' }).summary, 'Body');
  assert.equal(presentNode({ title: '  ' }).headline, '未命名节点');
});
test('board search matches id, detail and localized type/confidence, case-insensitively', () => {
  for (const query of ['NODE-7', 'session boundary', '猜测', '待验证', '高危', '静态确认']) assert.equal(matchesNode(node, query), true, query);
});
test('board search applies all terms and rejects unrelated text', () => {
  assert.equal(matchesNode(node, 'gateway session'), true);
  assert.equal(matchesNode(node, 'gateway missing'), false);
  assert.equal(matchesNode(node, '   '), true);
});
test('unknown states and custom types keep their authored labels', () => {
  assert.equal(statusLabel('custom'), 'custom');
  assert.equal(typeLabel('decision'), 'decision');
  assert.equal(severityLabel('custom'), 'custom');
  assert.equal(confidenceLabel('custom'), 'custom');
});
test('missing states are represented explicitly instead of a false status', () => {
  assert.equal(statusLabel(), '未设置');
  assert.equal(severityLabel(), '未评估');
  assert.equal(confidenceLabel(), '未声明');
});
