import { UpdateError } from './update-auth.mjs';

// 仅记录本进程的页面准备状态；真实任务与保存仍由原业务端口核实。
export function createIdleUpgradeCoordinator({ updates, pages = () => [], generation, now = Date.now }) {
  const reports = new Map();
  let requested = false, deferred = null, target = null, blocked = null, flight = null, stopped = false, timer, epoch = 0;
  let state = { mode: null, state: 'idle', reason: null };
  const set = (mode, next, reason = null) => { state = { mode, state: next, reason }; };
  const resetReports = () => { for (const report of reports.values()) report.prepared = false; };
  async function step() {
    if (stopped) return;
    const started = epoch;
    const status = await updates.status(), install = status.install;
    if (!install?.allowed) { set(null, 'idle'); return; }
    if (install.state === 'awaiting-browser-exit' || ['prepared', 'stopping', 'switching', 'starting', 'restarting-manager', 'rolling-back'].includes(install.state)) return;
    const candidate = install.targetVersion || (status.download.state === 'verified' ? status.download.version || status.latest?.version : null);
    const version = candidate === status.currentVersion ? null : candidate;
    if (target !== version) { target = version; blocked = null; resetReports(); }
    const mode = requested ? 'manual' : status.preferences.autoInstall && version !== deferred ? 'automatic' : null;
    if (!mode || !version) { set(null, 'idle'); resetReports(); return; }
    if (blocked) { set(mode, 'blocked', blocked); return; }
    if (install.stageError) { blocked = install.stageError; set(mode, 'blocked', blocked); return; }
    if (install.staging) { set(mode, 'staging'); return; }
    if (!install.canApprove) {
      if (status.download.state !== 'verified') { set(mode, 'waiting', 'upgrade_waiting_download'); return; }
      set(mode, 'staging');
      await updates.stage();
      return;
    }
    const activePages = pages();
    for (const id of reports.keys()) if (!activePages.includes(id)) reports.delete(id);
    const current = activePages.map(id => reports.get(id));
    if (current.some(report => !report || now() - report.at > 75_000)) {
      set(mode, 'waiting', 'upgrade_waiting_pages'); resetReports(); return;
    }
    const tasks = generation?.getStatus?.();
    if (tasks?.running > 0) { set(mode, 'waiting', 'upgrade_waiting_tasks'); resetReports(); return; }
    if (tasks?.unpersistedResults > 0) {
      const result = await generation.retryResultSaveBatch?.();
      if (!result || result.failures.length || generation.getStatus().unpersistedResults > 0) throw new UpdateError('upgrade_save_failed');
    }
    try { await generation?.assertCanUpdate?.(); }
    catch (error) {
      if (['generation_busy', 'video_check_busy', 'install_tasks_pending'].includes(error.code)) {
        set(mode, 'waiting', 'upgrade_waiting_tasks'); resetReports(); return;
      }
      throw error;
    }
    if (stopped || started !== epoch) return;
    if (current.some(report => report.error)) throw new UpdateError('upgrade_save_failed');
    if (current.some(report => !report.ready)) {
      set(mode, 'waiting', 'upgrade_waiting_activity'); resetReports(); return;
    }
    if (mode === 'automatic' && current.some(report => !report.idle)) {
      set(mode, 'waiting', 'upgrade_waiting_idle'); resetReports(); return;
    }
    set(mode, 'preparing');
    if (current.some(report => !report.prepared)) return;
    // 所有页面此时保持准备面板，禁止新编辑；再次核实业务后才批准切换。
    await generation?.assertCanUpdate?.();
    if (stopped || started !== epoch || pages().some(id => !activePages.includes(id) || !reports.get(id)?.prepared)) return;
    const latest = await updates.preferences();
    if (stopped || started !== epoch) return;
    if (!requested && !latest.autoInstall) { set(null, 'idle'); resetReports(); return; }
    await updates.approve('saved-and-all-tasks-ended', { manual: requested });
    requested = false;
    set(mode, 'installing');
  }
  function tick() {
    if (stopped) return Promise.resolve();
    if (flight) return flight;
    flight = step().catch(error => {
      blocked = /^[a-z_]{3,64}$/.test(error?.code || '') ? error.code : 'update_stage_failed';
      set(state.mode, 'blocked', blocked);
    }).finally(() => { flight = null; });
    return flight;
  }
  return Object.freeze({
    status: () => ({ ...state, targetVersion: target }),
    async activity(id, input) {
      if (typeof id !== 'string' || !pages().includes(id) || !input || Object.keys(input).sort().join(',') !== 'error,idle,prepared,ready,version'
        || ['idle', 'ready', 'prepared', 'error'].some(key => typeof input[key] !== 'boolean')
        || input.version !== null && typeof input.version !== 'string'
        || input.prepared && (!input.ready || input.error)) throw new UpdateError('invalid_request');
      reports.set(id, { ...input, prepared: input.prepared && input.version === target, at: now() });
      await tick();
    },
    async install() {
      epoch++; requested = true; deferred = null; blocked = null; resetReports();
      if (flight) await flight;
      // 明确重试会重新执行失败暂存，不复用上次错误。
      updates.stageResult = null;
      await tick();
    },
    async defer() {
      epoch++; requested = false; deferred = target; blocked = null; resetReports(); set(null, 'idle');
      if (flight) await flight;
      if ((await updates.status()).install?.targetVersion) await updates.defer();
      set(null, 'idle');
    },
    tick,
    start() {
      stopped = false;
      if (timer) return;
      const run = async () => {
        await tick();
        if (!stopped) { timer = setTimeout(run, ['staging', 'preparing', 'installing'].includes(state.state) ? 2000 : 30_000); timer.unref?.(); }
      };
      timer = setTimeout(run, 0); timer.unref?.();
    },
    async close() { stopped = true; clearTimeout(timer); timer = null; await flight; reports.clear(); },
  });
}
