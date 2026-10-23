// Read-only collection predicates shared by statistics and recovery projections.
// These predicates never fill in or mutate independent status/confidence fields.
const OPEN_STATUSES = new Set(['open', 'active', 'blocked']);
const RETIRED_INTERPRETATIONS = new Set(['dead', 'refuted', 'superseded']);
const THREAD_TYPES = new Set(['intent', 'hypothesis', 'question', 'action']);

export function isOpenThread(node) {
  return THREAD_TYPES.has(node.type) && OPEN_STATUSES.has(node.status || 'open');
}

export function isRetiredInterpretation(node) {
  return RETIRED_INTERPRETATIONS.has(node.status);
}

export function isCurrentFinding(node) {
  return ['finding', 'vuln'].includes(node.type) && !isRetiredInterpretation(node);
}

// Static confirmation remains a candidate for reproduction, as in the CLI's
// existing confidence contract. Missing confidence is never confirmation.
export function isExplicitlyConfirmed(node) {
  return ['reproduced', 'confirmed'].includes(node.confidence);
}

export function isConfirmedFact(node) {
  return ['fact', 'observation', 'result'].includes(node.type) &&
    !isRetiredInterpretation(node) &&
    (node.status === 'confirmed' ||
      ['static-confirmed', 'reproduced', 'confirmed'].includes(node.confidence));
}
