import assert from 'node:assert/strict';
import { test } from 'node:test';
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
