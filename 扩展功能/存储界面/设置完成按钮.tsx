import { App, Button } from "antd";
import { useTranslation } from "react-i18next";
import { useConfigStore } from "@/stores/use-config-store";

// 完成操作独立于滚动内容，保持设置入口和独立设置页使用相同的结束逻辑。
export function SettingsDoneButton() {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const finish = () => {
        const state = useConfigStore.getState();
        const ready = state.config.channels.some(channel => channel.baseUrl.trim() && channel.apiKey.trim() && channel.models.length);
        state.setConfigDialogOpen(false);
        if (!ready) return;
        message.success(t(state.shouldPromptContinue ? "config.savedContinue" : "config.saved"));
        state.clearPromptContinue();
    };
    return <Button type="primary" onClick={finish}>{t("common.done")}</Button>;
}
