import path from 'node:path';
import { realpath } from 'node:fs/promises';
import { fork } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readPrivateFile, writePrivateFile } from './runtime-paths.mjs';

const origins = ['http://localhost:8888', 'http://127.0.0.1:8888'];
const uuid = value => /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value || '');
const busy = new Set(['prepared', 'backing-up', 'copying', 'browser-verified', 'switching', 'health-check', 'committed']);

// One-time transition for already-installed 8888 clients. Source development
// is explicitly excluded; the native worker executes only its sealed signed
// installation. A profile witness never authorizes migration by itself.
export class OnlineUpdateMigration {
  constructor({ paths, manager, projectRoot, instance, version, enabled, ready, now = Date.now }) {
    Object.assign(this, { paths, manager, projectRoot, instance, version, enabled, ready, now });
    this.profileDirectory = path.join(paths.updates, 'origin-browser-profiles');
    this.consentFile = path.join(paths.updates, 'origin-consent.json');
    this.journalFile = path.join(paths.updates, 'origin-transaction.json');
    this.launching = false; this.child = null;
  }
  async register(value, sourceOrigin) {
    if (!this.enabled || !origins.includes(sourceOrigin) || !value || Object.keys(value).sort().join(',') !== 'browserSession,extensionId,extensionVersion'
      || !/^[a-p]{32}$/.test(value.extensionId || '') || !uuid(value.browserSession) || value.extensionVersion !== '1.0.4') throw Error('update_migration_extension_required');
    await writePrivateFile(path.join(this.profileDirectory, value.browserSession + '.json'), JSON.stringify({ ...value, sourceOrigin, instance: this.instance,
      version: this.version, registeredAt: this.now() }));
  }
  async profile(context) {
    if (!uuid(context?.migrationSession) || !origins.includes(context?.sourceOrigin)) return null;
    const raw = await readPrivateFile(path.join(this.profileDirectory, context.migrationSession + '.json'), { maxBytes: 4096 });
    if (raw === null) return null;
    const value = JSON.parse(raw);
    if (value.instance !== this.instance || value.version !== this.version || value.sourceOrigin !== context.sourceOrigin
      || value.extensionVersion !== '1.0.4' || !/^[a-p]{32}$/.test(value.extensionId || '') || !uuid(value.browserSession)
      || !Number.isSafeInteger(value.registeredAt) || this.now() < value.registeredAt || this.now() - value.registeredAt > 30000) return null;
    return value;
  }
  async status(context) {
    if (!this.enabled) return null;
    const raw = await readPrivateFile(this.journalFile, { maxBytes: 16384 });
    if (raw !== null) {
      const record = JSON.parse(raw);
      if (record.next?.version === this.version && record.phase !== 'rolled-back') {
        if (record.phase === 'committed') return { state: 'migration-starting', migrationRequired: true, targetVersion: this.version };
        if (record.phase === 'recovery-required') return { state: 'recovery-required', migrationRequired: true,
          targetVersion: this.version, reason: 'update_migration_recovery_required' };
        if (busy.has(record.phase)) return { state: 'migration-' + record.phase, migrationRequired: true, targetVersion: this.version };
      }
    }
    const consent = await readPrivateFile(this.consentFile, { maxBytes: 8192 });
    if (consent) {
      const value = JSON.parse(consent);
      if (value.instance === this.instance && value.version === this.version && this.now() <= value.expiresAt)
        return { state: 'awaiting-browser-exit', migrationRequired: true, targetVersion: this.version };
    }
    return { state: 'migration-required', migrationRequired: true, targetVersion: this.version,
      reason: await this.profile(context) ? null : 'update_migration_extension_required' };
  }
  async approve(acknowledgement, context) {
    if (!this.enabled || this.launching || this.child || acknowledgement !== 'saved-and-all-tasks-ended') throw Error('update_migration_invalid');
    this.launching = true;
    try {
      const status = await this.status(context);
      if (status.state !== 'migration-required') throw Error('update_migration_recovery_required');
      const profile = await this.profile(context);
      if (!profile) throw Error('update_migration_extension_required');
      await this.ready();
      const pointer = await this.manager.readCurrent(), checked = await this.manager.verifyInstalled(pointer);
      if (pointer.version !== this.version || await realpath(this.projectRoot) !== await realpath(checked.directory))
        throw Error('update_migration_unsigned');
      const receipt = { format: 1, id: randomUUID(), acknowledgement, instance: this.instance, version: this.version,
        pointer, profile, expiresAt: this.now() + 30 * 60 * 1000 };
      await writePrivateFile(this.consentFile, JSON.stringify(receipt));
      // The entry and runtime are already bound to the signed file inventory.
      const child = fork(path.join(checked.directory, 'scripts/run-online-migration.mjs'), [], {
        execPath: path.join(checked.directory, 'runtime/node'), detached: true, stdio: 'ignore',
        env: { PATH: '/usr/bin:/bin', HOME: process.env.HOME, GUAN_WORKBENCH_DATA_DIR: this.paths.root },
      });
      this.child = child;
      child.on('error', () => { this.child = null; }); child.on('exit', () => { this.child = null; }); child.unref();
      return { state: 'awaiting-browser-exit', migrationRequired: true, targetVersion: this.version };
    } finally { this.launching = false; }
  }
}
