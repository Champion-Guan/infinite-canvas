import { useState } from "react";
import { Button, Modal } from "antd";
import { ArrowDown, ArrowUp } from "lucide-react";
import { defaultModelOrder } from "./模型默认排序.mjs";
import styles from "./模型排序面板.module.css";

type Props = {
    label: string; entries: Array<{ modelName: string }>; preferred?: string[]; revision: number; busy: boolean;
    onClose(): void; onSave(order: string[], revision: number): Promise<boolean>;
};
export function ModelOrderPanel({ label, entries, preferred = [], revision, busy, onClose, onSave }: Props) {
    const [draft, setDraft] = useState<string[]>(() => defaultModelOrder(entries, preferred));
    const [openedRevision] = useState(revision);
    const [unavailable] = useState(() => preferred.filter(name => !entries.some(entry => entry.modelName === name)));
    const [error, setError] = useState("");
    const move = (index: number, delta: number) => setDraft(current => {
        const next = [...current]; [next[index], next[index + delta]] = [next[index + delta], next[index]]; return next;
    });
    return <Modal open title={`${label}模型默认排序`} centered width={580} maskClosable={!busy}
        closable={!busy} keyboard={!busy} onCancel={onClose}
        footer={<><Button disabled={busy} onClick={onClose}>取消</Button>
            <Button type="primary" loading={busy} onClick={async () => {
                setError("");
                if (await onSave([...draft, ...unavailable], openedRevision)) onClose();
                else setError("排序未保存。请关闭后重新打开，核对最新配置再试。");
            }}>保存并应用排序</Button></>}>
        <p>按模型由新到旧排列。同一模型的多个渠道仍按价格优先；以后“恢复默认排序”会使用这里保存的顺序。</p>
        <ol className={styles.list} aria-label="模型顺序，由新到旧" aria-busy={busy}>
            {draft.map((name, index) => <li key={name} className={styles.row}>
                <span className={styles.number}>{index + 1}</span><span className={styles.name}>{name}</span>
                <Button size="small" aria-label={`上移 ${name}`} disabled={busy || index === 0} onClick={() => move(index, -1)} icon={<ArrowUp size={14} />} />
                <Button size="small" aria-label={`下移 ${name}`} disabled={busy || index === draft.length - 1} onClick={() => move(index, 1)} icon={<ArrowDown size={14} />} />
            </li>)}
        </ol>
        {!draft.length ? <p>暂无可排序的模型。</p> : null}
        {error ? <p role="alert">{error}</p> : null}
    </Modal>;
}
