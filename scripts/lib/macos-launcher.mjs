import path from 'node:path';
import { mkdir, lstat, readFile, chmod, rename } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { writePrivateFile, readPrivateFile } from '../../src/server/runtime-paths.mjs';
import { UserLaunchdJobs } from '../../src/server/update-deployment.mjs';

const xml = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
const shell = value => "'" + value.replaceAll("'", "'\\''") + "'";
export class PortableLaunchdJobs extends UserLaunchdJobs {
  target(label) {
    if (label !== 'com.guanaiworkbench.portable' && !/^com\.guanaiworkbench\.portable\.qa\.[a-f0-9-]{36}$/.test(label)) throw Error('portable_label_invalid');
    return this.domain + '/' + label;
  }
  async resume(label, descriptor) {
    if (!await this.inspect(label, descriptor)) throw Error('portable_job_absent');
    const { stdout } = await this.command(['print', this.target(label)]);
    if (/^\s*pid = [1-9][0-9]*\s*$/m.test(stdout)) return;
    // No -k: start an exited owned job without terminating an active service.
    await this.run('/bin/launchctl', ['kickstart', this.target(label)], {
      timeout: 40000, maxBuffer: 65536, encoding: 'utf8', env: { PATH: '/usr/bin:/bin', LC_ALL: 'C' },
    });
  }
}
export function portableDescriptor({ node, root, privateRoot, agents, logs, port = 8888, label = 'com.guanaiworkbench.portable' }) {
  if (![node, root, privateRoot, agents, logs].every(value => typeof value === 'string' && path.isAbsolute(value) && !/[\x00-\x1f]/.test(value))
    || !Number.isSafeInteger(port) || port < 1024 || port > 65535) throw Error('portable_paths_invalid');
  const entry = path.join(root, 'server.mjs'), plist = path.join(agents, label + '.plist');
  const bytes = `<?xml version="1.0"?><plist version="1.0"><dict>
<key>Label</key><string>${xml(label)}</string>
<key>ProgramArguments</key><array><string>${xml(node)}</string><string>${xml(entry)}</string></array>
<key>WorkingDirectory</key><string>${xml(root)}</string>
<key>EnvironmentVariables</key><dict><key>GUAN_WORKBENCH_DATA_DIR</key><string>${xml(privateRoot)}</string><key>PORT</key><string>${port}</string><key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string></dict>
<key>RunAtLoad</key><true/><key>KeepAlive</key><false/><key>Umask</key><integer>63</integer>
<key>StandardOutPath</key><string>${xml(path.join(logs, 'portable.log'))}</string>
<key>StandardErrorPath</key><string>${xml(path.join(logs, 'portable-error.log'))}</string>
</dict></plist>\n`;
  return { node, entry, directory: root, plist, bytes };
}
export async function startPortableJob({ descriptor, jobs, label = 'com.guanaiworkbench.portable' }) {
  const old = await readPrivateFile(descriptor.plist, { maxBytes: 16384 });
  if (old !== null && old !== descriptor.bytes) throw Error('portable_installation_conflict');
  if (old === null && !await writePrivateFile(descriptor.plist, descriptor.bytes, { exclusive: true })) throw Error('portable_installation_conflict');
  if (!await jobs.inspect(label, descriptor)) await jobs.start(label, descriptor);
  else await jobs.resume(label, descriptor);
}
export async function desktopShortcut({ desktop, node, root, port = 8888 }) {
  if (![desktop, node, root].every(value => typeof value === 'string' && path.isAbsolute(value) && !/[\x00-\x1f]/.test(value))
    || !Number.isSafeInteger(port) || port < 1024 || port > 65535) throw Error('desktop_shortcut_paths_invalid');
  const destination = path.join(desktop, 'AI-Workbench.app');
  const url = `http://127.0.0.1:${port}`;
  const probe = `ObjC.import('Foundation');\nfunction run() {\n  try {\n    const data = $.NSFileHandle.fileHandleWithStandardInput.readDataToEndOfFile;\n    const text = ObjC.unwrap($.NSString.alloc.initWithDataEncoding(data, $.NSUTF8StringEncoding));\n    const value = JSON.parse(text);\n    return value.app === 'guan-ai-workbench' && value.ready === true && value.maintenance === false && value.origin === ${JSON.stringify(url)} ? 'ready' : '';\n  } catch (_) { return ''; }\n}\n`;
  const launch = `#!/bin/sh\nlauncher_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"\nif [ "$(/usr/bin/curl --noproxy '*' --fail --silent --max-time 2 --max-filesize 16384 ${shell(url + '/local-app/health')} | /usr/bin/osascript -l JavaScript "$launcher_dir/probe.js" 2>/dev/null)" = ready ]; then\n  exec /usr/bin/open ${shell(`http://localhost:${port}`)}\nfi\nif ${shell(node)} ${shell(path.join(root, 'scripts/start-macos.mjs'))} >/dev/null 2>&1; then\n  exit 0\nfi\n/usr/bin/osascript -e 'display alert "AI-Workbench 启动未完成" message "请从最新安装包运行启动工作台入口以修复桌面快捷方式。原有画布和配置不会被清空。若仍失败，请检查软件更新服务。" as warning' >/dev/null 2>&1\nexit 1\n`;
  const refresh = async bundle => {
    for (const directory of ['Contents', 'Contents/MacOS']) {
      const info = await lstat(path.join(bundle, directory));
      if (!info.isDirectory() || info.isSymbolicLink()) throw Error('desktop_shortcut_conflict');
    }
    const entry = path.join(bundle, 'Contents/MacOS/launch');
    await writePrivateFile(path.join(bundle, 'Contents/MacOS/probe.js'), probe);
    await writePrivateFile(entry, launch);
    await chmod(entry, 0o700);
  };
  // Refresh only an explicitly marked project launcher. Old extracted paths
  // must not survive an upgrade; unrelated desktop entries are never replaced.
  try {
    const info = await lstat(destination);
    if (!info.isDirectory() || info.isSymbolicLink()
      || await readFile(path.join(destination, 'Contents/guan-workbench-shortcut'), 'utf8') !== 'AI-Workbench desktop launcher\n') throw Error('desktop_shortcut_conflict');
    await refresh(destination);
    return { path: destination, created: false, refreshed: true };
  } catch (error) { if (error.code !== 'ENOENT') throw error;
    // ENOENT inside an existing unrelated bundle must not permit a merge.
    try { await lstat(destination); throw Error('desktop_shortcut_conflict'); } catch (check) { if (check.code !== 'ENOENT') throw check; }
  }
  const temporary = path.join(desktop, '.AI-Workbench-' + randomUUID() + '.app');
  await mkdir(path.join(temporary, 'Contents/MacOS'), { recursive: true, mode: 0o700 });
  await writePrivateFile(path.join(temporary, 'Contents/Info.plist'), `<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>com.guanaiworkbench.desktop</string><key>CFBundleName</key><string>AI-Workbench</string><key>CFBundleExecutable</key><string>launch</string><key>CFBundlePackageType</key><string>APPL</string><key>LSUIElement</key><true/></dict></plist>\n`);
  await writePrivateFile(path.join(temporary, 'Contents/guan-workbench-shortcut'), 'AI-Workbench desktop launcher\n');
  await refresh(temporary);
  // Do not rename over an existing entry.
  try { await lstat(destination); throw Error('desktop_shortcut_conflict'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await rename(temporary, destination);
  return { path: destination, created: true };
}
