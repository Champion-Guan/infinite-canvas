import path from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { open, unlink, lstat, realpath } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { runtimePaths, readPrivateFile, writePrivateFile } from '../src/server/runtime-paths.mjs';
import { UpdateManager } from '../src/server/update-manager.mjs';
import { SignedUpdaterRuntime } from '../src/server/update-runtime.mjs';
import { UpdaterDeployment, UserLaunchdJobs } from '../src/server/update-deployment.mjs';
import { UpdateManagerClient } from '../src/server/update-manager-client.mjs';
import { UpdateOriginTransaction } from '../src/server/update-origin-transaction.mjs';
import { UpdateOriginNativeAdapter } from '../src/server/update-origin-native-adapter.mjs';
import { stableServiceOrigin } from '../src/server/update-service-origin.mjs';
import { workbenchPageCensus } from '../src/server/workbench-page-census.mjs';
import { desktopShortcut } from './lib/macos-launcher.mjs';

// Native fixed worker, no argv URLs/paths/commands. It survives the old app and
// updater exiting. An interrupted lock/journal requires explicit recovery;
// neither browser data nor unknown processes are automatically overwritten.
async function main() {
  if (process.argv.length !== 2 || process.platform !== 'darwin' || process.arch !== 'arm64') throw Error('update_migration_platform_invalid');
  const projectRoot = fileURLToPath(new URL('../', import.meta.url)), paths = runtimePaths({ projectRoot });
  const origin = await stableServiceOrigin(paths.root);
  if (origin !== 'http://127.0.0.1:8888') throw Error('update_migration_already_committed');
  const manager = new UpdateManager({ root: path.join(paths.root, 'installation'), dataRoot: paths.data,
    repository: 'Champion-Guan/infinite-canvas', origin });
  const raw = await readPrivateFile(path.join(paths.updates, 'origin-consent.json'), { maxBytes: 8192 });
  const consent = JSON.parse(raw);
  const assertConsent = async () => {
    if (!raw || consent.format !== 1 || consent.acknowledgement !== 'saved-and-all-tasks-ended'
      || consent.version !== consent.pointer?.version || !Number.isSafeInteger(consent.expiresAt)
      || Date.now() > consent.expiresAt || Date.now() < consent.expiresAt - 30 * 60 * 1000
      || await readPrivateFile(path.join(paths.updates, 'origin-consent.json'), { maxBytes: 8192 }) !== raw
      || JSON.stringify(await manager.readCurrent()) !== JSON.stringify(consent.pointer)) throw Error('install_operator_confirmation_required');
  };
  await assertConsent();
  const checked = await manager.verifyInstalled(consent.pointer);
  if (await realpath(projectRoot) !== await realpath(checked.directory)) throw Error('update_migration_unsigned');
  const lockFile = path.join(paths.updates, 'origin-migration.lock');
  const handle = await open(lockFile, 'wx', 0o600), ownedLock = await handle.stat();
  await handle.writeFile(consent.id); await handle.sync(); await handle.close();
  let adapter;
  try {
    const census = () => workbenchPageCensus({ ports: [8888, 3000] });
    while (true) {
      await assertConsent();
      const value = await census();
      if (value.workbenchPagesClosed && !value.blockers.length) break;
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    const runtime = new SignedUpdaterRuntime({ directory: path.join(paths.root, 'updater-runtime'), manager });
    const deployment = new UpdaterDeployment({ runtime, directory: path.join(paths.root, 'updater-deployment'),
      agents: path.join(homedir(), 'Library/LaunchAgents'), privateRoot: paths.root, logs: path.join(paths.root, 'logs/updater'),
      jobs: new UserLaunchdJobs(), health: async () => {} });
    adapter = new UpdateOriginNativeAdapter({ paths, manager, runtime, deployment, profile: consent.profile,
      assertConsent, projectRoot, census });
    const transaction = new UpdateOriginTransaction({ file: path.join(paths.updates, 'origin-transaction.json'), adapter });
    await transaction.run({ source: consent.profile.sourceOrigin, next: consent.pointer, lease: { assertValid: assertConsent } });
    // Commit precedes activation. Lost activation acknowledgement must never
    // roll back an app which may already have accepted customer work.
    const committed = await transaction.read();
    await adapter.activate({ ...committed, next: committed.next });
    const client = new UpdateManagerClient({ socketPath: path.join(paths.updates, 'u.sock') });
    let healthy = false;
    for (let n = 0; n < 100; n++) {
      try {
        const ready = await client.request({ op: 'service-ready' }, 1000);
        if (ready.owned && ready.currentVersion === consent.version) { healthy = true; break; }
      } catch { /* independently owned cold manager startup */ }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (!healthy) throw Error('update_migration_activation_unconfirmed');
    let shortcutUpdated = true;
    try {
      await desktopShortcut({ desktop: path.join(homedir(), 'Desktop'), node: path.join(runtime.directory, consent.pointer.id, 'runtime/node'),
        root: path.join(runtime.directory, consent.pointer.id), port: 3000 });
    } catch { shortcutUpdated = false; /* Never overwrite an unrelated desktop bundle. */ }
    await writePrivateFile(path.join(paths.updates, 'origin-completed.json'), JSON.stringify({ format: 1, version: consent.version,
      transaction: committed.id, origin: 'http://localhost:3000', verified: true, shortcutUpdated }));
    await promisify(execFile)('/usr/bin/open', ['http://localhost:3000'], { timeout: 10000 });
  } finally {
    adapter?.disconnect();
    const now = await lstat(lockFile);
    if (now.ino === ownedLock.ino && now.dev === ownedLock.dev) await unlink(lockFile);
  }
}
main().catch(() => { console.error('自动迁移未确认完成。原地址数据和本机备份保留，请查看独立更新进度。'); process.exitCode = 1; });
