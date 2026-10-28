import { createHash } from 'node:crypto';
import path from 'node:path';

const SCHEMA = 'https://docs.oasis-open.org/sarif/sarif/v2.1.0/os/schemas/sarif-schema-2.1.0.json';
const SOURCE_ROOT = '%SRCROOT%';
const RULES = [
  { id: 'blackboard/finding', name: 'AuthoredFinding', shortDescription: { text: 'Authored finding with a recorded code location.' } },
  { id: 'blackboard/vuln', name: 'AuthoredVulnerability', shortDescription: { text: 'Authored vulnerability with a recorded code location.' } },
];
const LEVELS = new Map([
  ['critical', 'error'], ['high', 'error'], ['medium', 'warning'], ['low', 'note'], ['info', 'note'],
]);

function encodePath(value) {
  return value.split('/').map((segment) => encodeURIComponent(segment)
    .replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)).join('/');
}

// These operations deliberately use the path's syntax rather than the host OS.
function absolutePath(value) {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0')) return null;
  if (/^[a-z]:[\\/]/i.test(value)) {
    return { syntax: path.win32, value: path.win32.normalize(value).replace(/^[a-z]:/i, (drive) => drive.toUpperCase()) };
  }
  if (value.startsWith('\\\\')) {
    const normalized = path.win32.normalize(value);
    const [host, share] = normalized.slice(2).split('\\');
    if (!host || !/^[a-z\d._-]+$/i.test(host) || !share) return null;
    return { syntax: path.win32, value: normalized };
  }
  if (value.startsWith('/')) return { syntax: path.posix, value: path.posix.normalize(value) };
  return null;
}

function fileUri(absolute) {
  if (absolute.syntax === path.posix) return `file://${encodePath(absolute.value)}`;
  const value = absolute.value.replaceAll('\\', '/');
  if (value.startsWith('//')) {
    const separator = value.indexOf('/', 2);
    return `file://${value.slice(2, separator).toLowerCase()}${encodePath(value.slice(separator))}`;
  }
  return `file:///${value.slice(0, 2)}${encodePath(value.slice(2))}`;
}

function artifactLocation(authoredPath, base) {
  if (typeof authoredPath !== 'string' || !authoredPath.trim() || authoredPath.includes('\0')) return null;
  const absolute = absolutePath(authoredPath);
  if (absolute) {
    if (base && absolute.syntax === base.syntax) {
      const relative = base.syntax.relative(base.value, absolute.value);
      if (relative && relative !== '..' && !relative.startsWith(`..${base.syntax.sep}`) && !base.syntax.isAbsolute(relative)) {
        return { uri: encodePath(relative.split(base.syntax.sep).join('/')), uriBaseId: SOURCE_ROOT };
      }
    }
    return { uri: fileUri(absolute) };
  }
  // URI schemes, drive-relative paths and root-relative Windows paths cannot be
  // resolved as recorded code paths without making assumptions about a drive.
  if (/^[a-z][a-z\d+.-]*:/i.test(authoredPath) || authoredPath.startsWith('\\')) return null;
  if (!base) return null;
  const relative = path.posix.normalize(authoredPath.replaceAll('\\', '/'));
  return { uri: encodePath(relative), uriBaseId: SOURCE_ROOT };
}

function physicalLocation(loc, base) {
  if (loc === undefined || loc === null) return { reason: 'missing-location' };
  const authoredPath = typeof loc === 'string' ? loc : (typeof loc === 'object' && !Array.isArray(loc) ? loc.path : undefined);
  let artifact;
  try {
    artifact = artifactLocation(authoredPath, base);
  } catch (error) {
    if (!(error instanceof URIError)) throw error;
  }
  if (!artifact) return { reason: 'invalid-location' };
  const location = { artifactLocation: artifact };
  // A column without an authored line cannot establish a SARIF source region.
  if (typeof loc === 'object' && Number.isSafeInteger(loc.line) && loc.line > 0) {
    location.region = { startLine: loc.line };
    if (Number.isSafeInteger(loc.column) && loc.column > 0) location.region.startColumn = loc.column;
  }
  return { location };
}

/** Render only authored findings with usable authored locations, without I/O. */
export function renderSarif(data) {
  const nodes = data.nodes ?? [];
  const relatedNodes = data.relatedNodes ?? [];
  const edges = data.edges ?? [];
  const byId = new Map([...relatedNodes, ...nodes].map((node) => [node.id, node]));
  const incidentEdges = new Map();
  for (const edge of edges) {
    for (const id of new Set([edge.from, edge.to])) {
      if (!incidentEdges.has(id)) incidentEdges.set(id, []);
      incidentEdges.get(id).push(edge);
    }
  }
  const base = absolutePath(data.cwd);
  const results = [];
  const skippedNodes = [];
  let usesSourceRoot = false;
  for (const node of nodes) {
    const ruleIndex = node.type === 'finding' ? 0 : node.type === 'vuln' ? 1 : -1;
    if (ruleIndex === -1) {
      skippedNodes.push({ nodeId: node.id, type: node.type, reason: 'unsupported-node-type' });
      continue;
    }
    const { location, reason } = physicalLocation(node.loc, base);
    if (!location) {
      skippedNodes.push({ nodeId: node.id, type: node.type, reason });
      continue;
    }
    usesSourceRoot ||= location.artifactLocation.uriBaseId === SOURCE_ROOT;
    const relationships = incidentEdges.get(node.id) ?? [];
    const relatedNodeIds = [...new Set(relationships.flatMap((edge) => [edge.from, edge.to]))].filter((id) => id !== node.id);
    const level = LEVELS.get(node.severity) ?? 'none';
    results.push({
      ruleId: RULES[ruleIndex].id,
      ruleIndex,
      // SARIF requires non-failure kinds to have level none. This identifies
      // an unranked record for review, without deriving its authored status.
      ...(level === 'none' ? { kind: 'review' } : {}),
      level,
      // OASIS SARIF 2.1.0 §3.11.5: authored braces are literals, not placeholders.
      message: { text: (node.title + (typeof node.detail === 'string' && node.detail.length ? `\n\n${node.detail}` : '')).replace(/[{}]/g, '$&$&') },
      locations: [{ physicalLocation: location }],
      partialFingerprints: { 'blackboardNodeId/v1': createHash('sha256').update(node.id).digest('hex') },
      properties: {
        nodeId: node.id,
        status: node.status ?? null,
        severity: node.severity ?? null,
        confidence: node.confidence ?? null,
        node,
        relationships,
        relatedNodeIds,
        relatedNodes: relatedNodeIds.filter((id) => byId.has(id)).map((id) => byId.get(id)),
      },
    });
  }
  const run = {
    tool: { driver: { name: 'blackboard', ...(data.version ? { semanticVersion: data.version } : {}), rules: RULES } },
    results,
    properties: {
      title: data.title ?? '',
      filters: data.filters ?? {},
      groups: data.groups ?? [{ values: {}, nodeIds: nodes.map((node) => node.id) }],
      integrity: data.integrity ?? {},
      coverage: {
        selectedNodeCount: nodes.length,
        relatedNodeCount: relatedNodes.length,
        resultCount: results.length,
        skippedNodeCount: skippedNodes.length,
      },
      skippedNodes,
    },
  };
  if (usesSourceRoot) {
    const uri = fileUri(base);
    run.originalUriBaseIds = { [SOURCE_ROOT]: { uri: uri.endsWith('/') ? uri : `${uri}/` } };
  }
  return `${JSON.stringify({ $schema: SCHEMA, version: '2.1.0', runs: [run] }, null, 2)}\n`;
}
