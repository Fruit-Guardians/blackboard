// Deterministic, read-only retrieval over the replayed graph. No filesystem reads,
// inferred evidence, embeddings, or changes to cursors/relations.
export function searchGraph(graph, { query = '', type, tags = [], status, relation, relatedTo, limit = 30 } = {}) {
  limit = Number(limit);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw new Error('search limit must be an integer from 1 to 1000');
  if (typeof query !== 'string') throw new Error('search query must be a string');
  const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  tags = [].concat(tags || []).map(String);
  // One disposable adjacency projection, rather than rescanning all edges for
  // each node. Nothing is persisted or made authoritative.
  const adjacent = new Map();
  for (const edge of Object.values(graph.edges || {})) {
    for (const id of [edge.from, edge.to]) {
      if (!adjacent.has(id)) adjacent.set(id, []);
      adjacent.get(id).push(edge);
    }
  }
  const items = [];
  for (const node of Object.values(graph.nodes || {})) {
    if (type && node.type !== type) continue;
    if (status && node.status !== status) continue;
    if (tags.some((tag) => !(node.tags || []).includes(tag))) continue;
    const linked = adjacent.get(node.id) || [];
    const relations = linked.filter((edge) => (!relation || edge.kind === relation) &&
      (!relatedTo || (edge.from === relatedTo && edge.to === node.id) || (edge.to === relatedTo && edge.from === node.id)));
    if ((relation || relatedTo) && !relations.length) continue;
    const fields = { id: node.id, type: node.type, title: node.title, detail: node.detail,
      status: node.status, confidence: node.confidence, severity: node.severity,
      tags: (node.tags || []).join(' '), 'loc.path': node.loc?.path, author: node.author,
    };
    const entries = Object.entries(fields).filter(([, value]) => typeof value === 'string' && value.length);
    if (!terms.every((term) => entries.some(([, value]) => value.toLowerCase().includes(term)))) continue;
    const matches = entries.filter(([, value]) => terms.some((term) => value.toLowerCase().includes(term)))
      .map(([field, value]) => ({ field, value }));
    items.push({ id: node.id, node, matches, relations });
  }
  items.sort((a, b) => ((b.node.updated || b.node.ts || 0) - (a.node.updated || a.node.ts || 0)) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { schema: 'blackboard.search.v1', readOnly: true, prescriptive: false, query, total: items.length, items: items.slice(0, limit), truncated: items.length > limit };
}
