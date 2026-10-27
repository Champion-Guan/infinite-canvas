import { requireValue } from '../本机存储/协议.mjs';
import { publicIPv4 } from '../生成网关/受限请求规划.mjs';

const fakeIPv4 = address => /^198\.(?:18|19)\.\d{1,3}\.\d{1,3}$/.test(address);
// 系统代理的Fake-IP不能当真实公网IP连接。经受管代理向固定DoH服务查询，仍核验公网地址并固定TLS目标。
export async function 解析代理公网地址(addresses, query) {
  requireValue(addresses.length > 0, 'provider_dns_denied', '代理目标解析失败。');
  if (addresses.every(entry => publicIPv4(entry.address))) return addresses;
  requireValue(addresses.every(entry => fakeIPv4(entry.address)), 'provider_dns_denied', '代理目标必须为已核验公网地址。');
  const response = await query();
  requireValue(response.status === 200 && response.bytes.length <= 65536, 'provider_dns_denied', '代理域名解析未确认。');
  let result; try { result = JSON.parse(response.bytes.toString('utf8')); } catch { requireValue(false, 'provider_dns_denied', '代理域名解析未确认。'); }
  const records = result.Answer?.filter(item => item.type === 1).map(item => ({ address: item.data }));
  requireValue(result.Status === 0 && Array.isArray(records) && records.length > 0 && records.length <= 64 && records.every(entry => publicIPv4(entry.address)), 'provider_dns_denied', '代理目标必须为已核验公网地址。');
  return records;
}
