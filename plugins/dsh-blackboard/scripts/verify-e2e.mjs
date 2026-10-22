// Opt-in LIVE model test. No model/tool response mocks and no scripted plugin tool execution.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { normalizeConfig } from '../src/config.js';

const exec = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
const evidence = process.env.DSH_E2E_DIR
  ? path.resolve(process.env.DSH_E2E_DIR)
  : await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-blackboard-e2e-'));
await fs.mkdir(evidence, { recursive: true, mode: 0o700 });
const project = path.join(evidence, 'project');
const home = path.join(evidence, 'dsh-home');
const authHome = path.resolve(process.env.DSH_E2E_AUTH_HOME || process.env.DSH_HOME || path.join(os.homedir(), '.dsh'));
const modelPatch = path.resolve(process.env.DSH_E2E_MODEL_PATCH || path.join(authHome, 'profiles/headless/cordis.patch.yml'));
const authFile = path.join(authHome, '.env');
const runtimeCli = normalizeConfig({ runtimeCli: process.env.BLACKBOARD_TEST_CLI }).runtimeCli;
const dsh = process.env.DSH_BIN || 'dsh';
const profile = 'blackboard-live-e2e';
const nonce = `HANDOFF-${randomBytes(8).toString('hex')}`;
const marker = `E2E-${randomBytes(4).toString('hex')}`;
const hypothesis = `缓存可能掩盖旧值 ${marker}`;
const observation = `重启后读到相同值 ${marker}`;
const env = { ...process.env, DSH_HOME: home, BLACKBOARD_CWD: project, DSH_TELEMETRY_DISABLED: '1', DSH_TOOLS_MODE: 'native', DSH_PERMISSION_MODE: 'workspace-write' };
const hash = async (file) => createHash('sha256').update(await fs.readFile(file)).digest('hex');
const run = (command, args, cwd = project) => exec(command, args, { cwd, env, timeout: 300_000, maxBuffer: 8_388_608 });
const write = (name, value) => fs.writeFile(path.join(evidence, name), typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
const inspect = async (args) => JSON.parse((await run(process.execPath, [runtimeCli, ...args])).stdout);
const report = { mode: 'live-model-headless', evidence, marker, phases: [], checks: {}, exitCode: null };
let authBefore, modelBefore, installed = false;

async function modelRun(label, prompt, sessionId) {
  await write(`${label}.prompt.txt`, prompt);
  console.log(`LIVE_E2E: ${label} model turn starting`);
  const args = ['--profile', profile, '--patch', modelPatch, '--patch', path.join(evidence, 'e2e.patch.json'), '--json', ...(sessionId ? ['--session-id', sessionId] : []), prompt];
  let result;
  try { result = await run(dsh, args); }
  catch (error) {
    await write(`${label}.jsonl`, error.stdout || '');
    await write(`${label}.stderr.log`, error.stderr || error.message);
    throw error;
  }
  await write(`${label}.jsonl`, result.stdout);
  await write(`${label}.stderr.log`, result.stderr);
  const events = result.stdout.split('\n').filter((line) => line.trim()).map((line) => JSON.parse(line));
  const calls = events.filter((e) => e.type === 'tool_call');
  const results = events.filter((e) => e.type === 'tool_result');
  assert.ok(events.some((e) => e.type === 'final'), `${label}: missing final`);
  assert.equal(results.filter((e) => e.status !== 'completed').length, 0, `${label}: tool errors`);
  assert.ok(calls.some((e) => e.tool === 'blackboard_context'), `${label}: model did not read blackboard`);
  const session = events.find((e) => e.type === 'session')?.sessionId;
  assert.ok(session, `${label}: missing Session id`);
  if (sessionId) assert.equal(session, sessionId);
  const phase = {
    label, sessionId: session, exitCode: 0,
    toolCalls: calls.map(({ tool, input }) => ({ tool, input })),
    toolResults: results.map(({ status }) => status),
    usage: events.filter((e) => e.usage).map((e) => e.usage),
    final: events.findLast((e) => e.type === 'final').text,
  };
  assert.ok(phase.usage.length, `${label}: no real provider usage reported`);
  report.phases.push(phase);
  console.log(`LIVE_E2E: ${label} tools=${calls.map((e) => e.tool).join(',')} PASS`);
  return phase;
}

try {
  // Reuse existing model settings and an ephemeral .env symlink, never copy keys into evidence.
  authBefore = await hash(authFile);
  modelBefore = await hash(modelPatch);
  await fs.mkdir(project, { recursive: false });
  await fs.mkdir(home, { recursive: true });
  await fs.symlink(authFile, path.join(home, '.env'));
  await run('git', ['init', '-q']);
  await run(process.execPath, [runtimeCli, 'init', '--here', '--json']);
  await run(dsh, ['--profile', profile, '--from-default-profile', 'headless', '--dump-config']);
  const packed = JSON.parse((await run('npm', ['pack', '--json', '--pack-destination', evidence], root)).stdout)[0];
  const tarball = path.join(evidence, packed.filename);
  report.packageSha256 = await hash(tarball);
  await run(dsh, ['plugin', '--profile', profile, 'add', tarball, '--ignore-scripts', '--config.auto-install-peers=false']);
  installed = true;
  // Fixture-only observer limits tool surface and records route names. It never calls tools.
  const guard = path.join(evidence, 'guard.mjs');
  await fs.writeFile(guard, `
import fs from 'node:fs/promises';
export const name = 'live-e2e-observer';
export const inject = ['tools', 'agents', 'skills'];
export function apply(ctx, config) {
  ctx.on('agent/created', async ({ agent }) => {
    agent.ctx.tools.restrict({ allow: ['skill', ...ctx.tools.schemas().map(s => s.name).filter(n => n.startsWith('blackboard_'))] });
    const selected = await ctx.skills.get('blackboard', { cwd: agent.session.header.cwd });
    if (selected?.provider !== 'blackboard-runtime') throw new Error('E2E Skill did not come from the adapter provider');
  });
  ctx.on('agent/pre-step', async ({ step }, next) => {
    if (step > 20) throw new Error('E2E model-step ceiling reached');
    return next();
  });
  ctx.on('agent/request', async (_payload, next) => {
    const request = await next();
    await fs.appendFile(config.routeLog, JSON.stringify({ provider: request.provider, model: request.model }) + '\\n');
    return request;
  });
}
`, { mode: 0o600 });
  await write('e2e.patch.json', [
    { id: 'blackboard', config: { runtimeCli, projects: [{ workspace: project }] } },
    { id: 'skill-filesystem', disabled: true },
    { insert: [{ id: 'live-e2e-observer', name: guard, config: { routeLog: path.join(evidence, 'model-routes.jsonl') } }] },
  ]);
  const first = await modelRun('01-write', `这是隔离的 blackboard 端到端验收，不是开发任务。请先加载 blackboard Skill，再使用原生工具记录研究现场：创建一个 hypothesis，标题是“${hypothesis}”，可信度 suspected；创建一个 observation，标题是“${observation}”；明确建立 observation supports hypothesis 关系；显式将你的关注游标移动到 hypothesis；保存一个交接检查点，摘要含口令 ${nonce}；最后读取黑板上下文核对。只创建这两个节点，不使用 shell，不修改文件。最后简要报告实际节点、关系、游标和检查点 ID。`);
  assert.ok(first.toolCalls.some((e) => e.tool === 'skill'), 'model did not load Skill');
  for (const name of ['blackboard_node_add', 'blackboard_link', 'blackboard_cursor', 'blackboard_checkpoint']) assert.ok(first.toolCalls.some((e) => e.tool === name), `missing ${name}`);
  const packet = await inspect(['context', `--agent=dsh:${first.sessionId}`, '--budget=64000']);
  const eventsFile = path.join(project, '.blackboard/events.jsonl');
  const authored = (await fs.readFile(eventsFile, 'utf8')).trim().split('\n').map(JSON.parse);
  const nodes = authored.filter((e) => e.op === 'node').map((e) => e.node);
  assert.equal(nodes.length, 2);
  const h = nodes.find((n) => n.title === hypothesis), o = nodes.find((n) => n.title === observation);
  assert.ok(h && o); assert.equal(h.confidence, 'suspected');
  assert.equal(packet.currentFocus.id, h.id);
  assert.ok(packet.relations.some((e) => e.from === o.id && e.to === h.id && e.kind === 'supports'));
  assert.ok(packet.checkpoints.some((c) => c.summary.includes(nonce)));
  report.checks.persistedNodesEdgesCursorCheckpoint = true;
  await write('persisted-context.json', packet);
  const before = await hash(eventsFile);
  const resumed = await modelRun('02-resume', '请重新读取 blackboard 上下文恢复现场，不要只凭聊天历史回答。只读取，不创建记录或移动游标。返回当前节点标题、支持关系，以及检查点中保存的交接口令。', first.sessionId);
  assert.ok(resumed.final.includes(nonce), 'resumed model did not recover nonce');
  assert.equal(await hash(eventsFile), before);
  report.checks.sameSessionProcessRestart = true;
  const fresh = await modelRun('03-handoff', `你是新的接手者。请加载 blackboard Skill，从已有黑板恢复研究现场，只读取，不创建记录或移动任何游标。上一位参与者身份是 dsh:${first.sessionId}；必要时显式查询其上下文。请报告他的当前节点标题、支持关系和检查点中保存的交接口令。不要猜测或使用 shell。`);
  assert.notEqual(fresh.sessionId, first.sessionId);
  assert.ok(fresh.final.includes(nonce), 'new Session did not recover nonce from blackboard');
  assert.equal(await hash(eventsFile), before);
  report.checks.freshSessionHandoff = true;
  report.checks.recoveryLeavesEventHashUnchanged = true;
  report.eventsSha256 = before;
  report.modelRoutes = (await fs.readFile(path.join(evidence, 'model-routes.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
  assert.ok(report.modelRoutes.every((r) => r.provider && r.model));
  report.exitCode = 0;
  console.log('LIVE_E2E: natural-language Skill/tool selection, persisted graph, process resume, new-Session handoff and read-only event hash PASS');
} catch (error) {
  report.exitCode = 1;
  report.error = error.message;
  process.exitCode = 1;
  console.error(`LIVE_E2E: FAIL ${error.message}`);
} finally {
  if (installed) {
    try { await run(dsh, ['plugin', '--profile', profile, 'remove', 'dsh-blackboard']); report.pluginRemoved = true; }
    catch (error) { report.cleanupError = error.message; report.exitCode = 1; process.exitCode = 1; }
  }
  await fs.rm(path.join(home, '.env'), { force: true });
  if (authBefore) report.authSourceUnchanged = await hash(authFile) === authBefore;
  if (modelBefore) report.modelConfigUnchanged = await hash(modelPatch) === modelBefore;
  if (report.authSourceUnchanged === false || report.modelConfigUnchanged === false) {
    report.error = 'Existing authentication or model configuration changed during the run';
    report.exitCode = 1;
    process.exitCode = 1;
  }
  await write('REPORT.json', report);
  console.log(`LIVE_E2E: evidence=${evidence}`);
}
