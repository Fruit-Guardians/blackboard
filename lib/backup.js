// Recoverable backups are byte-preserving copies of the event source, not UI
// exports or an alternate graph. The manifest checks integrity, not authenticity.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { TextDecoder } from 'node:util';
import { EVENT_VERSION, apply, emptyGraph, isFutureEvent } from './model.js';
import { paths, withLock, readState, writeState, protectBoard } from './store.js';

export const BACKUP_VERSION = 1;
const FORMAT = 'blackboard-backup';
const FILES = new Set(['events.jsonl', 'config.json']);
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

function fail(message) {
  throw new Error(`blackboard backup: ${message}`);
}

function entryStat(file) {
  try { return fs.lstatSync(file); } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function regularFile(file) {
  const stat = entryStat(file);
  if (!stat || !stat.isFile() || stat.isSymbolicLink()) fail(`expected a regular file: ${file}`);
  return fs.readFileSync(file);
}

function objectJson(bytes, label) {
  let parsed;
  try { parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch {
    fail(`invalid ${label} JSON or UTF-8`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) fail(`${label} must be a JSON object`);
  return parsed;
}

function inspectEvents(bytes) {
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch {
    return { eventCount: 0, corruptLines: 1, futureEvents: 0, rejected: 0, unknownOps: 0, incompleteTailBytes: 0, invalidUtf8: true };
  }
  const lastNewline = bytes.lastIndexOf(10);
  const incompleteTailBytes = bytes.length && bytes[bytes.length - 1] !== 10 ? bytes.length - lastNewline - 1 : 0;
  const complete = incompleteTailBytes ? text.slice(0, text.lastIndexOf('\n') + 1) : text;
  const events = [];
  let corruptLines = 0;
  let futureEvents = 0;
  let invalidRecords = 0;
  for (const line of complete.split('\n')) {
    if (!line.trim()) continue;
    let event;
    try { event = JSON.parse(line); } catch { corruptLines++; continue; }
    if (!event || typeof event !== 'object' || Array.isArray(event) || typeof event.op !== 'string') {
      invalidRecords++;
      continue;
    }
    if (isFutureEvent(event)) futureEvents++;
    else events.push(event);
  }
  let graph = emptyGraph();
  let rejected = invalidRecords;
  let unknownOps = 0;
  try {
    for (const event of events) {
      const before = { ...graph.integrity };
      graph = apply(graph, event);
      // A reset replaces the graph and its counters, but it must not hide
      // damaged or unknown historical records from backup diagnostics.
      if (event.op !== 'reset') {
        rejected += graph.integrity.rejected - before.rejected;
        unknownOps += graph.integrity.unknownOps - before.unknownOps;
      }
    }
  } catch {
    // Preserve all bytes in a backup even when a hand-written event cannot be
    // replayed by this release; a restore must not silently discard it.
    rejected++;
  }
  return { eventCount: events.length, corruptLines, futureEvents, rejected, unknownOps, incompleteTailBytes };
}

function checkDirectory(file, label) {
  const stat = entryStat(file);
  if (!stat || !stat.isDirectory() || stat.isSymbolicLink()) fail(`${label} must be a real directory: ${file}`);
}

// Resolve existing ancestors as well as the final component, so a symlinked
// parent cannot disguise a destination inside the source data directory.
function storageLocation(file) {
  let ancestor = file;
  const suffix = [];
  while (!entryStat(ancestor)) {
    suffix.unshift(path.basename(ancestor));
    const parent = path.dirname(ancestor);
    if (parent === ancestor) break;
    ancestor = parent;
  }
  return path.join(fs.realpathSync(ancestor), ...suffix);
}

function descriptor(name, bytes) {
  return { path: name, bytes: bytes.length, sha256: sha256(bytes) };
}

function writePrivate(file, bytes) {
  const fd = fs.openSync(file, 'wx', 0o600);
  try {
    fs.writeFileSync(fd, bytes);
    fs.fsyncSync(fd);
  } finally { fs.closeSync(fd); }
}

/**
 * Capture a stable event/config snapshot under the same cross-process lock as
 * writers. Damaged and newer logs can be archived, but the receipt describes
 * the damage and this release will refuse to restore them.
 */
export function backupBoard(cwd, outputDir) {
  const source = path.resolve(cwd);
  const output = path.resolve(outputDir);
  const sourcePaths = paths(source);
  checkDirectory(sourcePaths.root, 'source .blackboard');
  const sourceLocation = fs.realpathSync(sourcePaths.root);
  const outputLocation = storageLocation(output);
  if (outputLocation === sourceLocation || outputLocation.startsWith(`${sourceLocation}${path.sep}`)) {
    fail('backup destination must be outside the source .blackboard directory');
  }
  if (entryStat(output)) fail(`destination already exists: ${output}`);
  const snapshot = withLock(() => {
    const events = regularFile(sourcePaths.events);
    const files = { 'events.jsonl': events };
    if (entryStat(sourcePaths.config)) files['config.json'] = regularFile(sourcePaths.config);
    const integrity = inspectEvents(events);
    if (files['config.json']) {
      try { objectJson(files['config.json'], 'config'); } catch { integrity.invalidConfig = true; }
    }
    return { files, integrity };
  }, source, null, { readOnly: true });

  const parent = path.dirname(output);
  fs.mkdirSync(parent, { recursive: true });
  const staging = fs.mkdtempSync(path.join(parent, `.${path.basename(output)}.backup-`));
  try {
    const files = Object.entries(snapshot.files).map(([name, bytes]) => {
      writePrivate(path.join(staging, name), bytes);
      return descriptor(name, bytes);
    });
    const manifest = {
      format: FORMAT, backupVersion: BACKUP_VERSION, eventVersion: EVENT_VERSION,
      createdAt: new Date().toISOString(), files, integrity: snapshot.integrity,
    };
    writePrivate(path.join(staging, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    if (entryStat(output)) fail(`destination already exists: ${output}`);
    fs.renameSync(staging, output);
    return {
      kind: 'backup', path: output, manifest: path.join(output, 'manifest.json'),
      eventsSha256: files.find((file) => file.path === 'events.jsonl').sha256,
      eventCount: snapshot.integrity.eventCount, integrity: snapshot.integrity, files,
    };
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

function loadBackup(backupDir) {
  checkDirectory(backupDir, 'backup');
  const manifest = objectJson(regularFile(path.join(backupDir, 'manifest.json')), 'manifest');
  if (manifest.format !== FORMAT || manifest.backupVersion !== BACKUP_VERSION) fail('unsupported backup format/version');
  if (!Number.isInteger(manifest.eventVersion) || manifest.eventVersion < 1) fail('invalid manifest eventVersion');
  if (manifest.eventVersion > EVENT_VERSION) fail(`future eventVersion ${manifest.eventVersion}; supported: ${EVENT_VERSION}`);
  if (!Array.isArray(manifest.files)) fail('manifest files must be an array');
  const expected = new Set(['manifest.json']);
  const files = {};
  for (const file of manifest.files) {
    // A fixed flat allowlist also rules out absolute paths, traversal, alternate
    // separators, nested directories and prototype-property path tricks.
    if (!file || !FILES.has(file.path) || expected.has(file.path)) fail('invalid or duplicate manifest file path');
    if (!Number.isSafeInteger(file.bytes) || file.bytes < 0 || !/^[a-f0-9]{64}$/.test(file.sha256)) fail(`invalid manifest checksum: ${file.path}`);
    const bytes = regularFile(path.join(backupDir, file.path));
    if (bytes.length !== file.bytes || sha256(bytes) !== file.sha256) fail(`checksum mismatch: ${file.path}`);
    expected.add(file.path);
    files[file.path] = bytes;
  }
  if (!files['events.jsonl']) fail('manifest is missing events.jsonl');
  const actual = fs.readdirSync(backupDir);
  if (actual.length !== expected.size || actual.some((name) => !expected.has(name))) fail('backup file set differs from manifest');
  const integrity = inspectEvents(files['events.jsonl']);
  if (integrity.futureEvents) fail(`event log contains ${integrity.futureEvents} future eventVersion record(s); supported: ${EVENT_VERSION}`);
  if (integrity.corruptLines || integrity.rejected || integrity.incompleteTailBytes || integrity.invalidUtf8) {
    fail(`event log is damaged: ${JSON.stringify(integrity)}`);
  }
  if (files['config.json']) objectJson(files['config.json'], 'config');
  return { files, integrity };
}

/**
 * Restore only into a project with no .blackboard entry. Validate everything
 * before creating the target, then publish a complete board by directory rename.
 * Neither the source backup nor any existing board is ever rewritten or merged.
 */
export function restoreBoard(backupDir, targetDir) {
  const backup = path.resolve(backupDir);
  const target = path.resolve(targetDir);
  const snapshot = loadBackup(backup);
  const backupLocation = fs.realpathSync(backup);
  const targetLocation = storageLocation(target);
  if (targetLocation === backupLocation || targetLocation.startsWith(`${backupLocation}${path.sep}`)) {
    fail('restore target must be outside the source backup directory');
  }
  const destination = paths(target).root;
  const targetStat = entryStat(target);
  if (targetStat && (!targetStat.isDirectory() || targetStat.isSymbolicLink())) fail('restore target must be a real project directory');
  if (entryStat(destination)) fail(`restore target already has .blackboard: ${destination}`);
  const targetCreated = !targetStat;
  fs.mkdirSync(target, { recursive: true });
  let staging;
  try {
    staging = fs.mkdtempSync(path.join(target, '.blackboard-restore-'));
    // Use an isolated temporary project so store paths and cache recovery retain
    // their normal semantics. No source state.json cache is trusted or copied.
    const stagingBoard = paths(staging).root;
    fs.mkdirSync(stagingBoard, { mode: 0o700 });
    for (const [name, bytes] of Object.entries(snapshot.files)) writePrivate(path.join(stagingBoard, name), bytes);
    if (!snapshot.files['config.json']) writePrivate(path.join(stagingBoard, 'config.json'), '{}\n');
    protectBoard(staging);
    writeState(readState(staging), staging);
    if (entryStat(destination)) fail(`restore target already has .blackboard: ${destination}`);
    fs.renameSync(stagingBoard, destination);
    return {
      kind: 'restore', path: target, boardPath: destination,
      eventsSha256: sha256(snapshot.files['events.jsonl']),
      eventCount: snapshot.integrity.eventCount, integrity: snapshot.integrity,
      state: 'rebuilt-from-events',
    };
  } finally {
    if (staging) fs.rmSync(staging, { recursive: true, force: true });
    if (targetCreated) {
      try { fs.rmdirSync(target); } catch { /* A successful restore or another writer owns its contents. */ }
    }
  }
}
