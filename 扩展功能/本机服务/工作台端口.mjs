// 直接绑定后处理端口冲突，避免“先探测空闲、再监听”之间被其他进程抢占。
// 不接管现有进程；所有尝试始终仅监听回环地址。
export const DEFAULT_WORKBENCH_PORT = 3000;
export function isWorkbenchOrigin(value) {
  try {
    const url = new URL(value);
    return url.origin === value && url.protocol === 'http:' && url.hostname === 'localhost' &&
      Number(url.port) >= DEFAULT_WORKBENCH_PORT && Number(url.port) <= 65535;
  } catch { return false; }
}
export async function listenWorkbench(server, port, { automatic = false } = {}) {
  for (let candidate = port; candidate <= 65535; candidate++) {
    try {
      await new Promise((resolve, reject) => {
        const failed = error => { server.off('listening', listening); reject(error); };
        const listening = () => { server.off('error', failed); resolve(); };
        server.once('error', failed); server.once('listening', listening);
        server.listen(candidate, '127.0.0.1');
      });
      return;
    } catch (error) {
      if (!automatic || error.code !== 'EADDRINUSE' || candidate === 65535) throw error;
    }
  }
}
