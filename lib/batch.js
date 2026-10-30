// Batch input: JSON Lines of node/link/edit records. Parsing is strict so a
// misspelled field fails loudly instead of silently dropping what it held.
import { closest } from './cli/args.js';
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

const lineError = (line, message, details = {}) => Object.assign(new Error(message), { code: 'invalid_batch', line, ...details });

/** Where a line stops being JSON. The parser's own message can quote the input, so only its offset is used. */
function invalidJson(line, text, error) {
  if (/end of JSON input/i.test(error.message)) {
    const column = text.length + 1;
    return lineError(line, `invalid JSON at column ${column}: the line ends before the record does`, { column });
  }
  const offset = /position (\d+)/.exec(error.message)?.[1];
  if (offset === undefined) return lineError(line, 'invalid JSON');
  const column = Number(offset) + 1;
  try {
    JSON.parse(text.slice(0, Number(offset)));
    return lineError(line, `invalid JSON at column ${column}: a second value follows the record; put each record on its own line`, { column });
  } catch {
    return lineError(line, `invalid JSON at column ${column}`, { column });
  }
}

export const batchTooLarge = (limits = BATCH_LIMITS) => Object.assign(new Error(`batch input exceeds ${limits.batchMaxBytes} bytes; split it into several batches`), { code: 'invalid_batch' });

/** Parse JSONL into ordered records; every reference to `$name` must point at an earlier `ref`. */
export function parseBatch(text, limits = BATCH_LIMITS) {
  if (Buffer.byteLength(text, 'utf8') > limits.batchMaxBytes) throw batchTooLarge(limits);
  const records = [];
  const refs = new Set();
  // Editors on Windows often save JSONL with a byte order mark, which JSON.parse rejects.
  const lines = text.replace(/^\uFEFF/, '').split('\n');
  for (let index = 0; index < lines.length; index++) {
    const line = index + 1;
    if (!lines[index].trim()) continue;
    if (records.length === limits.batchMaxOps) {
      throw Object.assign(new Error(`batch exceeds ${limits.batchMaxOps} records; split it into several batches`), { code: 'invalid_batch' });
    }
    let value;
    try { value = JSON.parse(lines[index]); } catch (error) { throw invalidJson(line, lines[index], error); }
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw lineError(line, 'each line must be a JSON object');
    const { op, ...fields } = value;
    const spec = Object.hasOwn(FIELDS, op) ? FIELDS[op] : null;
    if (!spec) throw lineError(line, `unknown op: ${op} (batch supports node, link, edit)`);

    for (const key of Object.keys(fields)) {
      if (!spec.text.includes(key) && !spec.lists.includes(key)) {
        const suggestion = closest(key, [...spec.text, ...spec.lists]);
        throw lineError(line, `unknown field for ${op}: ${key}${suggestion ? `; did you mean ${suggestion}?` : ''}`, suggestion ? { suggestion } : {});
      }
    }
    for (const key of spec.text) {
      if (key in fields && typeof fields[key] !== 'string') throw lineError(line, `${key} must be a string`);
    }
    for (const key of spec.required) {
      if (typeof fields[key] !== 'string' || !fields[key].trim()) throw lineError(line, `${key} is required`);
    }
    // An empty value is never a change: the CLI rejects it as a missing option value.
    for (const key of spec.text) {
      if (key in fields && !fields[key].trim()) throw lineError(line, `${key} cannot be empty`);
    }
    if ('tags' in fields && (!Array.isArray(fields.tags) || !fields.tags.length || fields.tags.some((tag) => typeof tag !== 'string' || !tag))) {
      throw lineError(line, 'tags must be a non-empty array of non-empty strings');
    }
    if (op === 'node' && ('rel' in fields || 'label' in fields) && !('to' in fields)) {
      throw lineError(line, 'rel and label describe the relation to to; pass to as well');
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
