import path from 'node:path';
import { readPrivateFile, writePrivateJson } from './runtime-paths.mjs';
import { compareVersions, parseVersion, validRepository } from './stable-version.mjs';
import { readGitHubStable } from './github-stable.mjs';
import { UpdateError } from './update-auth.mjs';
import { STABLE_REPOSITORY, isWorkbenchRepository, isPublicUpdateRepository, sameWorkbenchRepository } from './workbench-identity.mjs';
import { acceptsUpdateVersion, requireUpdateChannel, readUpdateDeveloperMode, saveUpdateDeveloperMode } from './更新发布渠道.mjs';

export const UPDATE_INTERVAL_MS = 6 * 60 * 60 * 1000;
const defaults = () => ({ version: 1, repository: STABLE_REPOSITORY, autoCheck: true, autoDownload: true, autoInstall: false, developerMode: false, network: 'auto' });
export class SoftwareUpdates {
  constructor({ directory, auth, currentVersion, downloader = null, manager = null, progress = null, proxyUrl = () => null, readRelease = readGitHubStable, now = Date.now, lockRepository = true }) {
    this.progress = progress;
    this.lockRepository = lockRepository;
    this.downloader = downloader;
    this.manager = manager; this.staging = null; this.stageResult = null;
    this.stopped = false;
    this.file = path.join(directory, 'preferences.json'); this.auth = auth; this.currentVersion = currentVersion;
    this.directory = directory;
    this.historyFile = path.join(directory, 'check-history.json');
    this.proxyUrl = proxyUrl; this.readRelease = readRelease; this.now = now; this.tail = Promise.resolve();
    this.result = { state: 'unconfigured', latest: null, lastCheckedAt: null, error: null, history: [] }; this.inFlight = null; this.timer = null;
  }
  serial(fn) { const next = this.tail.catch(() => {}).then(fn); this.tail = next; return next; }
  matchesPreferences(p) { return this.result.repository === p.repository && (this.result.developerMode ?? false) === p.developerMode && (!this.result.latest || acceptsUpdateVersion(this.result.latest.version, p.developerMode)); }
  async history(repository) {
    try {
      const raw = await readPrivateFile(this.historyFile, { maxBytes: 32768 });
      if (raw === null) return [];
      const h = JSON.parse(raw);
      if (h.version !== 1 || !validRepository(h.repository) || !Array.isArray(h.entries) || h.entries.length > 30
        || Object.keys(h).some(k => !['version', 'repository', 'entries'].includes(k))
        || h.entries.some(e => !e || typeof e.at !== 'string' || !Number.isFinite(Date.parse(e.at))
          || !['available', 'up-to-date', 'no-stable-release', 'error'].includes(e.state)
          || e.version !== null && !parseVersion(e.version)
          || e.error !== null && (typeof e.error !== 'string' || !/^[a-z_]{1,80}$/.test(e.error))
          || Object.keys(e).some(k => !['at', 'state', 'version', 'error'].includes(k)))) throw Error();
      return sameWorkbenchRepository(h.repository, repository) ? h.entries : [];
    } catch { throw new UpdateError('update_history_invalid'); }
  }
  async preferences() {
    try {
      const raw = await readPrivateFile(this.file, { maxBytes: 4096 });
      if (raw === null) return { ...defaults(), developerMode: await readUpdateDeveloperMode(this.directory) };
      const p = JSON.parse(raw);
      if (p.version !== 1 || p.repository !== '' && !validRepository(p.repository) || ['autoCheck', 'autoDownload', 'autoInstall'].some(k => typeof p[k] !== 'boolean')
        || p.developerMode !== undefined && typeof p.developerMode !== 'boolean'
        || !['auto', 'direct', 'proxy'].includes(p.network) || Object.keys(p).some(k => !Object.hasOwn(defaults(), k))) throw Error();
      return { ...defaults(), ...p, developerMode: await readUpdateDeveloperMode(this.directory), ...(this.lockRepository || isWorkbenchRepository(p.repository) ? { repository: STABLE_REPOSITORY } : {}) };
    } catch { throw new UpdateError('update_storage_invalid'); }
  }
  async status(context) {
    try {
      const p = await this.preferences(), meta = isPublicUpdateRepository(p.repository) ? null : await this.auth.metadata(), history = await this.history(p.repository);
      const bound = Boolean(meta && meta.repository.toLowerCase() === p.repository.toLowerCase());
      // Never show a previously checked repository's release after external config change.
      const result = this.matchesPreferences(p) ? this.result : { state: p.repository ? 'unchecked' : 'unconfigured', latest: null, lastCheckedAt: null, error: null, history: [] };
      const cached = this.downloader?.status(p.repository);
      const download = cached?.version && !acceptsUpdateVersion(cached.version, p.developerMode) ? { state: 'idle', progress: 0 } : cached || { state: 'not-implemented', progress: 0 };
      const install = await this.manager?.status();
      const excluded = install?.targetVersion && !acceptsUpdateVersion(install.targetVersion, p.developerMode);
      const latest = result.latest ? { version: result.latest.version, publishedAt: result.latest.publishedAt, notes: result.latest.notes,
        verification: download.state === 'verified' && download.version === result.latest.version ? 'verified' : result.latest.verification } : null;
      return { ...result, latest, history, lastCheckedAt: result.lastCheckedAt || history.at(-1)?.at || null, currentVersion: this.currentVersion, preferences: p, channel: `${isPublicUpdateRepository(p.repository) ? 'GitHub Public' : 'GitHub Private'} / ${p.developerMode ? 'Beta + Stable' : 'Stable'}`,
        authorization: isPublicUpdateRepository(p.repository) ? 'not-required' : bound ? 'configured-not-verified' : 'required', checking: Boolean(this.inFlight),
        hasNewVersion: Boolean(result.latest && compareVersions(result.latest.version, this.currentVersion) > 0),
        download, install: this.manager ? { ...install, ...(excluded ? { canApprove: false, reason: 'update_channel_excluded' } : {}),
          staging: Boolean(this.staging), stageError: this.stageResult?.repository === p.repository ? this.stageResult.error : null }
          : { allowed: false, state: 'disabled' } };
    } catch (e) { return { ...this.result, latest: null, currentVersion: this.currentVersion, preferences: defaults(), channel: 'GitHub Private / Stable', authorization: 'unavailable', checking: false, hasNewVersion: false, error: e.code || 'update_storage_invalid', state: 'error', download: { state: 'not-implemented', progress: 0 }, install: { allowed: false, state: 'disabled' } }; }
  }
  configure(input) {
    return this.serial(async () => {
      if (this.lockRepository && input?.repository !== undefined && input.repository !== STABLE_REPOSITORY)
        throw new UpdateError('update_repository_locked');
      if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k => !['repository', 'autoCheck', 'autoDownload', 'autoInstall', 'developerMode', 'network'].includes(k))
        || input.repository !== undefined && input.repository !== '' && !validRepository(input.repository)
        || ['autoCheck', 'autoDownload', 'autoInstall', 'developerMode'].some(k => input[k] !== undefined && typeof input[k] !== 'boolean')
        || input.network !== undefined && !['auto', 'direct', 'proxy'].includes(input.network)) throw new UpdateError('invalid_update_preferences');
      const old = await this.preferences(), next = { ...old, ...input, ...(this.lockRepository ? { repository: STABLE_REPOSITORY } : {}) };
      await this.history(old.repository); // Bad history is preserved, not silently reset.
      const channelChanged = next.developerMode !== old.developerMode;
      if (channelChanged) {
        const install = await this.manager?.status();
        if (this.staging || ['prepared', 'stopping', 'switching', 'starting', 'restarting-manager', 'rolling-back'].includes(install?.state)) throw new UpdateError('update_channel_busy');
        if (install?.targetVersion && !acceptsUpdateVersion(install.targetVersion, next.developerMode)) await this.manager.defer();
      }
      if (Object.keys(input).some(key => key !== 'developerMode')) {
        const { developerMode: _mode, ...legacyPreferences } = next;
        await writePrivateJson(this.file, legacyPreferences);
      }
      if (channelChanged) await saveUpdateDeveloperMode(this.directory, next.developerMode);
      if (next.repository !== old.repository || channelChanged) {
        if (next.repository !== old.repository || !acceptsUpdateVersion(this.downloader?.status(old.repository).version, next.developerMode)) this.downloader?.cancel?.();
        this.result = { repository: next.repository, developerMode: next.developerMode, state: 'unchecked', latest: null, lastCheckedAt: null, error: null, history: [] };
        this.stageResult = null;
      }
      return this.status();
    });
  }
  check({ automatic = false } = {}) {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.serial(async () => {
      let p;
      try {
        p = await this.preferences();
        if (automatic && !p.autoCheck) return this.status();
        if (!p.repository) throw new UpdateError('repository_required');
        this.result.history = await this.history(p.repository);
        if (this.matchesPreferences(p) && this.result.lastCheckedAt && this.now() - Date.parse(this.result.lastCheckedAt) < 60_000) return this.status();
        const token = await this.auth.token(p.repository);
        const proxy = p.network === 'direct' ? null : this.proxyUrl();
        if (p.network === 'proxy' && !proxy) throw new UpdateError('proxy_unavailable');
        const candidate = await this.readRelease({ repository: p.repository, token, developerMode: p.developerMode, network: p.network, proxyUrl: proxy, signal: AbortSignal.timeout(30000) });
        const latest = candidate && acceptsUpdateVersion(candidate.version, p.developerMode) ? candidate : null;
        this.result = { ...this.result, repository: p.repository, developerMode: p.developerMode, latest,
          state: latest && compareVersions(latest.version, this.currentVersion) > 0 ? 'available' : latest ? 'up-to-date' : 'no-stable-release', error: null };
      } catch (e) {
        this.result = { ...this.result, repository: p?.repository || '', developerMode: p?.developerMode ?? false, state: 'error', error: e instanceof UpdateError ? e.code : 'update_check_failed' };
      }
      const time = new Date(this.now()).toISOString();
      this.result.lastCheckedAt = time;
      this.result.history = [...this.result.history, { at: time, state: this.result.state, version: this.result.latest?.version || null, error: this.result.error }].slice(-30);
      if (p?.repository) {
        try {
          await this.history(p.repository);
          await writePrivateJson(this.historyFile, { version: 1, repository: p.repository, entries: this.result.history });
        } catch { this.result.error = 'update_history_invalid'; this.result.state = 'error'; }
      }
      if (!this.stopped && p?.autoDownload && this.result.state === 'available') void this.beginDownload(p).catch(e => {
        if (this.matchesPreferences(p)) this.downloader?.failure(p.repository, e instanceof UpdateError ? e.code : 'asset_download_failed');
      });
      return this.status().then(status => ({ ...status, checking: false }));
    }).finally(() => { this.inFlight = null; });
    return this.inFlight;
  }
  async beginDownload(p) {
    if (this.stopped) throw new UpdateError('update_service_stopped');
    if (!this.downloader) throw new UpdateError('download_unavailable');
    if (this.staging) throw new UpdateError('update_stage_unavailable');
    const install = await this.manager?.status?.();
    if (install?.canApprove || ['awaiting-browser-exit', 'starting', 'rolling-back'].includes(install?.state)) return;
    const release = this.result.latest;
    const current = await this.preferences();
    if (current.repository !== p.repository || current.developerMode !== p.developerMode || !this.matchesPreferences(current) || this.result.state !== 'available') throw new UpdateError('release_not_available');
    requireUpdateChannel(release?.version, current);
    const cached = this.downloader.status(p.repository);
    if (cached.state === 'verified' && cached.version === this.result.latest.version) return;
    const token = await this.auth.token(p.repository);
    const proxy = current.network === 'direct' ? null : this.proxyUrl();
    if (current.network === 'proxy' && !proxy) throw new UpdateError('proxy_unavailable');
    const finalPreferences = await this.preferences();
    if (this.stopped || finalPreferences.repository !== p.repository || finalPreferences.developerMode !== p.developerMode || !this.matchesPreferences(finalPreferences) || this.result.latest !== release) throw new UpdateError('release_not_available');
    void this.downloader.download({ repository: p.repository, release, token, network: current.network, proxyUrl: proxy, currentVersion: this.currentVersion });
  }
  async download() {
    // Start only: HTTP never waits for a potentially large package or accepts URLs.
    const p = await this.preferences();
    if (!this.downloader || this.result.repository !== p.repository || this.result.state !== 'available') throw new UpdateError('release_not_available');
    await this.beginDownload(p);
    return this.status();
  }
  async stage() {
    if (this.stopped || !this.manager || !this.downloader?.stageIdentity) throw new UpdateError('update_stage_unavailable');
    if (this.staging) return this.status();
    const p = await this.preferences(), identity = this.downloader.stageIdentity(p.repository);
    requireUpdateChannel(identity.version, p);
    // Concurrent iframe requests can both pass the first check before the
    // preferences read resolves. Recheck immediately before acquiring the job.
    if (this.stopped) throw new UpdateError('update_stage_unavailable');
    if (this.staging) return this.status();
    // No caller-supplied identity is accepted. The downloader is the only
    // source, and the independent manager verifies all bytes again.
    if (compareVersions(identity.version, this.currentVersion) <= 0) throw new UpdateError('version_not_newer');
    this.stageResult = { repository: p.repository, error: null };
    this.staging = this.manager.stage(identity).catch(e => {
      this.stageResult = { repository: p.repository, error: e instanceof UpdateError ? e.code : 'update_stage_failed' };
    }).finally(() => { this.staging = null; });
    return this.status();
  }
  async approve(acknowledgement, { manual = false } = {}) {
    if (this.stopped || !this.manager?.approve || this.staging) throw new UpdateError('update_stage_unavailable');
    const p = await this.preferences();
    if (!p.autoInstall && !manual) throw new UpdateError('install_disabled');
    if (acknowledgement !== 'saved-and-all-tasks-ended') throw new UpdateError('install_operator_confirmation_required');
    let identity;
    try { identity = await this.manager.stagedIdentity?.(); }
    catch (error) { if (error.code !== 'invalid_request') throw error; } // 已安装旧管理器的过渡兼容。
    identity ||= this.downloader?.stageIdentity?.(p.repository);
    if (!identity || identity.repository !== p.repository) throw new UpdateError('update_stage_unavailable');
    requireUpdateChannel(identity.version, p);
    if (compareVersions(identity.version, this.currentVersion) <= 0) throw new UpdateError('version_not_newer');
    try { await this.manager.approve(identity, acknowledgement); }
    catch (e) { this.progress?.failed(); throw e; }
    return this.status();
  }
  async progressWindow() {
    if (this.stopped || !this.manager || !this.progress) throw new UpdateError('update_progress_unavailable');
    const p = await this.preferences();
    // 重启后已暂存的签名身份来自管理器，不要求重新下载同一安装包。
    const identity = await this.manager.stagedIdentity?.() || this.downloader?.stageIdentity?.(p.repository);
    if (!identity || identity.repository !== p.repository) throw new UpdateError('update_progress_unavailable');
    requireUpdateChannel(identity.version, p);
    if (compareVersions(identity.version, this.currentVersion) <= 0) throw new UpdateError('version_not_newer');
    try { return await this.progress.open(identity.version); }
    catch (error) { if (error.code === 'invalid_request') throw new UpdateError('update_progress_unavailable'); throw error; }
  }
  async defer() {
    if (!this.manager?.defer) throw new UpdateError('update_manager_unavailable');
    await this.manager.defer(); return this.status();
  }
  start({ setIntervalFn = setInterval } = {}) {
    if (this.timer) return;
    this.stopped = false;
    void Promise.resolve().then(() => this.downloader?.cleanup?.(this.currentVersion))
      .then(() => { if (!this.stopped) return this.check({ automatic: true }); })
      .catch(async error => {
        const p = await this.preferences().catch(() => defaults());
        this.result = { ...this.result, repository: p.repository, developerMode: p.developerMode, state: 'error', error: error.code || 'download_storage_failed' };
      });
    this.timer = setIntervalFn(() => { void this.check({ automatic: true }); }, UPDATE_INTERVAL_MS);
    this.timer.unref?.();
  }
  stop() { this.stopped = true; clearInterval(this.timer); this.timer = null; this.downloader?.cancel(); }
}
