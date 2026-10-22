import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { BlackboardError } from './config.js';

/** A process boundary keeps blackboard's synchronous I/O and locks out of the DSH loop. */
export class CliBridge {
  #operations = new Set();
  #lifecycle = new AbortController();

  constructor(config) { this.config = config; }

  async runtime() {
    const cli = this.config.runtimeCli;
    try {
      const root = path.dirname(path.dirname(cli));
      const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
      if (pkg.name !== 'blackboard' || !/^0\.6\.\d+$/.test(pkg.version)) {
        throw new BlackboardError('RUNTIME_VERSION', 'This adapter supports blackboard 0.6.x.');
      }
      if (!(await fs.stat(cli)).isFile()) throw new Error('CLI is not a file');
      return { root, cli, version: pkg.version };
    } catch (cause) {
      if (cause instanceof BlackboardError) throw cause;
      throw new BlackboardError('RUNTIME_MISSING', 'Install blackboard independently, then configure its stable current CLI path.', { cause });
    }
  }

  async run(scope, argv, signal, beforeSpawn) {
    this.#lifecycle.signal.throwIfAborted();
    signal?.throwIfAborted();
    const { cli } = await this.runtime();
    await beforeSpawn?.();
    this.#lifecycle.signal.throwIfAborted();
    signal?.throwIfAborted();
    const operation = this.#execute(scope, [cli, ...argv], signal);
    this.#operations.add(operation);
    try { return await operation; }
    finally { this.#operations.delete(operation); }
  }

  #execute(scope, argv, signal) {
    return new Promise((resolve, reject) => {
      // Copy instead of changing process.env: each concurrent Session owns its identity and board.
      const env = {
        ...process.env,
        BLACKBOARD_CWD: scope.boardRoot,
        BLACKBOARD_AGENT: scope.agentId,
        BLACKBOARD_LOCK_TIMEOUT_MS: String(Math.min(3000, this.config.timeoutMs)),
        NO_COLOR: '1',
      };
      // Desktop's executable is Electron, not a stand-alone node binary.
      if (process.versions.electron) env.ELECTRON_RUN_AS_NODE = '1';
      const child = spawn(this.config.nodeExecutable, argv, {
        cwd: scope.boardRoot, env, shell: false, stdio: ['ignore', 'pipe', 'pipe'],
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
      const deadline = setTimeout(() => stop('TIMEOUT', 'CLI deadline exceeded.'), this.config.timeoutMs);
      const collect = (chunks) => (chunk) => {
        bytes += chunk.length;
        if (bytes > this.config.maxOutputBytes) stop('OUTPUT_LIMIT', 'CLI output limit exceeded.');
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
          resolve({ boardRoot: scope.boardRoot, agentId: scope.agentId, data, diagnostics: Buffer.concat(stderr).toString('utf8').trim() });
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
