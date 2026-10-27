export type UpdatePreferences = { version: 1; repository: string; autoCheck: boolean; autoDownload: boolean; autoInstall: boolean; network: "auto" | "direct" | "proxy" };
export type UpdateBlocker = { id: string; state: string; reason: string; createdAt: number; canConfirmNoResult: boolean; productId?: string; nodeId?: string };
export type SoftwareUpdateStatus = {
    currentVersion: string; channel: string; preferences: UpdatePreferences; state: string; checking: boolean;
    authorization: string; hasNewVersion: boolean; lastCheckedAt: string | null; error: string | null;
    latest: { version: string; publishedAt: string; notes: string; verification: string } | null;
    history: { at: string; state: string; version: string | null; error: string | null }[];
    download: { state: string; progress: number; error?: string | null };
    install: { allowed: boolean; state: string; currentVersion?: string | null; targetVersion?: string | null;
        reason?: string | null; staging?: boolean; stageError?: string | null; canApprove?: boolean; progressAvailable?: boolean; blockers?: UpdateBlocker[] };
};
export const updateMessages: Record<string, string> = {
    web_manifest_invalid: "Web版签名清单无效，更新已停止",
    web_package_invalid: "Web安装包库存或文件核验失败，原版本保留",
    web_migration_required: "此版本的数据结构不同，需要专门迁移，未自动替换",
    web_release_required: "当前源码开发模式尚未接入 Web 发布包安装",
    update_progress_unavailable: "独立安装进度暂不可用，尚未确认安装；请通过原启动入口重启客户安装器后重试",
    update_repository_locked: "更新仓库固定为 Champion-Guan/infinite-canvas",
    asset_download_timeout: "安装包下载超时，请检查本机代理后重试",
    unconfigured: "尚未配置仓库", unchecked: "尚未检查", available: "有新的稳定版本（签名结果见下载状态）", "up-to-date": "没有更高的稳定版本",
    "no-stable-release": "仓库暂无符合当前渠道的发布包", error: "检查未完成", repository_required: "请先填写私有仓库 OWNER/REPOSITORY",
    authorization_required: "请在本机终端独立授权 GitHub", authorization_expired: "GitHub 授权失效，请重新授权",
    authorization_denied: "GitHub 权限不足，需要指定仓库 Contents 只读权限", repository_unavailable: "仓库不存在或授权不可访问",
    rate_limited: "GitHub 限流，请稍后重试", github_network_failed: "GitHub 网络请求失败，请检查网络或代理",
    github_unavailable: "GitHub 暂时不可用", proxy_unavailable: "本地代理不可用，请启动代理或选择直连",
    keychain_unavailable: "Keychain 不可访问，请检查本机授权", invalid_update_preferences: "仓库或更新设置无效",
    update_storage_invalid: "更新配置读取失败，原文件保留", auth_storage_invalid: "更新授权记录读取失败，原文件保留",
    update_history_invalid: "更新检查记录读取或保存失败，原文件保留",
    "trust-not-configured": "尚未配置可信签名公钥", idle: "尚未下载", "verifying-manifest": "正在验证签名清单", downloading: "正在下载", verified: "签名和文件完整性已验证（未安装）",
    signing_trust_not_configured: "尚未配置内置可信公钥，已安全停止下载", signing_key_untrusted: "签名公钥不可信，已拒绝更新",
    signature_invalid: "数字签名验证失败", stable_manifest_invalid: "稳定版清单无效", release_identity_mismatch: "清单与仓库或版本不匹配",
    version_not_newer: "禁止降级或重复更新", architecture_unsupported: "没有适合本机架构的更新包",
    download_cache_limit: "更新缓存达到单包上限，请清理异常文件后重试", download_cache_unsafe: "更新缓存目录异常，已停止写入",
    disk_budget_exceeded: "安装版本或构建目录容量已达上限，请清理旧版本后重试", disk_budget_unsafe_path: "目录包含异常链接，已停止写入",
    package_integrity_failed: "更新包损坏或不完整", disk_space_insufficient: "暂存更新的磁盘空间不足",
    release_assets_invalid: "稳定版文件缺失或尺寸不匹配", asset_download_failed: "更新下载失败，请稍后重试",
    asset_redirect_rejected: "下载重定向不受信任", asset_access_denied: "更新文件访问失败或受到限流",
    asset_size_invalid: "下载文件超出安全大小限制", download_storage_failed: "暂存失败，当前版本和用户数据保留",
    release_not_available: "请先检查并获得更高的稳定版本", download_in_progress: "另一项更新下载尚未结束，请稍后重试",
    update_manager_unavailable: "独立更新管理器未就绪，当前工作台不受影响", update_manager_invalid: "更新器通信结果无效，已安全停止",
    update_stage_unavailable: "尚无已验证的更新包可暂存", update_stage_invalid: "更新包身份不符合固定渠道",
    update_stage_failed: "暂存复核失败，原版本及用户数据保留", update_bootstrap_required: "尚未完成首次安全接管，仅允许暂存，不执行安装",
    install_coordination_unavailable: "可信窗口与任务协调器尚未就绪，禁止安装", update_recovery_required: "上次版本事务未结束，需要安全恢复",
    update_activation_unconfirmed: "版本激活尚未确认，不开放新任务或自动降级", update_state_invalid: "更新状态记录读取失败，原记录保留",
    install_permit_invalid: "任务空闲许可无效，未进行版本切换", update_failed_rolled_back: "新版本启动失败，已恢复旧版",
    update_rollback_failed: "回滚未能确认，已停止后续安装并保留数据",
    install_disabled: "请先开启确认后自动安装",
    install_operator_confirmation_required: "此版本需要重新确认已保存且全部任务结束",
    install_operator_record_invalid: "安装确认记录损坏，已保留并停止安装",
    install_tasks_pending: "存在未决任务、失败保存或未确认记录，不能安装",
    install_browsers_running: "请保存并关闭所有工作台页面，其他网站可以继续使用",
    install_page_inventory_unavailable: "无法核实工作台页面状态，请检查本机浏览器自动化授权或浏览器支持情况",
    install_evidence_changed: "确认之后活动或保存状态改变，请重新核实",
    generation_confirmation_required: "请先在渠道端确认请求已结束且没有结果",
    generation_resolution_denied: "任务仍在运行或已有结果，不能按无结果收口",
    generation_resolution_conflict: "核实凭据与原任务不一致，记录已保留",
    generation_save_unconfirmed: "核实记录尚未确认保存，请重试本机保存",
};
export const installationMessages: Record<string, string> = {
    "source-development": "源码开发模式，仅检查及下载",
    unavailable: "更新器未启动", disabled: "安装关闭", idle: "更新器已就绪", staged: "已暂存并再次验签（未执行）",
    "bootstrap-required": "等待首次安全接管", "activation-required": "等待确认激活", "recovery-required": "需要安全恢复",
    blocked: "安装被安全阻止", prepared: "已准备版本事务", stopping: "正在停止受控服务", switching: "正在切换版本",
    starting: "正在隔离启动", committed: "版本事务已提交", "rolling-back": "正在恢复旧版", "rolled-back": "已恢复旧版",
    "awaiting-browser-exit": "已确认，等待工作台页面关闭", "confirmation-required": "等待本次更新确认", deferred: "已选择稍后安装",
};
type UpdateHost = { request(operation: string, input?: unknown): Promise<unknown> };
const pendingStatuses = new WeakMap<UpdateHost, Promise<SoftwareUpdateStatus>>();

type UpdateOperation = "status" | "check" | "download" | "preferences" | "stage" | "approve" | "approve-manual" | "defer" | "confirm-no-result";
type UpdateInput = Partial<UpdatePreferences> | { taskId: string; acknowledgement: "upstream-ended-without-result" };
export function updateRequest(operation: "progress-window"): Promise<{ url: string }>;
export function updateRequest(operation: UpdateOperation, input?: UpdateInput): Promise<SoftwareUpdateStatus>;
export async function updateRequest(operation: UpdateOperation | "progress-window", input?: UpdateInput): Promise<SoftwareUpdateStatus | { url: string }> {
    const host = (window as unknown as { __guanUpdateHost?: UpdateHost }).__guanUpdateHost;
    if (!host) throw new Error("本机更新服务未连接，请刷新工作台页面");
    const send = async () => {
        try { return await host.request(operation, input) as SoftwareUpdateStatus; }
        catch (error) { throw new Error(updateMessages[(error as { code?: string }).code || ""] || "软件更新操作未完成，请重新读取状态"); }
    };
    if (operation === "progress-window") {
        const result = await send() as unknown as { url: string };
        if (typeof result?.url !== "string" || !/^http:\/\/127\.0\.0\.1:\d{1,5}\/[a-f0-9]{48}\/$/.test(result.url)) throw new Error(updateMessages.update_progress_unavailable);
        return result;
    }
    // 设置页、版本弹窗及后台轮询共享同一次在途读取，不缓存旧状态或合并写操作。
    if (operation === "status") {
        const existing = pendingStatuses.get(host);
        if (existing) return existing;
        const pending = send();
        pendingStatuses.set(host, pending);
        const clear = () => { if (pendingStatuses.get(host) === pending) pendingStatuses.delete(host); };
        void pending.then(clear, clear);
        return pending;
    }
    pendingStatuses.delete(host);
    try { return await send(); }
    finally { pendingStatuses.delete(host); }
}
