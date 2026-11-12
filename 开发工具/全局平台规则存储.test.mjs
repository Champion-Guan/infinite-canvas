import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { platformState } from './全局平台规则夹具.mjs';
import * as upgradeState from '../扩展功能/软件更新/升级页面状态.mjs';
import { openWorkspace } from '../扩展功能/本机存储/SQLite工作区.mjs';
import { createRecoverableApplicationStorage } from '../扩展功能/本机存储/可恢复应用存储.mjs';

const require = createRequire(new URL('../.运行/3100源/画布副本/web/package.json', import.meta.url)), ts = require('typescript');
const code = ts.transpileModule(readFileSync(new URL('../扩展功能/本机存储/上游浏览器存储桥.ts', import.meta.url), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;

test('实际存储桥在应用启动前载入全局规则，SQLite落盘重开后所有产品继续使用新规则', async () => {
    const root = mkdtempSync(join(tmpdir(), 'guan-global-platform-'));
    let workspace, app, reopened;
    try {
        workspace = openWorkspace({ dataRoot: root, initialize: true });
        const client = { readDocument: (collection, id) => workspace.readDocument(collection, id),
            writeDocument: input => workspace.writeDocument(input) };
        app = createRecoverableApplicationStorage({ client, requestLimit: 0 });
        const canvasKey = 'infinite-canvas:canvas_store';
        const canvas = JSON.stringify({ state: { projects: [
            { id: 'a', nodes: [{ metadata: { productPlatform: 'Wildberries', productPlatformRuleOverrides: { Wildberries: '旧卡自定义' } } }] },
            { id: 'b', nodes: [{ metadata: { productPlatform: 'Wildberries' } }] },
        ] } });
        await app.createInstance({ storeName: 'app_state' }).setItem(canvasKey, canvas);
        const load = async runtime => {
            const global = platformState.createGlobalPlatformRuleStore(), module = { exports: {} };
            const window = { __guanSQLiteHost: { initialize: async () => runtime }, dispatchEvent() {}, addEventListener() {} };
            new Function('module', 'exports', 'require', 'window', code)(module, module.exports, id => {
                if (id === '../软件更新/升级页面状态.mjs') return upgradeState;
                assert.equal(id, '../Excel画布/平台规则全局状态'); return { globalPlatformRules: global };
            }, window);
            await module.exports.initializeSQLiteApplication();
            return { global, bridge: module.exports };
        };
        const first = await load(app);
        assert.equal(first.global.read('Wildberries'), '旧卡自定义');
        await first.global.save('Wildberries', '所有WB产品统一规则', '旧卡自定义');
        assert.equal(first.bridge.storageStatus().pending, 0);
        const stored = await app.createInstance({ storeName: 'preferences' }).getItem(platformState.GLOBAL_PLATFORM_RULES_KEY);
        assert.equal(JSON.parse(stored).rules.Wildberries, '所有WB产品统一规则');
        assert.equal(first.bridge.sqliteStateStorage.getItem(canvasKey), canvas, '全局编辑不能批量重写产品画布');
        reopened = createRecoverableApplicationStorage({ client, requestLimit: 0 });
        const second = await load(reopened);
        assert.equal(second.global.read('Wildberries'), '所有WB产品统一规则');
        assert.equal(second.bridge.sqliteStateStorage.getItem(canvasKey), canvas);
    } finally {
        await reopened?.close(); await app?.close(); workspace?.close();
        rmSync(root, { recursive: true, force: true });
    }
});
