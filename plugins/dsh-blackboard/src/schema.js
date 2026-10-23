import Schema from '@deepseek-ai/schemastery';
import { snapshotConfig } from './config.js';

const absolute = () => Schema.string().pattern(process.platform === 'win32'
  ? /^(?:[A-Za-z]:[\\/]|\\\\)[^\0]*$/ : /^\/[^\0]*$/);
const integer = (min, max, fallback) => Schema.number().step(1).min(min).max(max).default(fallback).volatile();

// One volatile array keeps project edits atomic; no volatile field is nested inside it.
export const Config = Schema.object({
  projects: Schema.array(Schema.object({
    workspace: absolute().required().description('项目工作区绝对路径'),
    boardRoot: absolute().description('黑板根目录；省略时使用工作区'),
  })).default([]).description('显式启用的项目；保存配置不会初始化黑板').volatile(),
  runtimeCli: absolute().description('blackboard current/bin/blackboard.js；省略时使用独立安装路径').volatile(),
  nodeExecutable: absolute().description('Node 可执行文件；省略时使用宿主运行时').volatile(),
  timeoutMs: integer(50, 120_000, 10_000).description('单次 CLI 超时（毫秒）'),
  maxOutputBytes: integer(1024, 16_777_216, 1_048_576).description('单次输出上限（字节）'),
});

// Add Host-only cross-field validation through Standard Schema, retaining a plain,
// serializable Schemastery tree. Callback/transform nodes cannot be rehydrated by
// DSH 0.2.1-rc.2's browser forms and would leave their values perpetually loading.
const standard = Config['~standard'];
Object.defineProperty(Config, '~standard', { value: {
  ...standard,
  validate(input) {
    const result = standard.validate(input);
    if (result.issues) return result;
    try { snapshotConfig(result.value); return result; }
    catch (error) { return { issues: [{ message: error.message }] }; }
  },
} });
