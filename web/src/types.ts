export type BoardNode = {
  id: string;
  type: string;
  title: string;
  detail?: string;
  inputTruncation?: Record<string, { originalLength: number; storedLength: number }> | null;
  status?: string | null;
  severity?: string | null;
  confidence?: string | null;
  ts?: number;
  updated?: number;
  session?: string;
  [key: string]: unknown;
};

export type BoardEdge = {
  id: string;
  from: string;
  to: string;
  kind: string;
  label?: string;
  inputTruncation?: Record<string, { originalLength: number; storedLength: number }> | null;
  ts?: number;
};

export type Activity = {
  id: string;
  tool?: string;
  summary?: string;
  status?: string;
  agentId?: string;
  at?: number;
  linkedNodeIds?: string[];
};

export type Cursor = {
  id: string;
  agentId: string;
  from?: string;
  to?: string;
  at?: number;
};

export type GraphSnapshot = {
  meta: {
    title?: string;
    focus?: string;
    count?: number;
    session?: string;
    /** Set by a server that accepts edits from the viewer. */
    writable?: boolean;
  };
  nodes: Record<string, BoardNode> | BoardNode[];
  edges: Record<string, BoardEdge> | BoardEdge[];
  cursors?: Record<string, Cursor>;
  cursorTrail?: unknown[];
  activities?: Record<string, Activity> | Activity[];
  checkpoints?: Record<string, { agentId?: string; [key: string]: unknown }>;
  stats?: {
    total?: number;
    edges?: number;
    activities?: number;
    checkpoints?: number;
    frontier?: number;
    confirmed?: number;
    candidates?: number;
    byType?: Record<string, number>;
    vulns?: Record<string, number>;
    confidence?: Record<string, number>;
  };
  digest?: string;
  digests?: Record<string, string>;
};

export type ViewMode = 'context' | 'logic' | 'all';

export const values = <T,>(input: Record<string, T> | T[] | undefined): T[] =>
  Array.isArray(input) ? input : Object.values(input || {});


export type FieldChange = { before: unknown; after: unknown };
export type HistoryEntry = {
  index: number;
  eventId?: string | null;
  op: string;
  at: number | null;
  by: string | null;
  reason: string | null;
  changes: Record<string, FieldChange>;
  edges: { added: BoardEdge[]; removed: BoardEdge[] };
};
export type HistoryIntegrity = { corruptLines: number; futureEvents: number; unknownOps: number; rejected: number };
export type NodeHistory = { nodeId: string; entries: HistoryEntry[]; integrity: HistoryIntegrity };
export type CheckpointChanges = {
  since: { id: string; at: number | null; index: number; summary: string };
  nodes: { added: BoardNode[]; updated: { id: string; before: BoardNode; after: BoardNode; fields: string[] }[]; removed: BoardNode[] };
  edges: { added: BoardEdge[]; removed: BoardEdge[] };
  events: { index: number; op: string; at: number | null; by: string | null; reason: string | null; nodes: CheckpointChanges['nodes']; edges: CheckpointChanges['edges'] }[];
  integrity: HistoryIntegrity;
};
