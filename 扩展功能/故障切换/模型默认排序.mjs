const versions = { 'gpt-image-2.5-sunburst': 5, 'gpt-image-2.5-flare': 4, 'gpt-image-2.5': 3, 'gpt-image-2-4k': 2, 'gpt-image-2': 1 };
const version = name => versions[String(name).trim().toLowerCase()] || 0;
export function validModelOrder(order) {
  return Array.isArray(order) && order.length <= 512 && new Set(order).size === order.length &&
    order.every(name => typeof name === 'string' && name.length > 0 && name.length <= 200 && !/[\r\n\0]/.test(name));
}
export function defaultModelOrder(entries, preferred = []) {
  const names = [...new Set(entries.map(entry => entry.modelName))];
  return [...preferred.filter(name => names.includes(name)), ...names.filter(name => !preferred.includes(name)).sort((a, b) => version(b) - version(a) || a.localeCompare(b))];
}
export function sortDefaultEntries(entries, profiles, preferred) {
  const channels = new Map(profiles.map((profile, index) => [profile.id, index]));
  const ranks = new Map((preferred || []).map((name, index) => [name, index]));
  const price = entry => Number.isFinite(Number(entry.model?.price)) ? Number(entry.model.price) : Infinity;
  return [...entries].sort((a, b) => {
    const rank = name => ranks.get(name) ?? ranks.size;
    return rank(a.modelName) - rank(b.modelName) || version(b.modelName) - version(a.modelName) ||
      price(a) - price(b) || (channels.get(a.profileId) ?? 0) - (channels.get(b.profileId) ?? 0) || a.modelName.localeCompare(b.modelName);
  });
}
