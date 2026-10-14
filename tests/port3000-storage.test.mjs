import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { exportBrowserStorage, restoreBrowserStorage } from '../src/shared/data-contract/port-migration.mjs';
import { encodeBackupValue } from '../src/shared/data-contract/browser-backup-codec.mjs';

function initialize() {
  const storage = () => {
    const map = new Map();
    return { get length() { return map.size; }, key: index => [...map.keys()][index],
      getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, String(value)) };
  };
  globalThis.location = { origin: 'http://localhost:3000' };
  globalThis.localStorage = storage(); globalThis.sessionStorage = storage();
  globalThis.indexedDB = new IDBFactory();
}
const requestResult = request => new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
async function seed() {
  const request = indexedDB.open('infinite-canvas', 8);
  request.onupgradeneeded = () => { for (const name of ['app_state', 'image_files']) request.result.createObjectStore(name); };
  const db = await requestResult(request);
  const tx = db.transaction(['app_state', 'image_files'], 'readwrite');
  const done = new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onabort = () => reject(tx.error); });
  tx.objectStore('app_state').put(JSON.stringify({ version: 0, state: { projects: [{ id: 'existing-project', nodes: [1] }], deletedProjects: [] } }), 'infinite-canvas:canvas_store');
  tx.objectStore('image_files').put(new Blob(['target-image'], { type: 'image/png' }), 'target-image');
  await done; db.close();
  localStorage.setItem('champion-blog:new-post-draft', 'retained');
  localStorage.setItem('infinite-canvas:theme_store', 'old-theme');
}
async function sourceSnapshot(target) {
  const source = structuredClone(target); source.origin = 'http://localhost:8888';
  source.localStorage = { 'infinite-canvas:theme_store': 'new-theme' };
  source.databases[0].stores.find(s => s.name === 'app_state').records = [{ key: 'infinite-canvas:canvas_store', value: JSON.stringify({ version: 0, state: { projects: [{ id: 'source-project', nodes: [2] }], deletedProjects: [] } }) }];
  source.databases[0].stores.find(s => s.name === 'image_files').records = [{ key: 'source-image', value: await encodeBackupValue(new Blob(['source-image'], { type: 'image/png' })) }];
  source.databases.push({ name: 'gpt-image-playground', version: 3, stores: [{ name: 'tasks', keyPath: 'id', autoIncrement: false, indexes: [],
    records: [{ key: 'task', value: await encodeBackupValue({ id: 'task', status: 'completed' }) }] }] });
  return source;
}

test('actual IndexedDB transactions retain target media and projects, add inline-key tasks, and verify all bytes', async () => {
  initialize(); await seed(); const backup = await exportBrowserStorage(), source = await sourceSnapshot(backup);
  const result = await restoreBrowserStorage(source, { mergeTargetBackup: backup });
  assert.equal(result.verified, true);
  assert.equal(localStorage.getItem('champion-blog:new-post-draft'), 'retained');
  assert.equal(localStorage.getItem('infinite-canvas:theme_store'), 'new-theme');
  const after = await exportBrowserStorage();
  const records = after.databases.find(d => d.name === 'infinite-canvas').stores.find(s => s.name === 'app_state').records;
  assert.deepEqual(JSON.parse(records[0].value).state.projects.map(p => p.id), ['source-project', 'existing-project']);
  assert.equal(after.databases.find(d => d.name === 'infinite-canvas').stores.find(s => s.name === 'image_files').records.length, 2);
  assert.equal(after.databases.find(d => d.name === 'gpt-image-playground').stores[0].records.length, 1);
});

test('destination mutation after backup prevents every database write', async () => {
  initialize(); await seed(); const backup = await exportBrowserStorage(), source = await sourceSnapshot(backup);
  localStorage.setItem('champion-blog:new-post-draft', 'changed-after-backup');
  await assert.rejects(restoreBrowserStorage(source, { mergeTargetBackup: backup }), /备份后发生变化/);
  const after = await exportBrowserStorage();
  assert.equal(after.databases.length, 1);
  assert.equal(after.databases[0].stores.find(s => s.name === 'image_files').records.length, 1);
  assert.equal(localStorage.getItem('infinite-canvas:theme_store'), 'old-theme');
});

test('quota failure never sets verified marker or deletes target media; partial state must stop', async () => {
  initialize(); await seed(); const backup = await exportBrowserStorage(), source = await sourceSnapshot(backup);
  localStorage.setItem = () => { throw Error('quota'); };
  await assert.rejects(restoreBrowserStorage(source, { mergeTargetBackup: backup }), /合并未通过/);
  assert.equal(localStorage.getItem('guan-port3000-copy-v1'), null);
  assert.equal(localStorage.getItem('champion-blog:new-post-draft'), 'retained');
  assert.equal((await exportBrowserStorage()).databases[0].stores.find(s => s.name === 'image_files').records.some(r => r.key === 'target-image'), true);
});
