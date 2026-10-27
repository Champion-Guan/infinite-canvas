import { useMemo, useRef, useState } from "react";
import { Alert, Button, Checkbox, Modal, Radio, Space, Typography } from "antd";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useConfigStore } from "@/stores/use-config-store";
import { usePromptSourceStore } from "@/stores/use-prompt-source-store";
import { useProductNavigation } from "../产品/产品操作";
import { prepareLegacyTransfer, previewLegacyTransfer, hasPendingLegacyTransfer, hasPendingLegacyFallback, type LegacyTransfer, type TransferResult } from "./整批迁移操作";

export function LegacyTransferEntry() {
  const [open, setOpen] = useState(false);
  return <><Button onClick={() => setOpen(true)}>旧版整批迁移</Button>{open && <LegacyTransferPanel onClose={() => setOpen(false)} />}</>;
}
function LegacyTransferPanel({ onClose }: { onClose: () => void }) {
  const { importLegacyProducts, retryLegacyProducts, busy: operationBusy } = useProductNavigation();
  const [backup, setBackup] = useState<File | null>(null), [config, setConfig] = useState<File | null>(null);
  const [plan, setPlan] = useState<LegacyTransfer | null>(null), [preferLegacy, setPreferLegacy] = useState(false);
  const [preserveMissing, setPreserveMissing] = useState(false);
  const [working, setWorking] = useState(false), [progress, setProgress] = useState("");
  const [error, setError] = useState(""), [result, setResult] = useState<TransferResult | null>(null);
  const inFlight = useRef(false);
  const pending = hasPendingLegacyTransfer(), busy = working || operationBusy;
  const projects = useCanvasStore(state => state.projects), deleted = useCanvasStore(state => state.deletedProjects), books = useCanvasStore(state => state.guanWorkbooks);
  const configState = useConfigStore(state => state.config), webdav = useConfigStore(state => state.webdav);
  const sources = usePromptSourceStore(state => state.sources), schedule = usePromptSourceStore(state => state.schedule);
  const { preview, previewError } = useMemo(() => {
    try { return { preview: plan ? previewLegacyTransfer(plan, preferLegacy,
      { projects, deletedProjects: deleted, guanWorkbooks: books },
      { app: "infinite-canvas", version: 1, exportedAt: "", config: configState, webdav, promptSources: { sources, schedule } }) : null, previewError: "" }; }
    catch (failure) { return { preview: null, previewError: failure instanceof Error ? failure.message : "当前数据存在冲突，未开始导入。" }; }
  }, [plan, preferLegacy, projects, deleted, books, configState, webdav, sources, schedule]);
  const run = async (action: () => Promise<void>) => {
    if (inFlight.current) return;
    inFlight.current = true; setWorking(true); setError("");
    try { await action(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "迁移未完成，请保留旧版和完整备份。"); }
    finally { inFlight.current = false; setWorking(false); }
  };
  const resetPreview = () => { setPlan(null); setResult(null); setError(""); setProgress(""); setPreserveMissing(false); };
  return <Modal open title="旧版产品与配置整批迁移" width={800} zIndex={1600} maskClosable={!busy && !pending} closable={!busy && !pending}
    onCancel={() => { if (!busy && !pending) onClose(); }} footer={null} styles={{ body: { maxHeight: "70vh", overflowY: "auto" } }}>
    <Space direction="vertical" size="middle" className="w-full">
      <Alert type="info" showIcon message="所有产品一次导出、一次导入" description={<>先在旧工作台同一个浏览器中打开 <Typography.Text code>http://localhost:3000/local-app/port-migration</Typography.Text>，点击“导出当前浏览器完整备份”。旧版使用其他端口时替换地址中的端口。然后在这里选取 JSON；不必逐个导出产品，也不必重新导入每个 Excel。</>} />
      <label>旧版完整备份 JSON（包含所有产品、素材和浏览器内配置）<input aria-label="旧版完整备份 JSON" type="file" accept=".json,application/json" disabled={busy || pending || !!result} onChange={event => { setBackup(event.target.files?.[0] ?? null); resetPreview(); }} className="mt-2 block w-full" /></label>
      <label>补充配置文件（可选；用此文件代替备份内的普通配置）<input aria-label="补充配置文件" type="file" accept=".json,application/json" disabled={busy || pending || !!result} onChange={event => { setConfig(event.target.files?.[0] ?? null); resetPreview(); }} className="mt-2 block w-full" /></label>
      <Button disabled={!backup || busy || pending || !!result} loading={working && !plan} onClick={() => void run(async () => { setProgress("正在检查所有产品、素材与配置，尚未写入新工作台"); setPlan(await prepareLegacyTransfer(backup!, config ?? undefined)); setProgress(""); })}>检查整批备份</Button>
      {plan && preview && <>
        <Alert type="success" showIcon message={`检查通过：新增 ${preview.added} 个产品，${preview.recycled} 个回收站产品，保留已存在 ${preview.skipped} 个`} description={`Excel 工作簿 ${plan.products.snapshot.guanWorkbooks?.contract.productSets.length ?? 0} 个；画布素材 ${plan.products.media.length} 份；新增渠道 ${preview.channels} 个。`} />
        <details><summary>查看本次产品清单</summary><div className="max-h-44 overflow-y-auto"><ul>{plan.products.snapshot.projects.map(project => <li key={project.id}>{project.title} · {project.nodes.length} 张卡片</li>)}</ul></div></details>
        <Radio.Group value={preferLegacy} disabled={busy || pending || !!result} onChange={event => setPreferLegacy(event.target.value)}>
          <Space direction="vertical"><Radio value={false}>合并配置，保留目标已有偏好与 Fallback（缺省项采用旧版值）</Radio><Radio value={true}>合并渠道，采用旧版普通偏好、WebDAV 账号与 Fallback 排序</Radio></Space>
        </Radio.Group>
        {!!preview.conflicts.length && <details><summary>配置差异 {preview.conflicts.length} 项（按所选合并方式处理）</summary><ul>{preview.conflicts.map((item, index) => <li key={`${item}:${index}`}>{item}</li>)}</ul></details>}
        <Alert type="warning" showIcon message="迁移范围与需要重新授权的项目" description={<ul>{[...plan.products.warnings, ...plan.settings.warnings].map((warning, index) => <li key={index}>{warning}</li>)}</ul>} />
        {!!plan.products.missingMedia.length && <Alert type="error" showIcon message="源备份中已有缺失素材" description={<><ul>{plan.products.missingMedia.map((item, index) => <li key={index}>{item.product} · 原编号 {item.key}</li>)}</ul><Checkbox checked={preserveMissing} disabled={busy || pending || !!result} onChange={event => setPreserveMissing(event.target.checked)}>保留原卡片和缺失标记，迁移其他完整内容；原备份继续保留</Checkbox></>} />}
      </>}
      {!!progress && !result && <Typography.Text role="status">{progress}</Typography.Text>}
      {!!error && <Alert type="error" showIcon message={error} />}
      {!!previewError && <Alert type="error" showIcon message={previewError} />}
      {result ? <Alert type="success" showIcon message="整批迁移已保存" description={`新增产品 ${result.added} 个、回收站 ${result.recycled} 个；已有产品保留 ${result.skipped} 个；新增渠道 ${result.channels} 个。产品、工作簿和配置均已收到 SQLite 保存确认。可关闭面板后切换工作簿查看。`} /> : pending ?
        <Space wrap><Button type="primary" loading={working} disabled={busy} onClick={() => void run(async () => { setResult(await retryLegacyProducts()); setProgress(""); })}>重试本批保存</Button>{hasPendingLegacyFallback() && <Button disabled={busy} onClick={() => void run(async () => { setResult(await retryLegacyProducts(true)); setProgress(""); })}>保留当前 Fallback 并重试保存</Button>}</Space> :
        <Button type="primary" disabled={!plan || !preview || busy || (!!plan.products.missingMedia.length && !preserveMissing)} loading={working && !!plan} onClick={() => void run(async () => { setResult(await importLegacyProducts(plan!, preferLegacy, setProgress, preserveMissing)); setProgress(""); })}>整批导入产品与配置</Button>}
      <Button disabled={busy || pending} onClick={onClose}>{result ? "完成" : "关闭"}</Button>
    </Space>
  </Modal>;
}
