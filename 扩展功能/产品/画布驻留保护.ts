type Participant = {
    idle(): boolean;
    prepare(): Promise<(() => boolean) | null>;
};

// 只保存工作计数和卸载端口，不复制画布。异步操作在第一个await前取得保护。
export class ProductCanvasResidency {
    private participants = new Map<string, Participant>();
    private leases = new Map<string, Set<symbol>>();
    private listeners = new Set<() => void>();
    private activity = new Map<string, number>();
    private sequence = 0;
    revision = (id: string) => this.activity.get(id) ?? 0;
    subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
    changed = () => { for (const listener of this.listeners) listener(); };
    register(id: string, participant: Participant) {
        if (this.participants.has(id)) throw Error("画布驻留实例重复。");
        this.participants.set(id, participant); this.activity.set(id, ++this.sequence); this.changed();
        return () => { if (this.participants.get(id) === participant) { this.participants.delete(id); if (!this.leases.has(id)) this.activity.delete(id); this.changed(); } };
    }
    acquire(id: string) {
        const token = Symbol(id), leases = this.leases.get(id) ?? new Set<symbol>();
        leases.add(token); this.leases.set(id, leases); this.activity.set(id, ++this.sequence); this.changed();
        return () => {
            if (!leases.delete(token)) return;
            if (!leases.size && this.leases.get(id) === leases) this.leases.delete(id);
            if (!this.leases.has(id) && !this.participants.has(id)) this.activity.delete(id);
            this.changed();
        };
    }
    async run<T>(id: string, operation: () => T | PromiseLike<T>): Promise<T> {
        const release = this.acquire(id);
        try { return await operation(); } finally { release(); }
    }
    eligible = (id: string) => !this.leases.get(id)?.size && this.participants.get(id)?.idle() === true;
    async prepare(id: string) {
        const participant = this.participants.get(id);
        if (!participant || !this.eligible(id)) return null;
        const valid = await participant.prepare();
        // 已完成且未改变快照的任务确认不会让画布永久驻留；
        // 新编辑由检查点代次作废票据，仍在运行的工作由租约阻止卸载。
        return valid ? () => this.participants.get(id) === participant && this.eligible(id) && valid() : null;
    }
}

export const productCanvasResidency = new ProductCanvasResidency();
export function protectProductCanvasWork<A extends unknown[], T>(id: string, operation: (...args: A) => Promise<T>) {
    return (...args: A) => productCanvasResidency.run(id, () => operation(...args));
}
