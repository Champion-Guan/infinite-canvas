import { Tooltip } from "antd";
import { PRODUCT_BRIEF_FIELDS, WILDBERRIES_PLATFORM, type ProductBriefField, type ProductBriefValues } from "./旧版参数规则";
import { ProductOptionSelect } from "./产品选项下拉";

type ProductBriefFormProps = {
    values?: ProductBriefValues;
    platform: string;
    borderColor: string;
    textColor: string;
    shared?: boolean;
    onChange: (field: ProductBriefField, value: string) => void;
};

const RICH_CONTENT_OPTIONS = [
    { value: "", label: "未指定" },
    { value: "需要", label: "需要" },
    { value: "不需要", label: "不需要" },
];

export function ProductBriefForm({ values, platform, borderColor, textColor, shared, onChange }: ProductBriefFormProps) {
    const style = { borderColor, color: textColor };
    const controlClass = "w-full rounded-lg border bg-transparent px-2 text-xs outline-none focus:ring-2 focus:ring-stone-300/70 dark:focus:ring-stone-500/50";
    const renderFields = (start: number, end: number) => PRODUCT_BRIEF_FIELDS.slice(start, end)
        .filter(field => field.key !== "richContent" || platform !== WILDBERRIES_PLATFORM)
        .map(field => (
        <label key={field.key} className={`${["nameCategory", "colorModel", "richContent"].includes(field.key) ? "" : "col-span-2 "}block min-w-0 text-[11px]`}>
            <span className="mb-1 block font-medium">{field.label}</span>
            <Tooltip title={field.help} trigger={["hover", "focus"]} placement="right" mouseEnterDelay={0.35}
                styles={{ root: { maxWidth: 300 }, container: { fontSize: 13, lineHeight: 1.6, padding: "8px 12px" } }}>
                {field.kind === "multiline" ? (
                    <textarea aria-label={field.label} value={values?.[field.key] || ""} onChange={event => onChange(field.key, event.target.value)}
                        rows={2} className={`${controlClass} min-h-16 resize-y py-2`} style={style}
                        placeholder={field.key === "styleReference" ? "可选" : ""} />
                ) : field.kind === "choice" ? (
                    <div>
                        <ProductOptionSelect label={field.label} value={values?.[field.key] || ""} onChange={value => onChange(field.key, value)}
                            options={RICH_CONTENT_OPTIONS} borderColor={borderColor} textColor={textColor} />
                    </div>
                ) : (
                    <input aria-label={field.label} type="text"
                        value={values?.[field.key] || ""} onChange={event => onChange(field.key, event.target.value)}
                        className={`${controlClass} h-8`} style={style} />
                )}
            </Tooltip>
        </label>
    ));
    return (
        <div className="space-y-3" data-product-brief-form>
            <h3 className="text-xs font-semibold">{shared ? "共用商品资料" : "商品资料"}</h3>
            <div className="grid grid-cols-2 gap-2">{renderFields(0, 2)}</div>
            <div className="grid grid-cols-2 gap-2">{renderFields(2, 9)}</div>
            {platform !== WILDBERRIES_PLATFORM ? <fieldset className="min-w-0">
                <legend className="mb-2 text-[11px] font-medium">需要制作</legend>
                <div className="grid grid-cols-2 gap-2">{renderFields(9, 10)}</div>
            </fieldset> : null}
            <div className="grid grid-cols-2 gap-2">{renderFields(10, PRODUCT_BRIEF_FIELDS.length)}</div>
        </div>
    );
}
