// Batch input: JSON Lines of node/link/edit records. Parsing is strict so a
// misspelled field fails loudly instead of silently dropping what it held.
import { defaultAgentId } from './store.js';

export const BATCH_LIMITS = { batchMaxOps: 500, batchMaxBytes: 4 * 1024 * 1024 };

const REF = /^[A-Za-z0-9_-]{1,64}$/;
const FIELDS = {
  node: {
    required: ['type', 'title'],
    text: ['type', 'title', 'detail', 'at', 'status', 'severity', 'confidence', 'rel', 'label', 'ref', 'agent'],
    lists: ['tags', 'to'],
  },
  link: { required: ['from', 'to'], text: ['from', 'to', 'rel', 'label', 'agent'], lists: [] },
  edit: {
    required: ['id'],
    text: ['id', 'title', 'detail', 'status', 'severity', 'confidence', 'agent'],
    lists: ['tags'],
    changes: ['title', 'detail', 'status', 'severity', 'confidence', 'tags'],
  },
};

const lineError = (line, message) => Object.assign(new Error(message), { line });

/** Parse JSONL into ordered records; every reference to `$name` must point at an earlier `ref`. */
export function parseBatch(text, limits = BATCH_LIMITS) {
  if (Buffer.byteLength(text, 'utf8') > limits.batchMaxBytes) {
    throw new Error(`batch input exceeds ${limits.batchMaxBytes} bytes; split it into several batches`);
  }
  const records = [];
  const refs = new Set();
  const lines = text.split('\n');
  for (let index = 0; index < lines.length; index++) {
    const line = index + 1;
    if (!lines[index].trim()) continue;
    if (records.length === limits.batchMaxOps) {
      throw new Error(`batch exceeds ${limits.batchMaxOps} records; split it into several batches`);
    }
    let value;
    try { value = JSON.parse(lines[index]); } catch { throw lineError(line, 'invalid JSON'); }
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw lineError(line, 'each line must be a JSON object');
    const { op, ...fields } = value;
    const spec = FIELDS[op];
    if (!spec) throw lineError(line, `unknown op: ${op} (batch supports node, link, edit)`);

    for (const key of Object.keys(fields)) {
      if (!spec.text.includes(key) && !spec.lists.includes(key)) throw lineError(line, `unknown field for ${op}: ${key}`);
    }
    for (const key of spec.text) {
      if (key in fields && typeof fields[key] !== 'string') throw lineError(line, `${key} must be a string`);
    }
    for (const key of spec.required) {
      if (typeof fields[key] !== 'string' || !fields[key].trim()) throw lineError(line, `${key} is required`);
    }
    if ('title' in fields && !fields.title.trim()) throw lineError(line, 'title cannot be empty');
    if ('agent' in fields && !fields.agent.trim()) throw lineError(line, 'agent cannot be empty');
    if ('tags' in fields && (!Array.isArray(fields.tags) || fields.tags.some((tag) => typeof tag !== 'string' || !tag))) {
      throw lineError(line, 'tags must be an array of non-empty strings');
    }
    if (op === 'node' && 'to' in fields) {
      const targets = [].concat(fields.to);
      if (!targets.length || targets.some((target) => typeof target !== 'string' || !target)) {
        throw lineError(line, 'to must be a node id or a non-empty array of node ids');
      }
    }
    if (op === 'edit' && !spec.changes.some((key) => key in fields)) {
      throw lineError(line, `edit needs at least one of ${spec.changes.join(', ')}`);
    }

    // `$name` is never a node id, so a local reference cannot be mistaken for one.
    const references = op === 'node' ? [].concat(fields.to ?? []) : op === 'link' ? [fields.from, fields.to] : [fields.id];
    for (const reference of references) {
      if (reference.startsWith('$') && !refs.has(reference.slice(1))) {
        throw lineError(line, `unknown batch reference ${reference}; declare it with ref on an earlier line`);
      }
    }
    if ('ref' in fields) {
      if (!REF.test(fields.ref)) throw lineError(line, `ref must match ${REF.source}`);
      if (refs.has(fields.ref)) throw lineError(line, `ref ${fields.ref} is already used in this batch`);
      refs.add(fields.ref);
    }
    if ('agent' in fields) fields.agent = defaultAgentId({ BLACKBOARD_AGENT: fields.agent });
    records.push({ line, op, ...fields });
  }
  if (!records.length) throw new Error('batch has no records');
  return records;
}
