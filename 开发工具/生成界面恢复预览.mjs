import { createRequire } from 'node:module';
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export async function generateRecoveryPreview({ component, diagnostic, workbenchUrl, write = true }) {
    const url = new URL(workbenchUrl);
    if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
        throw Error('恢复预览只能打开本机工作台');
    const require = createRequire(join(root, '.运行/3100源/画布副本/web/package.json'));
    const React = require('react'), { renderToString } = require('react-dom/server');
    const { build } = createRequire(require.resolve('vite'))('esbuild');
    const notice = '这是恢复页交互预览；重试将打开本机工作台，诊断信息为测试示例。';
    const data = { diagnostic, workbenchUrl: url.href, notice };
    const result = await build({
        entryPoints: [join(root, '开发工具/界面恢复预览入口.tsx')],
        bundle: true, write: false, minify: true, format: 'iife', platform: 'browser', jsx: 'automatic',
        nodePaths: [join(root, '.运行/3100源/画布副本/web/node_modules')],
        define: { __RECOVERY_PREVIEW__: JSON.stringify(data), __APP_VERSION__: JSON.stringify(diagnostic.version),
            'process.env.NODE_ENV': JSON.stringify('production') },
    });
    const assets = join(root, '.运行/开发版3100/web/assets');
    const css = readdirSync(assets).filter(name => name.endsWith('.css'))
        .map(name => readFileSync(join(assets, name), 'utf8')).join('\n');
    const logo = readFileSync(join(root, '界面资源/首页原样资源/工作台Logo.png')).toString('base64');
    const markup = renderToString(React.createElement(component, { diagnostic, retryHref: url.href, previewNotice: notice,
        logoSrc: 'data:' + 'image/png;base64,' + logo }));
    const script = result.outputFiles[0].text.replaceAll('</script', '<' + String.fromCharCode(92) + '/script');
    const html = '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
        '<title>工作台恢复页 - 交互预览</title><style>' + css + '</style>' +
        '<body style="margin:0;font-family:-apple-system,BlinkMacSystemFont,PingFang SC,sans-serif">' +
        '<div id="interface-recovery-preview">' + markup + '</div><script>' + script + '</script></body></html>';
    if (write) {
        const directory = join(root, '开发文档/验收记录/界面异常20261104');
        mkdirSync(directory, { recursive: true });
        writeFileSync(join(directory, '恢复页面.html'), html);
    }
    return html;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
    throw Error('请通过执行界面异常恢复验收生成并验证交互预览');
