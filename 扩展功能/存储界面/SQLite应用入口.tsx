import React from "react";
import { LocalStatusRegion } from "./状态通知区";
import { SQLiteSaveStatus } from "./保存状态条";
import { createRoot } from "react-dom/client";
import "antd/dist/reset.css";
import "streamdown/styles.css";
import "@/styles/globals.css";
import { RouterProvider } from "react-router-dom";

import { AppProviders } from "@/components/layout/app-providers";
import "@/i18n/index";
import { initAnalytics } from "@/lib/analytics";
import { router } from "@/router";

initAnalytics();

document.body.style.fontFamily = '"SF Pro Display","SF Pro Text","PingFang SC","Microsoft YaHei","Helvetica Neue",sans-serif';

createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
        <AppProviders>
            <LocalStatusRegion>
                <RouterProvider router={router} />
                <SQLiteSaveStatus />
            </LocalStatusRegion>
        </AppProviders>
    </React.StrictMode>,
);
