type Offset = { x: number; y: number };
type Offsets = ReadonlyMap<string, Offset>;
type Port = { frame(callback: (now: number) => void): number; cancel(id: number): void; now(): number; write(offsets: Map<string, Offset>): void };

export function createBatchDisplacementPlayer(port: Port) {
    let current = new Map<string, Offset>(), frame = 0, revision = 0;
    const stop = () => { revision++; if (frame) port.cancel(frame); frame = 0; };
    return {
        move(target: Offsets, direct: boolean) {
            stop();
            if (direct) { current = new Map(target); port.write(current); return; }
            const keys = new Set([...current.keys(), ...target.keys()]);
            if ([...keys].every(id => (current.get(id)?.x ?? 0) === (target.get(id)?.x ?? 0)
                && (current.get(id)?.y ?? 0) === (target.get(id)?.y ?? 0))) return;
            const from = current, to = new Map(target), started = port.now(), token = revision;
            const tick = (now: number) => {
                if (token !== revision) return;
                const progress = Math.min(1, Math.max(0, (now - started) / 240));
                const ease = 1 - (1 - progress) ** 3;
                current = new Map([...keys].map(id => {
                    const a = from.get(id) ?? { x: 0, y: 0 }, b = to.get(id) ?? { x: 0, y: 0 };
                    return [id, { x: a.x + (b.x - a.x) * ease, y: a.y + (b.y - a.y) * ease }] as const;
                }));
                if (progress === 1) { current = to; frame = 0; }
                else frame = port.frame(tick);
                port.write(current);
            };
            frame = port.frame(tick);
        },
        stop,
    };
}
