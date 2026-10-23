import { selectScope } from './scope.js';

const remedies = {
  RUNTIME_MISSING: '独立安装 blackboard，或在插件配置页指定 current/bin/blackboard.js。',
  RUNTIME_VERSION: '切换到 blackboard 0.6.x，再检查 CLI 路径。',
  SESSION_REQUIRED: '在已选择项目的 DSH 会话中运行诊断。',
  WORKSPACE_MISSING: '确认会话原始工作区仍然存在。',
  NOT_ENABLED: '在插件配置页添加当前会话的项目工作区并保存。',
  AMBIGUOUS_PROJECT: '移除解析到同一真实目录的重复项目配置。',
  BOARD_NOT_INITIALIZED: '在确认的项目目录显式执行 blackboard init --json；诊断不会初始化。',
  POLICY_REQUIRED: '使用提供 sandboxPolicy 的 DSH profile；只读操作仍可使用。',
  WRITE_POLICY: '确认当前会话访问模式允许写入，且黑板位于允许的工作区内。',
  SPAWN_FAILED: '检查 Node 可执行路径是否存在且可执行。',
};

/** Observe runtime, Session binding and current policy without initializing or writing a board. */
export async function diagnose(config, bridge, exec, authorizeWrite) {
  const checks = [];
  const add = (id, code, message, status = 'ok') => checks.push({ id, status, code, message, remedy: status === 'ok' ? '' : (remedies[code] ?? '检查 CLI 诊断和插件配置，再重新运行只读诊断。') });
  const failure = (id, error) => {
    exec.signal?.throwIfAborted();
    if (['ABORTED', 'DISPOSED'].includes(error.code)) throw error;
    add(id, error.code ?? 'CHECK_FAILED', error.message, 'blocked');
  };
  let runtime, scope, readable = false, writable = false;
  try { runtime = await bridge.runtime(config); add('runtime', 'OK', `blackboard ${runtime.version}`); }
  catch (error) { failure('runtime', error); }
  try { scope = await selectScope(config, exec); add('project', 'OK', scope.boardRoot); }
  catch (error) { failure('project', error); }
  if (scope && runtime) {
    try {
      const result = await bridge.run(scope, ['status', '--json'], exec.signal, undefined, config);
      readable = true;
      add('read', 'OK', result.diagnostics || 'CLI 只读状态查询成功。');
    } catch (error) { failure('read', error); }
  }
  if (scope) {
    try {
      if (!authorizeWrite) throw Object.assign(new Error('Host write policy is not available.'), { code: 'POLICY_REQUIRED' });
      await authorizeWrite(scope, exec);
      writable = true;
      add('write-policy', 'OK', '当前宿主策略允许写入；诊断未执行写操作。');
    } catch (error) { failure('write-policy', error); }
  }
  return {
    schema: 'blackboard.diagnostics.v1', readOnly: true,
    runtimeCli: config.runtimeCli,
    sessionWorkspace: typeof exec.agent?.session?.header?.cwd === 'string' ? exec.agent.session.header.cwd : null,
    boardRoot: scope?.boardRoot ?? null, agentId: scope?.agentId ?? null,
    readyToRead: readable, readyToWrite: readable && writable, checks,
  };
}

export const diagnosticOutput = {
  type: 'object', additionalProperties: false,
  properties: {
    schema: { type: 'string', required: true }, readOnly: { type: 'boolean', required: true },
    runtimeCli: { type: 'string', required: true },
    sessionWorkspace: { type: 'json', required: true }, boardRoot: { type: 'json', required: true }, agentId: { type: 'json', required: true },
    readyToRead: { type: 'boolean', required: true }, readyToWrite: { type: 'boolean', required: true },
    checks: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: Object.fromEntries(['id', 'status', 'code', 'message', 'remedy'].map(key => [key, { type: 'string', required: true }])) } },
  },
};
