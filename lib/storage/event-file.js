import fs from 'node:fs';

/** Read the observed byte range completely, allowing short reads and early EOF. */
export function readEventBytes(file, fromByte) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    if (size <= fromByte) return { bytes: null, size };
    const bytes = Buffer.alloc(size - fromByte);
    let read = 0;
    while (read < bytes.length) {
      const count = fs.readSync(fd, bytes, read, bytes.length - read, fromByte + read);
      if (count === 0) break;
      read += count;
    }
    return { bytes: read === bytes.length ? bytes : bytes.subarray(0, read), size };
  } finally {
    fs.closeSync(fd);
  }
}

export function repairTornTail(file) {
  if (!fs.existsSync(file)) return;
  const fd = fs.openSync(file, 'r+');
  try {
    const size = fs.fstatSync(fd).size;
    if (!size) return;
    const last = Buffer.alloc(1);
    fs.readSync(fd, last, 0, 1, size - 1);
    if (last[0] === 0x0a) return;
    const readSize = Math.min(size, 1024 * 1024);
    const tail = Buffer.alloc(readSize);
    fs.readSync(fd, tail, 0, readSize, size - readSize);
    const nl = tail.lastIndexOf(0x0a);
    fs.ftruncateSync(fd, nl === -1 ? 0 : size - readSize + nl + 1);
  } finally {
    fs.closeSync(fd);
  }
}

