// 来源：旧项目 src/server/index.mjs 的 readRootSettings/makeFallbackPanel。
// 仅更换状态出口；保留能力分组、渠道/模型排序及开关的原实际语义。
import { sortDefaultEntries, validModelOrder } from './模型默认排序.mjs';
export const FALLBACK_MODEL_OPTION = '__fallback__';
export const FALLBACK_CHANGED_EVENT = 'guan-fallback-config-changed';
export const capabilities = Object.freeze([
  { key: 'image', label: '生图' }, { key: 'video', label: '视频' },
  { key: 'text', label: '文本' }, { key: 'audio', label: '音频' },
]);
export const emptyFallback = () => ({ enabled: false, capabilities: Object.fromEntries(capabilities.map(({ key }) => [key, { enabled: false, entries: [] }])) });
const entryKey = entry => JSON.stringify([entry.profileId, entry.modelName]);
export function normalizeFallback(groups) {
  const normalized = Object.fromEntries(capabilities.map(({ key }) => [key, {
    enabled: groups[key]?.enabled === true,
    ...(groups[key]?.modelOrder ? { modelOrder: [...groups[key].modelOrder] } : {}),
    entries: (groups[key]?.entries || []).map(entry => ({ profileId: entry.profileId, modelName: entry.modelName, enabled: entry.enabled === true })),
  }]));
  return { enabled: capabilities.some(({ key }) => normalized[key].enabled && normalized[key].entries.some(entry => entry.enabled)), capabilities: normalized };
}
export function reconcileFallback(state, profiles) {
  const groups = {};
  for (const { key } of capabilities) {
    const stored = state?.capabilities?.[key], prior = stored?.entries || [], entries = [];
    for (const profile of profiles) for (const model of profile.models || []) {
      if (model.capability && model.capability !== key) continue;
      const old = prior.find(entry => entry.profileId === profile.id && (!entry.modelName || entry.modelName === model.name));
      entries.push({ profileId: profile.id, modelName: model.name, enabled: old?.enabled === true, profile, model });
    }
    const available = new Map(entries.map(entry => [entryKey(entry), entry])), seen = new Set(), ordered = [];
    for (const entry of prior) {
      const id = entryKey(entry);
      if (available.has(id) && !seen.has(id)) { ordered.push(available.get(id)); seen.add(id); }
    }
    for (const entry of entries) if (!seen.has(entryKey(entry))) { ordered.push(entry); seen.add(entryKey(entry)); }
    groups[key] = { enabled: stored?.enabled === true, entries: ordered, ...(stored?.modelOrder ? { modelOrder: [...stored.modelOrder] } : {}) };
  }
  return { enabled: capabilities.some(({ key }) => groups[key].enabled && groups[key].entries.some(entry => entry.enabled)), capabilities: groups };
}
export function editFallback(state, profiles, action) {
  const current = reconcileFallback(state, profiles), groups = current.capabilities;
  if (action.type === 'global') {
    for (const { key } of capabilities) groups[key] = { ...groups[key], enabled: action.enabled && groups[key].enabled,
      entries: groups[key].entries.map(entry => ({ ...entry, enabled: action.enabled && entry.enabled })) };
  } else {
    const group = groups[action.capability];
    if (!group) throw Error('不支持的Fallback能力');
    if (action.type === 'group') { group.enabled = action.enabled; group.entries = group.entries.map(entry => ({ ...entry, enabled: action.enabled })); }
    else if (action.type === 'entry') {
      group.entries = group.entries.map(entry => entry.profileId === action.profileId && entry.modelName === action.modelName ? { ...entry, enabled: action.enabled } : entry);
      group.enabled = group.entries.some(entry => entry.enabled);
    } else if (action.type === 'move') {
      const next = action.index + action.direction;
      if (![-1, 1].includes(action.direction) || !group.entries[action.index] || !group.entries[next]) throw Error('排序位置无效');
      [group.entries[action.index], group.entries[next]] = [group.entries[next], group.entries[action.index]];
    } else if (action.type === 'reset' || action.type === 'model-order') {
      if (action.type === 'model-order') {
        if (!validModelOrder(action.order)) throw Error('模型默认排序无效');
        group.modelOrder = [...action.order];
      }
      group.entries = sortDefaultEntries(group.entries, profiles, group.modelOrder);
    } else throw Error('不支持的Fallback操作');
  }
  return normalizeFallback(groups);
}
// 安全修正：关闭/空清单必须返回空，不能沿用旧版“未配置便遍历全部渠道”的隐式兜底。
export function enabledEntries(state, capability) {
  const group = state?.capabilities?.[capability];
  return state?.enabled === true && group?.enabled === true ? group.entries.filter(entry => entry.enabled === true) : [];
}
