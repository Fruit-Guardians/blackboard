#!/usr/bin/env node
// Generates skills/blackboard/methods/INDEX.md from each method's frontmatter.
// The kernel never reads methods/; this index is only for the Agent to browse.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
export const METHODS_DIR = path.join(ROOT, 'skills/blackboard/methods');
export const INDEX_FILE = 'INDEX.md';

function scalar(raw) {
  const value = raw.trim();
  return /^".*"$/.test(value) ? JSON.parse(value) : value;
}

/** Parses the small YAML subset method packages use: flat keys plus one `metadata` string map. */
export function parseFrontmatter(text, file = 'method') {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!match) throw new Error(`${file}: missing frontmatter`);
  const data = {};
  let map = null;
  for (const line of match[1].split('\n')) {
    if (!line.trim()) continue;
    const nested = /^ {2}([a-z][a-z0-9-]*):(?: (.*))?$/.exec(line);
    const top = /^([a-z][a-z0-9-]*):(?: (.*))?$/.exec(line);
    if (nested && map) map[nested[1]] = scalar(nested[2] ?? '');
    else if (top && top[1] === 'metadata' && !top[2]) map = data.metadata = {};
    else if (top) { map = null; data[top[1]] = scalar(top[2] ?? ''); }
    else throw new Error(`${file}: unsupported frontmatter line: ${line}`);
  }
  return { data, body: text.slice(match[0].length) };
}

export function relationsOf(method) {
  return (method.metadata?.relations || '').split(',').map((name) => name.trim()).filter(Boolean);
}

export function readMethods(dir = METHODS_DIR) {
  return fs.readdirSync(dir)
    .filter((name) => name.endsWith('.md') && name !== INDEX_FILE)
    .sort()
    .map((name) => {
      const { data, body } = parseFrontmatter(fs.readFileSync(path.join(dir, name), 'utf8'), name);
      return { file: name, ...data, body };
    });
}

const INVOCATION = { agent: '你自己判断有用时', user: '仅用户明确点名时' };

export function renderIndex(methods) {
  const rows = methods.map((m) => {
    const relations = relationsOf(m).map((name) => `\`${name}\``).join(' ') || '—';
    return `| [${m.name}](${m.file}) | ${m.metadata.version} | ${INVOCATION[m.metadata.invocation]} | ${m.description} | ${relations} |`;
  });
  return `<!-- 由 scripts/method-index.mjs 从各方法的 frontmatter 生成，不要手改。 -->
# 可选的记录方法

这里的每个方法都是一种可选的记录或思考角度，不是任务步骤。用不用、用哪个由你决定；一个都不用也是完整、正常的记录。blackboard 内核不认识这些方法：\`context\`、\`digest\`、\`lint\` 不会因为你用或不用而改变。

只读你选中的那一个。选用后可以给目标或相关节点加标签 \`method:<名称>@<版本>\`，例如 \`method:inquiry@1\`，让压缩后的你或接手者知道这些记录按哪种方式写、该重读哪份说明。读到不认识的关系名时，可以在下表“关系”一列查它出自哪个方法。

| 方法 | 版本 | 何时读 | 说明 | 关系 |
| --- | --- | --- | --- | --- |
${rows.join('\n')}
`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const target = path.join(METHODS_DIR, INDEX_FILE);
  const text = renderIndex(readMethods());
  if (process.argv[2] === '--check') {
    if (fs.readFileSync(target, 'utf8') !== text) {
      console.error(`${path.relative(ROOT, target)} 已过期：运行 node scripts/method-index.mjs`);
      process.exit(1);
    }
  } else {
    fs.writeFileSync(target, text);
    console.log(`已写入 ${path.relative(ROOT, target)}`);
  }
}
