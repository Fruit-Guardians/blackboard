import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { installRelease, stableCliPath, cliOrigin, useRelease, listReleases } from '../lib/release.js';
import { resolveNodeBinary } from '../lib/hooks.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const CLI = path.join(REPO, 'bin', 'blackboard.js');
const VERSION = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8')).version;

function tmp(t, prefix = 'blackboard-release-') {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** A fake HOME: releases, launcher, Skill and settings all land inside it. */
function homeEnv(t) {
  const home = tmp(t, 'blackboard-home-');
  const env = { ...process.env, HOME: home, BLACKBOARD_QUIET: '1' };
  for (const key of Object.keys(env)) if (key.startsWith('BLACKBOARD_') && key !== 'BLACKBOARD_QUIET') delete env[key];
  delete env.XDG_DATA_HOME;
  env.BLACKBOARD_CWD = home;
  return env;
}

function run(env, cli, ...args) {
  return spawnSync(process.execPath, [cli, ...args], { env, encoding: 'utf8' });
}

function releasePaths(env) {
  const home = path.join(env.HOME, '.local', 'share', 'blackboard');
  return { home, current: path.join(home, 'current'), currentCli: path.join(home, 'current', 'bin', 'blackboard.js') };
}

test('release install copies the package and integrations point at current, not the checkout', (t) => {
  const env = homeEnv(t);
  const res = run(env, CLI, 'release', 'install', '--json');
  assert.equal(res.status, 0, res.stderr);
  const result = JSON.parse(res.stdout);
  const { home, current, currentCli } = releasePaths(env);
  assert.equal(result.version, VERSION);
  assert.equal(result.refresh.error, undefined);

  const dir = path.join(home, 'versions', VERSION);
  for (const entry of ['bin/blackboard.js', 'lib/model.js', 'skills/blackboard/SKILL.md', 'skills/blackboard/methods/threat-model.md', 'public/index.html', 'package.json', 'README.md', '.release.json']) {
    assert.ok(fs.existsSync(path.join(dir, entry)), entry);
  }
  assert.equal(fs.existsSync(path.join(dir, 'test')), false);
  assert.equal(fs.realpathSync(current), dir);

  const launcher = fs.readFileSync(path.join(env.HOME, '.local', 'bin', 'blackboard'), 'utf8');
  assert.ok(launcher.includes(currentCli), launcher);
  assert.ok(!launcher.includes(REPO), launcher);
  // Nothing that was not installed before is added by the refresh.
  assert.equal(fs.existsSync(path.join(env.HOME, '.claude')), false);

  const version = run(env, currentCli, '--version');
  assert.match(version.stdout, new RegExp(`blackboard ${VERSION.replaceAll('.', '\\.')} \\(已安装版本 · current\\)`));
});

test('an installed version is immutable unless --force replaces it', (t) => {
  const env = homeEnv(t);
  assert.equal(run(env, CLI, 'release', 'install').status, 0);
  const again = run(env, CLI, 'release', 'install');
  assert.equal(again.status, 1);
  assert.match(again.stderr, /已安装/);
  const forced = run(env, CLI, 'release', 'install', '--force', '--json');
  assert.equal(forced.status, 0, forced.stderr);
  assert.equal(JSON.parse(forced.stdout).replaced, true);
});

test('Skill and hooks installed through current survive switching versions', (t) => {
  const env = homeEnv(t);
  assert.equal(run(env, CLI, 'release', 'install').status, 0);
  const { home, current, currentCli } = releasePaths(env);
  assert.equal(run(env, currentCli, 'skill', 'install', '--user').status, 0);
  assert.equal(run(env, currentCli, 'hooks', 'install', '--user', '--write').status, 0);

  const skillFile = path.join(env.HOME, '.claude', 'skills', 'blackboard', 'SKILL.md');
  const settingsFile = path.join(env.HOME, '.claude', 'settings.json');
  const recorded = () => [fs.readFileSync(skillFile, 'utf8'), fs.readFileSync(settingsFile, 'utf8')];
  assert.equal(fs.readFileSync(path.join(path.dirname(skillFile), 'methods/threat-model.md'), 'utf8'),
    fs.readFileSync(path.join(REPO, 'skills/blackboard/methods/threat-model.md'), 'utf8'));
  for (const text of recorded()) {
    assert.ok(text.includes(currentCli));
    assert.ok(!text.includes(path.join(home, 'versions')));
  }

  // A second installed version, as a later release would produce.
  const next = path.join(home, 'versions', '9.9.9');
  fs.cpSync(path.join(home, 'versions', VERSION), next, { recursive: true });
  const pkg = JSON.parse(fs.readFileSync(path.join(next, 'package.json'), 'utf8'));
  fs.writeFileSync(path.join(next, 'package.json'), JSON.stringify({ ...pkg, version: '9.9.9' }));
  fs.writeFileSync(path.join(next, '.release.json'), JSON.stringify({ version: '9.9.9', installedAt: new Date(Date.now() + 1000).toISOString() }));
  fs.appendFileSync(path.join(next, 'skills', 'blackboard', 'SKILL.md'), '\n<!-- 9.9.9 -->\n');

  const use = run(env, currentCli, 'release', 'use', '9.9.9');
  assert.equal(use.status, 0, use.stderr);
  assert.equal(fs.realpathSync(current), next);
  const [skill, settings] = recorded();
  assert.ok(skill.includes('<!-- 9.9.9 -->'), 'the newly active version rewrites the user Skill');
  assert.ok(skill.includes(currentCli));
  assert.ok(settings.includes(currentCli));
  assert.match(run(env, currentCli, '--version').stdout, /blackboard 9\.9\.9/);

  const list = JSON.parse(run(env, currentCli, 'release', 'ls', '--json').stdout);
  assert.deepEqual(list.versions.map((v) => [v.version, v.active]), [[VERSION, false], ['9.9.9', true]]);

  const back = run(env, currentCli, 'release', 'use', VERSION);
  assert.equal(back.status, 0, back.stderr);
  assert.ok(!fs.readFileSync(skillFile, 'utf8').includes('<!-- 9.9.9 -->'), 'rolling back restores the older Skill text');

  const missing = run(env, currentCli, 'release', 'use', '0.0.0');
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /未安装版本 0\.0\.0.*9\.9\.9/);
});

test('only the active release may refresh integrations, and installs come from a checkout', (t) => {
  const env = homeEnv(t);
  const fromCheckout = run(env, CLI, 'release', 'refresh');
  assert.equal(fromCheckout.status, 1);
  assert.match(fromCheckout.stderr, /current/);
  assert.equal(fs.existsSync(path.join(env.HOME, '.local', 'bin', 'blackboard')), false);

  assert.equal(run(env, CLI, 'release', 'install').status, 0);
  const nested = run(env, releasePaths(env).currentCli, 'release', 'install');
  assert.equal(nested.status, 1);
  assert.match(nested.stderr, /开发仓库/);
});

test('a CLI path inside the active version is recorded through current', (t) => {
  const home = tmp(t);
  const cli = path.join(home, 'versions', '1.0.0', 'bin', 'blackboard.js');
  fs.mkdirSync(path.dirname(cli), { recursive: true });
  fs.writeFileSync(cli, '');
  fs.mkdirSync(path.join(home, 'versions', '2.0.0', 'bin'), { recursive: true });
  fs.writeFileSync(path.join(home, 'versions', '2.0.0', 'bin', 'blackboard.js'), '');

  assert.equal(stableCliPath(cli, home), cli, 'no current link yet');
  assert.deepEqual(useRelease('1.0.0', home), { version: '1.0.0', previous: null, cli: path.join(home, 'current', 'bin', 'blackboard.js') });
  assert.equal(stableCliPath(cli, home), path.join(home, 'current', 'bin', 'blackboard.js'));
  assert.deepEqual(cliOrigin(cli, home), { kind: 'release', version: '1.0.0', active: true });

  const other = path.join(home, 'versions', '2.0.0', 'bin', 'blackboard.js');
  assert.equal(stableCliPath(other, home), other, 'an inactive version keeps its own path');
  assert.deepEqual(cliOrigin(other, home), { kind: 'release', version: '2.0.0', active: false });
  assert.equal(stableCliPath(CLI, home), CLI);
  assert.equal(cliOrigin(CLI, home).kind, 'checkout');

  assert.equal(useRelease('2.0.0', home).previous, '1.0.0');
  assert.equal(listReleases(home).current, '2.0.0');
  assert.throws(() => useRelease('3.0.0', home), /未安装版本 3\.0\.0/);
});

function packageFixture(t, marker = 'original') {
  const source = tmp(t, 'blackboard-package-');
  const home = tmp(t);
  fs.mkdirSync(path.join(source, 'bin'));
  fs.mkdirSync(path.join(source, 'public'));
  fs.writeFileSync(path.join(source, 'package.json'), JSON.stringify({ version: '1.0.0', files: ['bin', 'public', 'payload.txt'] }));
  fs.writeFileSync(path.join(source, 'public', 'index.html'), '<html></html>');
  const update = (value) => {
    fs.writeFileSync(path.join(source, 'bin', 'blackboard.js'), `console.log(${JSON.stringify(value)});\n`);
    fs.writeFileSync(path.join(source, 'payload.txt'), value);
  };
  update(marker);
  const dest = path.join(home, 'versions', '1.0.0');
  return {
    source, home, dest, update,
    staging: path.join(home, 'versions', `.1.0.0.staging-${process.pid}`),
    retired: path.join(home, 'versions', `.1.0.0.replaced-${process.pid}`),
    currentCli: path.join(home, 'current', 'bin', 'blackboard.js'),
  };
}

function withFsMethods(methods, fn) {
  const originals = Object.fromEntries(Object.keys(methods).map((name) => [name, fs[name]]));
  try {
    for (const [name, method] of Object.entries(methods)) fs[name] = (...args) => method(originals[name], ...args);
    return fn();
  } finally {
    Object.assign(fs, originals);
  }
}

function assertRunnable(cli, marker) {
  const result = spawnSync(process.execPath, [cli], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), marker);
}

test('a failed forced publication restores the runnable active release and removes staging', (t) => {
  const fixture = packageFixture(t);
  installRelease(fixture);
  useRelease('1.0.0', fixture.home);
  fixture.update('replacement');
  const failure = Object.assign(new Error('injected publication failure'), { code: 'EIO' });
  withFsMethods({ renameSync: (rename, from, to) => {
    if (from === fixture.staging && to === fixture.dest) throw failure;
    return rename(from, to);
  } }, () => {
    assert.throws(() => installRelease({ ...fixture, force: true }), (error) => error === failure && error.code === 'EIO');
  });
  assertRunnable(fixture.currentCli, 'original');
  assert.equal(fs.readFileSync(path.join(fixture.dest, 'payload.txt'), 'utf8'), 'original');
  assert.deepEqual(fs.readdirSync(path.dirname(fixture.dest)), ['1.0.0']);
});

test('failed fresh copies and publications leave no partial installed version', (t) => {
  for (const phase of ['copy', 'publish']) {
    const fixture = packageFixture(t);
    const failure = new Error(`injected ${phase} failure`);
    const methods = phase === 'copy' ? { cpSync: (copy, from, ...args) => {
      if (from === path.join(fixture.source, 'payload.txt')) throw failure;
      return copy(from, ...args);
    } } : { renameSync: (rename, from, to) => {
      if (from === fixture.staging) throw failure;
      return rename(from, to);
    } };
    withFsMethods(methods, () => assert.throws(() => installRelease(fixture), (error) => error === failure));
    assert.deepEqual(fs.readdirSync(path.dirname(fixture.dest)), [], phase);
    assert.deepEqual(listReleases(fixture.home).versions, [], phase);
  }
});

test('a failed forced copy leaves the active release intact and removes staging', (t) => {
  const fixture = packageFixture(t);
  installRelease(fixture);
  useRelease('1.0.0', fixture.home);
  fixture.update('replacement');
  const failure = new Error('injected copy failure');
  withFsMethods({ cpSync: (copy, from, ...args) => {
    if (from === path.join(fixture.source, 'payload.txt')) throw failure;
    return copy(from, ...args);
  } }, () => assert.throws(() => installRelease({ ...fixture, force: true }), (error) => error === failure));
  assertRunnable(fixture.currentCli, 'original');
  assert.deepEqual(fs.readdirSync(path.dirname(fixture.dest)), ['1.0.0']);
});

test('successful force publication replaces the complete package without old files', (t) => {
  const fixture = packageFixture(t);
  installRelease(fixture);
  useRelease('1.0.0', fixture.home);
  fs.writeFileSync(path.join(fixture.dest, 'obsolete.txt'), 'old package only');
  fixture.update('replacement');
  const installed = installRelease({ ...fixture, force: true });
  assert.deepEqual(installed, { version: '1.0.0', dir: fixture.dest, replaced: true, warnings: [] });
  assertRunnable(fixture.currentCli, 'replacement');
  assert.equal(fs.readFileSync(path.join(fixture.dest, 'payload.txt'), 'utf8'), 'replacement');
  assert.equal(fs.existsSync(path.join(fixture.dest, 'obsolete.txt')), false);
  assert.equal(JSON.parse(fs.readFileSync(path.join(fixture.dest, '.release.json'), 'utf8')).version, '1.0.0');
  assert.deepEqual(fs.readdirSync(path.dirname(fixture.dest)), ['1.0.0']);
});

test('failed rollback preserves old bytes and reports recovery alongside the original publication error', (t) => {
  const fixture = packageFixture(t);
  installRelease(fixture);
  useRelease('1.0.0', fixture.home);
  fixture.update('replacement');
  const failure = Object.assign(new Error('injected publication failure'), { code: 'EIO' });
  const rollbackFailure = new Error('injected rollback failure');
  withFsMethods({ renameSync: (rename, from, to) => {
    if (from === fixture.staging) throw failure;
    if (from === fixture.retired) throw rollbackFailure;
    return rename(from, to);
  } }, () => assert.throws(() => installRelease({ ...fixture, force: true }), (error) => {
    assert.equal(error, failure);
    assert.equal(error.code, 'EIO');
    assert.equal(error.rollbackError, rollbackFailure);
    assert.equal(error.recoveryPath, fixture.retired);
    assert.ok(error.message.includes(fixture.retired));
    assert.ok(error.message.includes(fixture.dest));
    assert.match(error.message, /injected publication failure.*injected rollback failure/);
    return true;
  }));
  assertRunnable(path.join(fixture.retired, 'bin', 'blackboard.js'), 'original');
  assert.equal(fs.readFileSync(path.join(fixture.retired, 'payload.txt'), 'utf8'), 'original');
  assert.equal(fs.existsSync(fixture.staging), false);
  assert.throws(() => installRelease({ ...fixture, force: true }), (error) => error.message.includes(fixture.retired));
  assertRunnable(path.join(fixture.retired, 'bin', 'blackboard.js'), 'original');
});

test('failed staging cleanup keeps the original installation error and names the leftover path', (t) => {
  const fixture = packageFixture(t);
  const failure = Object.assign(new Error('injected copy failure'), { code: 'EIO' });
  const cleanupFailure = new Error('injected staging cleanup failure');
  withFsMethods({
    cpSync: (copy, from, ...args) => {
      if (from === path.join(fixture.source, 'payload.txt')) throw failure;
      return copy(from, ...args);
    },
    rmSync: (remove, target, ...args) => {
      if (target === fixture.staging && fs.existsSync(target)) throw cleanupFailure;
      return remove(target, ...args);
    },
  }, () => assert.throws(() => installRelease(fixture), (error) => {
    assert.equal(error, failure);
    assert.equal(error.code, 'EIO');
    assert.deepEqual(error.cleanupErrors, [{ path: fixture.staging, error: cleanupFailure }]);
    assert.ok(error.message.includes(fixture.staging));
    assert.match(error.message, /injected copy failure.*injected staging cleanup failure/);
    return true;
  }));
  assert.equal(fs.existsSync(fixture.dest), false);
  assert.equal(fs.existsSync(fixture.staging), true);
});

test('retired cleanup failure reports a warning after successful force publication', (t) => {
  const fixture = packageFixture(t);
  installRelease(fixture);
  useRelease('1.0.0', fixture.home);
  fixture.update('replacement');
  const installed = withFsMethods({ rmSync: (remove, target, ...args) => {
    if (target === fixture.retired) throw new Error('injected retired cleanup failure');
    return remove(target, ...args);
  } }, () => installRelease({ ...fixture, force: true }));
  assert.equal(installed.replaced, true);
  assert.equal(installed.warnings.length, 1);
  assert.ok(installed.warnings[0].includes(fixture.retired));
  assert.match(installed.warnings[0], /injected retired cleanup failure/);
  assertRunnable(fixture.currentCli, 'replacement');
  assertRunnable(path.join(fixture.retired, 'bin', 'blackboard.js'), 'original');
  assert.equal(fs.existsSync(fixture.staging), false);
});

test('failed current publication removes the staged link and preserves the active CLI', (t) => {
  for (const cleanupFails of [false, true]) {
    const fixture = packageFixture(t);
    installRelease(fixture);
    useRelease('1.0.0', fixture.home);
    const link = path.join(fixture.home, 'current');
    const staging = `${link}.staging-${process.pid}`;
    const failure = Object.assign(new Error('injected link publication failure'), { code: 'EIO' });
    const cleanupFailure = new Error('injected link cleanup failure');
    withFsMethods({
      renameSync: (rename, from, to) => {
        if (from === staging) throw failure;
        return rename(from, to);
      },
      rmSync: (remove, target, ...args) => {
        if (cleanupFails && target === staging && fs.existsSync(target)) throw cleanupFailure;
        return remove(target, ...args);
      },
    }, () => assert.throws(() => useRelease('1.0.0', fixture.home), (error) => {
      assert.equal(error, failure);
      assert.equal(error.code, 'EIO');
      if (cleanupFails) {
        assert.deepEqual(error.cleanupErrors, [{ path: staging, error: cleanupFailure }]);
        assert.ok(error.message.includes(staging));
      }
      return true;
    }));
    assertRunnable(fixture.currentCli, 'original');
    assert.equal(fs.existsSync(staging), cleanupFails);
  }
});

test('fnm interpreter paths that go stale are replaced by the default alias', (t) => {
  const fnm = tmp(t);
  const pinned = path.join(fnm, 'node-versions', 'v22.0.0', 'installation', 'bin', 'node');
  const alias = path.join(fnm, 'aliases', 'default', 'bin', 'node');
  assert.equal(resolveNodeBinary(pinned, {}), pinned, 'no alias to fall back to');
  fs.mkdirSync(path.dirname(alias), { recursive: true });
  fs.writeFileSync(alias, '');
  assert.equal(resolveNodeBinary(pinned, {}), alias);
  assert.equal(resolveNodeBinary('/run/user/fnm_multishells/123/bin/node', { FNM_DIR: fnm }), alias);
  assert.equal(resolveNodeBinary('/usr/local/bin/node', { FNM_DIR: fnm }), '/usr/local/bin/node');
});
