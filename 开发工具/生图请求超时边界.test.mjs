import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { generationCommandTimeout } from '../扩展功能/本机存储/本机授权客户端.mjs';
import { createDataClient } from '../扩展功能/本机存储/浏览器适配.mjs';
import { createWriteCoordinator } from '../扩展功能/本机服务/写入协调.mjs';

const validSession = {
  protocol: 'guan-local-data.v1',
  workspaceId: '11111111-1111-4111-8111-111111111111',
  expiresAt: Date.now() + 60_000,
  token: 'a'.repeat(64),
  csrf: 'b'.repeat(64),
};

test('生成命令使用有界长等待，并为结果确认预留更长时间', () => {
  assert.equal(generationCommandTimeout('submit'), 30_000);
  assert.equal(generationCommandTimeout('get'), 30_000);
  assert.equal(generationCommandTimeout('retry-save'), 60_000);
  assert.equal(generationCommandTimeout('result'), 120_000);
  assert.equal(generationCommandTimeout('unknown-generation-operation'), 30_000);
});

test('存储写入和媒体请求使用有界长等待，避免生图过程被短超时打断', () => {
  const source = readFileSync(new URL('../扩展功能/本机存储/浏览器适配.mjs', import.meta.url), 'utf8');
  assert.match(source, /DEFAULT_DOCUMENT_REQUEST_TIMEOUT_MS\s*=\s*60_000/);
  assert.match(source, /DEFAULT_MEDIA_REQUEST_TIMEOUT_MS\s*=\s*180_000/);
  assert.match(source, /writeDocument[\s\S]*DEFAULT_DOCUMENT_REQUEST_TIMEOUT_MS/);
  assert.match(source, /writeMedia[\s\S]*mediaRequestTimeoutMs/);
  assert.doesNotThrow(() => createDataClient({ url: 'http://127.0.0.1:1', session: validSession, fetchImpl: async () => { throw Error('synthetic'); } }));
});

test('写入协调允许生成过程排队一分钟，但仍拒绝无界等待', () => {
  assert.doesNotThrow(() => createWriteCoordinator({ maxWait: 60_000 }));
  assert.throws(() => createWriteCoordinator({ maxWait: 60_001 }), error => error?.code === 'invalid_write_coordinator');
});

test('生成超时错误语义保留原任务，不把结果未确认包装成授权失败', () => {
  const source = readFileSync(new URL('../扩展功能/本机存储/本机授权客户端.mjs', import.meta.url), 'utf8');
  assert.match(source, /new StorageError\('request_timeout',[^)]*原任务ID已保留/);
  assert.match(source, /new StorageError\('generation_connection_unknown',[^)]*原任务ID已保留/);
  assert.doesNotMatch(source, /if \(path === 'generation'\) throw new StorageError\('authorization_connection_failed'/);
});
