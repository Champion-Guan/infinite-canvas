// 只为冻结代理模块装配其声明的yaml依赖；不向批准包添加文件或修改源码。
import { registerHooks } from 'node:module';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { 读取迁移扩大整批批准 } from '../上游适配/迁移扩大整批批准.mjs';

export function 装配代理隔离依赖(integration) {
  const manifest = 读取迁移扩大整批批准(), modulePath = '画布副本/扩展功能/网络代理/配置边界.mjs';
  for (const relative of [modulePath, '画布副本/扩展功能/网络代理/package.json', '画布副本/扩展功能/网络代理/package-lock.json']) {
    if (createHash('sha256').update(readFileSync(join(integration.组合包, relative))).digest('hex') !== manifest.文件.find(item => item.文件 === relative)?.候选SHA256) throw Error('代理依赖装配拒绝非批准来源');
  }
  const lock = JSON.parse(readFileSync(join(integration.副本, '扩展功能/网络代理/package-lock.json'))).packages['node_modules/yaml'];
  if (lock.version !== '2.8.2' || lock.resolved !== 'https://registry.npmjs.org/yaml/-/yaml-2.8.2.tgz' || !/^sha512-[A-Za-z0-9+/]+=*$/.test(lock.integrity)) throw Error('代理依赖锁无效');
  const root = mkdtempSync(join(tmpdir(), 'guan-proxy-dependency-'));
  const bytes = execFileSync('curl', ['--fail', '--silent', '--show-error', '--proto', '=https', '--connect-timeout', '8', '--max-time', '45', lock.resolved], { timeout: 50_000, maxBuffer: 8 * 1024 * 1024 });
  if ('sha512-' + createHash('sha512').update(bytes).digest('base64') !== lock.integrity) throw Error('代理依赖完整性不符');
  const archive = join(root, 'package.tgz'); writeFileSync(archive, bytes, { flag: 'wx', mode: 0o600 });
  const entries = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' }).split('\n').filter(Boolean);
  if (entries.some(item => !item.startsWith('package/') || item.split('/').includes('..'))) throw Error('代理依赖归档越界');
  execFileSync('tar', ['-xzf', archive, '-C', root, '--no-same-owner', '--no-same-permissions']);
  const parentURL = pathToFileURL(join(integration.组合包, modulePath)).href;
  const dependencyURL = pathToFileURL(join(root, 'package/dist/index.js')).href;
  const hook = registerHooks({ resolve(specifier, context, nextResolve) {
    if (specifier === 'yaml' && context.parentURL === parentURL) return { url: dependencyURL, shortCircuit: true };
    return nextResolve(specifier, context);
  } });
  return { close: () => hook.deregister(), report: { root, name: 'yaml', version: lock.version, integrity: lock.integrity, parentURL } };
}
