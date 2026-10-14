import { createBrowserRouter, Outlet } from "react-router-dom";
import { lazy, Suspense, type ComponentType } from "react";

import { AnalyticsTracker } from "@/components/layout/analytics-tracker";
import UserLayout from "@/layouts/user-layout";
import NotFound from "@/pages/not-found";

// Keep the shell and the current route responsive by loading large feature
// pages only when they are visited. This also keeps video, Agent and settings
// code out of the first canvas download.
const HomePage = lazy(() => import("@/pages/home"));
const ImagePage = lazy(() => import("@/pages/image"));
const VideoPage = lazy(() => import("@/pages/video"));
const AssetsPage = lazy(() => import("@/pages/assets"));
const PromptsPage = lazy(() => import("@/pages/prompts"));
const CanvasPage = lazy(() => import("@/pages/canvas"));
const CanvasProjectPage = lazy(() => import("@/pages/canvas/project"));
const ConfigPage = lazy(() => import("@/pages/config"));

function LazyPage({ component: Component }: { component: ComponentType }) {
    return (
        <Suspense fallback={<main className="guan-route-loading flex h-full items-center justify-center bg-background text-sm text-muted-foreground" aria-busy="true">正在加载工作台…</main>}>
            <div className="guan-route-enter h-full min-h-0">
                <Component />
            </div>
        </Suspense>
    );
}

function CanvasLoadError() {
    return <main className="flex h-full flex-col items-center justify-center gap-4 bg-white p-6 text-stone-900 dark:bg-stone-950 dark:text-white" role="alert">
        <h2>画布加载遇到问题</h2>
        <p>原画布和生成文件已保留。请先切回原产品查看任务状态，再刷新页面。</p>
        <button type="button" className="rounded-lg border px-4 py-2" onClick={() => window.location.reload()}>重新加载当前画布</button>
    </main>;
}

export const router = createBrowserRouter([
    {
        element: (
            <UserLayout>
                <AnalyticsTracker />
                <Outlet />
            </UserLayout>
        ),
        children: [
            { path: "/", element: <LazyPage component={HomePage} /> },
            { path: "/image", element: <LazyPage component={ImagePage} /> },
            { path: "/video", element: <LazyPage component={VideoPage} /> },
            { path: "/assets", element: <LazyPage component={AssetsPage} /> },
            { path: "/prompts", element: <LazyPage component={PromptsPage} /> },
            { path: "/canvas", element: <LazyPage component={CanvasPage} /> },
            { path: "/canvas/:id", element: <LazyPage component={CanvasProjectPage} />, errorElement: <CanvasLoadError /> },
            { path: "/config", element: <LazyPage component={ConfigPage} /> },
        ],
    },
    { path: "*", element: <NotFound /> },
]);
