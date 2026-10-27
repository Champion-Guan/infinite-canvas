import { isWorkbenchOrigin } from '../本机服务/工作台端口.mjs';
import { UpdateError } from '../软件更新/update-auth.mjs';

const codes = new Set(['web_health_mismatch', 'web_start_timeout', 'web_service_exited', 'web_start_failed',
  'keychain_unavailable', 'invalid_keychain_helper', 'keychain_helper_migration_required', 'workspace_busy',
  'insufficient_space', 'web_stop_timeout', 'web_stop_unconfirmed', 'update_activation_unconfirmed',
  'update_rollback_failed', 'update_manager_handoff_failed', 'update_manager_handoff_timeout',
  'install_browsers_running', 'install_tasks_pending', 'generation_busy', 'proxy_busy']);
const fields = new Set(['ready', 'version', 'workspace', 'origin', 'activation']);

// 不序列化异常消息、堆栈、系统路径、UUID或业务状态，只保留明确允许的诊断字段。
export function safeStartupDiagnostic(error, stage = 'starting') {
  const code = codes.has(error?.code) ? error.code : codes.has(error?.message) ? error.message : 'web_start_failed';
  return { code, stage: ['starting', 'activating', 'rolling-back', 'handoff'].includes(stage) ? stage : 'starting',
    ...(fields.has(error?.field) ? { field: error.field } : {}) };
}
export function startupError(code, field) {
  const error = new UpdateError(code);
  if (fields.has(field)) error.field = field;
  return error;
}
export function assertWebHealth(ready, identity, workspaceId, { active = false } = {}) {
  const field = ready?.ready !== true ? 'ready' : ready.version !== identity.version ? 'version'
    : workspaceId && ready.workspaceId !== workspaceId ? 'workspace' : !isWorkbenchOrigin(ready.origin) ? 'origin'
    : active && ready.acceptingPages === false ? 'activation' : null;
  if (field) throw startupError('web_health_mismatch', field);
  return ready;
}
