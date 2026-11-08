// 独立后继，来源 开发工具/类型依赖只读镜像.mjs SHA256 8a5ed40faa0d62e45b22e68df9779e36d48d1560a51abe7526fbd52b61e4d05f；仅将公开元数据改从npm官方读取，SHA512锁校验不变。
import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { spawnSync } from 'node:child_process';

// Static checking only. Resolve package/version through the existing pnpm
// symlinks, then read the same version's public registry package in a temp root.
// No install scripts, existing dependency writes or product runtime hooks.
export function 创建类型依赖只读镜像(fallback, lockPath) {
  const locks = new Map();
  function loadLock(path) {
    if (locks.has(path)) return locks.get(path);
    const lock = readFileSync(path, 'utf8'), locked = new Map(); let lockKey;
    for (const line of lock.slice(lock.indexOf('\npackages:\n'), lock.indexOf('\nsnapshots:\n')).split('\n')) {
      const key = line.match(/^ {2}(?:'([^']+)'|([^\s:]+)):\s*$/);
      if (key) lockKey = key[1] || key[2];
      const integrity = line.match(/^ {4}resolution: \{integrity: ([^,}\s]+)/);
      if (integrity && lockKey) locked.set(lockKey, integrity[1]);
    }
    if (!locked.size) throw Error('类型依赖锁文件无有效完整性记录');
    const value = { path, hash: createHash('sha256').update(lock).digest('hex'), locked }; locks.set(path, value); return value;
  }
  loadLock(lockPath);
  const archives = new Map();
  for (const dir of readdirSync(tmpdir()).filter(name => /^guan-type-dependencies-[A-Za-z0-9]+$/.test(name))) {
    const folder = join(tmpdir(), dir); if (!lstatSync(folder).isDirectory() || lstatSync(folder).isSymbolicLink()) continue;
    for (const item of readdirSync(folder).filter(name => /^\d+$/.test(name))) {
      const archive = join(folder, item, 'package.tgz');
      try {
        const stat = lstatSync(archive); if (!stat.isFile() || stat.isSymbolicLink()) continue;
        archives.set('sha512-' + createHash('sha512').update(readFileSync(archive)).digest('base64'), archive);
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
  }
  const root = mkdtempSync(join(tmpdir(), 'guan-type-dependencies-'));
  const packages = new Map(), contents = new Map();
  function command(program, args, maxBuffer = 64 * 1024 * 1024) {
    const result = spawnSync(program, args, { timeout: 55_000, maxBuffer });
    if (result.error || result.status !== 0) throw Error('类型依赖镜像读取失败：' + program + '，' + (result.error?.code || String(result.status)));
    return result.stdout;
  }
  function read(path) {
    let actual;
    try { actual = realpathSync(path); } catch { return fallback(path); }
    const match = actual.match(/^(.*\/node_modules\/\.pnpm\/)([^/]+)\/node_modules\/((?:@[^/]+\/)?[^/]+)\/(.+)$/);
    if (!match) return fallback(path);
    const [, pnpm, folder, name, file] = match;
    const prefix = name.replace('/', '+') + '@';
    if (!folder.startsWith(prefix)) throw Error('pnpm包名与实路径不匹配');
    const version = folder.slice(prefix.length).split('_')[0];
    if (!/^\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$/.test(version)) throw Error('类型镜像拒绝未知版本格式');
    const key = name + '@' + version;
    const locked = loadLock(join(pnpm, 'lock.yaml')).locked;
    const integrity = locked.get(key);
    if (!/^sha512-[A-Za-z0-9+/]+=*$/.test(integrity || '')) throw Error('类型依赖缺少锁定完整性：' + key);
    let pkg = packages.get(key);
    if (!pkg) {
      let bytes;
      if (archives.has(integrity)) bytes = readFileSync(archives.get(integrity));
      else {
        const metadata = JSON.parse(command('curl', ['--fail', '--silent', '--show-error', '--connect-timeout', '8', '--max-time', '45', 'https://registry.npmjs.org/' + encodeURIComponent(name) + '/' + encodeURIComponent(version)], 4 * 1024 * 1024).toString('utf8'));
        const url = new URL(metadata.dist?.tarball || '');
        if (metadata.name !== name || metadata.version !== version || url.protocol !== 'https:' || !['registry.npmjs.org', 'registry.npmmirror.com'].includes(url.hostname) || metadata.dist?.integrity !== integrity) throw Error('类型依赖元数据或锁定完整性不匹配：' + key);
        bytes = command('curl', ['--fail', '--silent', '--show-error', '--location', '--proto', '=https', '--proto-redir', '=https', '--connect-timeout', '8', '--max-time', '45', url.href]);
      }
      if ('sha512-' + createHash('sha512').update(bytes).digest('base64') !== integrity) throw Error('类型依赖压缩包完整性不符');
      const dir = join(root, String(packages.size)); mkdirSync(dir);
      const archive = join(dir, 'package.tgz'); writeFileSync(archive, bytes, { flag: 'wx', mode: 0o600 });
      const entries = command('tar', ['-tzf', archive]).toString('utf8').split('\n').filter(Boolean);
      const roots = new Set(entries.map(entry => entry.split('/')[0]));
      if (roots.size !== 1 || !/^[a-zA-Z0-9@_-][a-zA-Z0-9@. _-]*$/.test([...roots][0]) || entries.some(entry => entry.split('/').includes('..'))) throw Error('类型依赖压缩包路径非法：' + key);
      const unpacked = join(dir, 'unpacked'); mkdirSync(unpacked);
      command('tar', ['-xzf', archive, '-C', unpacked, '--no-same-owner', '--no-same-permissions']);
      pkg = { name, version, integrity, root: realpathSync(join(unpacked, [...roots][0])) }; packages.set(key, pkg);
      const metadata = JSON.parse(readFileSync(join(pkg.root, 'package.json'), 'utf8'));
      if (metadata.name !== name || metadata.version !== version) throw Error('类型依赖压缩包名称/版本不匹配');
      console.log('类型依赖只读镜像：' + key);
    }
    const target = join(pkg.root, file), location = relative(pkg.root, realpathSync(target));
    if (location.startsWith('..' + sep) || location === '..') throw Error('类型依赖镜像文件越界');
    if (!contents.has(target)) contents.set(target, readFileSync(target, 'utf8'));
    return contents.get(target);
  }
  return { read, report: () => ({ 临时目录: root, 锁文件: [...locks.values()].map(({ path, hash }) => ({ 文件: path, SHA256: hash })), 声明与元数据文件数: contents.size, 包: [...packages.values()].map(({ name, version, integrity }) => ({ name, version, integrity })),
    说明: '从现有pnpm实路径取得精确版本，经公开npm官方注册表核对包名/版本，并逐包匹配原pnpm锁文件SHA512后读取临时副本。未更换任何原有依赖文件或跳过类型声明。' }) };
}
