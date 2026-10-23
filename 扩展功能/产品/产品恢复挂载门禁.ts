// 待审查后继：仅阻止恢复产品在落盘确认前挂载，不改变SQLite保存/重试协议。
export class ProductRestoreMountGate {
  private snapshot: readonly string[] = Object.freeze([]);
  private listeners = new Set<() => void>();

  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  block(id: string) {
    if (this.snapshot.includes(id)) return;
    this.snapshot = Object.freeze([...this.snapshot, id]);
    for (const listener of this.listeners) listener();
  }

  release(id: string) {
    if (!this.snapshot.includes(id)) return;
    this.snapshot = Object.freeze(this.snapshot.filter(value => value !== id));
    for (const listener of this.listeners) listener();
  }
}

export const productRestoreMountGate = new ProductRestoreMountGate();
