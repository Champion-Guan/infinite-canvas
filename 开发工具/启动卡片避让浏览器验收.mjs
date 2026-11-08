import { createInterface } from 'node:readline';
import { createPlacementCanvasFixture } from './卡片自动避让浏览器夹具.mjs';
import { createShardedApplicationStorage } from '../扩展功能/本机存储/分片应用存储.mjs';
import { openWorkspace } from '../扩展功能/本机存储/SQLite工作区.mjs';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';

if (process.argv.length !== 3 || !process.argv[2].startsWith('--隔离记录=')) throw Error('只接受四文件批准接入的隔离记录');
const fixture = await createPlacementCanvasFixture({ reviewRecord: process.argv[2].slice('--隔离记录='.length) });
async function readCanvas(workspace) {
  const app = createShardedApplicationStorage({ client: {
    readDocument: async (...args) => workspace.readDocument(...args),
    readMedia: async id => { const media = workspace.readMedia(id); return new Blob([media.bytes], { type: media.mime }); },
  } });
  try {
    const value = await app.createInstance().getItem('infinite-canvas:canvas_store');
    const state = value ? JSON.parse(value) : null;
    return state?.state?.projects?.map(project => ({ id: project.id, title: project.title, viewport: project.viewport,
      nodes: project.nodes.map(node => ({ id: node.id, type: node.type, title: node.title, position: node.position,
        width: node.width, height: node.height, metadata: node.metadata })),
      connections: project.connections, backgroundMode: project.backgroundMode })) ?? [];
  } finally { app.close(); }
}
console.log(JSON.stringify({ ready: true, origin: fixture.origin, root: fixture.root,
  dataRoot: fixture.dataRoot, source: fixture.integration.副本, production3100Untouched: true }));
let closed = false;
const input = createInterface({ input: process.stdin });
async function close() { if (!closed) { await fixture.close(); closed = true; } }
try {
  for await (const line of input) {
    if (line === 'state') console.log(JSON.stringify({ canvas: await readCanvas(fixture.workspace) }));
    else if (line === 'status') console.log(JSON.stringify({ status: fixture.getStatus() }));
    else if (line === 'close') {
      const before = await readCanvas(fixture.workspace);
      await close();
      const cold = openWorkspace({ dataRoot: fixture.dataRoot });
      let after;
      try { after = await readCanvas(cold); } finally { cold.close(); }
      const db = new DatabaseSync(join(fixture.dataRoot, '工作台.sqlite'), { readOnly: true });
      let integrity, foreignKeys;
      try { integrity = db.prepare('PRAGMA integrity_check').get().integrity_check; foreignKeys = db.prepare('PRAGMA foreign_key_check').all().length; } finally { db.close(); }
      console.log(JSON.stringify({ closed: true, coldReadSame: JSON.stringify(before) === JSON.stringify(after),
        integrity, foreignKeys, canvas: after, dataRoot: fixture.dataRoot }));
      break;
    } else throw Error('只支持state、status或close测试指令');
  }
} finally { await close(); input.close(); }
