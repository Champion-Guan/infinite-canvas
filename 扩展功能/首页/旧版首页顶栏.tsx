// 旧顶栏来自 server/index.mjs 的 workbenchLogoStyle/mvpNavigationStyle、
// shared/data-contract/index.js 的空产品 controls，SVG 路径与尺寸保持不变。
import { App } from "antd";
import { useRef } from "react";
import { ExcelWorkbookPicker } from "../Excel/Excel工作簿选择";
import { ProductCapsules } from "../产品/顶部产品胶囊";
import { ProductTrashEntry } from "../产品/产品回收面板";
import { useProductNavigation } from "../产品/产品操作";
import { useConfigStore } from "@/stores/use-config-store";
import { useThemeStore } from "@/stores/use-theme-store";
import styles from "./旧版顶栏.module.css";
import { productFeatures } from "../产品配置/功能开关";
import { preloadSettings } from "../存储界面/延迟设置入口";

export function LegacyHomeChrome() {
  const { message } = App.useApp();
  const { createProduct, importProduct, busy } = useProductNavigation();
  const importRef = useRef<HTMLInputElement>(null);
  const theme = useThemeStore((s) => s.theme);
  const openConfig = useConfigStore((s) => s.openConfigDialog);
  const isConfigOpen = useConfigStore((s) => s.isConfigOpen);
  const setConfigOpen = useConfigStore((s) => s.setConfigDialogOpen);
  const pending = "选择画布压缩包，新建产品并导入其内容。";
  const importProductFile = async (file: File) => {
    try {
      const ids = await importProduct(file);
      message.success(ids.length === 1 ? "已新建产品并导入画布内容" : `已新建 ${ids.length} 个产品并导入画布内容`);
    } catch (error) {
      message.error(error instanceof Error ? error.message : "导入产品失败");
    }
  };
  return <><header className={styles.header} data-theme={theme} aria-label="工作台顶栏"
    onPointerOver={event => { if ((event.target as Element).closest("#guan-settings-trigger")) preloadSettings(); }}
    onFocusCapture={event => { if ((event.target as Element).closest("#guan-settings-trigger")) preloadSettings(); }}>
    <div className={styles.brand}><img src="/guan/首页原样资源/工作台Logo.png" alt="G" /><span>AI-Workbench</span></div>
    <div className={styles.controls}>
      <ProductCapsules />
      <div className={styles.actions} aria-label="画布操作">
        <button type="button" title="新建产品" disabled={busy} onClick={() => { void createProduct().catch(error => message.error(error instanceof Error ? error.message : String(error))); }}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg><span>新建产品</span></button>
        <button type="button" disabled={busy} title={pending} onClick={() => importRef.current?.click()}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 20h14" /></svg><span>导入产品</span></button>
        <input ref={importRef} type="file" accept="application/zip,.zip" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void importProductFile(file); event.currentTarget.value = ""; }} />
        <ProductTrashEntry />
      </div>
      {productFeatures.excel ? <><span className={styles.sheetLabel}>当前工作表：</span><ExcelWorkbookPicker /></> : null}
    </div>
    <button type="button" id="guan-settings-trigger" className={styles.settingsButton} aria-label="画布设置" aria-haspopup="dialog" aria-expanded={isConfigOpen} title="画布设置" onClick={() => isConfigOpen ? setConfigOpen(false) : openConfig(false)}><svg fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg></button>
  </header></>;
}
