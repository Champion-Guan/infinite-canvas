import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createProxyConfigurationStore } from '../扩展功能/网络代理/代理配置存储.mjs';

function read(value) {
  const workspaceId = randomUUID();
  return createProxyConfigurationStore({ workspace: { workspaceId, readDocument: () => ({ workspaceId, mediaIds: [], revision: 7, value }) },
    vault: { store() { throw Error('不应修改凭据'); }, read() { throw Error('不应读取密文内容'); } }, runTrustedWrite() { throw Error('不应改写配置'); } }).read();
}
const empty = () => ({ format: 'guan-network-proxy-state.v1', enabled: false, sourceKind: 'text', source: null, config: null, configName: '' });
test('旧版空代理配置可重开，保留关闭偏好与修订号', () => {
  const value = empty(), result = read(value);
  assert.equal(result.revision, 7); assert.equal(result.value.enabled, false); assert.deepEqual(value, empty());
});
test('新增本地代理开关字段可重开，不读写凭据', () => {
  const value = { ...empty(), relayEnabled: false };
  const result = read(value); assert.equal(result.value.relayEnabled, false); assert.deepEqual(result.value, value);
});
test('未知附加字段或错误开关类型仍拒绝，保留原配置', () => {
  for (const value of [{ ...empty(), unexpected: true }, { ...empty(), relayEnabled: 'true' }]) {
    assert.throws(() => read(value), error => error.code === 'proxy_state_corrupt');
  }
});
