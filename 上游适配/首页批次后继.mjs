// 首页历史批准的明确后继版本。
// 历史 JSON/patch 保持原字节；当前维护源码在后续功能迁入后拥有新的完整指纹。
// 这里只允许整文件精确匹配，未知改动仍会被批次检查拒绝。
export const 首页后继 = Object.freeze({
  'web/src/guan/工作台首页.tsx': Object.freeze({
    前态SHA256: '1c4e8da6f6330c53ebc810abd90318676f0c40a0c4dfe048d1921d454cb63e3d',
    后态SHA256: '7a935d011f88a0d6ddc3ae6dcebfe75a37636f712ce72bfd620bb3edf5fe4331',
  }),
});

export const 顶栏后继 = Object.freeze({
  'web/src/guan/旧版首页顶栏.tsx': Object.freeze({
    前态SHA256: 'ecabc4b7b98b1ad4f3c21e14ef302b2aed59a8df8ff95fa1d5731f2d332ecd04',
    后态SHA256: 'cabeeb6d92ae9939496bc909a4e9e77ab432acf8e6487f6b9d94d6c120a3788f',
  }),
  'web/src/guan/旧版顶栏.module.css': Object.freeze({
    前态SHA256: '41d8906c3c41cf7f61f480853efab471e322d68b90d68ea9a883a899ff11c0c2',
    后态SHA256: '965c6257c9d508ff3c52933d67730636c9d08403fdb4a63d04b961f87cd452cd',
  }),
});

export const 顶栏后继差异SHA256 = 'eb00df85a4c3f15452a10e2b6e5ac4cc3481247ffb7798c0dd91b5604c39e12d';
// 运行副本在产品/Excel批次后已经有自己的完整顶栏后继。
export const 顶栏运行后继SHA256 = '9c143b3f69ae6bac6c32df6a7e65748be97234ee95e88b6ce621760c114f2f79';
export const 脚本来源后继SHA256 = '001c8f89d1b578f3e11ed6095b7d5e0b372e3532c632c25f3c41ad6a93876aba';
export const 脚本来源运行后继SHA256 = 'c1d69054432cbe6e0eb58f3e8b3153ba544bfdef2986d22339343592a7e42105';

export function 匹配首页后继(清单项, 当前SHA256) {
  const item = 首页后继[清单项.文件];
  return Boolean(item && 清单项.候选SHA256 === item.前态SHA256 && 当前SHA256 === item.后态SHA256);
}

export function 匹配顶栏后继(清单项, 当前SHA256) {
  const item = 顶栏后继[清单项.文件];
  return Boolean(item && 清单项.候选SHA256 === item.前态SHA256 && 当前SHA256 === item.后态SHA256);
}
