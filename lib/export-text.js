// Pure text projections of the selected graph. Authored text never supplies markup.

function text(value) {
  if (typeof value === 'string') return value;
  return JSON.stringify(value) ?? String(value);
}

// Entities are decoded as text after Markdown syntax has been parsed. Encoding
// punctuation also prevents authored links, headings and emphasis becoming markup.
function markdownText(value) {
  return text(value).replace(/[^\p{L}\p{N} ]/gu, (char) => `&#${char.codePointAt(0)};`);
}

function recorded(value) {
  return value == null ? 'unset' : value === '' ? 'empty string' : markdownText(value);
}

function fenced(value) {
  const content = text(value);
  const runs = content.match(/`+/g) || [];
  const width = runs.reduce((longest, run) => Math.max(longest, run.length + 1), 3);
  const fence = '`'.repeat(width);
  return `${fence}text\n${content}\n${fence}`;
}

function groupsFor(data) {
  return data.groups?.length ? data.groups : [{ values: {}, nodeIds: data.nodes.map((node) => node.id) }];
}

function groupTitle(group) {
  const fields = Object.entries(group.values || {});
  return fields.length
    ? fields.map(([key, value]) => `${key}=${value == null ? '(unset)' : text(value)}`).join(', ')
    : 'Selected nodes';
}

function nodeFields(node) {
  const lines = [
    `- ID: ${markdownText(node.id)}`,
    `- Type: ${recorded(node.type)}`,
    `- Status: ${recorded(node.status)}`,
    `- Severity: ${recorded(node.severity)}`,
    `- Confidence: ${recorded(node.confidence)}`,
  ];
  for (const [key, label] of [['tags', 'Tags'], ['loc', 'Location'], ['author', 'Author'], ['updatedBy', 'Updated by'], ['ts', 'Recorded at'], ['updated', 'Updated at'], ['inputTruncation', 'Recorded input truncation']]) {
    if (node[key] != null) lines.push(`- ${label}: ${markdownText(node[key])}`);
  }
  lines.push('', 'Title:', '', fenced(node.title ?? ''));
  if (node.detail != null) lines.push('', 'Detail:', '', fenced(node.detail));
  else lines.push('', 'Detail: unset.');
  return lines;
}

/** Render all selected records, with one-hop explicit evidence kept across filters. */
export function renderMarkdown(data) {
  const { nodes = [], relatedNodes = [], edges = [] } = data;
  const groups = groupsFor({ ...data, nodes });
  const selectedIds = new Set(nodes.map((node) => node.id));
  const context = relatedNodes.filter((node) => !selectedIds.has(node.id));
  const references = new Map();
  for (const node of [...nodes, ...context]) {
    references.set(node.id, {
      label: markdownText(node.title ?? '') || '(empty title)',
      anchor: `node-${mermaidId(node.id).slice(2)}`,
    });
  }
  const link = (id) => {
    const ref = references.get(id);
    return ref ? `[${ref.label}](#${ref.anchor}) (${markdownText(id)})` : markdownText(id);
  };
  const incident = new Map(nodes.map((node) => [node.id, []]));
  for (const edge of edges) {
    incident.get(edge.from)?.push(edge);
    if (edge.to !== edge.from) incident.get(edge.to)?.push(edge);
  }
  const lines = [
    `# ${markdownText(data.title || 'Blackboard report')}`,
    '', '## Selection', '',
    `- Selected nodes: ${nodes.length}`,
    `- Related context nodes: ${context.length}`,
    `- Recorded incident edges: ${edges.length}`,
    `- Groups: ${groups.length}`,
  ];
  if (data.version != null) lines.push(`- Tool version: ${markdownText(data.version)}`);
  const filters = Object.entries(data.filters || {});
  if (filters.length) {
    lines.push('', 'Explicit filters:', '');
    for (const [key, value] of filters) lines.push(`- ${markdownText(key)}: ${recorded(value)}`);
  } else lines.push('', 'Explicit filters: none.');
  if (data.integrity) {
    lines.push('', 'Replay diagnostics:', '');
    for (const key of ['corruptLines', 'rejected', 'futureEvents', 'unknownOps']) {
      if (data.integrity[key] != null) lines.push(`- ${key}: ${markdownText(data.integrity[key])}`);
    }
  }
  lines.push('', 'Related context contains recorded one-hop endpoints outside this selection. Relations below are explicit records; context is not traversed recursively.');
  const rendered = new Set();
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const renderNode = (node) => {
    const ref = references.get(node.id);
    lines.push('', `<a id="${ref.anchor}"></a>`, '', `### ${ref.label}`, '', ...nodeFields(node), '', '#### Recorded relations', '');
    const relations = incident.get(node.id);
    const supporting = relations.filter((edge) =>
      (edge.to === node.id && ['supports', 'proves', 'prove', 'derive', 'produce'].includes(edge.kind)) ||
      (edge.from === node.id && ['derived-from', 'caused-by'].includes(edge.kind)));
    const contradicting = relations.filter((edge) => edge.to === node.id && edge.kind === 'contradicts');
    for (const [label, records] of [['supporting', supporting], ['contradicting', contradicting]]) {
      if (!records.length) lines.push(`No recorded incident ${label} relations.`, '');
      else {
        const incoming = records.filter((edge) => edge.to === node.id).length;
        const outgoing = records.filter((edge) => edge.from === node.id).length;
        lines.push(`Recorded ${label} relations: ${incoming} incoming, ${outgoing} outgoing.`, '');
      }
    }
    if (!relations.length) lines.push('No recorded incident edges.');
    for (const edge of relations) {
      lines.push(`- Edge ${recorded(edge.id)}: ${link(edge.from)} → ${link(edge.to)}; kind: ${recorded(edge.kind)}; label: ${recorded(edge.label)}`);
      if (edge.author != null) lines.push(`  - Author: ${markdownText(edge.author)}`);
      if (edge.ts != null) lines.push(`  - Recorded at: ${markdownText(edge.ts)}`);
    }
    rendered.add(node.id);
  };
  groups.forEach((group, index) => {
    lines.push('', `## Group ${index + 1}: ${markdownText(groupTitle(group))}`);
    const ids = [...new Set(group.nodeIds || [])].filter((id) => byId.has(id));
    if (!ids.length) lines.push('', 'No selected nodes in this group.');
    for (const id of ids) {
      if (rendered.has(id)) lines.push('', `- Additional group membership: ${link(id)}. Full record appears above.`);
      else renderNode(byId.get(id));
    }
  });
  // Preserve selected records even if a direct caller supplies incomplete groups.
  const ungrouped = nodes.filter((node) => !rendered.has(node.id));
  if (ungrouped.length) {
    lines.push('', '## Other selected nodes');
    for (const node of ungrouped) renderNode(node);
  }
  if (!nodes.length) lines.push('', 'No selected nodes.');
  if (context.length) {
    lines.push('', '## Related context', '', 'These records are referenced by explicit edges; they are outside the selected node set.');
    for (const node of context) {
      const ref = references.get(node.id);
      lines.push('', `<a id="${ref.anchor}"></a>`, '', `### ${ref.label}`, '', ...nodeFields(node));
    }
  }
  return `${lines.join('\n')}\n`;
}

// Mermaid's own decimal entity syntax keeps all authored punctuation and line
// breaks inside quoted labels, including literal entity strings and backticks.
function mermaidText(value) {
  return text(value).replace(/[^\p{L}\p{N} ]/gu, (char) => `#${char.codePointAt(0)};`);
}

// Plain quoted labels do not wrap consistently across Mermaid consumers. Insert
// only exporter-owned breaks, retaining every authored code point in order.
function mermaidLabel(value) {
  const chars = Array.from(text(value));
  const lines = [];
  for (let start = 0; start < chars.length; start += 72) {
    lines.push(mermaidText(chars.slice(start, start + 72).join('')));
  }
  return lines.join('<br/>');
}

// An injective encoding, stable across ordering, filters and node caps. Original
// IDs never become Mermaid identifiers, keywords or executable directives.
function mermaidId(id) {
  return `n_${Array.from(String(id), (char) => char.codePointAt(0).toString(16)).join('_') || 'empty'}`;
}

/** Render a bounded directed graph without inventing links or dangling edges. */
export function renderMermaid(data, { maxNodes = 200 } = {}) {
  if (!Number.isSafeInteger(maxNodes) || maxNodes < 0) throw new RangeError('maxNodes must be a non-negative safe integer');
  const nodes = data.nodes || [];
  const relatedNodes = data.relatedNodes || [];
  const edges = data.edges || [];
  const all = new Map();
  for (const node of [...nodes, ...relatedNodes]) if (!all.has(node.id)) all.set(node.id, node);
  const shown = [...all.values()].slice(0, maxNodes);
  const shownIds = new Set(shown.map((node) => node.id));
  const selectedIds = new Set(nodes.map((node) => node.id));
  const keptEdges = edges.filter((edge) => shownIds.has(edge.from) && shownIds.has(edge.to));
  if (keptEdges.length > 500) {
    throw new RangeError(`Mermaid export has ${keptEdges.length} displayed edges; the default Mermaid maxEdges limit is 500. Reduce --max-nodes or narrow the selection with export filters; use Markdown for the full report.`);
  }
  const omittedNodes = all.size - shown.length;
  const omittedEdges = edges.length - keptEdges.length;
  const lines = ['flowchart TD'];
  if (data.title) lines.push(`  %% Title: ${mermaidText(data.title)}`);
  lines.push(`  %% Selected nodes: ${nodes.length}; related context nodes: ${all.size - selectedIds.size}`);
  if (omittedNodes || omittedEdges) lines.push(`  %% Omitted nodes: ${omittedNodes}; omitted edges: ${omittedEdges}; maxNodes: ${maxNodes}`);
  if (!shown.length) lines.push('  %% No displayed nodes.');
  for (const node of shown) {
    lines.push(`  ${mermaidId(node.id)}["${mermaidLabel(`${node.id}: ${node.title ?? ''}`)}"]`);
  }
  const assigned = new Set();
  const groups = groupsFor({ ...data, nodes });
  groups.forEach((group, index) => {
    const ids = [...new Set(group.nodeIds || [])].filter((id) => shownIds.has(id) && selectedIds.has(id));
    const firstMemberships = ids.filter((id) => !assigned.has(id));
    const repeated = ids.filter((id) => assigned.has(id));
    const label = mermaidLabel(groupTitle(group));
    if (firstMemberships.length) {
      lines.push(`  subgraph group_${index}["${label}"]`);
      for (const id of firstMemberships) {
        lines.push(`    ${mermaidId(id)}`);
        assigned.add(id);
      }
      lines.push('  end');
    } else lines.push(`  %% Group ${index + 1}: ${label}; no newly placed nodes.`);
    if (repeated.length) {
      lines.push(`  %% Additional membership in group ${index + 1} (${label}): ${repeated.map(mermaidId).join(', ')}`);
    }
  });
  const context = shown.filter((node) => !selectedIds.has(node.id));
  if (context.length) {
    lines.push('  subgraph related_context["Related context"]');
    for (const node of context) lines.push(`    ${mermaidId(node.id)}`);
    lines.push('  end');
  }
  for (const edge of keptEdges) {
    const label = mermaidLabel(edge.label == null || edge.label === '' ? edge.kind : `${edge.kind}: ${text(edge.label)}`);
    const arrow = edge.kind === 'related-to' ? '-.->' : '-->';
    lines.push(`  ${mermaidId(edge.from)} ${arrow}|"${label}"| ${mermaidId(edge.to)}`);
  }
  const source = `${lines.join('\n')}\n`;
  if (source.length > 50000) {
    throw new RangeError(`Mermaid export contains ${source.length} characters; the default Mermaid maxTextSize limit is 50000. Reduce --max-nodes or narrow the selection with export filters; use Markdown to retain full authored text.`);
  }
  return source;
}
