import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../.运行/3100源/画布副本/web/package.json', import.meta.url));
const postcss = createRequire(require.resolve('vite/package.json'))('postcss');
const css = postcss.parse(readFileSync(new URL('../扩展功能/产品/产品胶囊.module.css', import.meta.url), 'utf8'));

// 只比较胶囊按钮的底色/前景规则，按实际选择器的类、属性优先级及源码顺序层叠。
function capsuleColors(dark, status, moving) {
    const styles = {}, priority = {};
    css.walkRules(rule => {
        for (const original of rule.selectors || []) {
            const selector = original.replace(/:global\(([^)]+)\)/g, '$1');
            if (!selector.includes('.guan-dc-product-capsule') || /:(?:hover|focus|active|disabled|has)\b|(?:^|\s)(?:svg|span)\b/.test(selector)) continue;
            if (selector.includes('.dark') && !dark) continue;
            const state = selector.match(/\.guan-dc-product-capsule-(loading|success|error)\b/)?.[1];
            if (state && status !== state) continue;
            if (selector.includes('[data-capsule-sliding="true"]') && !moving) continue;
            const weight = (selector.match(/\.[\w-]+|\[[^\]]+\]/g) || []).length;
            rule.walkDecls(decl => {
                if (!['background', 'color'].includes(decl.prop) || weight < (priority[decl.prop] || 0)) return;
                priority[decl.prop] = weight;
                styles[decl.prop] = decl.value.replace('var(--dc-text)', dark ? '#f4f4f5' : '#17181a');
            });
        }
    });
    return styles;
}

for (const dark of [false, true]) test(`${dark ? '深' : '浅'}色下空闲、运行、成功、失败的静止选中胶囊均有实体底色和可见文字`, () => {
    for (const [status, background, color] of [
        ['idle', dark ? '#f4f4f5' : '#111214', dark ? '#17181a' : '#fff'],
        ['loading', '#facc15', '#111214'], ['success', '#16a34a', '#fff'], ['error', '#dc2626', '#fff'],
    ]) {
        const styles = capsuleColors(dark, status, false);
        assert.equal(styles.background, background, status);
        assert.equal(styles.color, color, status);
        assert.notEqual(styles.background, styles.color);
    }
});

test('只有正在播放滑动动画时才允许选中按钮背景透明，滑动层平时隐藏', () => {
    for (const dark of [false, true]) for (const status of ['idle', 'loading', 'success', 'error']) {
        assert.equal(capsuleColors(dark, status, true).background, 'transparent');
        assert.notEqual(capsuleColors(dark, status, false).background, 'transparent');
    }
    const rules = [];
    css.walkRules(rule => rule.walkDecls('opacity', decl => rules.push([rule.selector, decl.value])));
    assert.ok(rules.some(([selector, value]) => selector === '.indicator' && value === '0'));
    assert.ok(rules.some(([selector, value]) => selector.includes('[data-capsule-sliding="true"]') && selector.endsWith('.indicator') && value === '1'));
});
