// 仅测试浏览器：沿真实页面已加载的模块URL取证，保留Vite的?t指纹，避免创建第二个Zustand store。
export async function 安装模块取证(page) {
  await page.addInitScript(() => {
    performance.setResourceTimingBufferSize(10000);
    window.__guanImport = async pathname => {
      const matches = [...new Set(performance.getEntriesByType('resource').map(item => item.name).filter(name => new URL(name).origin === location.origin && new URL(name).pathname === pathname))];
      if (matches.length > 1) throw Error('测试发现同一模块有多个运行实例，停止取证：' + pathname);
      // 服务拒绝接口等尚未被页面加载的模块，才允许首次按路径加载。
      return import(matches[0] ?? pathname);
    };
  });
}
