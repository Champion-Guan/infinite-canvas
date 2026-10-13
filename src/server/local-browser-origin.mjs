// Exact same-host browser requests only. localhost is a browser alias, not
// permission for cross-Origin reads, arbitrary DNS names or LAN clients.
export function localBrowserOrigin(request, configured, browserRead = false) {
  const base = new URL(configured);
  const allowed = new Set([base.host]);
  if (base.protocol === 'http:' && base.hostname === '127.0.0.1') allowed.add(`localhost:${base.port}`);
  const host = request.headers.host;
  if (!allowed.has(host)) return null;
  const origin = `http://${host}`;
  return request.headers.origin === origin || browserRead && request.headers['sec-fetch-site'] === 'same-origin' ? origin : null;
}
