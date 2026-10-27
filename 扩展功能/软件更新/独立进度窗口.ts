import { updateRequest } from "./软件更新客户端";

// 在确认按钮的同步点击中先创建窗口，避免异步请求后被浏览器拦截。
// 观察入口连接失败时不确认安装，用户仍留在原工作台。
export async function connectUpdateProgressWindow(popup: Window | null): Promise<void> {
    if (!popup || popup.closed) throw new Error("请允许打开安装进度窗口；本次安装尚未确认");
    try {
        const { url } = await updateRequest("progress-window");
        if (popup.closed) throw new Error("进度窗口已关闭，本次安装尚未确认");
        popup.opener = null;
        popup.location.replace(url);
    } catch (error) { popup.close(); throw error; }
}
