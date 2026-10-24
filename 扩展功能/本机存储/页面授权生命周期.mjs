// pagehide只在导航确实发生后触发。取消关闭提示、切换标签、休眠均不撤销当前页面。
// bfcache保留的页面继续使用原授权；真正离开时沿用同源鉴权协议释放名额。
export function bindPageAuthorization(view, host) {
  let released = false;
  const leave = event => {
    if (event.persisted || released) return;
    released = true;
    void host.close({ keepalive: true }).catch(() => { /* 浏览器进程被强制终止时仍由原服务端期限兜底。 */ });
  };
  view.addEventListener('pagehide', leave);
  return () => view.removeEventListener('pagehide', leave);
}
