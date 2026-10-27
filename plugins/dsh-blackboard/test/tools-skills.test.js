import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { normalizeConfig } from '../src/config.js';
import { toolSpecifications } from '../src/tools.js';
import { skillProvider } from '../src/skills.js';
import { mount } from '../src/plugin.js';
import { temporary, board, execution } from './helpers.js';

test('nine fixed tools expose no arbitrary project, shell, initialization or next-step selector', () => {
  const specs = toolSpecifications(normalizeConfig(), {});
  assert.equal(specs.length, 9);
  assert.equal(new Set(specs.map((s) => s.name)).size, 9);
  for (const s of specs) {
    for (const forbidden of ['cwd', 'boardRoot', 'command', 'shell']) assert.equal(s.parameters[forbidden], undefined);
    assert.ok(s.output.schema);
  }
});

test('user text stays positional, no implicit enter or relation, and writes are Session-bound', async (t) => {
  const root = await temporary(t), project = await board(root), calls = [];
  const config = normalizeConfig({ projects: [{ workspace: project }] });
  const bridge = { run: async (scope, argv) => { calls.push({ scope, argv }); return { data: { id: 'n1' } }; } };
  const specs = toolSpecifications(config, bridge), add = specs.find((s) => s.name === 'blackboard_node_add');
  await add.execute({ type: '--custom', title: '--enter', detail: '--json', tags: ['-tag'] }, execution(project));
  assert.deepEqual(calls[0].argv, ['node', `--cwd=${project}`, '--agent=dsh:session-a', '--no-init', '--json', '--detail=--json', '--tag=-tag', '--', 'add', '--custom', '--enter']);
  assert.equal(calls[0].scope.agentId, 'dsh:session-a');
  assert.equal(calls[0].argv.includes('--enter'), true); // title after --, not an option
  assert.equal(calls[0].argv.indexOf('--enter') > calls[0].argv.indexOf('--'), true);
});

test('reads bind the board explicitly; only writes add --no-init and reach write authorization with the runtime', async (t) => {
  const root = await temporary(t), project = await board(root), calls = [], authorized = [];
  const runtime = { capabilities: { writeTargets: [] } };
  const bridge = { run: async (scope, argv, _signal, beforeSpawn) => { await beforeSpawn?.(runtime); calls.push(argv); return { data: {} }; } };
  const specs = new Map(toolSpecifications(normalizeConfig({ projects: [{ workspace: project }] }), bridge,
    async (_scope, _exec, given) => { authorized.push(given); }).map((s) => [s.name, s]));
  const run = (name, args) => specs.get(`blackboard_${name}`).execute(args, execution(project));
  await run('status', {});
  await run('node_get', { id: 'n1' });
  await assert.rejects(run('context', { agentId: 'dsh:other' }), { code: 'CONTEXT_CONTRACT' });
  await run('cursor', { id: 'n1' });
  assert.deepEqual(calls, [
    ['status', `--cwd=${project}`, '--agent=dsh:session-a', '--json'],
    ['show', `--cwd=${project}`, '--json', '--', 'n1'],
    ['context', `--cwd=${project}`, '--agent=dsh:other'],
    ['cursor', `--cwd=${project}`, '--agent=dsh:session-a', '--no-init', '--json', '--', 'n1'],
  ]);
  assert.deepEqual(authorized, [runtime]);
});

test('reject invalid context and implicit next cursor selection', async (t) => {
  const root = await temporary(t), project = await board(root);
  const specs = toolSpecifications(normalizeConfig({ projects: [{ workspace: project }] }), { run: async () => ({ data: {} }) });
  const context = specs.find((s) => s.name === 'blackboard_context');
  await assert.rejects(context.execute({}, execution(project)), { code: 'CONTEXT_CONTRACT' });
  await assert.rejects(context.execute({ budget: 0 }, execution(project)), /budget/);
  await assert.rejects(specs.find((s) => s.name === 'blackboard_cursor').execute({ id: 'next' }, execution(project)), /explicit/);
  await assert.rejects(specs.find((s) => s.name === 'blackboard_node_patch').execute({ id: 'n1' }, execution(project)), /at least one/);
  await assert.rejects(specs.find((s) => s.name === 'blackboard_node_patch').execute({ id: 'n1', tags: [] }, execution(project)), /clearing tags/);
});

test('Skill provider reads upstream metadata and complete resource tree without writing files', async (t) => {
  const root = await temporary(t), skill = path.join(root, 'skills/blackboard');
  await fs.mkdir(path.join(skill, 'references'), { recursive: true });
  await fs.writeFile(path.join(skill, 'references/recording.md'), 'Original reference');
  await fs.writeFile(path.join(skill, 'SKILL.md'), '---\nname: blackboard\ndescription: "Upstream description"\n---\n# Original\nnode "__BLACKBOARD_CLI__"\n[record](references/recording.md)\n');
  const provider = skillProvider({ runtime: async () => ({ root, cli: '/release/current/bin/blackboard.js' }) }, 600);
  const [candidate] = await provider.list(), result = await provider.get(candidate);
  assert.equal(candidate.description, 'Upstream description');
  assert.equal(candidate.resourceBase.path, await fs.realpath(skill));
  assert.match(result.content, /\/release\/current\/bin\/blackboard\.js/);
  assert.ok(!result.content.includes('__BLACKBOARD_CLI__'));
  assert.equal(await fs.readFile(path.join(candidate.resourceBase.path, 'references/recording.md'), 'utf8'), 'Original reference');
  assert.match(await fs.readFile(path.join(skill, 'SKILL.md'), 'utf8'), /__BLACKBOARD_CLI__/);
  await assert.rejects(provider.get({ ...candidate, provider: 'other' }), /Invalid/);
});

test('mounting an unconfigured plugin only registers effects, tools and provider', async (t) => {
  const root = await temporary(t), tools = [], providers = [], cleanup = [];
  const ctx = { tools: { register: (spec) => tools.push(spec) }, skills: { registerProvider: (p) => providers.push(p) }, effect: (factory) => cleanup.push(factory()) };
  mount(ctx, {}, { defineTool: (spec) => spec, bundledSkillRank: 600 });
  assert.equal(tools.length, 9); assert.equal(providers.length, 1); assert.deepEqual(await fs.readdir(root), []);
  for (const dispose of cleanup) await dispose();
});
