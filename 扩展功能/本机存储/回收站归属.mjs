// 容量统计和显式删除共用归属规则；只接受明确所有者，不把没有归属的公共素材猜成回收内容。
export const recycleOwnerFields = ['projectId', 'productId', 'productSetId', 'workbookId', 'excelProductId', 'taskId', 'runId', 'providerAttemptId', 'assetId'];
export function collectRecordIds(value, ids = new Set()) {
  if (!value || typeof value !== 'object') return ids;
  if (typeof value.id === 'string') ids.add(value.id);
  for (const child of Object.values(value)) if (Array.isArray(child)) child.forEach(item => collectRecordIds(item, ids));
  else if (child && typeof child === 'object') collectRecordIds(child, ids);
  return ids;
}
export function recycleOwnership(state) {
  const products = state.deletedProjects ?? [], workbooks = state.guanWorkbooks?.recycledWorkbooks ?? [];
  const productIds = collectRecordIds(products), workbookIds = collectRecordIds(workbooks);
  const activeIds = collectRecordIds(state.projects ?? []);
  const rows = Object.values(state.guanWorkbooks?.contract ?? {}).flatMap(value => Array.isArray(value) ? value : []).filter(row => row && typeof row.id === 'string');
  // 先沿实际所有者建立有向图，再传播归属；不依赖合同数组顺序或固定传播轮数。
  const dependents = new Map();
  const seeds = new Set([...productIds, ...workbookIds]);
  for (const row of rows) for (const owner of ownerIds(row, seeds.has(row.id))) {
    if (!dependents.has(owner)) dependents.set(owner, new Set());
    dependents.get(owner).add(row.id);
  }
  function propagate(ids) {
    const queue = [...ids];
    for (let i = 0; i < queue.length; i++) for (const id of dependents.get(queue[i]) ?? []) if (!ids.has(id)) { ids.add(id); queue.push(id); }
  }
  propagate(productIds); propagate(workbookIds); propagate(activeIds);
  // 无回收归属的合同记录仍按活跃内容保护，不能提前把尚未传播到的run误标为活跃。
  for (const row of rows) if (!productIds.has(row.id) && !workbookIds.has(row.id)) collectRecordIds(row, activeIds);
  propagate(activeIds);
  return { productIds, workbookIds, activeIds };
}
function ownerIds(value, seeded = false) {
  const specific = ['projectId', 'productId', 'excelProductId', 'taskId', 'runId', 'providerAttemptId'];
  let ids = specific.flatMap(key => [value?.[key], value?.metadata?.[key]]).filter(id => typeof id === 'string');
  // 已有完整回收快照的产品仍可能属于活跃Excel，宽泛工作簿归属不能覆盖产品自身的回收归属。
  if (!ids.length && !seeded) ids = ['workbookId', 'productSetId', 'assetId'].flatMap(key => [value?.[key], value?.metadata?.[key]]).filter(id => typeof id === 'string');
  return ids;
}
function categoryIds(value, ownership) {
  const id = value?.id;
  const seeded = typeof id === 'string' && (ownership.productIds.has(id) || ownership.workbookIds.has(id));
  const ids = ownerIds(value, seeded);
  if (seeded || !ids.length) if (typeof id === 'string') ids.push(id);
  return ids;
}
export function recycleCategory(value, ownership) {
  const ids = categoryIds(value, ownership);
  if (ids.some(id => ownership.activeIds.has(id))) return 'workspace';
  const product = ids.some(id => ownership.productIds.has(id)), workbook = ids.some(id => ownership.workbookIds.has(id));
  return product && workbook ? 'shared' : product ? 'product_recycle' : workbook ? 'workbook_recycle' : 'workspace';
}

export function hasActiveRecycleOwner(value, ownership) {
  return categoryIds(value, ownership).some(id => ownership.activeIds.has(id));
}
