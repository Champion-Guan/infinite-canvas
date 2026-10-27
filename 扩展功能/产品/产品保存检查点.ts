// 迁自旧 RenderCommitCheckpoint：保留真实 layout-effect 提交票据和代次校验；
// 移除旧在线更新 activity 依赖，保存ACK改接现有SQLite桥，不含更新或停服权限。
type Commit<T> = { snapshot: T; revision: number; generation: number };
export class ProductCommitCheckpoint<T> {
  private active = false;
  private generation = 0;
  private revision = 0;
  private ticket = 0;
  private latest: T | undefined;
  private ready = false;
  private persistedRevision = 0;
  private deferredRevision = 0;
  private hasReadyBaseline = false;
  private pending = new Map<
    number,
    { resolve: (commit: Commit<T>) => void; reject: (error: Error) => void }
  >();
  constructor(private requestRender: (ticket: number) => void) {}
  mount() {
    this.active = true;
    this.generation++;
  }
  unmount() {
    this.active = false;
    this.generation++;
    for (const pending of this.pending.values())
      pending.reject(new Error("产品保存提交已失效。"));
    this.pending.clear();
    this.latest = undefined;
    this.ready = false;
    this.persistedRevision = 0;
    this.deferredRevision = 0;
    this.hasReadyBaseline = false;
  }
  commit(ticket: number, snapshot: T, ready: boolean) {
    if (!this.active) return;
    if (this.latest !== snapshot || this.ready !== ready) {
      this.latest = snapshot;
      this.ready = ready;
      this.revision++;
    }
    // 首次进入可编辑状态时，快照已经来自SQLite预读；将它作为基线，
    // 让单纯切换设置或产品时不重复写入同一份完整画布。
    if (ready && !this.hasReadyBaseline) {
      this.persistedRevision = this.revision;
      this.hasReadyBaseline = true;
    }
    for (const [id, pending] of this.pending) {
      if (id > ticket) continue;
      this.pending.delete(id);
      if (!ready)
        pending.reject(
          new Error("当前画布正在编辑或移动，请完成操作后再切换。"),
        );
      else
        pending.resolve({
          snapshot,
          revision: this.revision,
          generation: this.generation,
        });
    }
  }
  async flush(persist: (snapshot: T) => Promise<void>, options: { deferSQLiteFlush?: boolean } = {}) {
    if (!this.active || this.pending.size >= 32)
      throw new Error("产品保存检查点不可用。");
    if (this.latest !== undefined && this.ready && this.hasReadyBaseline && this.persistedRevision === this.revision)
      return;
    const generation = this.generation,
      ticket = ++this.ticket;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const committed = await new Promise<Commit<T>>((resolve, reject) => {
      const clear = () => {
        if (timer) clearTimeout(timer);
      };
      this.pending.set(ticket, {
        resolve: (value) => {
          clear();
          resolve(value);
        },
        reject: (error) => {
          clear();
          reject(error);
        },
      });
      timer = setTimeout(() => {
        this.pending.delete(ticket);
        reject(new Error("产品页面未确认提交，保留当前画布，请重试。"));
      }, 10000);
      try {
        this.requestRender(ticket);
      } catch {
        this.pending.get(ticket)?.reject(new Error("产品保存提交不可用。"));
        this.pending.delete(ticket);
      }
    });
    if (
      !this.active ||
      generation !== this.generation ||
      committed.revision !== this.revision
    )
      throw new Error("产品保存提交已改变，请重试。");
    await persist(committed.snapshot);
    // 工作簿切换会在同一 SQLite ACK 中确认这个快照及工作簿根；
    // 最终ACK成功前不能把该修订标记为已保存。
    if (options.deferSQLiteFlush) this.deferredRevision = committed.revision;
    else this.persistedRevision = committed.revision;
    if (
      !this.active ||
      committed.generation !== this.generation ||
      committed.revision !== this.revision
    )
      throw new Error("保存时画布发生新编辑，保留当前产品，请重试。");
  }
  acknowledgeDeferredSave() {
    if (!this.active || !this.deferredRevision || this.deferredRevision !== this.revision) return;
    this.persistedRevision = this.deferredRevision;
    this.deferredRevision = 0;
  }
}
