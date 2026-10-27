type Appearance = { showImageInfo?: boolean; imageInfoDefaultVersion?: number };
export const imageInfoDefaults = { showImageInfo: true, imageInfoDefaultVersion: 1 } as const;

// 兼容旧版本标记；保留所有明确的true/false，不把新版用户主动关闭的偏好覆盖掉。
export function withCanvasAppearanceDefaults<T extends Appearance>(project: T): T & { showImageInfo: boolean; imageInfoDefaultVersion: number } {
    if (project.imageInfoDefaultVersion === 1 && typeof project.showImageInfo === "boolean") return project as T & { showImageInfo: boolean; imageInfoDefaultVersion: number };
    return { ...project, showImageInfo: project.showImageInfo ?? true, imageInfoDefaultVersion: 1 };
}
