import { git, 基线, 检查 } from './公共.mjs';
检查();
git('fetch', 'upstream', '--tags');
console.log('当前锁定：' + 基线.版本 + ' ' + 基线.提交);
console.log('作者最新：' + git('rev-parse', 'upstream/main'));
console.log(git('log', '--oneline', 'HEAD..upstream/main') || '当前没有新提交。');
console.log('这里只获取并检查，不自动修改源码或基线。');
