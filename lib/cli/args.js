import { NODE_STATES, SEVERITIES, CONFIDENCE_LEVELS } from '../model.js';

const BOOLEAN_FLAGS = new Set([
  'json', 'open', 'write', 'all', 'open-only', 'quiet', 'enter', 'relate-here',
  'user', 'project', 'yes', 'with-activity', 'here', 'codex', 'no-hooks',
  'no-skill', 'no-serve', 'read-only', 'markdown', 'force', 'no-init', 'no-truncate', 'check',
]);
// Every write takes the same three: who is writing, which board, and whether a missing board may be created.
const WRITE_FLAGS = 'agent cwd no-init request-id';
const NODE_FLAGS = `detail tag status sev confidence at parent to enter relate-here rel kind label reason ${WRITE_FLAGS} no-truncate json`;
export const COMMAND_FLAGS = {
  init: 'title here cwd json',
  setup: 'target title port open no-hooks no-skill no-serve json',
  status: 'port agent cwd json',
  node: NODE_FLAGS, start: NODE_FLAGS, goal: NODE_FLAGS, intent: NODE_FLAGS,
  fact: NODE_FLAGS, vuln: NODE_FLAGS, hint: NODE_FLAGS,
  checkpoint: `summary title trigger write ${WRITE_FLAGS} no-truncate json`, compact: `summary title trigger write ${WRITE_FLAGS} no-truncate json`,
  cursor: `reason ${WRITE_FLAGS} json`, focus: `reason ${WRITE_FLAGS} json`, here: 'agent cwd json',
  activity: 'limit cwd json',
  promote: `kind type title detail to enter relate-here rel label reason ${WRITE_FLAGS} no-truncate json`,
  batch: `file check ${WRITE_FLAGS} no-truncate json`,
  done: `${WRITE_FLAGS} json`, block: `${WRITE_FLAGS} json`, revive: `${WRITE_FLAGS} json`,
  edit: `title detail status sev confidence tag ${WRITE_FLAGS} no-truncate json`,
  link: `rel kind label ${WRITE_FLAGS} no-truncate json`, unlink: `rel kind ${WRITE_FLAGS} json`,
  remove: `reason ${WRITE_FLAGS} json`, rm: `reason ${WRITE_FLAGS} json`,
  ls: 'type open open-only limit all cwd json', list: 'type open open-only limit all cwd json',
  show: 'cwd json', tree: 'depth cwd', tui: 'agent cwd', digest: 'agent write quiet cwd json',
  context: 'focus depth budget since limit agent markdown cwd json',
  lint: 'cwd json', tail: 'agent cwd json', serve: 'port open read-only cwd', stop: 'port cwd json',
  export: 'out format type status sev confidence tag rel related-to sort group-by max-nodes cwd json', reset: `yes ${WRITE_FLAGS} json`,
  search: 'type tag status sev confidence rel related-to group-by limit cwd json', history: 'cwd json', changes: 'since cwd json',
  backup: 'out cwd json', restore: 'into cwd json', receipt: 'cwd json', capabilities: 'cwd json',
  hooks: 'write user project with-activity cwd json',
  skill: 'codex user project cwd json', launcher: 'user project json',
  service: 'cwd json', release: 'force json', hook: '', help: '', version: '', '-v': '', '--version': '',
};

const usageError = (code, message, details = {}) => Object.assign(new Error(message), { code, ...details });

function editDistance(a, b) {
  let row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    row = next;
  }
  return row[b.length];
}

/** The accepted name a typo most likely meant, or null when nothing is close. */
export function closest(name, candidates) {
  const limit = name.length <= 2 ? 1 : Math.max(2, Math.floor(name.length / 3));
  let best = null;
  let bestScore = Infinity;
  for (const candidate of candidates) {
    const score = candidate.startsWith(name) ? 0 : editDistance(name, candidate);
    if (score <= limit && score < bestScore) { best = candidate; bestScore = score; }
  }
  return best;
}

export function parseArgs(argv, cmd = '') {
  const args = [];
  const flags = {};
  const allowed = new Set((COMMAND_FLAGS[cmd] || '').split(' ').filter(Boolean));
  const aliases = {
    '-d': cmd === 'tree' ? 'depth' : 'detail',
    '-t': ['ls', 'list'].includes(cmd) ? 'type' : 'tag',
    '-n': 'limit', '-o': 'out', n: 'limit', o: 'out', md: 'markdown',
    d: cmd === 'tree' ? 'depth' : 'detail',
    t: ['ls', 'list'].includes(cmd) ? 'type' : 'tag',
  };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--') { args.push(...argv.slice(i + 1)); break; }
    if (!token.startsWith('-') || token === '-') { args.push(token); continue; }
    const eq = token.indexOf('=');
    const spelling = eq < 0 ? token : token.slice(0, eq);
    const raw = spelling.startsWith('--') ? spelling.slice(2) : spelling;
    const key = aliases[raw] || raw;
    if (!allowed.has(key)) {
      const suggestion = closest(spelling, [...allowed].map((flag) => `--${flag}`));
      throw usageError('unknown_option', `未知选项 ${spelling}（命令 ${cmd}）；${suggestion ? `你可能想用 ${suggestion}` : `blackboard ${cmd} --help 查看可用选项`}`, suggestion ? { suggestion } : {});
    }
    let value;
    if (BOOLEAN_FLAGS.has(key)) {
      if (eq >= 0) throw usageError('invalid_value', `选项 ${spelling} 不接受值`);
      value = true;
    } else {
      value = eq >= 0 ? token.slice(eq + 1) : argv[++i];
      if (value === undefined || (eq < 0 && value.startsWith('-') && !/^-\d/.test(value))) {
        throw usageError('missing_value', `选项 ${spelling} 缺少值`);
      }
      if (!value.length) throw usageError('missing_value', `选项 ${spelling} 缺少值`);
    }
    if (flags[key] !== undefined) {
      if (key !== 'tag' && key !== 'to') throw usageError('invalid_usage', `选项 ${spelling} 不可重复`);
      flags[key] = [].concat(flags[key], value);
    } else flags[key] = value;
  }
  for (const pair of [['user', 'project'], ['rel', 'kind'], ['markdown', 'json'],
    ['to', 'parent'], ['to', 'relate-here'],
    ...(cmd === 'promote' ? [['kind', 'type']] : []),
    ...(['ls', 'list'].includes(cmd) ? [['all', 'limit']] : []),
    ...(['checkpoint', 'compact'].includes(cmd) ? [['summary', 'title']] : [])]) {
    if (pair.every((key) => flags[key] !== undefined)) throw usageError('conflicting_options', `选项 --${pair[0]} 与 --${pair[1]} 冲突`);
  }
  for (const [key, min, max] of [
    ['port', cmd === 'serve' ? 0 : 1, 65535],
    ['depth', 0, cmd === 'context' ? 5 : Number.MAX_SAFE_INTEGER],
    ['budget', 1, Number.MAX_SAFE_INTEGER], ['limit', 1, Number.MAX_SAFE_INTEGER],
    ['max-nodes', 1, Number.MAX_SAFE_INTEGER],
  ]) {
    if (flags[key] !== undefined && (!/^\d+$/.test(flags[key])
      || !Number.isSafeInteger(Number(flags[key])) || Number(flags[key]) < min || Number(flags[key]) > max)) {
      throw usageError('invalid_value', `--${key} 应为 ${min}–${max} 的整数，收到 ${flags[key]}`);
    }
  }
  for (const [key, values] of [['status', NODE_STATES], ['sev', SEVERITIES], ['confidence', CONFIDENCE_LEVELS]]) {
    if (flags[key] !== undefined && !values.includes(flags[key])) {
      const suggestion = closest(flags[key], values);
      throw usageError('invalid_value', `--${key} 只能是 ${values.join('|')}`, suggestion ? { suggestion } : {});
    }
  }
  if (cmd === 'setup' && flags.target && args.length) throw usageError('conflicting_options', '--target 与位置目录冲突');
  if (['skill', 'hooks'].includes(cmd) && args.length > 1) throw usageError('invalid_usage', `${cmd} 只接受一个子命令`);
  if (cmd === 'hooks' && args[0] === 'uninstall' && flags['with-activity']) {
    throw usageError('conflicting_options', '--with-activity 只用于 hooks install');
  }
  return { args, flags };
}

