export type ImageSuperAction = "language" | "color" | "dimensions";

export const imageSuperActions = [
    { key: "language", label: "换语言", placeholder: "例如：俄文、英文" },
    { key: "color", label: "换颜色", placeholder: "例如：主体改为哑光黑色，轮子保持原色" },
    { key: "dimensions", label: "增加尺寸标注", placeholder: "例如：主体高72cm、宽36cm、深23cm" },
] as const;

export function buildImageSuperPrompt(action: ImageSuperAction, input: string) {
    const value = input.trim();
    if (!value) throw Error("请先填写编辑要求");
    const shared = "以唯一参考图为原图进行编辑，生成一张图片。保留原图中的产品主体身份、结构、数量、视角、构图、背景、光照和画幅比例，仅执行以下指定编辑。";
    switch (action) {
        case "language":
            return `${shared}\n将原图中可见的文字翻译并替换为用户指定语言，保留原意、数字、尺寸、单位、品牌和型号；文字准确可读，字体风格、层级和布局与原图协调。不要添加原图没有的卖点。\n用户指定的目标语言及要求：\n${value}`;
        case "color":
            return `${shared}\n按用户要求修改产品主体或明确指定部位的颜色，保留材质质感、纹理、细节、阴影与高光。未指定部位、背景和文字保持原样。\n用户指定的颜色及部位：\n${value}`;
        case "dimensions":
            return `${shared}\n为图片中的产品主体添加尺寸标注：使用清晰、专业的尺寸线、延长线、箭头以及数字和单位，将用户提供的每项尺寸准确对应到主体相应部位和测量方向。尺寸线围绕主体排布，不遮挡产品关键细节，与原图风格协调。标注的是产品主体的实际尺寸，不是图片像素尺寸，也不是画布或图片边框的宽高。只使用用户明确提供的数值和单位，不根据图片比例或常识估算、补全其他尺寸，不改动产品主体本身。\n用户提供的主体尺寸及标注要求：\n${value}`;
        default:
            throw Error("不支持的图片编辑操作");
    }
}
