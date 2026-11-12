const categories: Record<string, { label: string; detail: string; status: string }> = {
    images: { label: "图片与原图", detail: "上传图片、生成结果，以及转换前保留的原图。", status: "保留使用" },
    previews: { label: "图片预览", detail: "浏览图片时使用的小预览图，可重新生成。", status: "按需保留" },
    videos: { label: "视频", detail: "上传和生成的视频文件。", status: "保留使用" },
    audio: { label: "音频", detail: "上传和生成的音频文件。", status: "保留使用" },
    media_index: { label: "文件目录", detail: "记录文件的位置与对应关系。", status: "系统管理" },
    prompts: { label: "提示词临时记录", detail: "提示词处理过程中的临时内容。", status: "系统管理" },
    workspace: { label: "画布与个人设置", detail: "产品画布、卡片、连线和工作台设置。", status: "保留使用" },
    image_logs: { label: "图片生成历史", detail: "过去的生图任务与结果记录。", status: "保留使用" },
    video_logs: { label: "视频生成历史", detail: "过去的视频任务与结果记录。", status: "保留使用" },
    product_recycle: { label: "已删除的产品", detail: "仍可恢复的产品与专属素材；清空后无法恢复，共用文件会保留。", status: "回收站" },
    workbook_recycle: { label: "已删除的 Excel", detail: "仍可恢复的工作表及其产品；清空后无法恢复，共用文件会保留。", status: "回收站" },
    other_media: { label: "其他文件与恢复记录", detail: "上传的其他文件，以及生成任务的临时恢复内容。结果确认保存后，旧恢复内容可整理。", status: "部分可整理" },
    shared: { label: "多处共用的文件", detail: "被多个画布或记录共同使用，只占一份空间；仍有使用处时保留。", status: "正在使用" },
    other: { label: "工作台运行记录", detail: "任务状态、保存确认及功能设置，由工作台维护。", status: "系统管理" },
    history: { label: "旧版保存记录", detail: "旧版存储方式留下的保存内容，区别于图片生成历史。整理时会重新核对当前是否仍在使用。", status: "可扫描整理" },
    retained_media: { label: "暂时未使用的文件", detail: "当前没有记录引用，保留一段时间后可整理；重新使用会继续保护。", status: "按期限整理" },
};
export function storageCategoryCopy(name: string, fallback: string) {
    return categories[name] || { label: fallback, detail: "由工作台管理的存储内容。", status: "系统管理" };
}
