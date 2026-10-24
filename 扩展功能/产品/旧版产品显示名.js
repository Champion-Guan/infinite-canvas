export function productDisplayName(product, index = 0) {
  const raw = product?.title || product?.identity?.titleZh || product?.identity?.sku || `产品 ${index + 1}`;
  const name = String(raw).split(/[|｜]/, 1)[0].trim();
  return name || `产品 ${index + 1}`;
}
