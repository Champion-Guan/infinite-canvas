import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { canvasTaskSummary, failedTaskTargets } from '../扩展功能/产品/产品任务摘要.js';
import { readCanvasCapsuleStatus } from '../扩展功能/产品/旧版产品胶囊状态.js';

const idle = { status: 'idle', taskId: '', startedAt: 0 };
const node = (id, metadata, type = 'config') => ({ id, type, metadata });

test('补齐的空闲配置只有生成参数，不代表执行或成功', () => {
  for (const generationImageType of ['main image', 'detail image', 'rich-content image', 'video frame']) {
    assert.deepEqual(canvasTaskSummary([node('config', {
      status: 'idle', generationMode: 'image', generationImageType,
      generationParamsDetected: true, size: '900x1200', generationAspectRatio: '3:4',
    })]), idle);
  }
});

test('Excel提示词和导入媒体的就绪状态不是生成成功', () => {
  for (const type of ['text', 'image', 'video', 'audio']) {
    assert.deepEqual(canvasTaskSummary([node('import', {
      status: 'success', generationImageType: 'main image', content: '导入内容',
    }, type)]), idle);
  }
});

test('仅有旧任务标记但没有执行状态，不生成成功通知或改变任务指纹', () => {
  for (const metadata of [{ generationType: 'generation' }, { generationStartedAt: 100 }, { videoTaskId: 'old' }]) {
    assert.deepEqual(canvasTaskSummary([node('idle', { ...metadata, status: 'idle' })]), idle);
  }
});

test('真实任务保留运行、成功和失败状态', () => {
  for (const type of ['config', 'image', 'video', 'audio', 'text']) {
    for (const status of ['loading', 'success', 'error']) {
      assert.deepEqual(canvasTaskSummary([node('task', { generationStartedAt: 100, status }, type)]), {
        status, taskId: 'task', startedAt: 100,
      });
    }
  }
});

test('兼容没有开始时间的旧生图和视频任务', () => {
  for (const metadata of [{ generationType: 'generation' }, { generationType: 'edit' }, { videoTaskId: 'video-task' }]) {
    assert.equal(canvasTaskSummary([node('legacy', { ...metadata, status: 'success' }, 'image')]).status, 'success');
  }
});

test('批次状态优先运行中，其次失败，再次成功，空闲配置不影响结果', () => {
  const config = node('idle', { generationImageType: 'main image', status: 'idle' });
  const tasks = [node('success', { generationStartedAt: 1, status: 'success' }), node('error', { status: 'error' }), node('loading', { status: 'loading' })];
  assert.equal(canvasTaskSummary([config, ...tasks]).status, 'loading');
  assert.equal(canvasTaskSummary([config, ...tasks.slice(0, 2)]).status, 'error');
  assert.equal(canvasTaskSummary([config, tasks[0]]).status, 'success');
});

test('图片与文本的槽位状态参与汇总，只有槽位运行时仍阻止删除', () => {
  for (const slots of ['images', 'texts']) {
    for (const status of ['loading', 'error', 'success']) {
      const metadata = { status: 'idle', [slots]: [{ id: 'slot', status }] };
      if (status === 'success') metadata.generationStartedAt = 100;
      assert.equal(canvasTaskSummary([node('slots', metadata, slots === 'images' ? 'image' : 'text')]).status, status);
    }
  }
});

test('新结果代表同一轮配置任务，旧结果不能掩盖新一轮运行状态', () => {
  const config = node('config', { generationStartedAt: 200, status: 'loading' });
  const result = node('result', { generationStartedAt: 200, status: 'success' }, 'image');
  const connections = [{ fromNodeId: 'config', toNodeId: 'result' }];
  assert.equal(canvasTaskSummary([config, result], connections).status, 'success');
  assert.equal(canvasTaskSummary([config, { ...result, metadata: { ...result.metadata, generationStartedAt: 100 } }], connections).status, 'loading');
});

test('补齐配置不改变既有真实任务指纹，不重新点亮已读成功胶囊', () => {
  const task = node('result', { generationStartedAt: 100, status: 'success' }, 'image');
  const before = canvasTaskSummary([task]);
  const after = canvasTaskSummary([task, node('config', { generationImageType: 'main image', status: 'idle' })]);
  assert.deepEqual(after, before);
  const values = new Map([['guan-canvas-status:p', JSON.stringify(before)]]);
  const storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  readCanvasCapsuleStatus('p', true, storage);
  values.set('guan-canvas-status:p', JSON.stringify(after));
  assert.equal(readCanvasCapsuleStatus('p', true, storage, true, false), 'idle');
});

test('真实生成完成仍会点亮成功胶囊，失败目标仍可重试', () => {
  const values = new Map([['guan-canvas-status:p', JSON.stringify(canvasTaskSummary([]))]]);
  const storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  readCanvasCapsuleStatus('p', true, storage);
  values.set('guan-canvas-status:p', JSON.stringify(canvasTaskSummary([node('task', { generationStartedAt: 100, status: 'success' })])));
  assert.equal(readCanvasCapsuleStatus('p', true, storage, true, false), 'success');
  const failed = node('failed', { generationStartedAt: 100, status: 'error' });
  assert.deepEqual(failedTaskTargets([failed]), [{ node: failed }]);
  assert.deepEqual(failedTaskTargets([node('idle', { generationImageType: 'main image', status: 'idle' })]), []);
});

function notifications() {
  const values = new Map(), storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  return {
    publish(nodes, connections = []) {
      values.set('guan-canvas-status:p', JSON.stringify(canvasTaskSummary(nodes, connections, true)));
    },
    read: () => readCanvasCapsuleStatus('p', true, storage, true, false),
    clear: () => readCanvasCapsuleStatus('p', true, storage, true, true),
    saved: () => JSON.stringify([...values]),
    restore(value) { values.clear(); for (const [key, entry] of JSON.parse(value)) values.set(key, entry); },
  };
}

test('成功变绿、清空变黑后删除最新图片，旧成功和其配置都不重新点亮胶囊', () => {
  const f = notifications();
  const older = node('old-image', { generationStartedAt: 100, status: 'success' }, 'image');
  const source = node('config', { generationStartedAt: 200, status: 'success' });
  const latest = node('latest-image', { generationStartedAt: 200, status: 'success' }, 'image');
  f.publish([older, source, latest], [{ fromNodeId: source.id, toNodeId: latest.id }]);
  assert.equal(f.read(), 'success'); assert.equal(f.clear(), 'idle'); assert.equal(f.read(), 'idle');
  f.publish([older, source]);
  assert.equal(f.read(), 'idle', '删除输出后显露的配置也是已确认的同一轮结果');
  f.publish([older]);
  assert.equal(f.read(), 'idle', '删除最新任务不能把更早的任务变成未读');
});

test('已读记录可持久化，删除、再次清空、撤销或恢复旧图片仍保持黑色', () => {
  const f = notifications();
  const a = node('a', { generationStartedAt: 100, status: 'success' }, 'image');
  const b = node('b', { generationStartedAt: 200, status: 'success' }, 'image');
  f.publish([a, b]); f.clear();
  f.publish([a]); f.clear();
  const restored = notifications(); restored.restore(f.saved());
  restored.publish([a, b]); assert.equal(restored.read(), 'idle');
  restored.publish([]); assert.equal(restored.read(), 'idle');
  restored.clear(); restored.publish([a, b]);
  assert.equal(restored.read(), 'idle');
});

test('已由输出代表的源配置只参与清空记录，不掩盖真实输出的成功', () => {
  const f = notifications();
  f.publish([]); f.clear();
  const source = node('config', { generationStartedAt: 100, status: 'error' });
  const result = node('result', { generationStartedAt: 100, status: 'success' }, 'image');
  f.publish([source, result], [{ fromNodeId: source.id, toNodeId: result.id }]);
  assert.equal(f.read(), 'success');
  f.clear(); f.publish([source]);
  assert.equal(f.read(), 'idle');
});

test('清空后真正的新结果仍提醒，包含较早开始但较晚完成的任务和同卡重试', () => {
  const f = notifications(), done = node('done', { generationStartedAt: 200, status: 'success' }, 'image');
  f.publish([done]); f.clear();
  const late = node('late', { generationStartedAt: 50, status: 'success' }, 'image');
  f.publish([done, late]); assert.equal(f.read(), 'success', '不能按开始时间水位吞掉迟到结果');
  f.clear();
  f.publish([done, { ...late, metadata: { generationStartedAt: 300, status: 'success' } }]);
  assert.equal(f.read(), 'success', '原卡的新一轮生成必须提醒');
});

test('运行中仍显示黄色，已清空的旧失败不掩盖新成功，新失败仍显示红色', () => {
  const f = notifications(), failed = node('failed', { generationStartedAt: 100, status: 'error' }, 'image');
  f.publish([failed]); assert.equal(f.read(), 'error'); f.clear();
  f.publish([failed, node('new', { generationStartedAt: 200, status: 'loading' }, 'image')]);
  assert.equal(f.read(), 'loading');
  f.publish([failed, node('new', { generationStartedAt: 200, status: 'success' }, 'image')]);
  assert.equal(f.read(), 'success', '旧的已读错误不能掩盖新的成功提醒');
  f.clear();
  f.publish([failed, node('new', { generationStartedAt: 300, status: 'error' }, 'image')]);
  assert.equal(f.read(), 'error');
});

test('批次删除和主图切换不产生新成功，槽位真正完成或同时间新任务仍会点亮', () => {
  const f = notifications();
  const batch = node('batch', { generationStartedAt: 100, status: 'error',
    images: [{ id: 'a', status: 'success' }, { id: 'b', status: 'success' }, { id: 'bad', status: 'error' }] }, 'image');
  f.publish([batch]); f.clear();
  const remaining = { ...batch, metadata: { ...batch.metadata, status: 'success', primaryImageId: 'b',
    images: batch.metadata.images.filter(image => image.id !== 'bad') } };
  f.publish([remaining]); assert.equal(f.read(), 'idle', '删除失败项后提升旧成功主图不是新结果');
  f.publish([{ ...remaining, metadata: { ...remaining.metadata, images: [...remaining.metadata.images, { id: 'new', status: 'success' }] } }]);
  assert.equal(f.read(), 'success');
  f.clear();
  f.publish([node('task', { generationStartedAt: 100, status: 'success',
    gatewayGenerationTasks: [{ taskId: 'one', slotId: 'slot' }] }, 'image')]);
  f.clear();
  f.publish([node('task', { generationStartedAt: 100, status: 'success',
    gatewayGenerationTasks: [{ taskId: 'two', slotId: 'slot' }] }, 'image')]);
  assert.equal(f.read(), 'success');
});

test('真实顶栏摘要缓存和偏好接线传递逐任务已读记录，删除旧图后仍为空闲', () => {
  const require = createRequire(new URL('../.运行/3100源/画布副本/web/package.json', import.meta.url));
  const ts = require('typescript'), source = readFileSync('扩展功能/产品/顶部产品胶囊.tsx', 'utf8');
  const ast = ts.createSourceFile('胶囊.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  function extract(name, dependencies) {
    const definition = ast.statements.find(statement => ts.isFunctionDeclaration(statement) && statement.name?.text === name);
    assert.ok(definition, name);
    const code = ts.transpileModule(definition.getText(ast), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
    return new Function(...Object.keys(dependencies), code + `;return ${name};`)(...Object.values(dependencies));
  }
  const selector = extract('createSummarySelector', {
    orderedProducts: projects => projects, canvasTaskSummary, productDisplayName: project => project.title,
  })();
  const values = new Map(), preferences = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  const storageFor = extract('capsuleStorage', { sqlitePreferences: preferences });
  const a = node('a', { generationStartedAt: 100, status: 'success' }, 'image');
  const b = node('b', { generationStartedAt: 200, status: 'success' }, 'image');
  const project = { id: 'p', title: '产品', createdAt: '2026-11-10', nodes: [a, b], connections: [] };
  const first = selector({ projects: [project] });
  assert.equal(readCanvasCapsuleStatus('p', true, storageFor(first[0]), true, false), 'success');
  readCanvasCapsuleStatus('p', true, storageFor(first[0]));
  assert.equal(selector({ projects: [{ ...project, viewport: { x: 10, y: 20, k: 1 } }] }), first);
  const after = selector({ projects: [{ ...project, nodes: [a] }] });
  assert.equal(readCanvasCapsuleStatus('p', true, storageFor(after[0]), true, false), 'idle');
  const newer = selector({ projects: [{ ...project, nodes: [a, { ...b, metadata: { ...b.metadata, generationStartedAt: 300 } }] }] });
  assert.equal(readCanvasCapsuleStatus('p', true, storageFor(newer[0]), true, false), 'success');
});
