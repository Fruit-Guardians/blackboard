const MAX_BODY = 256 * 1024;

export function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

export function jsonError(req, res, error) {
  if (res.headersSent) return;
  if (error.status === 413) {
    res.setHeader('Connection', 'close');
    res.once('finish', () => req.socket.destroy());
  }
  json(res, error.status || 400, { error: error.message || String(error), ...(error.fields ? { fields: error.fields } : {}), ...(error.limits ? { limits: error.limits } : {}), ...(error.code ? { code: error.code } : {}), ...(error.requestId ? { requestId: error.requestId } : {}) });
}

export function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        // Answer first; the connection is closed once the 413 has been sent.
        if (size - chunk.length <= MAX_BODY) reject(Object.assign(new Error('body too large'), { status: 413 }));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
      catch { reject(Object.assign(new Error('body is not valid JSON'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

/**
 * The board is only ever served on the loopback interface, but a web page the user happens to have
 * open can still reach it (DNS rebinding, or a plain cross-site request). Every request must name
 * a loopback host, and anything that writes must also come from this very page.
 */
export function requestGuard(req, port) {
  const hosts = [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`];
  const host = String(req.headers.host || '').toLowerCase();
  if (!hosts.includes(host)) return { ok: false, status: 403, error: 'host_not_allowed' };
  if (['GET', 'HEAD'].includes(req.method)) return { ok: true };
  const origin = req.headers.origin;
  if (!origin || origin.toLowerCase() !== `http://${host}`) return { ok: false, status: 403, error: 'cross_origin_write' };
  const site = req.headers['sec-fetch-site'];
  if (site && !['same-origin', 'none'].includes(site)) return { ok: false, status: 403, error: 'cross_origin_write' };
  if (!String(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) {
    return { ok: false, status: 415, error: 'json_required' };
  }
  return { ok: true };
}
