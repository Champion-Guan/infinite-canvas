import { storageStatus } from "../本机存储/上游浏览器存储桥";

// 已知保存错误时，上传不能继续排队等待一个永远不会确认的写入。
// 先让调用方收到明确错误并进入各自的 finally，避免按钮长期转圈。
export function assertUploadStorageReady() {
    const status = storageStatus();
    if (status.conflict || status.state === "error") {
        const error = new Error(
            status.conflict
                ? "当前保存存在版本冲突，请先处理“保存失败”后再上传文件。"
                : "当前保存尚未确认，请先点击“重试保存”后再上传文件。",
        );
        error.name = "UploadStorageBlocked";
        throw error;
    }
}
