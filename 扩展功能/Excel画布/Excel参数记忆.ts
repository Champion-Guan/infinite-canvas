import { sqlitePreferences } from "../本机存储/上游浏览器存储桥";

// 沿用旧版稳定产品ID键与合并/清空语义；只接入已授权SQLite，不按当前URL猜身份。
export function parameterMemoryKey(productId: string) {
  if (!productId) throw new Error("缺少产品身份，未读写参数。");
  return `guan-canvas-parameter-values:${encodeURIComponent(productId)}`;
}
export function readProductParameterValues(productId: string): Record<string, string> {
  const raw = sqlitePreferences.getItem(parameterMemoryKey(productId));
  if (raw === null) return {};
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error("产品参数记忆损坏，未作为空值覆盖。"); }
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.values(value).some(item => typeof item !== "string")) throw new Error("产品参数记忆格式异常，未覆盖。");
  return value as Record<string, string>;
}
export function saveProductParameterValues(productId: string, values: Record<string, string>) {
  if (Object.values(values).some(item => typeof item !== "string")) throw new Error("参数必须为文字。");
  const next = { ...readProductParameterValues(productId), ...values };
  sqlitePreferences.setItem(parameterMemoryKey(productId), JSON.stringify(next));
  // setItem只进入现有保存队列；界面的SQLite ACK才代表已持久化。
}

// 已保存卡片（含复制快照、撤销及明确留空）优先；产品记忆只补缺失键。
export function restoreProductParameterValues(productId: string, current: Record<string, string>): Record<string, string> {
  const remembered = readProductParameterValues(productId);
  const missing = Object.fromEntries(Object.entries(current).filter(([token]) => !Object.hasOwn(remembered, token)));
  if (Object.keys(missing).length) saveProductParameterValues(productId, missing);
  return { ...remembered, ...current };
}
