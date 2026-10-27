import { createHash } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installBundledProxyCore } from './安装内置代理核心.mjs';

export const 稳定代理核心目录 = () => join(homedir(), 'Library/Application Support/AI-Workbench-Web网络代理');
export async function 定位代理核心() {
  for (const directory of [fileURLToPath(new URL('./核心/', import.meta.url)), fileURLToPath(new URL('../../界面资源/网络代理核心/', import.meta.url)), 稳定代理核心目录()]) {
    try {
      const manifest = JSON.parse(await readFile(join(directory, '核心清单.json'), 'utf8'));
      if (manifest.archiveSha256) return installBundledProxyCore(directory, 稳定代理核心目录());
      const path = join(directory, 'mihomo'), info = await lstat(path);
      if (!/^[a-f0-9]{64}$/.test(manifest.sha256) || manifest.platform !== process.platform || manifest.arch !== process.arch ||
        await realpath(path) !== path || !info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > 128 * 1024 ** 2 ||
        !(info.mode & 0o111) || info.mode & 0o6022 || createHash('sha256').update(await readFile(path)).digest('hex') !== manifest.sha256) throw Error('代理核心校验失败');
      return { path, sha256: manifest.sha256 };
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return undefined;
}
