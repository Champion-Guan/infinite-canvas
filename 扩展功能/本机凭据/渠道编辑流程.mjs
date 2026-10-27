import { isProtectedCredential, isSealedCredential, comparableEndpoint, bindChannelConfiguration } from './页面凭据引用.mjs';

export function patchChannelDraft(current, patch) {
  if (!current) return current;
  const next = { ...current, ...patch };
  const changed = next.apiFormat !== current.apiFormat || comparableEndpoint(next.baseUrl) !== comparableEndpoint(current.baseUrl);
  return changed && isProtectedCredential(current.apiKey) && !Object.hasOwn(patch, 'apiKey') ? { ...next, apiKey: '' } : next;
}

// bind期间可以取消；写入配置后进入原保存队列，必须先确认，重试只排空原操作。
export function createChannelSaveFlow({ bind, commit, flush, retry }) {
  let version = 0, pending = null, running = false;
  return Object.freeze({
    invalidate() { version++; },
    getStatus: () => ({ running, pending: pending !== null }),
    async save(channel, isCurrent) {
      if (running) return null;
      running = true;
      const attempt = ++version;
      try {
        if (pending) {
          await retry();
          await flush();
          const saved = pending; pending = null;
          if (attempt !== version || !isCurrent()) return null;
          if (saved.id === channel.id) return saved;
        }
        const snapshot = structuredClone(channel);
        if (snapshot.apiKey.trim()) snapshot.apiKey = await bind(snapshot);
        if (attempt !== version || !isCurrent()) return null;
        const committing = commit(snapshot);
        pending = snapshot;
        await committing;
        await flush();
        pending = null;
        return attempt === version && isCurrent() ? snapshot : null;
      } finally { running = false; }
    },
  });
}

export async function saveChannelBinding(host, channel) {
  return bindChannelConfiguration(host, channel);
}

export async function sealConfiguration(config, getHost) {
  const next = structuredClone(config);
  for (const channel of [next, ...next.channels]) {
    if (!channel.apiKey.trim() || isSealedCredential(channel.apiKey)) continue;
    channel.apiKey = await bindChannelConfiguration(getHost(), channel);
  }
  return next;
}
