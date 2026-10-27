// 旧deleteProductSet的纯mutate回调原文；不带发布、浏览器存储和事件。
function requireById(items, id, label) {
  const item = items.find((candidate) => candidate.id === id);
  if (!item) throw new Error(`${label} 不存在：${id}`);
  return item;
}
export function deleteLegacyWorkbook(state, productSetId) {
      const productSet = requireById(state.productSets, productSetId, "ProductSet");
      const productIds = new Set(
        state.products
          .filter((product) => product.productSetId === productSet.id)
          .map((product) => product.id)
      );
      const slotIds = new Set(
        state.slots
          .filter((slot) => productIds.has(slot.productId))
          .map((slot) => slot.id)
      );
      const taskIds = new Set(
        state.tasks
          .filter((task) => productIds.has(task.productId))
          .map((task) => task.id)
      );
      const runIds = new Set(
        state.runs
          .filter((run) => taskIds.has(run.taskId) || productIds.has(run.productId))
          .map((run) => run.id)
      );

      state.productSets = state.productSets.filter((set) => set.id !== productSet.id);
      state.products = state.products.filter((product) => !productIds.has(product.id));
      state.importRecords = state.importRecords.filter((record) => record.productSetId !== productSet.id);
      state.slots = state.slots.filter((slot) => !slotIds.has(slot.id) && !productIds.has(slot.productId));
      state.prompts = state.prompts.filter((prompt) => !productIds.has(prompt.productId));
      state.tasks = state.tasks.filter((task) => !taskIds.has(task.id) && !productIds.has(task.productId));
      state.runs = state.runs.filter((run) => !runIds.has(run.id) && !taskIds.has(run.taskId));
      state.providerAttempts = state.providerAttempts.filter((attempt) => !runIds.has(attempt.runId));
      state.assets = state.assets.filter((asset) => (
        !productIds.has(asset.productId)
        && !taskIds.has(asset.taskId)
        && !runIds.has(asset.runId)
      ));

      const nextActive = state.productSets
        .slice()
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0]?.id || null;
      state.workspace.activeProductSetId = state.workspace.activeProductSetId === productSet.id
        ? nextActive
        : (state.productSets.some((set) => set.id === state.workspace.activeProductSetId)
          ? state.workspace.activeProductSetId
          : nextActive);
      state.workspace.activeProductId = state.products
        .filter((product) => product.productSetId === state.workspace.activeProductSetId)
        .sort((a, b) => a.order - b.order)[0]?.id || null;
      return {
        deletedProductSetId: productSet.id,
        deletedFileName: productSet.source?.fileName || "未命名产品表",
        activeProductSetId: state.workspace.activeProductSetId,
      };
    }
