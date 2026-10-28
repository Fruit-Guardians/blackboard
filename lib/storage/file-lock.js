import fs from 'node:fs';
import crypto from 'node:crypto';

const sleepBuf = new Int32Array(new SharedArrayBuffer(4));

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

/** A slow, live writer keeps its lock regardless of its age. */
function lockIsStale(file) {
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch { return false; }
  const pid = Number(raw.split('\n')[0]);
  if (Number.isInteger(pid) && pid > 0) return !pidAlive(pid);
  // A crash between exclusive creation and the token write leaves no owner.
  try { return Date.now() - fs.statSync(file).mtimeMs > 30000; } catch { return false; }
}

function removeOwnLock(file, own, token, tokenWritten) {
  try {
    const current = fs.lstatSync(file);
    if (own.dev !== current.dev || own.ino !== current.ino) return;
    const raw = fs.readFileSync(file, 'utf8');
    // A failed write may have left an empty or partial token. Both inode and
    // contents must still belong to this acquisition before removing it.
    if (raw === token || (!tokenWritten && token.startsWith(raw))) fs.unlinkSync(file);
  } catch {}
}

/** Own the descriptor from exclusive creation through callback or write failure. */
export function withFileLock(file, fn, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  const token = `${process.pid}\n${Date.now()}\n${crypto.randomBytes(6).toString('hex')}\n`;
  let fd;
  for (;;) {
    try {
      fd = fs.openSync(file, 'wx');
      break;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (lockIsStale(file)) {
        try { fs.unlinkSync(file); } catch {}
        continue;
      }
      if (Date.now() > deadline) throw new Error('blackboard lock timeout: another writer is still active');
      Atomics.wait(sleepBuf, 0, 0, 8);
    }
  }
  let tokenWritten = false;
  try {
    fs.writeFileSync(fd, token);
    tokenWritten = true;
    return fn();
  } finally {
    let own;
    try { own = fs.fstatSync(fd); } catch {}
    // Capture identity while open, then release the descriptor before unlinking.
    try { fs.closeSync(fd); } catch {}
    if (own) removeOwnLock(file, own, token, tokenWritten);
  }
}
