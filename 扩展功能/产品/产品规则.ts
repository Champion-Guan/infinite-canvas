// 命名规则迁自旧 data-contract/index.js 的新建处理及 product-recycle-bridge.ts。
// 产品顺序使用旧 registerCanvasProduct 的创建顺序，不跟随 updatedAt 重排。
export type ProductIdentity = { id: string; title: string; createdAt: string };

export function nextProductTitle(projects: ReadonlyArray<{ title: string }>) {
  const highest = projects.reduce((max, project) => {
    const number = project.title.match(/^未命名产品(\d+)$/)?.[1];
    return number && Number.isSafeInteger(Number(number))
      ? Math.max(max, Number(number))
      : max;
  }, 0);
  if (highest >= Number.MAX_SAFE_INTEGER)
    throw new Error("未命名产品编号已达上限，请先给产品命名。");
  return `未命名产品${highest + 1}`;
}

export function orderedProducts<T extends ProductIdentity>(
  projects: readonly T[],
): T[] {
  // Zustand 将新产品放在数组前端；反转后按 createdAt 稳定排序，兼容同毫秒创建。
  return [...projects]
    .reverse()
    .sort((a, b) => productDateKey(a.createdAt).localeCompare(productDateKey(b.createdAt)));
}

function productDateKey(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value) && Number.isFinite(new Date(value).getTime())) return new Date(value).toISOString();
  return "";
}

export function selectEntryProduct(
  projects: readonly ProductIdentity[],
  rememberedId: string | null,
) {
  return (
    projects.find((project) => project.id === rememberedId)?.id ||
    orderedProducts(projects)[0]?.id ||
    null
  );
}

// 与旧产品操作锁相同：同页操作串行，重复点击不创建同名产品或交错切换。
export class ProductOperationGate {
  private busy = false;
  private listeners = new Set<() => void>();
  getSnapshot = () => this.busy;
  subscribe = (callback: () => void) => {
    this.listeners.add(callback);
    return () => {
      this.listeners.delete(callback);
    };
  };
  private emit() {
    for (const listener of this.listeners) listener();
  }
  async run<T>(action: () => Promise<T>) {
    if (this.busy) throw new Error("另一个产品操作正在进行，请稍后重试。");
    this.busy = true;
    this.emit();
    try {
      return await action();
    } finally {
      this.busy = false;
      this.emit();
    }
  }
}

export class ProductSaveRegistry {
  private participants = new Map<
    string,
    { token: symbol; save: (options?: { deferSQLiteFlush?: boolean }) => Promise<void>; acknowledge: () => void }
  >();
  register(id: string, save: (options?: { deferSQLiteFlush?: boolean }) => Promise<void>, acknowledge: () => void = () => {}) {
    if (!id || this.participants.has(id))
      throw new Error("产品画布实例重复，已停止切换。");
    const token = Symbol(id);
    this.participants.set(id, { token, save, acknowledge });
    return () => {
      if (this.participants.get(id)?.token === token)
        this.participants.delete(id);
    };
  }
  async flush(id: string, options?: { deferSQLiteFlush?: boolean }) {
    const entry = this.participants.get(id);
    if (!entry) throw new Error("产品画布尚未加载完成，请稍后重试。");
    await entry.save(options);
    if (this.participants.get(id) !== entry)
      throw new Error("保存期间产品实例已改变，未切换画布。");
  }
  acknowledge(id: string) {
    this.participants.get(id)?.acknowledge();
  }
}
