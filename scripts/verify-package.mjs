#!/usr/bin/env node
// Exercise the actual tarball in a clean prefix: no source imports or dev dependencies.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SELF = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(SELF), '..');

function cleanEnv(home, board) {
  const env = { ...process.env };
  for (const name of Object.keys(env)) if (name.startsWith('BLACKBOARD_')) delete env[name];
  return { ...env, HOME: home, USERPROFILE: home, BLACKBOARD_CWD: board, BLACKBOARD_QUIET: '1', npm_config_cache: path.join(home, 'npm-cache'), npm_config_update_notifier: 'false' };
}

// Invoke npm's JavaScript entry directly, including on Windows (.cmd is not an executable).
function npmEntry() {
  const candidates = [process.env.npm_execpath,
    path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'),
    path.resolve(path.dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js')];
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    for (const name of ['npm', 'npm.cmd']) {
      const file = path.join(dir, name);
      try {
        const resolved = fs.realpathSync(file);
        if (resolved.endsWith('.js')) candidates.push(resolved);
        candidates.push(path.join(path.dirname(resolved), 'node_modules/npm/bin/npm-cli.js'));
      } catch {}
    }
  }
  const entry = candidates.find((file) => file && file.endsWith('.js') && fs.existsSync(file));
  assert.ok(entry, 'npm CLI entry not found; run through npm run verify:package or install npm alongside Node');
  return entry;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 120000, maxBuffer: 8 * 1024 * 1024, ...options });
  assert.equal(result.status, 0, `${command} ${args.join(' ')}\n${result.error?.message || ''}\n${result.stderr}\n${result.stdout}`);
  return result.stdout;
}

export function filesBelow(root, prefix = '') {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    return entry.isDirectory() ? filesBelow(path.join(root, entry.name), name) : [name];
  }).sort();
}

export function assertPackageLayout(root) {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(pkg.name, 'blackboard');
  assert.deepEqual(pkg.dependencies || {}, {}, 'the core must have zero runtime dependencies');
  assert.deepEqual(pkg.peerDependencies || {}, {}, 'host SDKs must stay inside isolated plugins');
  for (const name of ['bin/blackboard.js', 'lib/model.js', 'lib/store.js', 'skills/blackboard/SKILL.md', 'skills/blackboard/agents/openai.yaml', 'public/index.html', 'README.md']) {
    assert.ok(fs.statSync(path.join(root, name)).isFile(), `packed file missing: ${name}`);
  }
  const files = filesBelow(root);
  for (const name of files) assert.doesNotMatch(name, /^(?:plugins|web|test|node_modules|\.blackboard)\//, `unexpected runtime package member: ${name}`);
  const assets = files.filter((name) => name.startsWith('public/assets/'));
  assert.ok(assets.some((name) => name.endsWith('.js')), 'built JavaScript assets must be shipped');
  assert.ok(assets.some((name) => name.endsWith('.css')), 'built CSS assets must be shipped');
  const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
  for (const match of html.matchAll(/(?:src|href)="([^"?#]+)(?:[?#][^"]*)?"/g)) {
    const ref = match[1];
    if (/^(?:https?:|data:|#)/.test(ref)) continue;
    const local = path.resolve(root, 'public', ref.replace(/^\//, ''));
    assert.ok(local.startsWith(path.join(root, 'public') + path.sep), `asset escapes public: ${ref}`);
    assert.ok(fs.existsSync(local), `HTML references a missing asset: ${ref}`);
  }
  return { pkg, files };
}

export function verifyPackage(options = {}) {
  const source = fs.realpathSync(path.resolve(options.source || ROOT));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'blackboard-packed-'));
  const home = path.join(tmp, 'home');
  const board = path.join(tmp, 'board');
  const prefix = path.join(tmp, 'consumer');
  for (const dir of [home, board, prefix]) fs.mkdirSync(dir);
  const env = cleanEnv(home, board);
  const npm = npmEntry();
  try {
    let tarball = options.tarball ? path.resolve(options.tarball) : null;
    if (!tarball) {
      const packed = JSON.parse(run(process.execPath, [npm, 'pack', '--json', '--ignore-scripts', '--pack-destination', tmp], { cwd: source, env }));
      assert.equal(packed.length, 1);
      tarball = path.join(tmp, packed[0].filename);
    }
    assert.ok(fs.statSync(tarball).isFile(), `tarball missing: ${tarball}`);
    fs.writeFileSync(path.join(prefix, 'package.json'), JSON.stringify({ name: 'blackboard-packed-smoke', private: true, version: '0.0.0' }));
    run(process.execPath, [npm, 'install', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false', tarball], { cwd: prefix, env });
    const installed = path.join(prefix, 'node_modules', 'blackboard');
    const { pkg, files } = assertPackageLayout(installed);
    const sourceSkill = path.join(source, 'skills', 'blackboard');
    const installedSkill = path.join(installed, 'skills', 'blackboard');
    const skillFiles = filesBelow(sourceSkill).filter((name) => name !== '.DS_Store');
    assert.deepEqual(filesBelow(installedSkill).filter((name) => name !== '.DS_Store'), skillFiles, 'the complete single-source Skill must be packed');
    for (const name of skillFiles) assert.ok(fs.readFileSync(path.join(sourceSkill, name)).equals(fs.readFileSync(path.join(installedSkill, name))), `Skill content changed: ${name}`);
    const installedModules = fs.readdirSync(path.join(prefix, 'node_modules')).filter((name) => !name.startsWith('.'));
    assert.deepEqual(installedModules, ['blackboard'], 'clean consumer must not install frontend dev dependencies or host SDKs');
    const cli = path.join(installed, 'bin', 'blackboard.js');
    const command = (...args) => run(process.execPath, [cli, ...args], { cwd: board, env });
    assert.match(command('--version'), new RegExp(`blackboard ${pkg.version.replaceAll('.', '\\.')}`));
    const init = JSON.parse(command('init', '--title', 'Packed smoke fixture', '--json'));
    assert.ok(init);
    command('node', 'add', 'hypothesis', 'Packed hypothesis', '--status', 'open');
    command('node', 'add', 'observation', 'Packed evidence', '--confidence', 'reproduced', '--at', 'fixture.js:12');
    command('node', 'add', 'finding', 'Packed code finding', '--at', 'fixture.js:24', '--sev', 'high');
    const eventsFile = path.join(board, '.blackboard', 'events.jsonl');
    const beforeRead = fs.readFileSync(eventsFile);
    const packet = JSON.parse(command('context'));
    assert.equal(packet.policy.readOnly, true);
    assert.equal(packet.policy.prescriptive, false);
    assert.equal(packet.policy.nextStepSelection, 'agent-controlled');
    command('context', '--markdown');
    const lint = JSON.parse(command('lint', '--json'));
    assert.ok(lint);
    command('export', '-o', path.join(board, 'offline.html'));
    assert.match(fs.readFileSync(path.join(board, 'offline.html'), 'utf8'), /Packed hypothesis/);
    for (const [format, extension] of [['markdown', 'md'], ['mermaid', 'mmd'], ['sarif', 'sarif']]) {
      const output = path.join(board, `report.${extension}`);
      const exported = JSON.parse(command('export', '--format', format, '--type', 'finding', '--out', output, '--json'));
      assert.equal(exported.format, format);
      const content = fs.readFileSync(output, 'utf8');
      if (format === 'sarif') {
        const results = JSON.parse(content).runs[0].results;
        assert.equal(results.length, 1);
        assert.equal(results[0].message.text, 'Packed code finding');
        assert.equal(results[0].level, 'error');
        assert.equal(results[0].locations[0].physicalLocation.region.startLine, 24);
      } else assert.ok(content.includes('Packed code finding'), `${format} retains the authored finding title`);
    }
    assert.ok(fs.readFileSync(eventsFile).equals(beforeRead), 'recovery, lint and export must not write events');
    // Source and installed runtime are deliberately separate. No global installation/setup runs.
    return { result: 'PASS', package: `${pkg.name}@${pkg.version}`, node: process.version, platform: process.platform, arch: process.arch,
      tarball: options.tarball ? tarball : '(temporary npm pack artifact; removed)', packedFiles: files.length, skillFiles: skillFiles.length,
      checks: ['zero-runtime-dependencies', 'complete-skill', 'built-assets-resolve', 'clean-install', 'cli-init-create', 'json-markdown-context', 'nonblocking-lint', 'offline-export', 'markdown-mermaid-sarif-exports', 'read-only-event-integrity'] };
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === SELF) {
  try {
    const options = {};
    for (let i = 2; i < process.argv.length; i++) {
      const arg = process.argv[i];
      if (arg === '--help') { console.log('Usage: node scripts/verify-package.mjs [--source DIR] [--tarball FILE]'); process.exit(0); }
      assert.ok(['--source', '--tarball'].includes(arg), `unknown option: ${arg}`);
      assert.ok(process.argv[i + 1] && !process.argv[i + 1].startsWith('--'), `${arg} requires a value`);
      options[arg.slice(2)] = process.argv[++i];
    }
    console.log(JSON.stringify(verifyPackage(options), null, 2));
  } catch (error) { console.error(`verify-package: ${error.message}`); process.exitCode = 1; }
}
