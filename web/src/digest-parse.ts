/**
 * Reads the digest Markdown (exactly what the Agent is given) back into parts the dialog can lay
 * out. Nothing is inferred: every line ends up somewhere, and anything unrecognised stays text.
 */
export type DigestStat = { label: string; value: number };
export type DigestItem = { text: string; children: string[] };
export type DigestSection = { title: string; items: DigestItem[]; notes: string[] };
export type DigestNode = { id: string; meta: string[]; title: string; location?: string };
export type DigestRelation = { from: string; relation: string; to: string };
export type ParsedDigest = { title: string; stats: DigestStat[]; sections: DigestSection[]; intro: string[]; footer: string };

const italic = (line: string) => /^_.*_$/.test(line) ? line.slice(1, -1) : null;

export function parseDigest(markdown: string): ParsedDigest {
  const lines = markdown.replace(/\r/g, '').split('\n');
  const result: ParsedDigest = { title: '', stats: [], sections: [], intro: [], footer: '' };
  // The closing italic line is the digest's own disclaimer, not part of the last section.
  let last = lines.length - 1;
  while (last >= 0 && !lines[last].trim()) last--;
  if (last >= 0 && italic(lines[last].trim()) !== null) {
    result.footer = italic(lines[last].trim())!;
    lines.length = last;
  }
  let section: DigestSection | null = null;
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) continue;
    if (line.startsWith('## ')) {
      section = { title: line.slice(3).trim(), items: [], notes: [] };
      result.sections.push(section);
      continue;
    }
    if (line.startsWith('# ')) { result.title = line.slice(2).trim(); continue; }
    if (!section) {
      const stats = line.split(' · ').map((part) => /^(.+?)\s+(\d+)$/.exec(part.trim()));
      if (stats.length > 1 && stats.every(Boolean)) result.stats = stats.map((m) => ({ label: m![1], value: Number(m![2]) }));
      else result.intro.push(italic(line.trim()) ?? line.trim());
      continue;
    }
    if (line.startsWith('- ')) { section.items.push({ text: line.slice(2), children: [] }); continue; }
    const nested = /^\s+(?:-\s+)?(.*)$/.exec(line);
    if (nested && section.items.length) { section.items[section.items.length - 1].children.push(nested[1]); continue; }
    section.notes.push(italic(line.trim()) ?? line.trim());
  }
  return result;
}

/** `[id] 类型 · 状态 · 可信度：标题 @path:line`, as written by the digest's nodeText. */
export function parseNodeLine(text: string): DigestNode | null {
  const m = /^\[([^\]\s]+)\]\s+([^：]+)：(.*)$/.exec(text.trim());
  if (!m) return null;
  const at = /\s@(\S+)$/.exec(m[3]);
  return {
    id: m[1],
    meta: m[2].split(' · ').map((part) => part.trim()).filter(Boolean),
    title: (at ? m[3].slice(0, at.index) : m[3]).trim(),
    ...(at ? { location: at[1] } : {}),
  };
}

/** `left --关系--> right`, where either side is a bare `[id]` or a full node line. */
export function parseRelationLine(text: string): DigestRelation | null {
  const m = /^(.+?)\s+--(.+?)-->\s+(.+)$/.exec(text.trim());
  return m ? { from: m[1], relation: m[2], to: m[3] } : null;
}

/** The id inside a side of a relation, a bare `[id]`, or a `[id] …` node line. */
export const leadingId = (text: string) => /^\[([^\]\s]+)\]/.exec(text.trim())?.[1] || null;

/** `[cp1] MM-DD HH:MM @node summary`, the node being optional. */
export function parseCheckpoint(text: string) {
  const m = /^\[([^\]\s]+)\]\s+(\d\d-\d\d \d\d:\d\d)(?:\s+@([\w:-]+))?\s+(.*)$/.exec(text.trim());
  return m ? { id: m[1], time: m[2], at: m[3] || null, summary: m[4] } : null;
}

/** A cursor trail: ids joined by arrows. */
export function parseTrail(text: string): string[] | null {
  const parts = text.split('→').map((part) => part.trim());
  return parts.length > 1 && parts.every((part) => /^[\w:-]+$/.test(part)) ? parts : null;
}

/** Splits text into plain runs, `[id]` references and `code` spans for inline rendering. */
export type Run = { kind: 'text' | 'ref' | 'code'; value: string };
export function inlineRuns(text: string): Run[] {
  const runs: Run[] = [];
  const re = /\[([A-Za-z][\w:-]*)\]|`([^`]+)`/g;
  let at = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > at) runs.push({ kind: 'text', value: text.slice(at, m.index) });
    runs.push(m[1] ? { kind: 'ref', value: m[1] } : { kind: 'code', value: m[2] });
    at = m.index + m[0].length;
  }
  if (at < text.length) runs.push({ kind: 'text', value: text.slice(at) });
  return runs;
}
