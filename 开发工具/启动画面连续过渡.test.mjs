import test from 'node:test';
import assert from 'node:assert/strict';
import { preserveStartupScreen, finishStartupScreen } from '../扩展功能/本机存储/启动画面交接.mjs';
import { createValueCodec } from '../扩展功能/本机存储/应用值编码.mjs';
import { createStartupScreen } from '../扩展功能/本机存储/启动画面.mjs';

test('品牌加载画面使用独立稳定底色，Logo与状态固定占位，不受界面CSS加载影响', () => {
  const document = { createElement(tag) { return { tag, children: [], attributes: {},
    append(...children) { this.children.push(...children); },
    setAttribute(key, value) { this.attributes[key] = value; }, addEventListener() {} }; } };
  const { panel, status, retry } = createStartupScreen(document);
  const [style, content] = panel.children;
  assert.equal(panel.attributes['aria-label'], '本机工作区启动');
  const brand = content.children[0];
  assert.equal(brand.className, 'guan-startup-brand');
  assert.equal(brand.children[0].src, '/guan/首页原样资源/工作台Logo.png');
  assert.equal(brand.children[0].width, 52);
  assert.equal(brand.children[1].textContent, 'AI-Workbench');
  assert.match(style.textContent, /\.guan-startup-brand\{display:flex;align-items:center/);
  assert.equal(status.attributes.role, 'status');
  assert.equal(status.attributes['aria-live'], 'polite');
  assert.equal(retry.hidden, true);
  assert.match(style.textContent, /background:#f7f7f5/);
  assert.doesNotMatch(style.textContent, /var\(--background|guan-startup-pulse/);
  assert.match(style.textContent, /\.dark \.guan-startup\{background:#18181b/);
  assert.match(style.textContent, /prefers-reduced-motion:reduce/);
  assert.match(style.textContent, /@keyframes guan-startup-enter\{from\{opacity:0\}to\{opacity:1\}\}/,
    '刷新首帧只淡入，不能上下移动启动内容');
  assert.match(style.textContent, /top:50%;top:round\(nearest,50%,1px\)/,
    '刷新视口出现1px取整变化时，品牌中心保持整像素位置');
});

test('React接管前保留原启动节点，首屏提交立即让出交互，淡出完成才清理', async () => {
  let resolve, removed = 0, cancelled = 0;
  const panel = { style: {}, querySelector: () => null, ownerDocument: { defaultView: { matchMedia: () => ({ matches: false }) } },
    setAttribute(name, value) { this[name] = value; }, remove() { removed++; },
    animate(frames, options) {
      assert.deepEqual(frames, [{ opacity: 1 }, { opacity: 0 }]);
      assert.equal(options.duration, 220);
      return { finished: new Promise(yes => { resolve = yes; }), cancel() { cancelled++; } };
    } };
  const root = { querySelector: () => panel, ownerDocument: { body: {
    append() { assert.fail('React交接不能重新插入节点，避免入场与加载动画重播'); } } } };
  preserveStartupScreen(root);
  finishStartupScreen(); finishStartupScreen();
  assert.equal(panel.inert, true);
  assert.equal(panel['aria-hidden'], 'true');
  assert.equal(panel.style.pointerEvents, 'none');
  assert.equal(removed, 0, '不能在首屏提交时直接移除启动画面');
  resolve(); await Promise.resolve();
  assert.equal(removed, 1); assert.equal(cancelled, 1);
});

test('启动内容与覆盖层同时退场，重复完成不启动新动画，所有播放器完成后清理', async () => {
  const animations = [];
  let removed = 0;
  const animate = (frames, options) => {
    let resolve, reject;
    const animation = { frames, options, cancelled: false, finished: new Promise((yes, no) => { resolve = yes; reject = no; }),
      finish() { resolve(); }, cancel() { this.cancelled = true; reject(Error('cancelled')); } };
    animations.push(animation); return animation;
  };
  const status = {};
  const content = { animate };
  const panel = { style: {}, ownerDocument: { defaultView: { matchMedia: () => ({ matches: false }) } },
    querySelector: selector => selector.endsWith('status') ? status : content,
    setAttribute() {}, remove() { removed++; }, animate };
  preserveStartupScreen({ querySelector: () => panel, ownerDocument: { body: { append() { assert.fail('不能移动启动节点'); } } } });
  assert.equal(status.textContent, '正在恢复画布…');
  assert.equal(finishStartupScreen(), true);
  assert.equal(finishStartupScreen(), false);
  assert.equal(animations.length, 2);
  assert.equal(animations[0].options.duration, animations[1].options.duration);
  assert.deepEqual(animations[1].frames, [{ opacity: 1 }, { opacity: 0 }]);
  animations[0].finish(); await Promise.resolve();
  assert.equal(removed, 1);
  assert.ok(animations.every(animation => animation.cancelled));
});

test('减少动态效果、缺少原生动画和动画失败都直接释放启动覆盖层', () => {
  for (const mode of ['reduce', 'missing', 'throws']) {
    let removed = 0;
    const panel = { style: {}, querySelector: () => null, ownerDocument: { defaultView: { matchMedia: () => ({ matches: mode === 'reduce' }) } },
      setAttribute() {}, remove() { removed++; },
      ...(mode !== 'missing' ? { animate() { throw Error('不支持'); } } : {}) };
    preserveStartupScreen({ querySelector: () => panel });
    finishStartupScreen(); assert.equal(removed, 1);
  }
  preserveStartupScreen({ querySelector: () => null }); finishStartupScreen();
});

test('大份画布解码让出主线程，暂停期间不发布半份结果，次序与特殊字段完整保留', async () => {
  const previous = globalThis.performance;
  let clock = 0, yields = 0, complete = false, resume;
  globalThis.performance = { now: () => clock++ };
  const codec = createValueCodec({ client: {} });
  try {
    const values = Array.from({ length: 4096 }, (_, index) => ['object', [['index', ['number', index]], ['__proto__', ['string', 'kept']]]]);
    const result = codec.decode(['array', values], { yieldToMain: () => {
      yields++;
      return yields === 1 ? new Promise(resolve => { resume = resolve; }) : Promise.resolve();
    } }).then(value => { complete = true; return value; });
    await Promise.resolve();
    assert.equal(yields, 1); assert.equal(complete, false);
    resume();
    const restored = await result;
    assert.ok(yields > 1);
    assert.equal(restored.length, values.length);
    restored.forEach((value, index) => {
      assert.equal(value.index, index); assert.equal(value.__proto__, 'kept');
      assert.equal(Object.getPrototypeOf(value), Object.prototype);
    });
    await assert.rejects(codec.decode(['array', [...values, ['unknown', 'invalid']]], { yieldToMain: () => Promise.resolve() }), error => error.code === 'invalid_value');
    let smallYields = 0;
    assert.deepEqual(await codec.decode(['object', [['state', ['boolean', true]]]], { yieldToMain: () => { smallYields++; } }), { state: true });
    assert.equal(smallYields, 0);
  } finally { codec.close(); globalThis.performance = previous; }
});
