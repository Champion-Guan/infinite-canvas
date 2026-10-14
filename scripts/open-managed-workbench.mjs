import path from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { runtimePaths } from '../src/server/runtime-paths.mjs';
import { UpdateManager } from '../src/server/update-manager.mjs';
import { SignedUpdaterRuntime } from '../src/server/update-runtime.mjs';
import { UpdaterDeployment, UserLaunchdJobs } from '../src/server/update-deployment.mjs';
import { UpdateManagerClient } from '../src/server/update-manager-client.mjs';
import { stableServiceOrigin } from '../src/server/update-service-origin.mjs';

// Native desktop entry. No raw service spawn, port killing, or arbitrary URL.
async function main() {
  if (process.argv.length !== 2) throw Error();
  const projectRoot = fileURLToPath(new URL('../', import.meta.url));
  const paths = runtimePaths({ projectRoot });
  const manager = new UpdateManager({ root: path.join(paths.root, 'installation'), dataRoot: paths.data, projectRoot,
    repository: 'Champion-Guan/infinite-canvas', origin: await stableServiceOrigin(paths.root) });
  const runtime = new SignedUpdaterRuntime({ directory: path.join(paths.root, 'updater-runtime'), manager });
  const deployment = new UpdaterDeployment({ runtime, directory: path.join(paths.root, 'updater-deployment'),
    agents: path.join(homedir(), 'Library/LaunchAgents'), privateRoot: paths.root,
    logs: path.join(paths.root, 'logs/updater'), jobs: new UserLaunchdJobs(), health: async () => {} });
  const record = await deployment.read();
  if (record?.phase !== 'committed') throw Error();
  const supervisor = (await deployment.descriptors(record.supervisor)).supervisor;
  const updater = (await deployment.descriptors(record.next)).manager;
  for (const [role, descriptor] of [['supervisor', supervisor], ['manager', updater]]) {
    await deployment.plist(descriptor);
    if (!await deployment.jobs.inspect(deployment.labels[role], descriptor)) await deployment.jobs.start(deployment.labels[role], descriptor);
  }
  const client = new UpdateManagerClient({ socketPath: path.join(paths.updates, 'u.sock') });
  for (let n = 0; n < 120; n++) {
    try {
      const ready = await client.request({ op: 'service-ready' }, 1000);
      if (ready.owned && ready.currentVersion === (await manager.readCurrent())?.version) {
        const response = await fetch(manager.origin + '/local-app/health', { signal: AbortSignal.timeout(1000) });
        const health = await response.json();
        if (response.ok && health.ready && !health.maintenance && health.origin === manager.origin) {
          const browserOrigin = manager.origin.replace('127.0.0.1', 'localhost');
          await promisify(execFile)('/usr/bin/open', [browserOrigin]);
          console.log('工作台已打开：' + browserOrigin); return;
        }
      }
    } catch { /* Wait for independently owned cold startup. */ }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw Error();
}
main().catch(() => { console.error('工作台尚未就绪，请检查独立更新服务；没有启动额外服务或修改数据。'); process.exitCode = 1; });
