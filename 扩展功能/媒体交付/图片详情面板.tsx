import type { CSSProperties, ReactNode } from "react";
import { App, Modal, Spin, Tooltip } from "antd";
import type { CanvasNodeData } from "@/types/canvas";
import type { CanvasTheme } from "@/lib/canvas-theme";
import { formatBytes, getDataUrlByteSize } from "@/lib/image-utils";
import { decodeChannelModel } from "@/stores/use-config-store";
import { useHistoryDownloads } from "../生成历史/历史下载操作";
import { useHistoryMediaPreview } from "../生成历史/历史媒体预览";
import { imageDetailData } from "./图片详情数据";
import styles from "./图片详情面板.module.css";

type Props = { node: CanvasNodeData | null; imageId?: string | null; open: boolean; theme: CanvasTheme; onClose: () => void };

export function CanvasImageDetails({ node, imageId, open, theme, onClose }: Props) {
    const detail = node ? imageDetailData(node, imageId) : null;
    return open && node && detail ? <ImageDetails key={detail.file.id} node={node} detail={detail} theme={theme} onClose={onClose} /> : null;
}

function ImageDetails({ node, detail, theme, onClose }: { node: CanvasNodeData; detail: NonNullable<ReturnType<typeof imageDetailData>>; theme: CanvasTheme; onClose: () => void }) {
    const { message } = App.useApp();
    const preview = useHistoryMediaPreview(detail.file);
    const { downloading, downloadFile } = useHistoryDownloads(message);
    const metadata = node.metadata || {};
    const size = <span className={styles.dimensions}>
        {detail.sizeMatches ? <span>{detail.responseDimensions}</span> : <>
            <span title="请求尺寸：客户设置的目标图片尺寸">{detail.requestedDimensions}</span><span aria-hidden="true" className={styles.separator}>|</span>
            <Tooltip title={detail.hasOriginal || metadata.generationType ? "API 实际响应值：上游返回原图的真实尺寸" : "实际图片尺寸"}><mark>{detail.responseDimensions}</mark></Tooltip>
        </>}
    </span>;
    const rows: Array<[string, ReactNode]> = [
        ["生成来源", detail.source], ["使用渠道", metadata.channel || "暂无"],
        ["使用模型", decodeChannelModel(metadata.model || "")?.model || metadata.model || "暂无"],
        ["生图类型", detail.imageType], ["尺寸", size],
        ...(!detail.sizeMatches && detail.upstreamSize ? [["上游请求尺寸", detail.upstreamSize] as [string, ReactNode]] : []),
        ...(!detail.sizeMatches && detail.hasOriginal ? [["最终图片尺寸", detail.dimensions] as [string, ReactNode]] : []),
        ...(detail.deliveryNote ? [["尺寸处理", detail.deliveryNote] as [string, ReactNode]] : []),
    ];
    const grid: Array<[string, ReactNode]> = [
        ["图片格式", detail.format], ["文件大小", formatBytes(detail.bytes || (detail.file.content.startsWith("data:") ? getDataUrlByteSize(detail.file.content) : 0)) || "暂无"],
        ["审核", detail.moderation], ["质量", metadata.quality || "暂无"],
        ["生成数量", metadata.count != null ? String(metadata.count) : "暂无"], ["背景设置", detail.background],
    ];
    const variables = { "--图片详情背景": theme.node.panel, "--图片详情文字": theme.node.text, "--图片详情边框": theme.node.stroke, "--图片详情次要文字": theme.node.muted } as CSSProperties;
    return <Modal open centered title={<div className={styles.heading}><span>图片详情 - {detail.file.name}</span><button type="button" className={styles.download} onClick={() => void downloadFile(detail.file)} disabled={downloading} aria-busy={downloading}>{downloading ? "正在下载…" : "下载图片"}</button></div>}
        onCancel={onClose} footer={null} width={980} styles={{ body: { padding: 0, maxHeight: "80vh", overflow: "hidden" }, container: { background: theme.node.panel, color: theme.node.text } }}>
        <div className={styles.shell} style={variables} data-canvas-shortcuts-ignore>
            <div className={styles.preview}>
                {preview.error ? <p role="alert">{preview.error}</p> : preview.url ? node.type === "video" ? <video src={preview.url} controls className={styles.image} /> : <img src={preview.url} alt={detail.file.name} className={styles.image} /> : <Spin aria-label="正在读取图片" />}
            </div>
            <div className={styles.info} aria-label="图片生成信息">
                <dl>{rows.map(([label, value]) => <div className={styles.row} key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
                <dl className={styles.grid}>{grid.map(([label, value]) => <div className={styles.cell} key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
                {detail.originalStorageKey ? <button type="button" className={styles.originalDownload} disabled={downloading} onClick={() => void downloadFile({ ...detail.file, name: `${detail.file.name}-原生`, storageKey: detail.originalStorageKey, content: "" })}>下载原生图片</button> : null}
            </div>
        </div>
    </Modal>;
}
