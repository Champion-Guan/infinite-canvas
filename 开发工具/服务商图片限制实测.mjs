import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { request as httpsRequest } from 'node:https';
import { createCanvas } from '@napi-rs/canvas';
import { 核验稳定助手 } from './日常助手部署.mjs';
import { createMacOSMasterKeyProvider } from '../扩展功能/本机凭据/钥匙串主密钥.mjs';
import { openSQLiteCredentialVault } from '../扩展功能/本机凭据/SQLite凭据保管.mjs';

// 只读现有配置，凭据仅在内存中用于当前渠道；不创建画布或业务任务。
const db = new DatabaseSync('/Users/guanchengbin/Library/Application Support/AI-Workbench-重建版/工作区/工作台.sqlite', { readOnly: true });
let vault;
try {
  const doc = id => {
    const row = db.prepare('SELECT * FROM documents WHERE collection=? AND id=?').get('extension', id);
    return row && { workspaceId, collection: row.collection, id, value: JSON.parse(row.body), revision: row.revision,
      mediaIds: db.prepare('SELECT media_id FROM document_media WHERE collection=? AND document_id=?').all('extension', id).map(r => r.media_id) };
  };
  const workspaceId = JSON.parse(db.prepare("SELECT body FROM documents WHERE id='guan-credential-vault'").get().body).workspaceId;
  function decode(tree) {
    if (tree[0] === 'object') return Object.fromEntries(tree[1].map(([k, v]) => [k, decode(v)]));
    if (tree[0] === 'array') return tree[1].map(decode);
    return tree[1];
  }
  const root = db.prepare("SELECT body FROM documents WHERE collection='extension' AND id LIKE 'app-%' AND id NOT LIKE 'app-part-%' AND body LIKE '%infinite-canvas:ai_config_store%'").all()
    .map(r => JSON.parse(r.body)).find(v => v.namespace === 'app_state');
  const config = decode(root.entries.find(e => e[0] === 'infinite-canvas:ai_config_store')[1].tree).state.config;
  const [channelId, model] = config.textModel.split('::');
  const channel = config.channels.find(c => c.id === channelId);
  const profile = doc(channel.apiKey)?.value;
  if (!profile?.credentialRef || profile.kind !== 'openai') throw Error('当前文字渠道不是可读取的OpenAI绑定');
  const prepared = { manifest: JSON.parse(readFileSync('.运行/SQLite日常准备-UWriM2/准备清单.json')) };
  const helper = 核验稳定助手(prepared);
  vault = await openSQLiteCredentialVault({ workspace: {
    workspaceId, readDocument: (_collection, id) => doc(id),
    writeDocument() { throw Error('实测禁止写入'); }, listDocuments() { return []; },
  }, keyProvider: createMacOSMasterKeyProvider({ helperPath: helper.helperPath, helperSHA256: prepared.manifest.helper.sha256 }) });
  const credential = await vault.read(profile.credentialRef);
  const endpoint = profile.endpoint.replace(/\/v1\/?$/, '').replace(/\/$/, '');
  const canvas = createCanvas(256, 256), ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ff0000'; ctx.fillRect(0, 0, 256, 256);
  ctx.fillStyle = '#ffffff'; ctx.font = '48px sans-serif'; ctx.fillText('TEST', 55, 145);
  const png = canvas.toBuffer('image/png');
  console.log(JSON.stringify({ provider: channel.name, endpoint, model, imageBytes: png.length }));
  async function request(path, body, method = 'POST') {
    const started = Date.now();
    try {
      const res = await fetch(endpoint + path, { method, redirect: 'error',
        headers: { authorization: 'Bearer ' + credential, ...(body instanceof FormData ? {} : { 'content-type': 'application/json' }) },
        ...(body === undefined ? {} : { body: body instanceof FormData ? body : typeof body === 'string' ? body : JSON.stringify(body) }),
        signal: AbortSignal.timeout(180000) });
      const text = await res.text();
      let value; try { value = JSON.parse(text); } catch { value = null; }
      const detail = (value?.error?.message || value?.message || (!value ? text : '')).replaceAll(credential, '[redacted]').slice(0, 350);
      return { status: res.status, ms: Date.now() - started, detail, value };
    } catch (error) { return { status: null, ms: Date.now() - started, detail: error.name + ': ' + error.message }; }
  }
  function payload(image) {
    return { model, input: [{ role: 'user', content: [
      { type: 'input_text', text: 'What color is the background? Answer one word.' },
      { type: 'input_image', detail: 'low', ...image },
    ] }], reasoning: { effort: 'low' }, max_output_tokens: 32, store: false };
  }
  function report(label, result, extra = {}) {
    const output = result.value?.output?.flatMap(o => o.content || []).map(c => c.text || '').join('');
    console.log(JSON.stringify({ label, ...extra, status: result.status, ms: result.ms, detail: result.detail,
      ...(output ? { output } : {}), ...(result.value?.usage ? { usage: {
        input_tokens: result.value.usage.input_tokens, output_tokens: result.value.usage.output_tokens,
      } } : {}) }));
  }
  const mode = process.argv[2] || 'formats';
  if (mode === 'formats') {
    report('inline-base64', await request('/v1/responses', payload({ image_url: 'data:' + 'image/png;base64,' + png.toString('base64') })));
    report('public-image-url', await request('/v1/responses', payload({ image_url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a9/Example.jpg/500px-Example.jpg' })));
    const form = new FormData(); form.append('purpose', 'vision'); form.append('file', new Blob([png], { type: 'image/png' }), '测试.png');
    const uploaded = await request('/v1/files', form);
    report('multipart-file-upload', uploaded);
    if (uploaded.value?.id) {
      try { report('file-id-image', await request('/v1/responses', payload({ file_id: uploaded.value.id }))); }
      finally { report('delete-test-file', await request('/v1/files/' + encodeURIComponent(uploaded.value.id), undefined, 'DELETE')); }
    }
  } else if (mode === 'headers') {
    for (const bytes of process.argv.slice(3).map(Number)) {
      if (!Number.isInteger(bytes) || bytes <= 0 || bytes > 192 * 1024 ** 2) throw Error('探测长度超出范围');
      const result = await new Promise(resolve => {
        let done = false;
        const finish = value => { if (done) return; done = true; resolve(value); req.destroy(); };
        const req = httpsRequest(endpoint + '/v1/responses', { method: 'POST', headers: {
          authorization: 'Bearer ' + credential, 'content-type': 'application/json',
          'content-length': bytes, expect: '100-continue',
        } });
        req.setTimeout(15000, () => finish({ event: 'timeout' }));
        req.on('continue', () => finish({ event: 'continue', status: 100 }));
        req.on('response', res => finish({ event: 'response', status: res.statusCode }));
        req.on('error', error => finish({ event: 'error', error: error.code }));
        req.flushHeaders();
      });
      console.log(JSON.stringify({ label: 'headers-only-no-body', bytes, ...result }));
    }
  } else if (mode === 'size') {
    // 使用有效PNG的可忽略文本块增加文件字节，不靠大量图像消耗视觉token。
    const crcTable = Array.from({ length: 256 }, (_, i) => {
      for (let n = 0; n < 8; n++) i = i & 1 ? 0xedb88320 ^ i >>> 1 : i >>> 1;
      return i >>> 0;
    });
    function paddedPng(size) {
      if (size <= png.length) return png;
      const data = Buffer.alloc(size - png.length - 12, 65); data.write('padding\0');
      const chunk = Buffer.alloc(data.length + 12); chunk.writeUInt32BE(data.length); chunk.write('tEXt', 4); data.copy(chunk, 8);
      let crc = 0xffffffff;
      for (const byte of chunk.subarray(4, -4)) crc = crcTable[(crc ^ byte) & 255] ^ crc >>> 8;
      chunk.writeUInt32BE((crc ^ 0xffffffff) >>> 0, chunk.length - 4);
      return Buffer.concat([png.subarray(0, -12), chunk, png.subarray(-12)]);
    }
    for (const mib of process.argv.slice(3).map(Number)) {
      if (!Number.isFinite(mib) || mib <= 0 || mib > 128) throw Error('单次实测范围为0至128MiB');
      const image = paddedPng(Math.floor(mib * 1024 ** 2));
      const body = JSON.stringify(payload({ image_url: 'data:' + 'image/png;base64,' + image.toString('base64') }));
      const result = await request('/v1/responses', body);
      report('padded-valid-png', result, { imageMiB: mib, requestBytes: Buffer.byteLength(body) });
      if (result.status === null || result.status === 429 || result.status >= 500) break;
    }
  } else throw Error('未知实测模式');
} finally { vault?.close(); db.close(); }
