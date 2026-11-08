import { randomBytes } from 'node:crypto';
import { mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { 准备日常运行包, 核验日常运行包 } from './日常运行包.mjs';
import { 安装稳定助手, 核验稳定助手 } from './日常助手部署.mjs';
import { 解析日常命令, 管理日常会话, 停止确认 } from './日常命令行会话.mjs';
import { 加载SQLite写入协调隔离服务 } from './接入SQLite写入协调隔离服务.mjs';

const emit = value => console.log(JSON.stringify(value));
const help = `Guan工作台日常命令（Web本机服务）
--准备 --日常记录=批准记录 --协调记录=批准记录
--检查 --运行包=准备清单.json --清单指纹=SHA256
--隔离验收 --运行包=准备清单.json --清单指纹=SHA256
--安装助手 --运行包=准备清单.json --清单指纹=SHA256 --批准安装助手
--启动 --运行包=准备清单.json --清单指纹=SHA256 --已保存并关闭 [--首次初始化]

准备/检查不会执行助手或访问Keychain。隔离验收只用临时数据和内存密钥。
安装助手会写入独立的Application Support系统助手目录，但不执行助手。
启动会访问正式数据根/专用Keychain，必须另获维护及实机验证批准后使用。
不自动停止既有服务、不顺延3100、不打开默认浏览器、不迁入浏览器数据。
服务运行时保持此控制台，保存并关闭页面后输入“${停止确认}”；输入“状态”查看状态。
Ctrl+C/SIGTERM/输入关闭不等于内容已保存，不会自动停服务。`;

let boundary = 'command';
try {
  const { mode, fields } = 解析日常命令(process.argv.slice(2));
  if (mode === '--帮助') console.log(help);
  else if (mode === '--准备') { boundary = 'prepare'; emit({ phase: 'prepared', ...await 准备日常运行包({ dailyRecord: fields.get('--日常记录'), serviceRecord: fields.get('--协调记录') }) }); }
  else {
    boundary = 'verify-runtime';
    const prepared = 核验日常运行包(fields.get('--运行包'), fields.get('--清单指纹'));
    if (mode === '--检查') emit({ phase: 'verified', manifestSHA256: prepared.manifestSHA256, originalReactBundle: true, nativeHelperExecuted: false, realKeychainAccessed: false });
    else if (mode === '--安装助手') {
      boundary = 'install-helper';
      const installed = 安装稳定助手(prepared, { approved: true });
      emit({ phase: 'helper-installed', helperPath: installed.helperPath, reused: installed.reused, nativeHelperExecuted: false, realKeychainAccessed: false });
    } else {
      // 核验稳定助手必须先于加载正式日常入口及打开正式数据根；缺失时不自动编译/覆盖。
      boundary = 'verify-helper';
      const installed = mode === '--启动' ? 核验稳定助手(prepared) : null;
      if (mode === '--启动' && !process.stdin.isTTY) throw Error('正式启动需要保留交互式控制台；未打开数据根');
      const storage = await 加载SQLite写入协调隔离服务(prepared.serviceIntegration);
      const load = relative => import(pathToFileURL(join(prepared.integration.副本, relative)).href);
      let app, material;
      try {
        boundary = 'start-service';
        if (mode === '--启动') {
          const { startDailyWorkbench } = await load('扩展功能/本机服务/日常工作台.mjs');
          app = await startDailyWorkbench({ webRoot: prepared.webRoot, storage, helperPath: installed.helperPath,
            helperSHA256: prepared.manifest.helper.sha256, savedAndClosed: true, initialize: fields.has('--首次初始化') });
        } else {
          const { startIsolatedAuthorizedWorkbench } = await load('扩展功能/本机服务/受限工作台启动器.mjs');
          const root = mkdtempSync(join(realpathSync(tmpdir()), 'guan-daily-cli-'));
          material = randomBytes(32);
          app = await startIsolatedAuthorizedWorkbench({ webRoot: prepared.webRoot, dataRoot: join(root, '数据'), initialize: true, storage,
            credentialKeyProvider: { read: async () => Buffer.from(material), create: async () => Buffer.from(material) }, endpoint: { hostname: 'localhost', port: 0 } });
          emit({ phase: 'isolated-data', dataRoot: join(root, '数据'), realKeychainAccessed: false });
        }
        emit({ phase: 'ready', origin: app.origin, mode: mode === '--启动' ? 'daily' : 'isolated', stopCommand: 停止确认 });
        boundary = 'session-control';
        await 管理日常会话(app, { input: process.stdin, emit });
      } finally { material?.fill(0); }
    }
  }
} catch {
  // 不回显凭据助手、SQL/HTTP或解析输入的原文；准备/校验失败不触发自动修复。
  const messages = { command: '操作参数不正确或缺少确认，请先运行--帮助。', prepare: '运行包准备失败，请保留构建日志和新目录，不自动覆盖重试。',
    'verify-runtime': '运行包或批准源码核验失败，请检查清单指纹和完整文件，不会自动重新构建。',
    'install-helper': '助手安装未完成，请保留原助手及登记，不要覆盖或清理。',
    'verify-helper': '稳定助手尚未安装、身份不匹配或控制台不可交互。尚未打开正式数据根；请先另行完成助手安装批准。',
    'start-service': '服务启动失败。检查端口占用、数据根、锁和钥匙串状态；不会停止既有服务、清锁或降级。',
    'session-control': '服务控制异常，请保留数据与锁，不要强杀。' };
  emit({ phase: 'failed', boundary, message: messages[boundary] }); process.exitCode = 1;
}
