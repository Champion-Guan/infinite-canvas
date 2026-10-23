# Web客户安装与升级

目标仓库固定为`Champion-Guan/infinite-canvas`。Web预览渠道与旧Stable分开，旧`server.mjs`、3000/8888入口和既有Release保持。当前仅支持Apple Silicon macOS，固定`http://localhost:3100`。

## 客户使用

只有同时带`Web更新清单.json`、`Web更新清单.sig`和对应中文ZIP的`web-v*`预发布才是可安装版。GitHub的Source code ZIP及源码PR不属于客户安装包。

1. 下载`生图工作台Web-v版本-macos-arm64.zip`，解压后双击`安装工作台.command`。安装器从固定仓库取公开清单，使用原可信Ed25519公钥核验签名、库存、Node及系统助手；失败保留现有数据。
2. 双击`启动工作台.command`，在原浏览器打开`http://localhost:3100`。无需另装npm或Node。3100已被占用时不接管、不强制终止未知进程。
3. 旧3000/8888用户先在旧版导出产品，再用新版“导入产品”新建画布；API凭据需重新配置。当前没有自动搬迁旧浏览器数据库、WebDAV或代理运行状态。
4. 后续在设置→软件更新检查及下载可信包，再暂存。开启安装并确认画布已保存、任务已结束，关闭工作台页面后安装。原生端再次检查授权页面、生成任务和SQLite备份；其他网站可继续使用。

安装目录为`~/Library/Application Support/AI-Workbench-Web安装`，个人数据仍为`~/Library/Application Support/AI-Workbench-重建版/工作区`，系统助手按二进制摘要独立存放。升级只切版本，不搬移或清空SQLite、媒体与凭据。数据schema或Origin改变时拒绝就地升级。

## 开发和构建

唯一业务来源为根`扩展功能/`；根`上游适配/`的有序单功能补丁接入锁定作者提交。`.运行/`全是本机生成输入或证据，禁止提交。不要将生成画布源码复制成第二套业务来源。

在macOS arm64、Node24执行：

```sh
npm run web:test-update
npm run stable:runtime -- arm64
npm run web:build -- output/stable-runtime/arm64
```

`web:build`在`.运行/Web客户包/构建-*/`生成中文ZIP、完整逐文件库存及`构建结果.json`。使用锁定依赖`npm ci`，从作者固定Git SHA读取源码；不复制开发依赖、工作簿、数据库或已安装助手。构建只链接服务模块，不打开端口或Keychain。源码在构建期间变化即失败；脏树只生成`releaseReady:false`候选，不允许签名。

本机原开发193项边界还依赖其`.运行/3100源`和原已装开发依赖，不把它们当成新仓库的一键可运行测试。独立`web:test-update`可直接运行，不启动工作台、不使用真实数据或私钥。

## 所有者签名与预发布

从干净固定提交构建。按`开发文档/Web发布版本.json`创建匹配的`web-v*`标签后，所有者本机入口：

```sh
node 开发工具/签名Web客户包.mjs /绝对路径/构建结果.json /既有加密签名备份目录 RELEASE-WEB-PREVIEW
node 开发工具/发布Web预览版.mjs /绝对路径/构建结果.json RELEASE-WEB-PREVIEW
```

签名入口限定真实GitHub所有者`Champion-Guan`（87700227）、干净固定提交和匹配标签，复用既有固定公钥及Keychain保护的加密密钥备份。不得新建替代密钥、降低验签、伪造Actions或将私钥放聊天/参数/环境。发布先建Draft，上传包和两份清单，下载复核后才公开预发布；不替换旧Stable资产。

## 本轮真实验证与剩余限制

2026-10-23：44MB原生arm64候选构建、Swift编译、官方Node哈希、服务模块链接及ZIP库存核验通过；更新边界32项通过，涵盖签名、解包、任务/页面门禁、启动失败和提交写入失败回退。原3100更新页已切到Web渠道，旧Stable不会被误装。

尚未证明客户真实首次安装、原Keychain ACL在新助手路径的读权限、整链真实升级/回退、崩溃遗留锁恢复及跨Mac行为；视频/Agent/WebDAV未决任务的全覆盖也未完成。现阶段源码候选和单元事务检查不能宣称客户可升级。本轮完整TypeScript先检出14处类型错误，补齐媒体字段与回调类型后，锁定依赖的完整tsc和Vite构建均通过。开发依赖树缺少声明文件，不用该树产生的连锁报错充当源码结论。

2026-10-23检查时CLI登录为`MrGuAm`，不满足所有者签名入口；目标仓库当前无签名Secret，已检查的项目范围也未定位到既有加密签名备份。本轮不更换信任根或发布未签名客户包。
