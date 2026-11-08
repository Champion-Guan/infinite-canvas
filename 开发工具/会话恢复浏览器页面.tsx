// 仅合成数据的隔离验收页，不是工作台核心接入，也不连接日常3100。
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { authorizeLocalStorage } from '../扩展功能/本机存储/可重连授权客户端.mjs';
import { createRenewingDataClient } from '../扩展功能/本机存储/可重连数据客户端.mjs';
import { createRecoverableShardedApplicationStorage } from '../扩展功能/本机存储/可恢复分片应用存储.mjs';
import { initializeSQLiteApplication, sqliteStateStorage, flushSQLiteStorage } from '../扩展功能/本机存储/可重连存储桥';
import { SQLiteSaveStatus } from '../扩展功能/存储界面/可重连保存状态条';

const marker = document.querySelector('meta[name="guan-local-bootstrap"]');
const code = marker?.getAttribute('content'); marker?.remove();
if (!code) throw Error('缺少隔离握手材料');
const authorization = await authorizeLocalStorage({ code });
const client = createRenewingDataClient({ ...authorization });
const app = createRecoverableShardedApplicationStorage({ client });
await client.readUsage();
let initializeCount = 0;
Object.defineProperty(window, '__guanSQLiteHost', { value: Object.freeze({
    async initialize() { initializeCount++; return app; }, reconnect: () => client.reconnect(),
}), configurable: false, writable: false });
await initializeSQLiteApplication();

function RecoveryFixture() {
    const [text, setText] = useState('合成测试稿');
    const [message, setMessage] = useState('隔离工作区已连接');
    const [identity] = useState(() => crypto.randomUUID());
    return <main style={{ maxWidth: 640, margin: '80px auto', fontFamily: 'system-ui' }} data-page-identity={identity} data-initialize-count={initializeCount}>
        <h1>会话恢复隔离验收</h1>
        <p>仅临时SQLite和合成文本，不是日常工作台。</p>
        <label htmlFor="draft">合成编辑内容</label>
        <textarea id="draft" value={text} onChange={event => setText(event.target.value)} style={{ display: 'block', width: '100%', height: 120, margin: '12px 0' }} />
        <button type="button" onClick={() => {
            const snapshot = JSON.stringify({ state: { title: text }, version: 0 });
            void sqliteStateStorage.setItem('synthetic-draft', snapshot).then(() => setMessage('本次提交已确认'), () => setMessage('本次提交未确认，编辑仍在本页'));
        }}>保存合成文本</button>
        <button type="button" onClick={() => { void flushSQLiteStorage().then(() => setMessage('全部编辑已确认'), () => setMessage('仍有未确认编辑')); }} style={{ marginLeft: 12 }}>检查全部保存</button>
        <p role="status">{message}</p>
        <SQLiteSaveStatus />
    </main>;
}
createRoot(document.getElementById('root')!).render(<RecoveryFixture />);
