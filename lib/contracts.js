// The contract's machine-readable outputs, one entry per command (aliases share
// it). A top-level object carries its schema in band; an array keeps its shape
// and is described here only. capabilities --json publishes this table.
const object = (schema) => ({ shape: 'object', schema });
const array = (items) => ({ shape: 'array', items });
const NODE = 'blackboard.node.v2';
const EDGE = 'blackboard.edge.v1';
const ACTIVITY = 'blackboard.activity.v1';
export const OUTPUTS = {
  init: object('blackboard.init.v1'),
  status: object('blackboard.status.v2'),
  node: object('blackboard.node-add.v2'),
  checkpoint: object('blackboard.checkpoint.v1'),
  cursor: object('blackboard.cursor.v1'),
  here: object('blackboard.here.v2'),
  activity: array(ACTIVITY),
  'activity show': object(ACTIVITY),
  promote: object('blackboard.node-add.v2'),
  batch: object('blackboard.batch.v1'),
  done: object(NODE), block: object(NODE), revive: object(NODE), edit: object(NODE),
  link: object(EDGE), unlink: object(EDGE),
  remove: object('blackboard.remove.v1'),
  ls: array(NODE),
  show: object('blackboard.show.v2'),
  digest: object('blackboard.digest.v1'),
  context: object('blackboard.context.v2'),
  lint: object('blackboard.lint.v1'),
  tail: object('blackboard.tail.v1'),
  export: object('blackboard.export.v1'),
  reset: object('blackboard.reset.v1'),
  search: object('blackboard.search.v2'),
  history: object('blackboard.history.v2'),
  changes: object('blackboard.changes.v2'),
  backup: object('blackboard.backup-receipt.v1'),
  restore: object('blackboard.restore-receipt.v1'),
  receipt: object('blackboard.receipt.v1'),
  capabilities: object('blackboard.capabilities.v1'),
};

// Every file a command writes inside the project root, so an adapter can
// authorize exactly these. export, backup and restore also write the path the
// caller names; nothing else is written.
export const WRITE_TARGETS = [
  { path: '.blackboard/events.jsonl', role: 'log' },
  { path: '.blackboard/lock', role: 'lock' },
  { path: '.blackboard/state.json', role: 'cache' },
  { path: '.blackboard/state.json.tmp', role: 'cache-temp' },
  { path: '.blackboard/config.json', role: 'config' },
  { path: '.blackboard/.gitignore', role: 'gitignore' },
  { path: '.blackboard/digest.md', role: 'digest' },
];

export const GRAPH_SCHEMA = 'blackboard.graph.v2';

// Under --json a failure prints one blackboard.error.v1 line on stderr; stdout stays empty.
// A code is stable once listed; `error` covers everything not yet classified.
export const ERROR_SCHEMA = 'blackboard.error.v1';
export const ERROR_CODES = [
  'unknown_command', 'unknown_option', 'missing_value', 'invalid_value', 'conflicting_options',
  'invalid_usage', 'board_missing', 'not_found', 'ambiguous_ref', 'invalid_batch', 'input_too_long',
  'request_id_conflict', 'request_recovery_conflict', 'pending_request', 'error',
];
