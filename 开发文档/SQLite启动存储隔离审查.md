# SQLite启动存储隔离：3文件批准与隔离验收

日期：2026-10-17。分支：`guan/stage6-local-storage`。

## 状态与范围

用户已明确批准此3文件精确差异，通过第三次独立快照事务接入新建隔离副本。完整TypeScript预审、Vite构建及本批11项实际UI验收通过；未应用到作者目录或日常3100。审批前JSON/patch原字节保留，其历史“待批准”状态以独立批准登记和最新验收记录为准。

- 精确差异：[SQLite启动存储隔离.patch](../上游适配/待审查/SQLite启动存储隔离.patch)
- 文件清单：[SQLite启动存储隔离.json](../上游适配/待审查/SQLite启动存储隔离.json)
- 差异SHA-256：`0b15056948f5ada3171f66c36d778259c4b1728b6493d751a568be95644ff54e`
- 前置：获批25文件及节点存储1文件后继，锁定上游`3a6b64b602ad062b29fac66902ed18a7ef5fd9dc`。

## 批准前的真实失败边界（现已通过复验）

最新完整React构建的实际UI前6项通过，包含图片、预览和画布引用保存。真正重载后文本节点与Blob图片均已显示，但零浏览器存储断言失败；主题等后续验收停止。

定点探测记录两次getItem及堆栈，不记录key/value或凭据：

1. `web/index.html`的内联主题脚本读取旧localStorage；此前只审查TS/TSX，漏掉HTML。
2. React Router 7.18.4的`restoreAppliedTransitions`读取sessionStorage。其pagehide写入路径也必须覆盖，不是只消除一次读取。

证据：`.运行/output/playwright/SQLite存储探测-2026-10-17T07-20-23.679Z/诊断结果.json`。共享chunk名称含mermaid不能用来判断调用归属，已追溯到实际Router源码。

## 具体改动

| 文件 | 变更 | 保持不变 |
| --- | --- | --- |
| `web/index.html` | 首屏用matchMedia判定临时主题，不读取localStorage | 正式主题偏好仍由已有SQLite预读与主题Store恢复；顶栏手动切换保留 |
| `web/src/router.tsx` | 增加自有适配器import和官方`window`选项 | 路由、页面、入口策略、真实地址及浏览器历史不改 |
| `web/src/guan/路由临时状态.ts`（新增） | 来自自有`扩展功能/本机存储/路由临时状态.ts`；仅Router的sessionStorage改为本页Map | 真实history/location/document保留，window方法绑定原接收者；不改全局Storage和依赖 |

两个核心接入点的具体形式：

```diff
- var s = JSON.parse(localStorage.getItem("infinite-canvas:theme_store") || "{}");
- var t = s.state && s.state.theme === "light" ? "light" : "dark";
+ var t = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";

- ]);
+ ], { window: createRouterWindow(window) });
```

完整注释、import及适配器内容均在上述标准patch中。路由切换记录是瞬态技术缓存，不是用户画布数据，不需要写SQLite；刷新后丢弃此缓存是有意设计，浏览器前进/后退仍使用原history。首屏暂随系统，正式手动主题仍按SQLite恢复；自选主题与系统不同的首屏过渡需在获批后的真实浏览器回归观察，不宣称已消除所有主题闪烁。

## 预审与批准后验证

1. 主题脚本两种系统颜色执行正确，原localStorage访问可复现，候选零调用。
2. 路由仅增加官方window接入；锚点改变/重复接入拒绝。
3. 页内Storage get/set/remove/clear/key/length、实例隔离、Window方法接收者、history/location保留；localStorage和indexedDB访问拒绝。
4. **真实React Router模块+合成Window**：初始化、导航、pagehide保存转换缓存及dispose移除监听通过。该测试不等于实际浏览器WindowProxy已验收。

批准后新增`上游适配/SQLite启动存储批准.mjs`、`开发工具/接入SQLite启动存储隔离副本.mjs`和5项后继/事务测试；原审批器及快照不放宽。累计55项自动测试通过，自有JS35文件0错误0警告，完整内存类型与Vite构建通过。

实际UI最终11项通过，证据为`.运行/output/playwright/SQLite完整界面-2026-10-17T08-02-07.483Z/验收结果.json`。覆盖原生window方法、HTML及Router启动零存储、真实SQLite画布/媒体保存、新文档刷新恢复、浏览器同文档片段前进后退、手动主题保存及刷新恢复。不同页面路径导航由上述真实Router模块单元测试验证，未把片段导航冒充所有页面测试。先前历史测试错误假定“新建产品”会增加历史项，其失败记录保留，业务replace行为不改。

完整启动/图片/主题测试已通过，不等于量化验证了主题每一帧无闪烁，也不代表所有业务场景已回归。详细记录及剩余门槛见[隔离接入验收](SQLite批准后隔离接入验收.md)。

本批不是生产接管：不重启3100、不访问默认Chrome/Keychain/旧数据、不发布。正式host交付/续期、凭据网关、大项目容量/逐记录写入、保存错误重试、备份和崩溃锁恢复仍是单独生产门槛。
