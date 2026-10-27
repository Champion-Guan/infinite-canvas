import { compareVersions } from '../软件更新/stable-version.mjs';
import { WEB_ORIGIN, fail } from './Web发布协议.mjs';
import { assertWebHealth, safeStartupDiagnostic, startupError } from './启动健康诊断.mjs';

// 独立管理进程调用。存储路径从不交给下载包决定，所有版本使用同一工作区。
export async function switchWebVersion({ previous, target, workspaceId, save, stop, start, verify, report = () => {} }) {
  if (!workspaceId || compareVersions(target.version, previous.version) <= 0 || target.dataSchema !== previous.dataSchema ||
    target.dataSchema !== 1 || target.origin !== WEB_ORIGIN || previous.origin !== WEB_ORIGIN) fail('web_migration_required');
  await verify(target);
  await save({ phase: 'prepared', current: previous, target, workspaceId });
  report('prepared');
  // stop须原子冻结新授权、核实零页面和原生任务，排空保存并释放SQLite锁；遵循自动备份开关。
  try { report('stopping'); await stop(); }
  catch (error) {
    if (['install_browsers_running', 'install_tasks_pending', 'generation_busy', 'proxy_busy'].includes(error.code)) {
      await save({ phase: 'committed', current: previous, workspaceId });
    }
    throw error;
  }
  try {
    // 停服后的第一笔持久写入也在回退范围内，磁盘失败不能让旧版本永久停服。
    await save({ phase: 'switching', current: previous, target, workspaceId });
    report('switching');
    report('starting');
    const ready = await start(target);
    assertWebHealth(ready, target, workspaceId);
    await save({ phase: 'committed', current: target, previous, workspaceId });
    report('committed');
    return { current: target, rolledBack: false };
  } catch (error) {
    const diagnostic = safeStartupDiagnostic(error);
    report('rolling-back');
    // start失败后必须确认子进程退出及数据锁已释放；stop不确认时绝不启动第二写入者。
    try {
      await stop(); await verify(previous);
      const ready = await start(previous);
      assertWebHealth(ready, previous, workspaceId);
      await save({ phase: 'rolled-back', current: previous, previous: target, workspaceId, diagnostic });
      report('rolled-back');
      return { current: previous, rolledBack: true, error: 'update_failed_rolled_back', diagnostic };
    } catch (rollbackError) {
      const rollbackDiagnostic = safeStartupDiagnostic(rollbackError, 'rolling-back');
      await save({ phase: 'recovery-required', current: previous, target, workspaceId, diagnostic, rollbackDiagnostic });
      report('recovery-required');
      throw Object.assign(startupError('update_rollback_failed'), { diagnostic, rollbackDiagnostic });
    }
  }
}
