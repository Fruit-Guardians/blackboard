export type BoardNode = {
  id: string;
  type: string;
  title: string;
  detail?: string;
  status?: string;
  severity?: string;
  confidence?: string;
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
  };
  nodes: Record<string, BoardNode> | BoardNode[];
  edges: Record<string, BoardEdge> | BoardEdge[];
  cursors?: Record<string, Cursor>;
  cursorTrail?: unknown[];
  activities?: Record<string, Activity> | Activity[];
  checkpoints?: Record<string, unknown>;
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
};

export type ViewMode = 'context' | 'logic' | 'all';

export const values = <T,>(input: Record<string, T> | T[] | undefined): T[] =>
  Array.isArray(input) ? input : Object.values(input || {});

