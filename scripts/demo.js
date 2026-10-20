#!/usr/bin/env node
// Seed a blackboard demo in a fresh directory: `node scripts/demo.js [dir]`.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(HERE, '..', 'bin', 'blackboard.js');
const dir = path.resolve(process.argv[2] || path.join(HERE, '..', 'demo'));

if (fs.existsSync(path.join(dir, '.flow'))) fs.rmSync(path.join(dir, '.flow'), { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });

const flow = (...args) => execFileSync(process.execPath, [CLI, ...args], {
  cwd: dir,
  env: { ...process.env, BLACKBOARD_QUIET: '1' },
  encoding: 'utf8',
}).trim();

const add = (kind, title, ...args) => {
  const out = flow('node', 'add', kind, title, ...args, '--json');
  return JSON.parse(out).node.id;
};
const link = (from, to, relation) => flow('link', from, to, '--rel', relation);

flow('init', '--title', 'blackboard 演示 · Agent 外置黑板');
const start = add('start', '审计入口：内部管理后台', '--enter');
const goalAuth = add('goal', '确认管理 API 的匿名访问边界');
const goalTenant = add('goal', '确认导出链路的租户隔离');
link(start, goalAuth, 'related-to');
link(start, goalTenant, 'related-to');

const intentRoutes = add('intent', '枚举前端 bundle 中的 API 路由', '--status', 'done');
const obsBundle = add('observation', 'bundle 含 47 个 /api/v2/* 路径', '-d', '静态提取共得到 47 条唯一路由');
link(goalAuth, intentRoutes, 'derived-from');
link(intentRoutes, obsBundle, 'supports');

const hypothesisAuth = add('hypothesis', '管理读接口可能遗漏统一鉴权', '--enter', '--reason', '路由枚举后形成新猜测');
link(obsBundle, hypothesisAuth, 'supports');
const obsUsers = add('observation', 'GET /api/v2/admin/users 无 Cookie 返回 200', '-d', '响应包含 total=12043 和用户角色');
const obsWrite = add('observation', '写接口在匿名请求下返回 403', '-d', 'POST reset-password → 403');
link(obsUsers, hypothesisAuth, 'supports');
link(obsWrite, hypothesisAuth, 'supports');
const findingAuth = add('finding', '管理读接口匿名暴露全量用户列表', '--sev', 'critical', '--status', 'confirmed');
link(obsUsers, findingAuth, 'proves');
link(hypothesisAuth, findingAuth, 'refines');

const questionMiddleware = add('question', '读写路由是否挂载了不同的鉴权中间件');
link(hypothesisAuth, questionMiddleware, 'derived-from');
const hintMiddleware = add('hint', '优先比较 router.get 与 router.post 的中间件参数');
link(questionMiddleware, hintMiddleware, 'related-to');

flow('cursor', goalTenant, '--reason', '切换到租户隔离分支');
const actionExport = add('action', '使用低权限账号修改 export 请求中的 tenantId', '--enter');
link(goalTenant, actionExport, 'derived-from');
const obsExport = add('observation', '服务端接受任意 tenantId 并返回其他租户订单');
link(actionExport, obsExport, 'derived-from');
const findingExport = add('finding', '导出接口存在跨租户数据越权', '--sev', 'high', '--status', 'confirmed');
link(obsExport, findingExport, 'proves');

const hypothesisFiles = add('hypothesis', '异步导出文件可能存在可枚举下载路径');
link(obsExport, hypothesisFiles, 'derived-from');
const obsJob = add('observation', 'jobId 为递增整数，/exports/<jobId>.csv 无鉴权');
link(obsJob, hypothesisFiles, 'supports');
const findingFiles = add('finding', '导出文件下载无鉴权且可枚举', '--sev', 'high', '--status', 'confirmed');
link(obsJob, findingFiles, 'proves');

const questionUpload = add('question', '上传内容能否与导出链路形成组合利用', '--status', 'deferred');
link(findingExport, questionUpload, 'related-to');
link(findingFiles, questionUpload, 'related-to');
const obsSvg = add('observation', '上传接口接受同源可访问的脚本 SVG');
link(obsSvg, questionUpload, 'supports');
const counter = add('observation', '利用仍需要管理员访问，当前没有触发路径');
link(counter, questionUpload, 'contradicts');

flow('cursor', questionUpload, '--reason', '保留组合利用问题，等待后续条件');
flow('checkpoint', '--summary', '已确认三个发现；当前停在上传与导出链路的组合利用问题。');

console.log(`黑板演示已生成：${dir}`);
console.log(`查看：node ${CLI} serve --open  (cwd=${dir})`);
