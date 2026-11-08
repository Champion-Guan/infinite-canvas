import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
const require = createRequire(new URL('../.运行/3100源/画布副本/web/package.json', import.meta.url));
const ts = require('typescript');
function load(source, dependencies = {}, globals = {}) {
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const module = { exports: {} };
    new Function('require', 'module', 'exports', ...Object.keys(globals), code)(id => {
        assert.ok(Object.hasOwn(dependencies, id), id); return dependencies[id];
    }, module, module.exports, ...Object.values(globals));
    return module.exports;
}
const rules = load(readFileSync('扩展功能/主题/主题模式规则.ts', 'utf8'));

test('真实主题store同步恢复SQLite选择，系统深色不能在界面CSS加载时覆盖已存浅色', () => {
    for (const [saved, systemDark, expected] of [
        [{ mode: 'light' }, true, 'light'], [{ mode: 'dark' }, false, 'dark'],
        [{ mode: 'system' }, true, 'dark'], [{ mode: 'system' }, false, 'light'],
        [{ theme: 'light' }, true, 'light'], [null, true, 'dark'],
    ]) {
        let writes = 0;
        const storage = { getItem: key => {
            assert.equal(key, 'infinite-canvas:theme_store');
            return saved ? JSON.stringify({ state: saved, version: 0 }) : null;
        }, setItem() { writes++; }, removeItem() { assert.fail('启动不能删除主题'); } };
        const theme = load(readFileSync('扩展功能/主题/三态主题状态.ts', 'utf8'), {
            '../本机存储/上游浏览器存储桥': { sqliteStateStorage: storage },
            zustand: require('zustand'), 'zustand/middleware': require('zustand/middleware'),
            './主题模式规则': rules,
        }, { window: { matchMedia: () => ({ matches: systemDark }) } });
        assert.equal(theme.useThemeStore.persist.hasHydrated(), true, '必须在渲染前同步完成，不靠首次effect纠正');
        let dark = systemDark;
        const document = { documentElement: { classList: { toggle(name, value) { assert.equal(name, 'dark'); dark = value; } }, style: {} } };
        const boot = load(readFileSync('扩展功能/主题/启动主题同步.ts', 'utf8'), { './主题模式规则': rules },
            { window: { matchMedia: () => ({ matches: systemDark }) } });
        boot.applyStartupTheme(storage.getItem('infinite-canvas:theme_store'), document);
        assert.equal(dark, expected === 'dark');
        assert.equal(document.documentElement.style.colorScheme, expected);
        assert.equal(writes, 0, '首次绘制读取既有选择，不新增主题写入或缓存');
    }
});

test('真实启动接线在SQLite初始化完成后应用主题，再导入会加载CSS的React入口', () => {
    const source = readFileSync('.运行/3100源/画布副本/web/src/main.tsx', 'utf8');
    const initialized = source.indexOf('await initializeSQLiteApplication()');
    const apply = source.indexOf('applyStartupTheme(sqliteStateStorage.getItem("infinite-canvas:theme_store"));');
    const application = source.indexOf('await import("@/扩展功能/存储界面/SQLite应用入口")');
    assert.ok(initialized >= 0 && apply > initialized && application > apply);
    assert.doesNotMatch(source, /localStorage|sessionStorage|setTimeout/);
});

test('HTML初始帧不抢先选择系统深色，避免空启动页先闪黑再等SQLite恢复浅色', () => {
    const html = readFileSync('.运行/3100源/画布副本/web/index.html', 'utf8');
    const script = html.match(/<script>\s*([\s\S]*?)<\/script>/)?.[1];
    assert.ok(script);
    const document = { documentElement: { style: {}, classList: { toggle() { assert.fail('SQLite未读前不能切换dark类'); } } } };
    runInNewContext(script, { document, window: { matchMedia() { assert.fail('初始HTML不能覆盖用户主题选择'); } } });
    assert.equal(document.documentElement.style.colorScheme, 'light');
    assert.doesNotMatch(script, /localStorage|sessionStorage/);
});
