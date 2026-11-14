import { useEffect, useRef, useState } from "react";
import { useProductActive } from "../产品/产品界面边界";

export const retryPlanningSave = (error: unknown) => [
    "request_timeout", "generation_connection_unknown", "generation_canvas_unsaved",
    "generation_canvas_unconfirmed", "generation_http_busy", "generation_unavailable",
    "generation_ack_invalid", "session_expired", "session_denied",
].includes((error as { code?: string } | null)?.code || "");

// 自动恢复只接收“已有结果待保存”，查询和收费修正不进入这里。
export function useAutomaticPlanningSave({ identity, busy, start }: {
    identity: string; busy: boolean; start(): Promise<boolean>;
}) {
    const active = useProductActive();
    const latest = useRef(start); latest.current = start;
    const mounted = useRef(true);
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
    const budget = useRef({ identity, attempts: 0, running: false, stopped: false });
    const [round, setRound] = useState(0);
    useEffect(() => {
        if (identity && budget.current.identity !== identity) budget.current = { identity, attempts: 0, running: false, stopped: false };
        const current = budget.current;
        if (!identity || !active || busy || current.running || current.stopped || current.attempts >= 3) return;
        const timer = setTimeout(() => {
            current.running = true; current.attempts++;
            void latest.current().then(retry => { current.stopped = !retry; }, () => { current.stopped = true; })
                .finally(() => {
                    current.running = false;
                    if (mounted.current && budget.current === current) setRound(value => value + 1);
                });
        }, [0, 2000, 6000][current.attempts]);
        return () => clearTimeout(timer);
    }, [identity, active, busy, round]);
}
