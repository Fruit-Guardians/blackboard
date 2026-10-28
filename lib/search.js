// Deterministic, read-only retrieval over the replayed graph. No filesystem reads,
// inferred evidence, embeddings, or changes to cursors/relations.
export function searchGraph(graph, {
  query = '', type, tags = [], status, severity, confidence, relation, relatedTo,
  limit = 30, groupBy = [],
} = {}) {
  limit = Number(limit);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw new Error('search limit must be an integer from 1 to 1000');
  if (typeof query !== 'string') throw new Error('search query must be a string');
  if (typeof groupBy === 'string') groupBy = groupBy.split(',');
  if (!Array.isArray(groupBy) || groupBy.some((field) =>
    typeof field !== 'string' || (field !== 'severity' && field !== 'status' && !(field.startsWith('tag:') && field.length > 4))) ||
    new Set(groupBy).size !== groupBy.length) {
    throw new Error('group-by must name severity, status or tag:<key>, without empty or repeated fields');
  }
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
    if (severity && node.severity !== severity) continue;
    if (confidence && node.confidence !== confidence) continue;
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
  return {
    schema: 'blackboard.search.v1', readOnly: true, prescriptive: false, query,
    total: items.length, items: items.slice(0, limit), truncated: items.length > limit,
    ...(groupBy.length ? { groupBy, groups: groupMatches(items, groupBy) } : {}),
  };
}

function groupMatches(items, dimensions) {
  const groups = new Map();
  for (const { node } of items) {
    let combinations = [{}];
    for (const dimension of dimensions) {
      let values;
      if (dimension.startsWith('tag:')) {
        const prefix = `${dimension.slice(4)}=`;
        values = [...new Set((node.tags || [])
          .filter((tag) => tag.startsWith(prefix) && tag.length > prefix.length)
          .map((tag) => tag.slice(prefix.length)))];
        if (!values.length) values.push(null);
      } else values = [node[dimension] ?? null];
      combinations = combinations.flatMap((combination) =>
        values.map((value) => ({ ...combination, [dimension]: value })));
    }
    // A node contributes once per distinct value combination, including each
    // explicit site when it belongs to more than one. Missing values stay null.
    for (const values of combinations) {
      const key = JSON.stringify(values);
      const group = groups.get(key);
      if (group) group.count++;
      else groups.set(key, { values, count: 1 });
    }
  }
  return [...groups.values()].sort((a, b) => {
    for (const dimension of dimensions) {
      const av = a.values[dimension], bv = b.values[dimension];
      if (av === bv) continue;
      if (av === null) return 1;
      if (bv === null) return -1;
      return av < bv ? -1 : 1;
    }
    return 0;
  });
}
