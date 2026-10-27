// 当前固定公共渠道匿名读取，不接触或迁移旧项目的 GitHub 凭据。
export class UpdateError extends Error {
  constructor(code) { super(code); this.code = code; }
}
