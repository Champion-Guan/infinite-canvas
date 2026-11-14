import React from "react";
import { LocalStatusRegion } from "./状态通知区";
import { InterfaceErrorBoundary } from "./界面异常恢复";
import { MissingModelConfigurationNotice } from "./模型配置提示";
import { AutomaticStorageCleanup } from "./存储整理面板";
import { createRoot } from "react-dom/client";
import "antd/dist/reset.css";
import "streamdown/styles.css";
import "@/styles/globals.css";
import { RouterProvider } from "react-router-dom";

import { AppProviders } from "@/components/layout/app-providers";
import "@/i18n/index";
import { initAnalytics } from "@/lib/analytics";
import { router } from "@/router";
import { markWorkbenchStartup } from "../本机存储/启动计时.mjs";
import { preserveStartupScreen } from "../本机存储/启动画面交接.mjs";

initAnalytics();
markWorkbenchStartup("interface-ready");

document.body.style.fontFamily = '"SF Pro Display","SF Pro Text","PingFang SC","Microsoft YaHei","Helvetica Neue",sans-serif';

function WorkbenchInterface() {
    React.useLayoutEffect(() => {
        markWorkbenchStartup("interface-committed");
    }, []);
    return (
        <InterfaceErrorBoundary>
        <AppProviders>
            <LocalStatusRegion>
                <MissingModelConfigurationNotice />
                <AutomaticStorageCleanup />
                <RouterProvider router={router} />
            </LocalStatusRegion>
        </AppProviders>
        </InterfaceErrorBoundary>
    );
}

const root = document.getElementById("root")!;
preserveStartupScreen(root);
// 启动画面保留在原父节点，React只接管旁边的新容器，避免CSS动画重启。
const application = document.createElement("div");
application.style.height = "100%";
root.append(application);
createRoot(application).render(
    <React.StrictMode>
        <WorkbenchInterface />
    </React.StrictMode>,
);
