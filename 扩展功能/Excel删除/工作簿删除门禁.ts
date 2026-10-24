// 仅保存页内未确认操作身份，不保存/重放旧业务根；刷新和断电恢复不在此承诺。
export class WorkbookDeletionGate {
  private pending: { workbookId: string; navigate: boolean } | null = null;
  private running = false;
  private listeners = new Set<() => void>();
  getSnapshot = () => this.pending?.workbookId ?? "";
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private notify() { for (const listener of this.listeners) listener(); }
  async run<T extends { workbookId: string; navigate: boolean }>(workbookId: string, steps: {
    commitCurrent(): Promise<void>; plan(): T; publish(value: T): void; isPublished(): boolean;
    flush(): Promise<unknown>; navigate(value: { workbookId: string; navigate: boolean }): Promise<void>;
  }) {
    if (this.running) throw new Error("另一个工作簿删除正在进行，请稍后重试。");
    if (this.pending && this.pending.workbookId !== workbookId) throw new Error("上一次工作簿删除尚未确认，请先重试保存。");
    this.running = true;
    try {
      if (!this.pending) {
        await steps.commitCurrent();
        const planned = steps.plan();
        if (planned.workbookId !== workbookId) throw new Error("工作簿删除身份不一致，未发布。");
        this.pending = { workbookId, navigate: planned.navigate }; this.notify();
        try { steps.publish(planned); }
        catch (error) { if (!steps.isPublished()) { this.pending = null; this.notify(); } throw error; }
      }
      await steps.flush();
      await steps.navigate(this.pending);
      this.pending = null; this.notify();
    } finally { this.running = false; }
  }
}
export const workbookDeletionGate = new WorkbookDeletionGate();
