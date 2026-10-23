import { randomUUID } from 'node:crypto';
import { UpdateError } from '../软件更新/update-auth.mjs';

// 只有由已验签管理器启动的Node子进程持有IPC；网页不能选择路径、命令或执行文件。
export function createWebManagerClient(channel = process) {
  const pending = new Map();
  const receive = value => {
    if (value?.type !== 'web-manager-reply') return;
    const item = pending.get(value.id); if (!item) return;
    clearTimeout(item.timer); pending.delete(value.id);
    if (value.error) item.reject(new UpdateError(value.error)); else item.resolve(value.result);
  };
  channel.on('message', receive);
  const request = (operation, identity, acknowledgement) => new Promise((resolve, reject) => {
    if (!channel.connected || typeof channel.send !== 'function') { reject(new UpdateError('update_manager_unavailable')); return; }
    const id = randomUUID();
    const timer = setTimeout(() => { pending.delete(id); reject(new UpdateError('update_manager_unavailable')); }, operation === 'stage' ? 120000 : 10000);
    pending.set(id, { resolve, reject, timer });
    channel.send({ type: 'web-manager-request', id, operation, identity, acknowledgement });
  });
  return { status: () => request('status'), stage: identity => request('stage', identity),
    approve: (identity, acknowledgement) => request('approve', identity, acknowledgement), defer: () => request('defer'),
    close() { channel.off('message', receive); for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new UpdateError('update_manager_unavailable')); } pending.clear(); } };
}
