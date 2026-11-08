import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformWithEsbuild } from '../.运行/3100源/画布副本/web/node_modules/vite/dist/node/index.js';

const file = '扩展功能/生成历史/历史排序动效.ts';
const { code } = await transformWithEsbuild(readFileSync(file, 'utf8'), file, { loader: 'ts', format: 'cjs', target: 'es2022', tsconfigRaw: '{}' });
const module = { exports: {} };
new Function('require', 'module', 'exports', code)(name => { assert.ok(['react', 'motion/react'].includes(name)); return {}; }, module, module.exports);
const { createHistorySortMotion } = module.exports;
const settle = () => new Promise(resolve => setImmediate(resolve));
function fixture() {
    const animations = [], nodes = [], list = label => ({ getAttribute: () => label, getBoundingClientRect: () => ({ left: 0, right: 300, top: 0, bottom: 400 }) });
    const taskList = list('任务'), detailList = list('详情');
    const add = (id, y, owner = taskList) => {
        const node = { dataset: { historySortKey: id }, y, visualOffset: 0, style: { transform: `translateY(${y}px)` },
            closest: () => owner,
            getBoundingClientRect() { return { left: 0, right: 280, top: this.y + this.visualOffset, bottom: this.y + this.visualOffset + 60, width: 280, height: 60 }; },
            animate(frames, options) {
                let resolve, reject;
                const playback = { node: this, frames, options, cancelled: false, finished: new Promise((yes, no) => { resolve = yes; reject = no; }),
                    cancel() { this.cancelled = true; reject(Error('cancelled')); node.visualOffset = 0; }, finish() { resolve(); } };
                animations.push(playback); return playback;
            } };
        nodes.push(node); return node;
    };
    const root = { querySelectorAll: () => nodes };
    return { root, add, nodes, animations, detailList, motion: createHistorySortMotion() };
}
test('排序立即更新后交给WAAPI换位，不重写虚拟列表定位transform，完成清理填充效果', async () => {
    const f = fixture(), a = f.add('a', 0), b = f.add('b', 80);
    f.motion.capture(f.root); a.y = 80; b.y = 0; f.motion.play(f.root, false);
    assert.equal(f.animations.length, 2);
    assert.deepEqual(f.animations.map(item => item.frames[0].translate), ['0px -80px', '0px 80px']);
    assert.ok(f.animations.every(item => item.options.duration === 220 && item.options.fill === 'both'));
    assert.deepEqual([a.style.transform, b.style.transform], ['translateY(0px)', 'translateY(80px)']);
    f.animations.forEach(item => item.finish()); await settle();
    assert.ok(f.animations.every(item => item.cancelled));
});
test('连续反向排序从浏览器当前呈现位置继续，旧完成回调不能取消新动画', async () => {
    const f = fixture(), a = f.add('a', 0);
    f.motion.capture(f.root); a.y = 100; f.motion.play(f.root, false);
    const first = f.animations[0]; a.visualOffset = -60;
    f.motion.capture(f.root); assert.equal(first.cancelled, true);
    a.y = 0; f.motion.play(f.root, false);
    const next = f.animations[1]; assert.equal(next.frames[0].translate, '0px 40px');
    first.finish(); await settle(); assert.equal(next.cancelled, false);
    f.motion.stop(); assert.equal(next.cancelled, true);
});
test('只动画可见项，视区外缓冲不播放；任务与详情的相同ID不串位置', () => {
    const f = fixture(), task = f.add('same', 0), detail = f.add('same', 100, f.detailList), outside = f.add('offscreen', 600);
    f.motion.capture(f.root); task.y = 100; detail.y = 0; outside.y = 700;
    const added = f.add('new', 200); f.motion.play(f.root, false);
    assert.equal(f.animations.length, 3);
    assert.equal(f.animations.find(item => item.node === task).frames[0].translate, '0px -100px');
    assert.equal(f.animations.find(item => item.node === detail).frames[0].translate, '0px 100px');
    assert.equal(f.animations.find(item => item.node === added).frames[0].opacity, 0);
    assert.equal(f.animations.some(item => item.node === outside), false); f.motion.stop();
});
test('减少动态效果、同位置和未捕获时不播放，原生动画不可用仍不阻止排序', async () => {
    const f = fixture(), a = f.add('a', 0);
    f.motion.play(f.root, false); f.motion.capture(f.root); f.motion.play(f.root, false);
    assert.equal(f.animations.length, 0);
    f.motion.capture(f.root); a.y = 80; f.motion.play(f.root, false);
    f.motion.play(f.root, true); assert.equal(f.animations[0].cancelled, true);
    f.motion.capture(f.root); a.y = 0; f.motion.play(f.root, true); assert.equal(f.animations.length, 1);
    a.animate = () => { throw Error('当前环境不支持'); };
    f.motion.capture(f.root); a.y = 80; assert.doesNotThrow(() => f.motion.play(f.root, false));
    await settle();
});
