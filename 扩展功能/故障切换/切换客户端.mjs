import { emptyFallback, enabledEntries, FALLBACK_CHANGED_EVENT } from './原版策略.mjs';

// 页内镜像不是持久化副本。只有经过现有授权入口的SQLite ACK才能替换它。
export function createFallbackClient({ command, notify = () => {} }) {
  let state = { revision: 0, value: emptyFallback() }, loading = null, writing = false, closed = false;
  const listeners = new Set();
  const accept = result => {
    if (!result || !Number.isSafeInteger(result.revision) || result.revision < state.revision || !result.value?.capabilities) throw Error('Fallback保存状态不匹配');
    state = structuredClone(result); for (const listener of listeners) listener(); notify(FALLBACK_CHANGED_EVENT); return structuredClone(state);
  };
  const read = () => {
    if (closed || writing) return Promise.reject(Error('Fallback正在保存或页面已结束'));
    if (!loading) { const flight = command({ operation: 'fallback-load' }).then(accept); loading = flight; void flight.finally(() => { if (loading === flight) loading = null; }).catch(() => {}); }
    return loading;
  };
  return Object.freeze({ read, snapshot: () => structuredClone(state),
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    async save(value, expectedRevision = state.revision) {
      if (closed || writing || loading) throw Error('Fallback操作尚未结束');
      writing = true;
      try { return accept(await command({ operation: 'fallback-save', value, revision: expectedRevision })); }
      catch (error) {
        // 冲突或丢ACK后只读实际落盘状态，不自动覆盖另一个页面的修改。
        try { accept(await command({ operation: 'fallback-load' })); } catch { /* 保留最后一次已确认镜像。 */ }
        throw error;
      } finally { writing = false; }
    },
    entries: capability => enabledEntries(state.value, capability),
    close() { closed = true; listeners.clear(); },
  });
}
