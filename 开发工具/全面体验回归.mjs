// 现行开发版的可重复回归入口；不启动独立工作台，不连接真实生图渠道。
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json')));
const files = new Set(['test:boundaries', 'test:disk-guards', 'test:ux'].flatMap(key => pkg.scripts[key].split(' ').filter(item => item.endsWith('.test.mjs'))));
const extras = ['编辑图片读取边界', '请求队列并发边界', '浮层与媒体生命周期', '读取切换提速', '保存提速', 'SQLite分片存储', 'SQLite分片故障矩阵', 'SQLite分类容量', 'SQLite生成任务', 'SQLite保存恢复', 'SQLite会话恢复', '本机数据服务', '本机授权', '受控会话', '生成网关', '生成HTTP闭环', '代理与Fallback闭环', '代理交接与本地转发', '代理配置兼容', '内置订阅设置', '本地转发请求', '画布保存核验', '模型价格配置安全', '一键启动工作台', '在线安装入口边界', '更新进度观察', '画布性能迁移', '媒体任务迁移', '视频任务迁移', '文本流式迁移', '渠道读取迁移', '旧版整批迁移边界'];
for (const name of [...extras, '凭据后端隔离']) files.add('开发工具/' + name + '.test.mjs');
// 资源密集的构建、代理启动和故障矩阵独占执行，避免测试争用导致假超时。
const exclusive = ['内置网络代理', '异常退出写盘', 'Web构建缓存清理', 'SQLite分片存储', 'SQLite分片故障矩阵'].map(name => '开发工具/' + name + '.test.mjs');
const directory = resolve(root, '开发文档/验收记录/用户体验20261026');
mkdirSync(directory, { recursive: true });
const results = [];
async function verify(file) {
    const result = await new Promise((done, reject) => {
        // 每个文件已在独立进程；避免 Node 24 二次子进程的 V8 测试消息反序列化故障。
        const child = spawn(process.execPath, ['--test', '--test-isolation=none', '--test-reporter=tap', resolve(root, file)], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
        let output = '';
        const collect = chunk => { output = (output + chunk.toString()).slice(-1024 * 1024); };
        child.stdout.on('data', collect); child.stderr.on('data', collect);
        child.once('error', reject);
        child.once('close', code => {
            const count = name => Number(output.match(new RegExp('^# ' + name + ' (\\d+)', 'm'))?.[1] || 0);
            const ok = code === 0 && count('tests') > 0 && count('fail') === 0 && count('cancelled') === 0;
            done({ 文件: file, 通过: ok, 退出码: code, 测试: count('tests'), 成功: count('pass'), 失败: count('fail'), 取消: count('cancelled'), 跳过: count('skipped'),
                ...(!ok ? { 输出: output.slice(-16000) } : {}) });
        });
    });
    results.push(result);
    console.log((result.通过 ? '通过 ' : '失败 ') + file + ' · ' + result.成功 + '/' + result.测试);
}
const queue = [...files].filter(file => !exclusive.includes(file));
await Promise.all(Array.from({ length: 2 }, async () => { while (queue.length) await verify(queue.shift()); }));
for (const file of exclusive) if (files.has(file)) await verify(file);
const failures = results.filter(item => !item.通过);
const summary = { success: !failures.length, counts: { tests: 0, passed: 0, failed: 0, cancelled: 0, skipped: 0 } };
for (const item of results) for (const [key, name] of Object.entries({ tests: '测试', passed: '成功', failed: '失败', cancelled: '取消', skipped: '跳过' })) summary.counts[key] += item[name];
const report = { 时间: new Date().toISOString(), 测试文件数: files.size, 测试文件: [...files].sort(), 统计: summary, 结果: results, 失败: failures,
    范围说明: '现行根源码、装配引用及本机协议回归；嵌套场景计入用例数，不是独立功能数量。不把历史隔离包审批哈希作为当前功能测试，不代表付费生成或跨机器实机验收。' };
writeFileSync(resolve(directory, '全面回归结果.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ 文件: files.size, 统计: summary, 失败文件: failures.map(item => item.文件) }, null, 2));
if (failures.length) process.exitCode = 1;
