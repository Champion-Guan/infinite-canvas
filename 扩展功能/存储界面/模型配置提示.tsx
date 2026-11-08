import { useEffect, useRef, useSyncExternalStore } from "react";
import { App } from "antd";
import { missingModelNoticeSnapshot, subscribeMissingModelNotice } from "../产品配置/模型配置通知";

export function MissingModelConfigurationNotice() {
    const { message } = App.useApp();
    const notice = useSyncExternalStore(subscribeMissingModelNotice, missingModelNoticeSnapshot, () => null);
    const shown = useRef<number | undefined>(missingModelNoticeSnapshot()?.sequence);
    useEffect(() => {
        if (!notice || shown.current === notice.sequence) return;
        shown.current = notice.sequence;
        void message.warning({ key: "missing-model-configuration", content: notice.message, duration: 4 });
    }, [message, notice]);
    return null;
}
