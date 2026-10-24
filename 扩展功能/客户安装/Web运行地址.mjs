import { readState } from './Web安装目录.mjs';
import { isWorkbenchOrigin } from '../本机服务/工作台端口.mjs';
import { fail } from './Web发布协议.mjs';

// 地址只属于本次管理进程，不把上次运行或未提交版本的地址当成当前入口。
export async function readWebAddress(paths, running, state, owns) {
  if (!owns(running)) return null;
  const value = await readState(paths.address);
  if (!value?.ready || !['committed', 'rolled-back'].includes(state?.phase) ||
      value.owner?.pid !== running.pid || value.owner?.started !== running.started || value.owner?.command !== running.command ||
      value.version !== state.current?.version || value.workspaceId !== state.workspaceId || !isWorkbenchOrigin(value.origin)) return null;
  return value.origin;
}
export async function waitWebAddress(paths, owns, { timeout = 60_000 } = {}) {
  const deadline = Date.now() + timeout;
  do {
    const running = await readState(paths.lock), state = await readState(paths.state);
    const address = await readWebAddress(paths, running, state, owns);
    if (address) return { running: true, address, version: state.current.version };
    await new Promise(resolve => setTimeout(resolve, 200));
  } while (Date.now() < deadline);
  fail('web_start_timeout');
}
