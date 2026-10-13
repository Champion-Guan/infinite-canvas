import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { runtimePaths } from '../src/server/runtime-paths.mjs';
import { UpdateManagerClient } from '../src/server/update-manager-client.mjs';
import { serveUpdateProgress, progressSnapshot } from '../src/server/update-progress.mjs';

const paths = runtimePaths({ projectRoot: fileURLToPath(new URL('../', import.meta.url)) });
const target = process.argv[2];
const manager = new UpdateManagerClient({ socketPath: join(paths.updates, 'u.sock') });
let failed = false, cached = null, cachedAt = 0, pending = null;
process.on('message', message => { if (message?.state === 'failed') failed = true; });
// A parent disconnect is expected when the workbench restarts. Keep serving.
process.on('disconnect', () => {});
const monitor = await serveUpdateProgress({ target, readStatus: async () => {
  if (cached && Date.now() - cachedAt < 1500) return cached;
  if (!pending) pending = (async () => {
    const status = await manager.status();
    const ready = ['committed', 'rolled-back'].includes(status.state) ? await manager.request({ op: 'service-ready' }, 3000).catch(() => null) : null;
    cached = progressSnapshot(target, status, ready);
    if (failed && ['preparing', 'idle', 'staged'].includes(cached.state)) cached = { target, state: 'failed', reason: null };
    cachedAt = Date.now(); return cached;
  })().finally(() => { pending = null; });
  return pending;
} });
process.send?.({ url: monitor.url });
process.channel?.unref();
