import test from 'node:test';
import assert from 'node:assert/strict';
import { restoreBrowserStorage } from '../src/shared/data-contract/port-migration.mjs';
function setup(session = {}) {
  const storage = values => {
    const entries = new Map(Object.entries(values));
    return { get length() { return entries.size; }, key: n => [...entries.keys()][n],
      getItem: key => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value) };
  };
  globalThis.location = { origin: 'http://127.0.0.1:8888' };
  globalThis.localStorage = storage({}); globalThis.sessionStorage = storage(session);
  globalThis.indexedDB = { databases: async () => [] };
  return { app: 'guan-ai-workbench', kind: 'full-browser-backup', format: 1,
    origin: 'http://127.0.0.1:5174', databases: [], localStorage: { canvas: 'saved' },
    sessionStorage: { __imt_handshake_page_id: 'source-page', client: 'saved-client' } };
}
test('extension handshake does not prevent empty destination migration or get overwritten', async () => {
  const snapshot = setup({ __imt_handshake_page_id: 'destination-page' });
  await restoreBrowserStorage(snapshot);
  assert.equal(sessionStorage.getItem('__imt_handshake_page_id'), 'destination-page');
  assert.equal(sessionStorage.getItem('client'), 'saved-client');
  assert.equal(localStorage.getItem('canvas'), 'saved');
  await assert.rejects(restoreBrowserStorage(snapshot), /已有数据/);
});

test('8888 to localhost3000 copy retains source marker but requires a separate verified landing marker', async () => {
  const snapshot = setup(); snapshot.origin = 'http://localhost:8888'; location.origin = 'http://localhost:3000';
  snapshot.localStorage['guan-localhost-copy-v1'] = 'top-level-verified';
  await restoreBrowserStorage(snapshot);
  assert.equal(localStorage.getItem('canvas'), 'saved');
  assert.equal(localStorage.getItem('guan-port3000-copy-v1'), null);
  await assert.rejects(restoreBrowserStorage(snapshot), /已有数据/);
  setup(); location.origin = 'http://localhost:3000'; snapshot.origin = 'http://localhost:8889';
  await assert.rejects(restoreBrowserStorage(snapshot), /不匹配/);
});
test('any existing business session still refuses before writing', async () => {
  const snapshot = setup({ __imt_handshake_page_id: 'page', client: 'existing-client' });
  await assert.rejects(restoreBrowserStorage(snapshot), /已有数据/);
  assert.equal(localStorage.length, 0); assert.equal(sessionStorage.getItem('client'), 'existing-client');
});
test('existing local configuration still refuses even with only extension session', async () => {
  const snapshot = setup({ __imt_handshake_page_id: 'page' }); localStorage.setItem('canvas', 'existing');
  await assert.rejects(restoreBrowserStorage(snapshot), /已有数据/);
  assert.equal(localStorage.getItem('canvas'), 'existing');
});

test('same-port localhost alias copy preserves old values and refuses occupied targets and unrelated origins', async () => {
  const snapshot = setup(); snapshot.origin = 'http://127.0.0.1:8888'; location.origin = 'http://localhost:8888';
  await restoreBrowserStorage(snapshot); assert.equal(localStorage.getItem('canvas'), 'saved');
  await assert.rejects(restoreBrowserStorage(snapshot), /已有数据/);
  setup(); location.origin = 'http://localhost:8888'; snapshot.origin = 'http://other.example:8888';
  await assert.rejects(restoreBrowserStorage(snapshot), /不匹配/); assert.equal(localStorage.length, 0);
});

test('only obsolete empty-copy marker permits alias retry; business data still blocks', async () => {
  const snapshot = setup(); snapshot.origin = 'http://127.0.0.1:8888'; location.origin = 'http://localhost:8888';
  localStorage.setItem('guan-localhost-copy-v1', 'verified');
  await restoreBrowserStorage(snapshot);
  assert.equal(localStorage.getItem('canvas'), 'saved');
  await assert.rejects(restoreBrowserStorage(snapshot), /已有数据/);
});

test('backed-up empty-copy recovery accepts exact defaults, never business keys or databases', async () => {
  const snapshot = setup(); snapshot.origin = 'http://127.0.0.1:8888'; location.origin = 'http://localhost:8888';
  localStorage.setItem('guan-localhost-copy-v1', 'verified');
  localStorage.setItem('guan-workbench-theme', 'light');
  localStorage.setItem('pixpix:session-sync', JSON.stringify({status:'anonymous',at:1}));
  localStorage.setItem('infinite-canvas:theme_store', JSON.stringify({state:{theme:'light'}}));
  localStorage.setItem('pixpix:first-external-source:v1', JSON.stringify({capturedAt:'2026-10-13T00:00:00Z',firstLandingPath:'/',firstLandingUrl:'http://localhost:8888/',firstSource:'direct',firstSourceType:'direct'}));
  await assert.rejects(restoreBrowserStorage(snapshot), /已有数据/);
  indexedDB.databases = async () => [{name:'existing'}];
  await assert.rejects(restoreBrowserStorage(snapshot,{recoverEmptyAliasCopy:true}), /已有数据/);
  indexedDB.databases = async () => [];
  localStorage.setItem('canvas', 'existing');
  await assert.rejects(restoreBrowserStorage(snapshot,{recoverEmptyAliasCopy:true}), /已有数据/);
  assert.equal(localStorage.getItem('canvas'), 'existing');
});

test('backed-up automatic defaults can be recovered without deleting destination keys', async () => {
  const snapshot = setup(); snapshot.origin = 'http://127.0.0.1:8888'; location.origin = 'http://localhost:8888';
  localStorage.setItem('guan-localhost-copy-v1', 'verified');
  localStorage.setItem('guan-workbench-theme', 'light');
  await restoreBrowserStorage(snapshot,{recoverEmptyAliasCopy:true});
  assert.equal(localStorage.getItem('canvas'), 'saved');
  assert.equal(localStorage.getItem('guan-workbench-theme'), 'light');
});
