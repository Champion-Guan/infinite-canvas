export const PROXY_PROTOCOL = 'guan-network-proxy.v1';
// 认证与端口由既有页面授权传入；不读写localStorage/IndexedDB，不向浏览器提供代理密码或订阅读回。
export function createNetworkProxyClient({ command }) {
  let reading = null;
  const call = async (value, options) => {
    if (value.operation !== 'status') reading = null;
    const reply = await command(value, options);
    if (reply?.protocol !== PROXY_PROTOCOL || reply.error) throw new Error('网络代理操作未确认，请检查状态。');
    return reply.result;
  };
  const status = () => {
    if (!reading) {
      const pending = call({ operation: 'status' }); reading = pending;
      const clear = () => { if (reading === pending) reading = null; };
      pending.then(clear, clear);
    }
    return reading;
  };
  return Object.freeze({ status, configure: value => call({ operation: 'configure', ...value }),
    toggle: enabled => call({ operation: 'toggle', enabled }), refresh: () => call({ operation: 'refresh' }),
    toggleRelay: enabled => call({ operation: 'toggle-relay', enabled }), relay: (request, options) => call({ operation: 'relay', request }, options), testAll: () => call({ operation: 'test-all' }),
    checkResources: () => call({ operation: 'check-resources' }), configureResourceUpdates: enabled => call({ operation: 'resource-auto-update', enabled }),
    nodes: () => call({ operation: 'nodes' }), diagnose: () => call({ operation: 'diagnose' }), select: (group, name) => call({ operation: 'select', group, name }) });
}
