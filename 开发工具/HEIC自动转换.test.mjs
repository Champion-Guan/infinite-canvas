import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { EventEmitter } from 'node:events';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { HEIC_PROTOCOL, HEIC_ROUTE, HEIC_MAX_BYTES, identifyHeic, heicMime } from '../扩展功能/媒体交付/HEIC格式识别.mjs';
import { prepareCompatibleImage } from '../扩展功能/媒体交付/HEIC上传兼容.mjs';
import { createHeicConverter } from '../扩展功能/媒体交付/HEIC本机转换.mjs';
import { createMediaConversionService } from '../扩展功能/媒体交付/HEIC转换HTTP入口.mjs';
import { createMediaConversionClient } from '../扩展功能/媒体交付/HEIC转换客户端.mjs';
import { authorizeLocalStorage } from '../扩展功能/本机存储/本机授权客户端.mjs';
import { mediaFileExtension } from '../扩展功能/生成历史/媒体文件扩展.js';

const heic = Buffer.from('000000186674797068656963000000006d69663168656963', 'hex');
const jpeg = Buffer.from([255, 216, 255, 224, 0, 16, 255, 217]);
const disk = async () => ({ bavail: 2 * 1024 ** 3, bsize: 1 });
const execute = async (_command, args) => {
  if (args[0] === '-g') return { stdout: 'format: heic\npixelWidth: 5712\npixelHeight: 4284' };
  await writeFile(args.at(-1), jpeg); return { stdout: '' };
};
async function fixture(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'HEIC转换验收-'));
  const converter = createHeicConverter({ directory, platform: 'darwin', execute, inspectDisk: disk, ...options });
  t.after(async () => { await converter.close(); await rm(directory, { recursive: true, force: true }); });
  return { directory, converter };
}

test('用文件头识别空 MIME 的 HEIC/HEIF，不误收 AVIF、坏文件和过大文件', async () => {
  assert.equal(await identifyHeic(new Blob([heic])), 'image/heic');
  const heif = Buffer.from(heic); heif.write('mif1', 8); heif.write('mif1', 20);
  assert.equal(heicMime(heif), 'image/heif');
  const avif = Buffer.from(heif); avif.write('avif', 8);
  assert.equal(heicMime(avif), '');
  await assert.rejects(identifyHeic(new File(['broken'], '照片.HEIC')), /文件内容/);
  const large = new Blob([heic, new Uint8Array(HEIC_MAX_BYTES)]);
  await assert.rejects(identifyHeic(large), /32MB/);
});

test('HEIC 始终转换交付图且保留原字节；PNG 沿用原对象，不调用本机转换', async () => {
  let calls = 0;
  const source = new Blob([heic]);
  const host = { async convertHeic(blob) { calls++; assert.equal(blob.type, 'image/heic'); return new Blob([jpeg], { type: 'image/jpeg' }); } };
  const result = await prepareCompatibleImage(source, { host });
  assert.deepEqual(Buffer.from(await result.original.arrayBuffer()), heic);
  assert.equal(result.original.type, 'image/heic'); assert.equal(result.delivery.type, 'image/jpeg');
  const png = new Blob(['png'], { type: 'image/png' }), normal = await prepareCompatibleImage(png, { host });
  assert.equal(normal.original, png); assert.equal(normal.delivery, png); assert.equal(calls, 1);
  assert.equal(mediaFileExtension(result.original.type), 'heic'); assert.equal(mediaFileExtension(result.delivery.type), 'jpg');
});

test('转换失败、取消和服务未就绪均在保存前停止', async () => {
  let writes = 0;
  const source = new Blob([heic], { type: 'image/heic' });
  await assert.rejects(async () => { await prepareCompatibleImage(source, { host: { async convertHeic() { throw Error('decode failed'); } } }); writes++; }, /decode failed/);
  await assert.rejects(prepareCompatibleImage(source, { host: {} }), /重启工作台/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(prepareCompatibleImage(source, { signal: controller.signal }), { name: 'AbortError' });
  assert.equal(writes, 0);
});

test('本机转换只使用固定 sips 命令，保持尺寸，完成后不留临时文件', async t => {
  const { converter, directory } = await fixture(t, { execute: async (command, args, options) => {
    assert.equal(command, '/usr/bin/sips'); assert.ok(options.timeout <= 30_000); assert.equal(options.killSignal, 'SIGKILL');
    if (args[0] !== '-g') { assert.ok(!args.includes('--resampleWidth')); assert.deepEqual(args.slice(0, 6), ['-s', 'format', 'jpeg', '-s', 'formatOptions', '95']); }
    return execute(command, args);
  } });
  assert.deepEqual(await converter.convert(heic), jpeg);
  assert.deepEqual(await readdir(directory), []);
});

test('解码失败和取消后均清理本次暂存，之后仍能转换', async t => {
  let fail = true;
  const { converter, directory } = await fixture(t, { execute: async (...args) => { if (fail) { fail = false; throw Error('bad'); } return execute(...args); } });
  await assert.rejects(converter.convert(heic), /无法读取/);
  assert.deepEqual(await readdir(directory), []);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(converter.convert(heic, { signal: controller.signal }), { name: 'AbortError' });
  assert.deepEqual(await converter.convert(heic), jpeg);
  assert.deepEqual(await readdir(directory), []);
});

test('拒绝超大像素及低磁盘，不留下输入文件', async t => {
  const huge = await fixture(t, { execute: async () => ({ stdout: 'format: heic\npixelWidth: 10000\npixelHeight: 10000' }) });
  await assert.rejects(huge.converter.convert(heic), /8000 万/); assert.deepEqual(await readdir(huge.directory), []);
  const full = await fixture(t, { inspectDisk: async () => ({ bavail: 0, bsize: 1 }) });
  await assert.rejects(full.converter.convert(heic), /空间不足/); assert.deepEqual(await readdir(full.directory), []);
});

test('并行上传按单进程有界排队，不并行写入；超过四张明确提示', async t => {
  let release, start;
  const started = new Promise(resolve => { start = resolve; });
  const held = new Promise(resolve => { release = resolve; });
  let running = 0, maximum = 0;
  const { converter, directory } = await fixture(t, { execute: async (...args) => {
    running++; maximum = Math.max(maximum, running); start(); await held;
    try { return await execute(...args); } finally { running--; }
  } });
  const tasks = Array.from({ length: 4 }, () => converter.convert(heic));
  await started;
  assert.throws(() => converter.convert(heic), /稍后再上传/);
  release(); await Promise.all(tasks); assert.equal(maximum, 1); assert.deepEqual(await readdir(directory), []);
});

test('下次启动只回收已退出进程的本功能暂存，保留活跃进程和无关文件', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'HEIC转换残留验收-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const stale = 'ai-workbench-heic-999999999-abc123', live = `ai-workbench-heic-${process.pid}-abc123`;
  for (const name of [stale, live, '客户图片']) await mkdir(join(directory, name));
  const converter = createHeicConverter({ directory, platform: 'darwin', execute, inspectDisk: disk });
  t.after(() => converter.close());
  await converter.convert(heic);
  assert.deepEqual((await readdir(directory)).sort(), [live, '客户图片'].sort());
});

async function requestHandler({ headers = {}, bytes = heic, authorize = () => {}, converter } = {}) {
  const service = createMediaConversionService({ origin: 'http://localhost:3001', authorize, converter: converter || { convert: async () => jpeg, close: async () => {} } });
  const request = Readable.from([bytes]);
  Object.assign(request, { url: HEIC_ROUTE, method: 'POST', headers: { host: 'localhost:3001', origin: 'http://localhost:3001', 'content-type': 'application/octet-stream', 'x-guan-media-protocol': HEIC_PROTOCOL, 'x-guan-local-protocol': 'guan-local-authorization.v1', ...headers } });
  const response = new EventEmitter();
  response.headers = {}; response.setHeader = (key, value) => { response.headers[key.toLowerCase()] = value; };
  response.writeHead = (status, headers) => { response.status = status; Object.assign(response.headers, headers); };
  response.end = value => { response.body = value; response.writableEnded = true; response.writableFinished = true; };
  try { await service.handle(request, response); return response; } finally { await service.close(); }
}
test('转换 HTTP 限定同源授权，超限请求不进入解码器', async () => {
  let converts = 0, authorized = 0;
  const converter = { convert: async () => { converts++; return jpeg; }, close: async () => {} };
  const denied = await requestHandler({ headers: { origin: 'http://evil.invalid' }, converter }); assert.equal(denied.status, 403);
  const oversized = await requestHandler({ headers: { 'content-length': String(HEIC_MAX_BYTES + 1) }, converter }); assert.equal(oversized.status, 413);
  assert.equal(converts, 0);
  const ok = await requestHandler({ converter, authorize: () => { authorized++; } });
  assert.equal(ok.status, 200); assert.equal(authorized, 3); assert.deepEqual(ok.body, jpeg); assert.equal(ok.headers['Content-Type'], 'image/jpeg');
});

test('客户端使用二进制请求和既有授权会话，响应不明不重发', async () => {
  const calls = []; let prepare = 0;
  const origin = 'http://localhost:3001';
  const client = await authorizeLocalStorage({ code: 'a'.repeat(64), origin, prepareSession: async () => { prepare++; }, fetchImpl: async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/authorize')) return Response.json({ protocol: 'guan-local-authorization.v1', origin, dataURL: 'http://127.0.0.1:1234', capability: 'b'.repeat(64), expiresAt: Date.now() + 60000 });
    assert.equal(options.headers.Authorization, 'Bearer ' + 'b'.repeat(64)); assert.ok(options.body instanceof Blob); assert.equal(options.headers['Content-Type'], 'application/octet-stream');
    return new Response(jpeg, { headers: { 'Content-Type': 'image/jpeg', 'Content-Length': String(jpeg.length), 'X-Guan-Media-Protocol': HEIC_PROTOCOL } });
  } });
  assert.equal((await client.mediaPort.convertHeic(new Blob([heic]))).type, 'image/jpeg');
  assert.equal(calls.length, 2); assert.equal(prepare, 1); assert.ok(calls[1].url.endsWith(HEIC_ROUTE));
  let sent = 0;
  const failed = createMediaConversionClient({ send: async () => { sent++; throw Error('offline'); } });
  await assert.rejects(failed.convertHeic(new Blob([heic])), /未完成/); assert.equal(sent, 1);
});

test('有效 HEIC 实际通过系统转换，尺寸和原始字节保持，清理所有暂存', { skip: !process.env.GUAN_HEIC_TEST_FILE || process.platform !== 'darwin' }, async t => {
  const original = await readFile(process.env.GUAN_HEIC_TEST_FILE);
  const { converter, directory } = await fixture(t, { execute: promisify(execFile) });
  const result = await converter.convert(original);
  const output = join(directory, '验收.jpg'); await writeFile(output, result);
  try {
    const { stdout } = await promisify(execFile)('/usr/bin/sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', output]);
    assert.match(stdout, /pixelWidth: 5712/); assert.match(stdout, /pixelHeight: 4284/);
    assert.equal(result[0], 255); assert.equal(result[1], 216);
    assert.deepEqual(await readFile(process.env.GUAN_HEIC_TEST_FILE), original);
  } finally { await rm(output); }
  assert.deepEqual(await readdir(directory), []);
});
