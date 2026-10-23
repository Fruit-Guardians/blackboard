import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { presentationMeta, presenters } from '../src/presentation.js';

function client() {
  let registration; let materialized = false;
  const code = fs.readFile(new URL('../client/index.js', import.meta.url), 'utf8');
  return code.then(source => {
    vm.runInNewContext(source, { window: { __ModuleLoader__: { load: entry => { registration = entry; } } } });
    assert.equal(materialized, false);
    assert.equal(registration.id, 'dsh-blackboard');
    return registration.factory(name => { assert.equal(name, 'react'); materialized = true; return { createElement: (type, props, ...children) => ({ type, props, children }), Fragment: 'fragment' }; });
  });
}
test('UI metadata is bounded, replayable and does not mutate canonical output', () => {
  const args = { type: 'finding', title: 'a'.repeat(1000) };
  const value = { boardRoot: '/project', agentId: 'dsh:a', data: { node: { id: 'f1', title: 'a'.repeat(1000) } }, diagnostics: '' };
  const original = JSON.stringify(value);
  const first = presentationMeta('blackboard_node_add', args, value);
  assert.equal(first.blackboard.summary.length, 320);
  assert.deepEqual(first, presentationMeta('blackboard_node_add', args, value));
  assert.equal(JSON.stringify(value), original);
  const content = [{ type: 'text', text: 'Original failure' }];
  assert.deepEqual(presenters('blackboard_node_add').presentResult({}, { content, isError: true }).content, content);
});
test('browser entry is a lazy factory and registers nine cards and package-owned configuration slots', async () => {
  const plugin = await client(), registered = [], effects = [];
  plugin.apply({ effect: factory => effects.push(factory()), locale: { register: () => () => {} }, slots: {
    inject: (_slot, factory) => factory(), register: (options, component) => registered.push({ options, component }),
  } });
  assert.equal(registered.filter(r => r.options.name === 'tool.call.toolview').length, 9);
  assert.ok(registered.some(r => r.options.key === 'dsh-blackboard#blackboard'));
  assert.ok(registered.some(r => r.options.key === 'dsh-blackboard'));
  assert.equal(effects.length, 1);
});
test('configuration submits only changed fields and clears optional runtime overrides via unset', async () => {
  const { initial, edits } = (await client()).test;
  const base = initial({ runtimeCli: '/release/current/bin/blackboard.js' });
  assert.equal(edits(base, base).length, 0);
  const result = edits({ ...base, runtimeCli: '', projects: [{ workspace: '/p', boardRoot: '' }] }, base);
  assert.equal(JSON.stringify(result), JSON.stringify([
    { op: 'set', path: ['projects'], value: [{ workspace: '/p' }] },
    { op: 'unset', path: ['runtimeCli'] },
  ]));
});
test('card parser rejects foreign, oversized, incomplete and malformed diagnosis metadata', async () => {
  const { cardMeta } = (await client()).test;
  const good = presentationMeta('blackboard_node_add', { title: '<script>not HTML</script>' }, { data: { node: { id: 'n1' } } });
  assert.equal(cardMeta({ meta: good }, 'blackboard_node_add').nodeId, 'n1');
  assert.equal(cardMeta({ meta: good }, 'blackboard_cursor'), null);
  assert.equal(cardMeta({ meta: { blackboard: { ...good.blackboard, summary: 2 } } }, 'blackboard_node_add'), null);
  const diagnosis = presentationMeta('blackboard_diagnose', {}, { readyToRead: false, readyToWrite: false, checks: [] });
  assert.ok(cardMeta({ meta: diagnosis }, 'blackboard_diagnose'));
  diagnosis.blackboard.checks = [null];
  assert.equal(cardMeta({ meta: diagnosis }, 'blackboard_diagnose'), null);
});
test('failed and old recorded calls retain raw content instead of showing success facts', async () => {
  const { ToolCard } = (await client()).test;
  const props = { toolName: 'blackboard_node_add', phase: 'result', t: key => key, block: { isError: true, content: [{ type: 'text', text: 'WRITE_POLICY denied' }] } };
  const tree = JSON.stringify(ToolCard(props));
  assert.match(tree, /WRITE_POLICY denied/); assert.match(tree, /failed/); assert.doesNotMatch(tree, /done/);
  assert.match(JSON.stringify(ToolCard({ ...props, block: { isError: false, content: [{ type: 'text', text: 'old result' }] } })), /old result/);
});
