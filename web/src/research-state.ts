import type { BoardNode } from './types';

export type EditableField = 'title' | 'detail' | 'status' | 'severity' | 'confidence';
export type EditableFields = Partial<Record<EditableField, string>>;
export type EditDraft = { editing: boolean; fields: EditableFields; expected: EditableFields; conflict: boolean };
export const EMPTY_EDIT: EditDraft = { editing: false, fields: {}, expected: {}, conflict: false };

/** Capture a field's baseline once; unrelated SSE updates never enter the write. */
export function changeDraft(draft: EditDraft, node: BoardNode, key: EditableField, value: string): EditDraft {
  const fields = { ...draft.fields };
  const expected = { ...draft.expected };
  const baseline = expected[key] ?? String(node[key] ?? '');
  if (value === baseline) { delete fields[key]; delete expected[key]; }
  else { fields[key] = value; expected[key] = baseline; }
  return { ...draft, fields, expected };
}

/** Explicit direction for linking existing nodes, without creating a node or moving a cursor. */
export function existingLink(currentId: string, peerId: string, direction: 'outgoing' | 'incoming', kind = 'related-to') {
  if (!peerId || currentId === peerId) return null;
  return { from: direction === 'outgoing' ? currentId : peerId, to: direction === 'outgoing' ? peerId : currentId, kind };
}

/** Display/copy only. A stored source never becomes executable or an arbitrary file read. */
export function sourceLocation(node: BoardNode): string {
  if (typeof node.loc === 'string') return node.loc;
  if (node.loc && typeof node.loc === 'object' && 'path' in node.loc) {
    const loc = node.loc as { path?: unknown; line?: unknown; column?: unknown };
    if (typeof loc.path === 'string') return `${loc.path}${typeof loc.line === 'number' ? `:${loc.line}` : ''}${typeof loc.column === 'number' ? `:${loc.column}` : ''}`;
  }
  return '';
}

export function historyValue(value: unknown): string {
  if (value === null || value === undefined) return '∅';
  return typeof value === 'string' ? value || '""' : JSON.stringify(value);
}
