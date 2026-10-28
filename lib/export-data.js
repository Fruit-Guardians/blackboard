// A single read-only selection feeds every report renderer, without search's detail cap.
import { projectNode, SEVERITIES } from './model.js';
import { selectGraphItems, parseGroupBy, groupMatches } from './search.js';

const RANK = new Map(SEVERITIES.map((severity, index) => [severity, index]));
const byId = (a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

export function buildExportData(graph, {
  cwd = process.cwd(), version = '', sort = 'severity', groupBy = [], ...filters
} = {}) {
  if (!['severity', 'time', 'id'].includes(sort)) throw new Error('export sort must be severity, time or id');
  const dimensions = parseGroupBy(groupBy);
  const items = selectGraphItems(graph, filters);
  items.sort((a, b) => {
    if (sort === 'severity') {
      const difference = (RANK.get(a.node.severity) ?? SEVERITIES.length) - (RANK.get(b.node.severity) ?? SEVERITIES.length);
      if (difference) return difference;
    } else if (sort === 'time') {
      const difference = (b.node.updated || b.node.ts || 0) - (a.node.updated || a.node.ts || 0);
      if (difference) return difference;
    }
    return byId(a.node, b.node);
  });
  const nodes = items.map((item) => item.node);
  const selected = new Set(nodes.map((node) => node.id));
  const related = new Map();
  const edges = [];
  for (const edge of Object.values(graph.edges)) {
    if (!selected.has(edge.from) && !selected.has(edge.to)) continue;
    if (!graph.nodes[edge.from] || !graph.nodes[edge.to]) continue;
    edges.push(edge);
    for (const id of [edge.from, edge.to]) {
      if (!selected.has(id) && !related.has(id)) related.set(id, projectNode(graph.nodes[id]));
    }
  }
  edges.sort(byId);
  const groups = dimensions.length
    ? groupMatches(items, dimensions, { includeNodeIds: true }).map(({ values, nodeIds }) => ({ values, nodeIds }))
    : [{ values: {}, nodeIds: nodes.map((node) => node.id) }];
  return {
    title: graph.meta.title || 'blackboard', nodes,
    relatedNodes: [...related.values()].sort(byId), edges, groups,
    filters: Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== undefined && value !== '' && (!Array.isArray(value) || value.length))),
    cwd, version, integrity: { ...graph.integrity },
  };
}
