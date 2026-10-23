// Request receipts are projections of events.jsonl, never an independent store.
import crypto from 'node:crypto';

export function validateRequestId(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || !value.length || value.length > 200 || value.trim() !== value || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error('requestId must be a non-empty string of at most 200 characters without surrounding whitespace or control characters');
  }
  return value;
}

function ordered(value) {
  if (Array.isArray(value)) return value.map(ordered);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, ordered(value[key])]));
  }
  return value;
}

export function requestFingerprint(command, payload) {
  // JSON's own representation is also the event format: omitted optional
  // properties and object key ordering must not change a retry's identity.
  const json = JSON.stringify({ command, payload });
  return crypto.createHash('sha256').update(JSON.stringify(ordered(JSON.parse(json)))).digest('hex');
}

export function withoutRequestId(input) {
  const { requestId: _requestId, ...rest } = input || {};
  return rest;
}

/** Read-only receipt projection, including an interrupted complete-line prefix. */
export function projectReceipts(events) {
  const requests = new Map();
  const eventIds = new Set(events.map((ev) => ev.eventId).filter(Boolean));
  const markers = new Set();
  for (let index = 0; index < events.length; index++) {
    const ev = events[index];
    if (ev.op === 'receipt') markers.add(JSON.stringify([ev.requestId, ev.command, ev.fingerprint]));
    const request = ev.request;
    if (!request?.requestId || !Array.isArray(request.events)) continue;
    if (requests.has(request.requestId)) continue;
    requests.set(request.requestId, { ...request, firstIndex: index });
  }
  const out = new Map();
  for (const request of requests.values()) {
    const ids = request.events.map((ev) => ev.eventId);
    const marker = markers.has(JSON.stringify([request.requestId, request.command, request.fingerprint]));
    const committedEventIds = ids.filter((id) => eventIds.has(id));
    const status = marker && committedEventIds.length === ids.length ? 'committed' : 'pending';
    // A current writer stops at a pending command. If an older writer ignored
    // its metadata and appended other actions, don't replay a stale cursor or
    // patch over those actions when recovering the prefix.
    const plannedIds = new Set(ids);
    const interference = status === 'pending' && events.slice(request.firstIndex + 1).some((ev) =>
      !plannedIds.has(ev.eventId) && !(ev.op === 'receipt' && ev.requestId === request.requestId));
    out.set(request.requestId, {
      requestId: request.requestId, command: request.command, fingerprint: request.fingerprint,
      status, result: request.result, eventIds: ids, committedEventIds, at: request.at,
      ...(status === 'pending' ? { recoverable: !interference } : {}),
      // Internal recovery plan is deliberately not exposed by getReceipt.
      _events: request.events,
    });
  }
  return out;
}
