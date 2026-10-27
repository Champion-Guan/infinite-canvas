import { requireValue } from '../本机存储/协议.mjs';

// 只读取模型，不创建生成任务、不保存配置；并发刷新合并为同一请求。
export function createProviderModelReader({ gateway }) {
  const flights = new Map();
  async function read(binding) {
    const profile = gateway.describe(binding), names = new Set(), tokens = new Set();
    requireValue(['openai', 'gemini'].includes(profile.kind), 'model_binding_invalid', '模型读取需要具体渠道绑定。');
    let token = '', total = 0;
    for (let page = 0; page < 16; page++) {
      const version = new URL(profile.endpoint).pathname.endsWith('/v1') ? 'v1' : 'v1beta';
      const path = profile.kind === 'openai' ? '/v1/models' : `/${version}/models?pageSize=1000${token ? '&pageToken=' + encodeURIComponent(token) : ''}`;
      const result = await gateway.execute(binding, { method: 'GET', path, contentType: '', body: '' }, { timeout: 30000 });
      total += result.bytes.length;
      requireValue(result.status >= 200 && result.status < 300 && /json/i.test(result.contentType) && total <= 2 * 1024 * 1024,
        'model_read_unconfirmed', '渠道未返回有效模型列表，请检查渠道设置后重试。', 502);
      let value; try { value = JSON.parse(result.bytes.toString('utf8')); } catch { /* 下方统一核验 */ }
      const models = profile.kind === 'openai' ? value?.data : value?.models;
      requireValue(value && !value.error && (value.code === undefined || [0, 200, '0', '200'].includes(value.code)) && Array.isArray(models) && models.length <= 10000, 'model_read_invalid', '渠道模型列表格式无效。', 502);
      for (const model of models) {
        const name = profile.kind === 'openai' ? model?.id : model?.name?.replace?.(/^models\//, '');
        requireValue(typeof name === 'string' && name.length > 0 && name.length <= 512 && !/[\x00-\x1f\x7f]/.test(name), 'model_read_invalid', '渠道模型名称无效。', 502);
        names.add(name);
      }
      requireValue(names.size <= 10000, 'model_read_invalid', '渠道模型数量超过限制。', 502);
      const next = profile.kind === 'gemini' ? value.nextPageToken : undefined;
      if (next === undefined || next === '') return [...names].sort((a, b) => a.localeCompare(b));
      requireValue(typeof next === 'string' && next.length <= 2048 && !/[\x00-\x1f\x7f]/.test(next) && !tokens.has(next), 'model_read_invalid', '模型分页响应无效。', 502);
      tokens.add(next); token = next;
    }
    requireValue(false, 'model_read_invalid', '模型分页超过限制，未把不完整列表当作成功。', 502);
  }
  return Object.freeze({ read(binding) {
    if (flights.has(binding)) return flights.get(binding);
    requireValue(flights.size < 4, 'model_read_busy', '正在读取渠道模型，请稍后重试。', 429);
    const flight = read(binding); flights.set(binding, flight);
    const clear = () => { if (flights.get(binding) === flight) flights.delete(binding); };
    flight.then(clear, clear); return flight;
  } });
}
