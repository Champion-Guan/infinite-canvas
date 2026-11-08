import type { CSSProperties, ReactNode } from "react";
import { App, Spin, Tooltip } from "antd";
import { AnimatePresence } from "motion/react";
import { AppleModal as Modal } from "../主题/苹果弹窗";
import type { CanvasNodeData } from "@/types/canvas";
import type { CanvasTheme } from "@/lib/canvas-theme";
import { formatBytes, getDataUrlByteSize } from "@/lib/image-utils";
import { decodeChannelModel, useEffectiveConfig } from "@/stores/use-config-store";
import { useHistoryDownloads } from "../生成历史/历史下载操作";
import { useHistoryMediaPreview } from "../生成历史/历史媒体预览";
import { imageDetailData } from "./图片详情数据";
import styles from "./图片详情面板.module.css";

type Props = { node: CanvasNodeData | null; imageId?: string | null; open: boolean; theme: CanvasTheme; onClose: () => void };

export function CanvasImageDetails({ node, imageId, open, theme, onClose }: Props) {
    const config = useEffectiveConfig();
    const detail = node ? imageDetailData(node, imageId, config.channels) : null;
    return <AnimatePresence>{open && node && detail ? <ImageDetails key={detail.file.id} node={node} detail={detail} theme={theme} onClose={onClose} /> : null}</AnimatePresence>;
}

function ImageDetails({ node, detail, theme, onClose }: { node: CanvasNodeData; detail: NonNullable<ReturnType<typeof imageDetailData>>; theme: CanvasTheme; onClose: () => void }) {
    const { message } = App.useApp();
    const preview = useHistoryMediaPreview(detail.file);
    const { downloading, downloadFile } = useHistoryDownloads(message);
    const metadata = node.metadata || {};
    const size = <span className={styles.dimensions}>
        {detail.hasOriginal && detail.dimensions !== detail.responseDimensions ? <>
            <Tooltip title="最终保存图片尺寸"><span>{detail.dimensions}</span></Tooltip><span aria-hidden="true" className={styles.separator}>|</span>
            <Tooltip title="上游返回原图尺寸"><mark>{detail.responseDimensions}</mark></Tooltip>
        </> : <span>{detail.dimensions}</span>}
    </span>;
    const rows: Array<[string, ReactNode]> = [
        ["生成来源", detail.source], ["使用渠道", detail.channel || metadata.channel || metadata.provider || metadata.channelName || metadata.channelId || decodeChannelModel(metadata.model || "")?.channelId || "渠道未知"],
        ["使用模型", decodeChannelModel(detail.model || metadata.model || "")?.model || detail.model || metadata.model || "暂无"],
        ["生图类型", detail.imageType], ["尺寸", size],
    ];
    const grid: Array<[string, ReactNode]> = [
        ["图片格式", detail.format], ["文件大小", formatBytes(detail.bytes || (detail.file.content.startsWith("data:") ? getDataUrlByteSize(detail.file.content) : 0)) || "暂无"],
        ["审核", detail.moderation], ["质量", metadata.quality || "暂无"],
        ["生成数量", metadata.count != null ? String(metadata.count) : "暂无"], ["背景设置", detail.background],
    ];
    const variables = { "--图片详情背景": theme.node.panel, "--图片详情文字": theme.node.text, "--图片详情边框": theme.node.stroke, "--图片详情次要文字": theme.node.muted } as CSSProperties;
    return <Modal open centered title={<div className={styles.heading}><span>图片详情 - {detail.file.name}</span><button type="button" className={`${styles.download} guan-apple-action guan-apple-press`} onClick={() => void downloadFile(detail.file)} disabled={downloading} aria-busy={downloading}>{downloading ? "正在下载…" : "下载图片"}</button></div>}
        onCancel={onClose} footer={null} width={980} styles={{ body: { padding: 0, maxHeight: "80vh", overflow: "hidden" }, container: { background: theme.node.panel, color: theme.node.text } }}>
        <div className={styles.shell} style={variables} data-canvas-shortcuts-ignore>
            <div className={styles.preview}>
                {preview.error ? <p role="alert">{preview.error}</p> : preview.url ? node.type === "video" ? <video src={preview.url} controls className={styles.image} /> : <img src={preview.url} alt={detail.file.name} className={styles.image} /> : <Spin aria-label="正在读取图片" />}
            </div>
            <div className={styles.info} aria-label="图片生成信息">
                <dl>{rows.map(([label, value]) => <div className={styles.row} key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
                <dl className={styles.grid}>{grid.map(([label, value]) => <div className={styles.cell} key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
                {detail.originalStorageKey ? <button type="button" className={`${styles.originalDownload} guan-apple-action guan-apple-press`} disabled={downloading} onClick={() => void downloadFile({ ...detail.file, name: `${detail.file.name}-原生`, storageKey: detail.originalStorageKey, content: "" })}>下载原生图片</button> : null}
            </div>
        </div>
    </Modal>;
}
