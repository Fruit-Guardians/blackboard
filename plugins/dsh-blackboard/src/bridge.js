import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { BlackboardError } from './config.js';

/** What this adapter relies on, checked against `capabilities --json` instead of a version number. */
export const REQUIRED = Object.freeze({
  schema: 'blackboard.capabilities.v1',
  features: Object.freeze(['writeAttribution', 'cwdFlag', 'noInit']),
  outputs: Object.freeze({
    status: 'blackboard.status.v2', context: 'blackboard.context.v2', show: 'blackboard.show.v2',
    node: 'blackboard.node-add.v2', edit: 'blackboard.node.v2', link: 'blackboard.edge.v1',
    cursor: 'blackboard.cursor.v1', checkpoint: 'blackboard.checkpoint.v1',
  }),
});

function missing(capabilities) {
  if (capabilities?.schema !== REQUIRED.schema) return [`schema ${REQUIRED.schema}`];
  const gaps = REQUIRED.features.filter((name) => capabilities.features?.[name] !== true).map((name) => `feature ${name}`);
  for (const [command, schema] of Object.entries(REQUIRED.outputs)) {
    if (!capabilities.commands?.includes(command)) gaps.push(`command ${command}`);
    else if (capabilities.outputs?.[command]?.schema !== schema) gaps.push(`output ${schema}`);
  }
  if (!Array.isArray(capabilities.writeTargets)) gaps.push('writeTargets');
  return gaps;
}

/**
 * Bind a CLI call to its board with explicit flags, never inherited environment.
 * `write` adds identity and --no-init; `read` adds identity for cursor-aware reads; `path` adds only the root.
 * Flags go right after the command name, so user text after `--` stays positional.
 */
export function bound(argv, scope, access, agentId = scope.agentId) {
  const flags = [`--cwd=${scope.boardRoot}`];
  if (access !== 'path') flags.push(`--agent=${agentId}`);
  if (access === 'write') flags.push('--no-init');
  return [argv[0], ...flags, ...argv.slice(1)];
}

/** A process boundary keeps blackboard's synchronous I/O and locks out of the DSH loop. */
export class CliBridge {
  #operations = new Set();
  #lifecycle = new AbortController();
  #runtimes = new Map();

  constructor(config) { this.config = config; }

  snapshot() { return typeof this.config === 'function' ? this.config() : this.config; }

  async runtime(config = this.snapshot()) {
    let real;
    try {
      real = await fs.realpath(config.runtimeCli);
      if (!(await fs.stat(real)).isFile()) throw new Error('CLI is not a file');
    } catch (cause) {
      throw new BlackboardError('RUNTIME_MISSING', 'Install blackboard independently, then configure its stable current CLI path.', { cause });
    }
    // Keyed by the resolved file: switching `current` to another release probes again.
    const key = `${config.nodeExecutable}\0${real}`;
    let probe = this.#runtimes.get(key);
    if (!probe) {
      probe = this.#probe(real, config);
      this.#runtimes.set(key, probe);
      probe.catch(() => this.#runtimes.delete(key));
    }
    const { version, capabilities } = await probe;
    return { root: path.dirname(path.dirname(real)), cli: config.runtimeCli, real, version, capabilities };
  }

  async #probe(real, config) {
    let capabilities;
    try {
      ({ data: capabilities } = await this.#track(this.#execute([real, 'capabilities', '--json'], path.dirname(real), undefined, config)));
    } catch (cause) {
      if (!['CLI_FAILED', 'INVALID_JSON'].includes(cause.code)) throw cause;
      throw new BlackboardError('RUNTIME_INCOMPATIBLE', 'The configured CLI does not answer capabilities --json.', { cause });
    }
    const gaps = missing(capabilities);
    if (gaps.length) throw new BlackboardError('RUNTIME_INCOMPATIBLE', `The configured blackboard lacks ${gaps.join(', ')}.`);
    return { version: String(capabilities.version ?? ''), capabilities };
  }

  async run(scope, argv, signal, beforeSpawn, config = this.snapshot()) {
    this.#lifecycle.signal.throwIfAborted();
    signal?.throwIfAborted();
    const runtime = await this.runtime(config);
    await beforeSpawn?.(runtime);
    this.#lifecycle.signal.throwIfAborted();
    signal?.throwIfAborted();
    const { data, diagnostics } = await this.#track(this.#execute([runtime.real, ...argv], scope.boardRoot, signal, config));
    return { boardRoot: scope.boardRoot, agentId: scope.agentId, data, diagnostics };
  }

  async #track(operation) {
    this.#operations.add(operation);
    try { return await operation; }
    finally { this.#operations.delete(operation); }
  }

  #execute(argv, cwd, signal, config) {
    return new Promise((resolve, reject) => {
      // Copy instead of changing process.env: each concurrent Session owns its identity and board.
      // Root and identity travel as flags; an inherited value must not pick another board or author.
      const { BLACKBOARD_CWD: _cwd, BLACKBOARD_AGENT: _agent, ...inherited } = process.env;
      const env = {
        ...inherited,
        BLACKBOARD_LOCK_TIMEOUT_MS: String(Math.min(3000, config.timeoutMs)),
        NO_COLOR: '1',
      };
      // Desktop's executable is Electron, not a stand-alone node binary.
      if (process.versions.electron) env.ELECTRON_RUN_AS_NODE = '1';
      const child = spawn(config.nodeExecutable, argv, {
        cwd, env, shell: false, stdio: ['ignore', 'pipe', 'pipe'],
      });
      const stdout = [], stderr = [];
      let bytes = 0, failure, escalation;
      const stop = (code, message) => {
        if (failure) return;
        failure = new BlackboardError(code, `${message} A write may already have committed; read the board before retrying.`);
        child.kill('SIGTERM');
        escalation = setTimeout(() => child.kill('SIGKILL'), 250);
        escalation.unref();
      };
      const abort = () => stop('ABORTED', 'CLI call cancelled.');
      const dispose = () => stop('DISPOSED', 'Plugin unloaded.');
      signal?.addEventListener('abort', abort, { once: true });
      this.#lifecycle.signal.addEventListener('abort', dispose, { once: true });
      const deadline = setTimeout(() => stop('TIMEOUT', 'CLI deadline exceeded.'), config.timeoutMs);
      const collect = (chunks) => (chunk) => {
        bytes += chunk.length;
        if (bytes > config.maxOutputBytes) stop('OUTPUT_LIMIT', 'CLI output limit exceeded.');
        else chunks.push(chunk);
      };
      child.stdout.on('data', collect(stdout));
      child.stderr.on('data', collect(stderr));
      child.on('error', (cause) => { failure ??= new BlackboardError('SPAWN_FAILED', 'CLI process did not start.', { cause }); });
      child.on('close', (code, terminationSignal) => {
        clearTimeout(deadline);
        clearTimeout(escalation);
        signal?.removeEventListener('abort', abort);
        this.#lifecycle.signal.removeEventListener('abort', dispose);
        if (failure) return reject(failure);
        if (code !== 0) return reject(new BlackboardError('CLI_FAILED', `CLI exited ${code ?? terminationSignal}: ${Buffer.concat(stderr).toString('utf8').trim()}`));
        try {
          const data = JSON.parse(Buffer.concat(stdout).toString('utf8'));
          if (data === null || typeof data !== 'object') throw new Error('expected JSON object or array');
          resolve({ data, diagnostics: Buffer.concat(stderr).toString('utf8').trim() });
        } catch (cause) { reject(new BlackboardError('INVALID_JSON', 'CLI returned an invalid JSON result.', { cause })); }
      });
      // A caller may cancel between the pre-spawn check and listener attachment.
      if (signal?.aborted) abort();
      if (this.#lifecycle.signal.aborted) dispose();
    });
  }

  async dispose() {
    this.#lifecycle.abort();
    await Promise.allSettled([...this.#operations]);
  }
}
