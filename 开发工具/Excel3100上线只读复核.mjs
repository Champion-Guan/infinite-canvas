import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { 根目录 } from './公共.mjs';

// 本轮固定上线对象；只读正式SQLite，不创建产品、不解密凭据、不停止服务。
assert.equal(process.argv.length, 2);
const output = join(根目录, '.运行/output/Excel3100切换-UUWIDv');
const receiptBytes = readFileSync(join(output, '切换前备份.json'));
const sha = value => createHash('sha256').update(value).digest('hex');
assert.equal(sha(receiptBytes), '9843f9cbfba38f538e7b5d742f1a2c1078eb239ea12b4d48f38cfb8ee4aaeac4');
const receipt = JSON.parse(receiptBytes);
const manifestBytes = readFileSync(receipt.manifest);
assert.equal(sha(manifestBytes), receipt.manifestSHA256);
const manifest = JSON.parse(manifestBytes);
const integration = JSON.parse(readFileSync(manifest.integrationRecord));
const source = integration.副本 ?? join(integration.组合包, '画布副本');
const { createShardedApplicationStorage } = await import(pathToFileURL(join(source, 'web/src/guan/sqlite/分片应用存储.mjs')).href);
const normalize = value => {
  if (Array.isArray(value)) return value.map(normalize);
  if (!value || typeof value !== 'object') return value;
  // 每次读取会重建图片Blob URL；它不是持久化业务正文。
  return Object.fromEntries(Object.entries(value).filter(([key, child]) => key !== 'updatedAt' &&
    !(key === 'content' && typeof child === 'string' && child.startsWith('blob:'))).map(([key, child]) => [key, normalize(child)]));
};
async function read(root) {
  const db = new DatabaseSync(join(root, '工作台.sqlite'), { readOnly: true }); let app;
  try {
    db.exec('BEGIN');
    assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
    assert.equal(db.prepare("SELECT value FROM workspace WHERE key='id'").get().value, receipt.workspaceId);
    const documents = db.prepare('SELECT body,hash FROM documents').all();
    for (const row of documents) assert.equal(sha(row.body), row.hash);
    const media = db.prepare('SELECT * FROM media ORDER BY id').all();
    for (const row of media) {
      const bytes = readFileSync(join(root, '媒体', row.id));
      assert.equal(bytes.length, row.size); assert.equal(sha(bytes), row.id);
    }
    const client = {
      readDocument(collection, id) {
        const row = db.prepare('SELECT * FROM documents WHERE collection=? AND id=?').get(collection, id);
        return row ? { collection, id, value: JSON.parse(row.body), revision: row.revision, hash: row.hash,
          mediaIds: db.prepare('SELECT media_id FROM document_media WHERE collection=? AND document_id=? ORDER BY media_id').all(collection, id).map(item => item.media_id) } : null;
      },
      readMedia(id) {
        const row = media.find(item => item.id === id); assert.ok(row);
        return new Blob([readFileSync(join(root, '媒体', id))], { type: row.mime });
      },
    };
    app = createShardedApplicationStorage({ client });
    const canvas = JSON.parse(await app.createInstance().getItem('infinite-canvas:canvas_store'));
    const business = { projects: normalize(canvas.state.projects), deleted: normalize(canvas.state.deletedProjects ?? []),
      workbooks: normalize(canvas.state.guanWorkbooks ?? null), media: media.map(row => ({ id: row.id, size: row.size })) };
    return { business, documentCount: documents.length, operationCount: db.prepare('SELECT count(*) AS n FROM operations').get().n };
  } finally { app?.close(); db.close(); }
}
const before = await read(receipt.recovered), after = await read(receipt.dataRoot);
assert.deepEqual(after.business, before.business, '产品、节点、连线、视区、回收站、工作簿或媒体发生非预期变化');
const command = (name, args) => execFileSync(name, args, { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, cwd: join(根目录, '.运行') });
const pid = Number(command('lsof', ['-t', '-nP', '-iTCP:3100', '-sTCP:LISTEN']).trim());
assert.equal(pid, 2017);
assert.ok(command('ps', ['-p', String(pid), '-o', 'command=']).includes('开发工具/Excel日常运行.mjs --启动 ' + receipt.manifest + ' ' + receipt.manifestSHA256));
const tty = command('lsof', ['-a', '-p', String(pid), '-d', '0']);
assert.match(tty, /\/dev\/ttys\w+/); assert.ok(!tty.includes('(revoked)'));
assert.equal(JSON.parse(readFileSync(join(receipt.dataRoot, '.实例锁.json'))).pid, pid);
const cli = args => command(join(根目录, 'node_modules/.bin/playwright-cli'), ['--session', 'guan-excel-daily-20261019', '--raw', ...args]);
const page = JSON.parse(cli(['run-code', `async page => {
  await page.getByRole('banner',{name:'工作台顶栏',exact:true}).waitFor();
  return await page.evaluate(async () => {
    const app = await window.__guanSQLiteHost.initialize();
    const event = new Event('beforeunload',{cancelable:true}); window.dispatchEvent(event);
    return {origin:location.origin,pathname:location.pathname,title:document.title,status:app.getStatus(),
      bootstrapRemoved:!document.querySelector('meta[name=guan-local-bootstrap]'),
      dialogs:document.querySelectorAll('[role=dialog]').length,
      nodeIds:[...document.querySelectorAll('[data-node-id]')].map(el=>el.dataset.nodeId),
      scripts:[...document.scripts].map(el=>el.getAttribute('src')).filter(Boolean),beforeUnloadBlocked:event.defaultPrevented};
  });
}`]));
assert.equal(page.origin, 'http://localhost:3100'); assert.equal(page.bootstrapRemoved, true);
assert.equal(page.dialogs, 0); assert.equal(page.beforeUnloadBlocked, false);
assert.equal(page.status.state, 'saved'); assert.equal(page.status.pending, 0); assert.deepEqual(page.status.errors, []);
const active = after.business.projects.find(project => page.pathname === '/canvas/' + project.id); assert.ok(active);
assert.deepEqual([...page.nodeIds].sort(), active.nodes.map(node => node.id).sort());
const staticFiles = [];
for (const url of page.scripts.filter(url => url.startsWith('/assets/'))) {
  const response = await fetch(page.origin + url, { signal: AbortSignal.timeout(5000) }); assert.equal(response.status, 200);
  const servedSHA = sha(new Uint8Array(await response.arrayBuffer()));
  assert.equal(servedSHA, sha(readFileSync(join(receipt.manifest, '..', 'web', url.slice(1)))));
  staticFiles.push({ url, sha256: servedSHA });
}
assert.ok(staticFiles.length);
const requestsLog = cli(['requests']);
const requests = requestsLog.split('\n').map(line => line.match(/^\d+\. \[(\w+)\] (\S+) => \[(\d+)\]/)).filter(Boolean)
  .map(match => ({ method: match[1], url: match[2], status: Number(match[3]) }));
const probes = requests.filter(row => row.status >= 400);
assert.ok(probes.every(row => row.method === 'GET' && row.status === 404 && /\/documents\/extension\/app-part-[a-f0-9]{64}$/.test(row.url) &&
  requests.some(next => next.method === 'PUT' && next.url === row.url && next.status === 200)));
assert.ok(requests.some(row => row.method === 'PUT' && row.status === 200));
const errors = cli(['console', 'error']);
assert.ok(!/Uncaught|Unhandled|TypeError|ReferenceError|Content Security Policy|Invalid hook/i.test(errors));
const result = { passed: true, date: new Date().toISOString(), pid, workspaceId: receipt.workspaceId,
  manifestSHA256: receipt.manifestSHA256, integrity: 'ok', foreignKeyErrors: 0, businessDataUnchanged: true,
  projects: after.business.projects.map(project => ({ id: project.id, nodes: project.nodes.length, connections: project.connections.length })),
  workbooks: after.business.workbooks?.contract.productSets.length ?? 0, mediaCount: after.business.media.length,
  beforeDocuments: before.documentCount, afterDocuments: after.documentCount, operations: after.operationCount,
  page, staticFiles, missingShardProbes: probes.length, allProbesLaterCreated: true,
  successfulWrites: requests.filter(row => row.method === 'PUT' && row.status === 200).length,
  allDocumentAndMediaHashesValid: true, credentialsDecryptedByCheck: false, syntheticProductsImported: false,
  normalization: ['updatedAt', 'temporary image Blob URL'], interactiveConsoleValid: true };
const stamp = Date.now();
writeFileSync(join(output, '浏览器请求-' + stamp + '.log'), requestsLog, { flag: 'wx', mode: 0o600 });
writeFileSync(join(output, '浏览器控制台-' + stamp + '.log'), errors, { flag: 'wx', mode: 0o600 });
writeFileSync(join(output, '上线只读复核-' + stamp + '.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify(result));
