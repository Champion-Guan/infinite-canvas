// Operator-only source checkout launcher. No HTTP route can enable this mode.
import path from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { realpath, cp } from 'node:fs/promises';
import { runtimePaths, privateDirectory, readPrivateFile, writePrivateJson, writePrivateFile } from '../src/server/runtime-paths.mjs';
import { PortableLaunchdJobs, portableDescriptor, startPortableJob, desktopShortcut } from './lib/macos-launcher.mjs';
import { workbenchPageCensus } from '../src/server/workbench-page-census.mjs';
import { SupervisedUpdateService } from '../src/server/update-supervisor.mjs';

const run = promisify(execFile);
const root = await realpath(fileURLToPath(new URL('../', import.meta.url)));
const paths = runtimePaths({ projectRoot: root });
const node = await realpath(process.execPath);
const domain = `gui/${process.getuid()}`;
const marker = path.join(paths.root, 'development/source.json');
const mode = process.argv[2];
const agents = path.join(homedir(), 'Library/LaunchAgents');
const logs = path.join(paths.logs, 'development');
const jobs = new PortableLaunchdJobs();
const sourceDescriptor = (port, migration = false) => {
  const value = portableDescriptor({ node, root, privateRoot: paths.root, agents, logs, port });
  value.bytes = value.bytes.replace('<key>PORT</key>', '<key>GUAN_WORKBENCH_SOURCE_DEV</key><string>1</string>'
    + (migration ? '<key>GUAN_WORKBENCH_PORT3000_MIGRATION</key><string>1</string>' : '') + '<key>PORT</key>');
  return value;
};
let activePort = 8888;
let descriptor = sourceDescriptor(activePort);
const ctl = (...args) => run('/bin/launchctl', args, { timeout: 40000, maxBuffer: 65536 });
const probe = async (port = activePort) => {
  try { const response = await fetch(`http://127.0.0.1:${port}/local-app/health`, { signal: AbortSignal.timeout(1000) }); return await response.json(); }
  catch (error) { if (error?.cause?.code === 'ECONNREFUSED') return null; throw error; }
};
const closed = async () => {
  const census = await workbenchPageCensus({ ports: [8888, 3000] });
  if (!census.workbenchPagesClosed || census.blockers.length) throw Error('请保存并关闭工作台页面后再首次切换源码模式');
};
try {
  if (process.platform !== 'darwin' || process.arch !== 'arm64' || process.argv.length !== 3 || !['--enable', '--open', '--migrate-port'].includes(mode)) throw Error('source_launcher_arguments_invalid');
  const existing = await readPrivateFile(marker, { maxBytes: 4096 });
  if (existing) {
    const value = JSON.parse(existing);
    if (value.root !== root || value.node !== node || value.version !== 1) throw Error('development_source_mismatch');
    activePort = value.port ?? 8888;
    if (![3000, 8888].includes(activePort)) throw Error('development_source_port_invalid');
    descriptor = sourceDescriptor(activePort, value.portMigration === true);
  } else if (mode !== '--enable') throw Error('source_mode_not_enabled');
  if (mode === '--migrate-port' && activePort !== 3000) {
    await closed();
    const health = await probe();
    if (!health?.ready || !health.sourceDevelopment || health.maintenance || health.origin !== 'http://127.0.0.1:8888') throw Error('source_service_identity_mismatch');
    if (await probe(3000)) throw Error('target_port_occupied');
    if (await readPrivateFile(descriptor.plist, { maxBytes: 16384 }) !== descriptor.bytes
      || !await jobs.inspect('com.guanaiworkbench.portable', descriptor)) throw Error('source_job_ownership_lost');
    const backup = path.join(paths.backups, 'pre-port3000-' + Date.now());
    await privateDirectory(backup);
    await cp(paths.data, path.join(backup, 'data'), { recursive: true, force: false, errorOnExist: true });
    await cp(descriptor.plist, path.join(backup, 'source.plist'), { force: false, errorOnExist: true });
    await writePrivateFile(path.join(backup, 'source.json'), existing, { exclusive: true });
    const oldDescriptor = descriptor;
    await closed();
    await jobs.stop('com.guanaiworkbench.portable', oldDescriptor);
    try {
      activePort = 3000; descriptor = sourceDescriptor(3000, true);
      await writePrivateFile(descriptor.plist, descriptor.bytes);
      await startPortableJob({ descriptor, jobs });
      let ready = false;
      for (let i = 0; i < 100; i++) {
        const next = await probe();
        if (next?.ready && next.sourceDevelopment && next.origin === 'http://127.0.0.1:3000') { ready = true; break; }
        await new Promise(resolve => setTimeout(resolve, 300));
      }
      if (!ready) throw Error('port3000_start_failed');
      await writePrivateJson(marker, { ...JSON.parse(existing), port: 3000, portMigration: true, portBackup: backup });
    } catch (error) {
      if (await jobs.inspect('com.guanaiworkbench.portable', descriptor).catch(() => false)) await jobs.stop('com.guanaiworkbench.portable', descriptor);
      await writePrivateFile(oldDescriptor.plist, oldDescriptor.bytes);
      await startPortableJob({ descriptor: oldDescriptor, jobs });
      throw error;
    }
  } else if (!existing) {
    await closed();
    const health = await probe();
    if (!health?.ready || health.maintenance || health.sourceDevelopment) throw Error('stable_service_not_ready');
    const current = JSON.parse(await readPrivateFile(path.join(paths.root, 'installation/current.json'), { maxBytes: 4096 }));
    if (health.version !== current.version || health.buildId !== current.buildId) throw Error('stable_service_identity_mismatch');
    const backup = path.join(paths.backups, 'pre-source-mode-' + Date.now());
    await privateDirectory(backup);
    await cp(paths.data, path.join(backup, 'data'), { recursive: true, force: false, errorOnExist: true });
    for (const label of ['com.guanaiworkbench.updater', 'com.guanaiworkbench.supervisor']) {
      const plist = path.join(agents, label + '.plist');
      await cp(plist, path.join(backup, label + '.plist'), { force: false, errorOnExist: true });
    }
    await closed();
    let service;
    try {
      // Disable login restart before releasing exact signed service ownership.
      await ctl('disable', domain + '/com.guanaiworkbench.updater');
      await ctl('disable', domain + '/com.guanaiworkbench.supervisor');
      await ctl('bootout', domain + '/com.guanaiworkbench.updater');
      service = new SupervisedUpdateService({ socketPath: path.join(paths.updates, 's.sock'), capabilityFile: path.join(paths.updates, 'supervisor.capability') });
      // launchctl returning does not guarantee the supervisor has processed
      // the old controller's socket-close event. Retry read-only inspection.
      let owned;
      for (let attempt = 0; attempt < 30; attempt++) {
        try { owned = await service.inspectOwned(); break; }
        catch { service.disconnect(); await new Promise(resolve => setTimeout(resolve, 300)); }
      }
      if (!owned) throw Error('stable_controller_release_timeout');
      if (owned.stopped || owned.pointer.version !== current.version || owned.pointer.buildId !== current.buildId) throw Error('stable_service_ownership_lost');
      await closed();
      await service.stop({ allowed: [owned.pointer] });
      service.disconnect(); service = null;
      await ctl('bootout', domain + '/com.guanaiworkbench.supervisor');
      await privateDirectory(logs);
      await startPortableJob({ descriptor, jobs });
      let healthy = false;
      for (let i = 0; i < 100; i++) {
        const next = await probe();
        if (next?.ready && next.sourceDevelopment && next.origin === 'http://127.0.0.1:8888') { healthy = true; break; }
        await new Promise(resolve => setTimeout(resolve, 300));
      }
      if (!healthy) throw Error('source_service_start_failed');
      await writePrivateJson(marker, { version: 1, root, node, backup });
    } catch (error) {
      service?.disconnect();
      if (await jobs.inspect('com.guanaiworkbench.portable', descriptor).catch(() => false)) await jobs.stop('com.guanaiworkbench.portable', descriptor);
      await ctl('enable', domain + '/com.guanaiworkbench.supervisor');
      await ctl('enable', domain + '/com.guanaiworkbench.updater');
      await run(node, [path.join(root, 'scripts/open-managed-workbench.mjs')], { timeout: 90000 });
      throw error;
    }
  } else {
    const health = await probe();
    if (health && !health.sourceDevelopment) throw Error('port_owned_by_other_service');
    await privateDirectory(logs);
    await startPortableJob({ descriptor, jobs });
  }
  if (activePort === 3000) {
    try { await desktopShortcut({ desktop: path.join(homedir(), 'Desktop'), node, root, port: activePort }); }
    catch { console.log('桌面入口未刷新，源码服务及旧数据仍保留。'); }
  }
  await run('/usr/bin/open', [`http://localhost:${activePort}`]);
  console.log('源码工作台已打开，前端构建发布后刷新页面即可看到修改；Stable 自动安装已隔离。');
} catch (error) {
  console.error(error.message || 'source_mode_failed'); process.exitCode = 1;
}
