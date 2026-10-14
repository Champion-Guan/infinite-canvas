import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { readPrivateFile, writePrivateFile } from './runtime-paths.mjs';

const terminal = new Set(['committed', 'rolled-back']);
const phases = new Set(['prepared', 'backing-up', 'copying', 'browser-verified', 'switching', 'health-check',
  'committed', 'rolling-back', 'rolled-back', 'recovery-required']);
const origin = value => ['http://localhost:8888', 'http://127.0.0.1:8888', 'http://localhost:3000'].includes(value);

// Origin migration has its own durable transaction. Adapters own the signed
// payload, exact process/launchd identity and the browser profile. No browser
// URL, shell command, path or user data is accepted as an installation grant.
export class UpdateOriginTransaction {
  constructor({ file, adapter, onStep = async () => {} }) {
    if (!path.isAbsolute(file || '') || path.resolve(file) !== file || typeof onStep !== 'function'
      || ['verify', 'assertClosed', 'backup', 'copyAndVerify', 'verifyBackup', 'switchService', 'health', 'rollback']
        .some(method => typeof adapter?.[method] !== 'function')) throw Error('update_migration_invalid');
    Object.assign(this, { file, adapter, onStep }); this.busy = false;
  }
  async read() {
    const raw = await readPrivateFile(this.file, { maxBytes: 16384 });
    if (raw === null) return null;
    let value; try { value = JSON.parse(raw); } catch { throw Error('update_migration_record_invalid'); }
    if (!value || value.format !== 1 || !phases.has(value.phase) || !/^[a-f0-9-]{36}$/.test(value.id || '')
      || !origin(value.source) || value.source.endsWith(':3000') || value.target !== 'http://localhost:3000'
      || typeof value.next?.id !== 'string' || !/^[0-9A-Za-z.+-]{1,160}$/.test(value.next.id)
      || Object.keys(value.next).sort().join(',') !== 'buildId,commit,id,version'
      || !/^\d+\.\d+\.\d+$/.test(value.next?.version || '') || !/^[a-f0-9]{40}$/.test(value.next?.commit || '')
      || !/^[a-f0-9]{24}$/.test(value.next?.buildId || '')
      || !Number.isSafeInteger(value.sequence) || value.sequence < 0) throw Error('update_migration_record_invalid');
    return value;
  }
  async record(value, phase) {
    value.phase = phase; value.sequence++;
    await writePrivateFile(this.file, JSON.stringify(value));
    // Presentation failure cannot invalidate a durable transaction.
    try { await this.onStep({ phase, sequence: value.sequence, version: value.next.version }); } catch { /* read-only UI */ }
  }
  async run({ source, next, lease }) {
    if (this.busy) throw Error('update_migration_busy');
    if (!origin(source) || source.endsWith(':3000') || typeof lease?.assertValid !== 'function') throw Error('update_migration_invalid');
    this.busy = true;
    let value, switching = false;
    try {
      const old = await this.read();
      if (old && !terminal.has(old.phase)) throw Error('update_migration_recovery_required');
      // A completed copy is not reusable for a newer version: the destination
      // may have been edited, so no stale receipt can authorize an overwrite.
      if (old?.phase === 'committed') throw Error('update_migration_already_committed');
      next = Object.freeze(structuredClone(next));
      await this.adapter.verify(next);
      await lease.assertValid(); await this.adapter.assertClosed();
      value = { format: 1, id: randomUUID(), phase: 'prepared', sequence: 0, source,
        target: 'http://localhost:3000', next, backup: null, proof: null };
      await this.record(value, 'prepared');
      await this.record(value, 'backing-up');
      value.backup = await this.adapter.backup(structuredClone(value));
      await lease.assertValid(); await this.adapter.assertClosed();
      await this.record(value, 'copying');
      // Only explicitly owned temporary export/copy documents may be opened
      // here. No application UI may write either Origin during the copy.
      value.proof = await this.adapter.copyAndVerify(structuredClone(value));
      await this.adapter.verifyBackup(structuredClone(value));
      await lease.assertValid(); await this.adapter.assertClosed();
      await this.record(value, 'browser-verified');
      await this.adapter.verify(next); // Recheck signed inventory before switching.
      await lease.assertValid(); await this.adapter.assertClosed();
      await this.record(value, 'switching'); switching = true;
      await this.adapter.switchService(structuredClone(value));
      await lease.assertValid(); await this.adapter.assertClosed();
      await this.record(value, 'health-check');
      await this.adapter.health(structuredClone(value));
      await this.adapter.verifyBackup(structuredClone(value));
      await lease.assertValid(); await this.adapter.assertClosed();
      await this.record(value, 'committed');
      return { state: 'committed', version: next.version, origin: value.target };
    } catch (error) {
      if (!value) throw error;
      // Failures before service mutation leave the old app intact. Preserve
      // incomplete browser copies and every backup; never replay automatically.
      if (!switching) {
        // Native preparation may already have stopped the old app to expose
        // read-only exporters. Restore startup even if copying never completed.
        try { await lease.assertValid(); await this.adapter.assertClosed(); await this.adapter.rollback(structuredClone(value)); }
        catch { await this.record(value, 'recovery-required'); throw Error('update_migration_recovery_required'); }
        await this.record(value, 'recovery-required');
        throw Error('update_migration_safely_stopped');
      }
      try {
        await lease.assertValid(); await this.adapter.assertClosed();
        await this.record(value, 'rolling-back');
        await this.adapter.rollback(structuredClone(value));
        await lease.assertValid(); await this.adapter.assertClosed();
        await this.record(value, 'rolled-back');
      } catch {
        await this.record(value, 'recovery-required');
        throw Error('update_migration_recovery_required');
      }
      throw Error('update_migration_failed_rolled_back');
    } finally { this.busy = false; }
  }
  async recover({ lease }) {
    if (this.busy || typeof lease?.assertValid !== 'function') throw Error('update_migration_invalid');
    this.busy = true;
    try {
      const value = await this.read();
      if (!value || terminal.has(value.phase)) return { state: value?.phase || 'not-started' };
      // A restart never resumes partially copied browser storage. Recovery
      // restores startup metadata only, after a renewed exact maintenance grant.
      await this.adapter.verify(value.next);
      await lease.assertValid(); await this.adapter.assertClosed();
      await this.record(value, 'rolling-back');
      await this.adapter.rollback(structuredClone(value));
      await lease.assertValid(); await this.adapter.assertClosed();
      await this.record(value, 'rolled-back');
      return { state: 'rolled-back' };
    } finally { this.busy = false; }
  }
}
