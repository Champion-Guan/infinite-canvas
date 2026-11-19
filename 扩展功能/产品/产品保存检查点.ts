// 迁自旧 RenderCommitCheckpoint：保留真实 layout-effect 提交票据和代次校验；
// 移除旧在线更新 activity 依赖，保存ACK改接现有SQLite桥，不含更新或停服权限。
type Commit<T> = { snapshot: T; revision: number; generation: number };
type PersistResult = { deferred?: boolean } | void;
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
  private flushFlight: Promise<void> | null = null;
  private pending = new Map<
    number,
    { resolve: (commit: Commit<T>) => void; reject: (error: Error) => void; defer: () => void }
  >();
  constructor(private requestRender: (ticket: number) => void, private isSnapshotCurrent: () => boolean = () => true) {}
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
    this.flushFlight = null;
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
      // 手势或恢复中的快照尚不能落盘；保留票据，下一次可提交帧自动继续。
      if (!ready) { pending.defer(); continue; }
      this.pending.delete(id);
      pending.resolve({
        snapshot,
        revision: this.revision,
        generation: this.generation,
      });
    }
  }
  flush(persist: (snapshot: T) => Promise<PersistResult>, options: { deferSQLiteFlush?: boolean; forceBatch?: boolean } = {}) {
    const previous = this.flushFlight;
    const operation = previous
      ? previous.catch(() => {}).then(() => this.flushLatest(persist, options))
      : this.flushLatest(persist, options);
    this.flushFlight = operation;
    const clear = () => { if (this.flushFlight === operation) this.flushFlight = null; };
    void operation.then(clear, clear);
    return operation;
  }
  private async flushLatest(persist: (snapshot: T) => Promise<PersistResult>, options: { deferSQLiteFlush?: boolean; forceBatch?: boolean }) {
    if (!this.active || this.pending.size >= 32)
      throw new Error("产品保存检查点不可用。");
    const generation = this.generation;
    while (true) {
      if (!this.active || generation !== this.generation)
        throw new Error("产品保存提交已失效。");
      // setNodes会先同步更新事务ref，React提交可能还没发生；旧帧已保存不能代表新事务已保存。
      if (this.latest !== undefined && this.ready && this.hasReadyBaseline && this.persistedRevision === this.revision && this.isSnapshotCurrent())
        return;
      const ticket = ++this.ticket;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let awaitingReady = false;
      const committed = await new Promise<Commit<T>>((resolve, reject) => {
        const clear = () => { if (timer) clearTimeout(timer); };
        this.pending.set(ticket, {
          resolve: value => { clear(); resolve(value); },
          reject: error => { clear(); reject(error); },
          defer: () => { awaitingReady = true; clear(); timer = setTimeout(check, 250); },
        });
        const check = () => {
          if (!this.pending.has(ticket)) return;
          // 持续交互不属于保存失败。同步ref可能先于React清除，低频申请新帧核实。
          if (awaitingReady && !this.ready) {
            timer = setTimeout(check, 250);
            try { this.requestRender(++this.ticket); }
            catch {
              this.pending.get(ticket)?.reject(new Error("产品保存提交不可用。"));
              this.pending.delete(ticket);
              return;
            }
            return;
          }
          this.pending.delete(ticket);
          reject(new Error("产品页面未确认提交，保留当前画布，请重试。"));
        };
        timer = setTimeout(check, 10000);
        try { this.requestRender(ticket); }
        catch {
          this.pending.get(ticket)?.reject(new Error("产品保存提交不可用。"));
          this.pending.delete(ticket);
        }
      });
      if (!this.active || generation !== this.generation || committed.generation !== this.generation)
        throw new Error("产品保存提交已失效。");
      // 批量任务会在第一次保存期间更新其他卡片；直接跟进最新完整快照。
      if (committed.revision !== this.revision) continue;
      // 画布手势期间暂停真正的持久化边界。已排队的检查点保留在内存，
      // 待平移、缩放或拖拽结束后再写入，避免SQLite提交和画布绘制争抢主线程。
      while (!this.isSnapshotCurrent()) {
        await new Promise(resolve => setTimeout(resolve, 80));
        if (!this.active || generation !== this.generation)
          throw new Error("产品保存提交已失效。");
      }
      if (committed.revision !== this.revision) continue;
      // 批量生成开始前可能已经有一笔检查点保存正在等待 React 提交。
      // 如果它在批量期间才到达持久化边界，调用方必须明确返回 deferred；
      // 不能把“没有写 SQLite”误记成 persistedRevision，否则批量结束的最终快照会被跳过。
      const persisted = await persist(committed.snapshot);
      if (persisted && persisted.deferred) return;
      if (!this.active || generation !== this.generation || committed.generation !== this.generation)
        throw new Error("产品保存提交已失效。");
      // 工作簿切换在统一SQLite ACK后确认延迟保存；其他保存记录真实ACK。
      if (options.deferSQLiteFlush) this.deferredRevision = committed.revision;
      else this.persistedRevision = committed.revision;
      if (committed.revision === this.revision && this.isSnapshotCurrent()) return;
    }
  }
  acknowledgeDeferredSave() {
    if (!this.active || !this.deferredRevision || this.deferredRevision !== this.revision) return;
    this.persistedRevision = this.deferredRevision;
    this.deferredRevision = 0;
  }
  idle() { return this.active && this.ready && !this.flushFlight && !this.pending.size; }
  releaseProof() {
    const generation = this.generation, revision = this.revision;
    return () => this.idle() && generation === this.generation && revision === this.revision
      && this.hasReadyBaseline && this.persistedRevision === revision;
  }
}
