import { useSyncExternalStore } from "react";
import { Progress } from "antd";
import { AppleModal } from "../主题/苹果弹窗";
import { AppleAntButton } from "../主题/苹果交互按钮";
import { importProgressSnapshot, publishImportProgress, subscribeImportProgress } from "./产品导入进度";

export function ProductImportProgressPanel() {
    const progress = useSyncExternalStore(subscribeImportProgress, importProgressSnapshot, () => null);
    const busy = progress?.status === "running";
    const close = () => { if (!busy) publishImportProgress(null); };
    return <AppleModal title="导入产品" open={Boolean(progress)} centered width={480}
        closable={!busy} maskClosable={!busy} keyboard={!busy} onCancel={close}
        footer={busy ? null : <AppleAntButton type="primary" onClick={close}>完成</AppleAntButton>}>
        {progress ? <div className="space-y-3">
            <p className="break-all text-sm">{progress.name}</p>
            <p role="status" aria-live="polite">{progress.phase}</p>
            <Progress percent={progress.percent} status={progress.status === "error" ? "exception" : progress.status === "success" ? "success" : "active"} />
            {progress.total > 0 ? <p className="text-xs text-stone-500">{progress.completed} / {progress.total}</p> : null}
            {progress.error ? <p role="alert" className="text-sm text-red-600">{progress.error}</p> : null}
        </div> : null}
    </AppleModal>;
}
