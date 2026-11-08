// 数据服务的独立单文件后继登记。
// 历史 SQLite 批次及其 JSON/patch 保持原字节；这里只允许已核对的媒体读取顺序后继。
export const 数据服务路径 = '扩展功能/本机服务/数据服务.mjs';
export const 数据服务历史SHA256 = 'aff5145a09b2e27707c6ed3fbe38bc2b7937b7bbfb4fb56aa95007768731846b';
export const 数据服务后继SHA256 = 'a014ace4b964f0b91a91cd24044a2feb84f07ae3785c11d0711430d08a3b29fe';
export const 数据服务媒体读取后继登记 = Object.freeze({
  文件: 数据服务路径,
  历史SHA256: 数据服务历史SHA256,
  后继SHA256: 数据服务后继SHA256,
  用途: '媒体上传先读取请求体，再进入写入协调闸门，避免排队期间占用请求体并减少连接失败。',
  范围: '仅允许数据服务.mjs这一处已核对的媒体读取顺序变化；不放宽其他SQLite依赖、授权、备份或运行副本校验。',
});

export function 数据服务前态已登记(sha256) {
  return sha256 === 数据服务历史SHA256 || sha256 === 数据服务后继SHA256;
}

export function 数据服务后继通过(sha256) {
  return sha256 === 数据服务后继SHA256;
}
