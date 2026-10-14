import path from 'node:path';
import { cp, readFile, readdir, lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { privateDirectory, readPrivateFile, writePrivateFile } from './runtime-paths.mjs';
import { SupervisedUpdateService } from './update-supervisor.mjs';
import { workbenchPageCensus } from './workbench-page-census.mjs';
import { createUpdateOriginBrowserBridge } from './update-origin-browser-bridge.mjs';

const same = (a, b) => ['id', 'version', 'commit', 'buildId'].every(key => a?.[key] === b?.[key]);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function inventory(root) {
  const entries = [];
  async function walk(directory) {
    for (const name of (await readdir(directory)).sort()) {
      const file = path.join(directory, name), info = await lstat(file);
      if (info.isSymbolicLink() || info.uid !== process.getuid()) throw Error('update_migration_backup_invalid');
      if (info.isDirectory()) await walk(file);
      else if (info.isFile()) entries.push({ name: path.relative(root, file), size: info.size,
        sha256: createHash('sha256').update(await readFile(file)).digest('hex') });
      else throw Error('update_migration_backup_invalid');
    }
  }
  await walk(root); return entries;
}

// Native-only production adapter. It upgrades the independent supervisor and
// manager together while their owned app is stopped. App identity stays at the
// already installed signed version; failure restores 8888, never browser data.
export class UpdateOriginNativeAdapter {
  constructor({ paths, manager, runtime, deployment, profile, assertConsent, projectRoot,
    census = () => workbenchPageCensus({ ports: [8888, 3000] }), bridgeFactory = createUpdateOriginBrowserBridge,
    timeoutMs = 10 * 60 * 1000 }) {
    Object.assign(this, { paths, manager, runtime, deployment, profile, assertConsent, projectRoot, census, bridgeFactory, timeoutMs });
    this.serviceOptions = { socketPath: path.join(paths.updates, 's.sock'), capabilityFile: path.join(paths.updates, 'supervisor.capability') };
    this.active = null; this.bridge = null; this.saved = null; this.old = null; this.upcoming = null;
  }
  async assertClosed() {
    await this.assertConsent();
    const value = await this.census();
    if (value?.workbenchPagesClosed !== true || !Array.isArray(value.blockers) || value.blockers.length)
      throw Error('install_browsers_running');
  }
  async verify(pointer) {
    if (!same(await this.manager.readCurrent(), pointer)) throw Error('update_migration_identity_changed');
    await this.manager.verifyInstalled(pointer);
  }
  async backup(value) {
    const directory = path.join(this.paths.backups, 'online-update-' + value.id);
    await privateDirectory(directory);
    const files = await inventory(this.paths.data);
    await cp(this.paths.data, path.join(directory, 'data'), { recursive: true, force: false, errorOnExist: true });
    if (JSON.stringify(files) !== JSON.stringify(await inventory(this.paths.data))
      || JSON.stringify(files) !== JSON.stringify(await inventory(path.join(directory, 'data')))) throw Error('update_migration_backup_changed');
    await writePrivateFile(path.join(directory, 'PRIVATE-BACKUP.json'), JSON.stringify({ format: 1, files }), { exclusive: true });
    await this.runtime.prepare(value.next);
    const record = await this.deployment.read();
    if (record?.phase !== 'committed') throw Error('updater_deployment_recovery_required');
    this.old = { record, manager: (await this.deployment.descriptors(record.next)).manager,
      supervisor: (await this.deployment.descriptors(record.supervisor)).supervisor };
    this.upcoming = await this.deployment.descriptors(value.next);
    this.saved = {};
    for (const name of ['installation/service-origin.json', 'updater-deployment/deployment.json'])
      this.saved[name] = await readPrivateFile(path.join(this.paths.root, name), { maxBytes: 16384 });
    for (const role of ['manager', 'supervisor']) {
      await this.deployment.plist(this.old[role]);
      if (!await this.deployment.jobs.inspect(this.deployment.labels[role], this.old[role])) throw Error('service_ownership_lost');
      await writePrivateFile(path.join(directory, role + '.plist'), this.old[role].bytes, { exclusive: true });
    }
    await writePrivateFile(path.join(directory, 'STARTUP-BACKUP.json'), JSON.stringify({ saved: this.saved, old: record }), { exclusive: true });
    return { directory, files };
  }
  async copyAndVerify(value) {
    await this.assertClosed();
    await this.deployment.jobs.stop(this.deployment.labels.manager, this.old.manager);
    this.active = new SupervisedUpdateService(this.serviceOptions);
    const owned = await this.active.inspectOwned();
    if (owned.stopped || !same(owned.pointer, this.old.record.next)) throw Error('service_ownership_lost');
    await this.active.stop({ allowed: [this.old.record.next] });
    this.bridge = this.bridgeFactory({ backupRoot: this.paths.backups, extensionId: this.profile.extensionId,
      browserSession: this.profile.browserSession, sourceOrigin: value.source,
      contractRoot: new URL('../shared/data-contract/', import.meta.url), timeoutMs: this.timeoutMs });
    try {
      await this.bridge.listen();
      const deadline = Date.now() + this.timeoutMs;
      while (this.bridge.status().phase !== 'browser-verified') {
        await this.assertConsent();
        if (this.bridge.status().failed || this.bridge.status().expired || Date.now() > deadline) throw Error('update_migration_browser_unverified');
        await pause(250);
      }
      const proof = await this.bridge.verify();
      // Extension closes only the temporary documents it created. Any other
      // window/profile, changed tab or new app page must block the switch.
      while (true) {
        await this.assertConsent();
        const result = await this.census();
        if (result?.workbenchPagesClosed === true && Array.isArray(result.blockers) && !result.blockers.length) break;
        if (Date.now() > deadline) throw Error('install_browsers_running');
        await pause(250);
      }
      await this.bridge.close(); return proof;
    } catch (error) {
      // Keep the status endpoint briefly available so the extension may close
      // its known temporary documents. No arbitrary customer tab is closed.
      this.bridge.abort();
      for (let n = 0; n < 40; n++) {
        try { const value = await this.census(); if (value.workbenchPagesClosed && !value.blockers.length) break; } catch { /* unknown remains blocked */ }
        await pause(250);
      }
      await this.bridge.close(); throw error;
    }
  }
  async verifyBackup(value) {
    if (!value.backup?.directory || !value.proof?.directory) throw Error('update_migration_backup_unverified');
    if (JSON.stringify(await inventory(path.join(value.backup.directory, 'data'))) !== JSON.stringify(value.backup.files))
      throw Error('update_migration_backup_unverified');
    await this.bridge.verify();
  }
  async switchService(value) {
    await this.assertClosed(); this.active.disconnect();
    await this.deployment.jobs.stop(this.deployment.labels.supervisor, this.old.supervisor);
    await writePrivateFile(path.join(this.paths.root, 'installation/service-origin.json'), JSON.stringify({ format: 1,
      origin: 'http://127.0.0.1:3000', migration: path.basename(value.proof.directory) }));
    await this.deployment.write(this.upcoming.supervisor, false, [this.old.supervisor.bytes]);
    await this.deployment.write(this.upcoming.manager, false, [this.old.manager.bytes]);
    await this.deployment.jobs.start(this.deployment.labels.supervisor, this.upcoming.supervisor);
    this.active = new SupervisedUpdateService(this.serviceOptions);
    await this.waitOwner();
    this.manager.origin = 'http://127.0.0.1:3000';
    await this.active.start(value.next);
  }
  async waitOwner() {
    for (let n = 0; n < 100; n++) {
      try { await this.active.inspectOwned(); return; } catch { this.active.disconnect(); await pause(100); }
    }
    throw Error('service_supervisor_unavailable');
  }
  async health(value) {
    const owned = await this.active.inspectOwned();
    const response = await fetch('http://127.0.0.1:3000/local-app/health', { signal: AbortSignal.timeout(3000) });
    const health = await response.json();
    if (!response.ok || !health.ready || !health.maintenance || health.origin !== 'http://127.0.0.1:3000'
      || health.version !== value.next.version || health.buildId !== value.next.buildId || owned.stopped
      || !same(owned.pointer, value.next)) throw Error('update_health_failed');
  }
  async activate(value) {
    await this.assertClosed();
    await this.active.activate(value.next);
    await writePrivateFile(this.deployment.file, JSON.stringify({ format: 1, phase: 'committed',
      previous: same(this.old.record.next, value.next) ? this.old.record.previous : this.old.record.next,
      next: value.next, supervisor: value.next }));
    this.active.disconnect();
    await this.deployment.jobs.start(this.deployment.labels.manager, this.upcoming.manager);
  }
  async rollback(value) {
    await this.bridge?.close();
    if (!this.old && value.backup?.directory) {
      if (path.dirname(value.backup.directory) !== this.paths.backups || !/^online-update-[a-f0-9-]{36}$/.test(path.basename(value.backup.directory)))
        throw Error('update_migration_backup_invalid');
      const backup = JSON.parse(await readPrivateFile(path.join(value.backup.directory, 'STARTUP-BACKUP.json'), { maxBytes: 65536 }));
      this.saved = backup.saved;
      this.old = { record: backup.old, manager: (await this.deployment.descriptors(backup.old.next)).manager,
        supervisor: (await this.deployment.descriptors(backup.old.supervisor)).supervisor };
      this.upcoming = await this.deployment.descriptors(value.next);
    }
    if (!this.old) return; // Backup failure before any process mutation.
    await this.assertClosed();
    this.active?.disconnect();
    const supervisorBytes = await readPrivateFile(this.old.supervisor.plist, { maxBytes: 16384 });
    if (supervisorBytes === this.upcoming.supervisor.bytes) {
      if (await this.deployment.jobs.inspect(this.deployment.labels.supervisor, this.upcoming.supervisor)) {
        this.active = new SupervisedUpdateService(this.serviceOptions); await this.waitOwner();
        await this.active.stop({ allowed: [value.next] }); this.active.disconnect();
        await this.deployment.jobs.stop(this.deployment.labels.supervisor, this.upcoming.supervisor);
      }
      await this.deployment.write(this.old.supervisor, false, [this.upcoming.supervisor.bytes]);
    } else if (supervisorBytes !== this.old.supervisor.bytes) throw Error('service_ownership_lost');
    const managerBytes = await readPrivateFile(this.old.manager.plist, { maxBytes: 16384 });
    if (managerBytes === this.upcoming.manager.bytes) await this.deployment.write(this.old.manager, false, [this.upcoming.manager.bytes]);
    else if (managerBytes !== this.old.manager.bytes) throw Error('service_ownership_lost');
    await writePrivateFile(path.join(this.paths.root, 'installation/service-origin.json'), this.saved['installation/service-origin.json']
      || JSON.stringify({ format: 1, origin: 'http://127.0.0.1:8888' }));
    await writePrivateFile(this.deployment.file, this.saved['updater-deployment/deployment.json']);
    this.manager.origin = 'http://127.0.0.1:8888';
    if (!await this.deployment.jobs.inspect(this.deployment.labels.supervisor, this.old.supervisor))
      await this.deployment.jobs.start(this.deployment.labels.supervisor, this.old.supervisor);
    this.active = new SupervisedUpdateService(this.serviceOptions); await this.waitOwner();
    if (await this.active.isStopped()) { await this.active.start(value.next); await this.active.activate(value.next); }
    this.active.disconnect();
    if (!await this.deployment.jobs.inspect(this.deployment.labels.manager, this.old.manager))
      await this.deployment.jobs.start(this.deployment.labels.manager, this.old.manager);
  }
  disconnect() { this.active?.disconnect(); }
}
