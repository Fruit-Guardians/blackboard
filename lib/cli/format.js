import { TYPE_LABEL, CONFIDENCE_LABEL } from '../model.js';

export const C = process.stdout.isTTY
  ? {
      dim: (s) => `\x1b[2m${s}\x1b[0m`,
      bold: (s) => `\x1b[1m${s}\x1b[0m`,
      grn: (s) => `\x1b[32m${s}\x1b[0m`,
      blu: (s) => `\x1b[34m${s}\x1b[0m`,
      mag: (s) => `\x1b[35m${s}\x1b[0m`,
      red: (s) => `\x1b[31m${s}\x1b[0m`,
      yel: (s) => `\x1b[33m${s}\x1b[0m`,
      cyn: (s) => `\x1b[36m${s}\x1b[0m`,
      gry: (s) => `\x1b[90m${s}\x1b[0m`,
    }
  : new Proxy({}, { get: () => (s) => s });

const TYPE_COLOR = {
  start: C.gry,
  goal: C.grn,
  intent: C.blu,
  observation: C.yel,
  fact: C.yel,
  hypothesis: C.mag,
  question: C.cyn,
  action: C.blu,
  result: C.yel,
  finding: C.red,
  vuln: C.red,
  hint: C.mag,
  summary: C.cyn,
  note: C.gry,
  compact: C.cyn,
};

export function colorType(n) {
  return (TYPE_COLOR[n.type] || ((s) => s))(`${TYPE_LABEL[n.type] || n.type}`);
}

export function shortDetail(s, n = 100) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

export function nodeLine(n) {
  const st = n.status ? ` ${C.dim('[' + n.status + ']')}` : '';
  const sev = n.severity ? ` ${C.red(n.severity.toUpperCase())}` : '';
  const confidence = n.confidence ? ` ${C.dim(CONFIDENCE_LABEL[n.confidence] || n.confidence)}` : '';
  const loc = n.loc ? ` ${C.dim(`@${n.loc.path}${n.loc.line ? `:${n.loc.line}` : ''}`)}` : '';
  return `${C.dim(n.id.padEnd(5))} ${colorType(n).padEnd(8)}${st}${sev}${confidence} ${n.title}${loc}`;
}

export function activityLine(a) {
  const at = new Date(a.at || 0).toISOString().replace('T', ' ').slice(0, 19);
  return `${C.dim(a.id)} ${C.cyn(a.tool)} ${a.summary || ''} ${C.dim(at)}`;
}

