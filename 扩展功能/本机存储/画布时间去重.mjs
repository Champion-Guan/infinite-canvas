const fields = tree => Array.isArray(tree) && tree[0] === 'object' && Array.isArray(tree[1]) ? tree[1] : [];
const field = (tree, key) => fields(tree).find(pair => pair[0] === key)?.[1];
const projects = entry => field(field(entry?.tree, 'state'), 'projects');
const identity = tree => { const id = field(tree, 'id'); return id?.[0] === 'string' ? id[1] : null; };

// 临时URL在编码后已恢复成不可变媒体描述。只有项目的全部其余字段完全一致，
// 才保留原修改时间；真实文字、图像、位置、连线、视区和未知字段变化均照常保存。
// 只处理本地编码新树，不改调用方或已确认的上一代。
export function retainUnchangedCanvasTimestamps(previous, next) {
  const before = projects(previous), after = projects(next);
  if (before?.[0] !== 'array' || after?.[0] !== 'array') return next;
  const old = new Map();
  for (const project of before[1]) {
    const id = identity(project);
    if (!id || old.has(id)) return next;
    old.set(id, project);
  }
  for (const project of after[1]) {
    const saved = old.get(identity(project));
    if (!saved) continue;
    const previousDate = field(saved, 'updatedAt'), datePair = fields(project).find(pair => pair[0] === 'updatedAt');
    if (previousDate?.[0] !== 'string' || datePair?.[1]?.[0] !== 'string'
        || !Number.isFinite(Date.parse(previousDate[1])) || !Number.isFinite(Date.parse(datePair[1][1]))) continue;
    if (JSON.stringify(fields(saved).filter(pair => pair[0] !== 'updatedAt'))
        === JSON.stringify(fields(project).filter(pair => pair[0] !== 'updatedAt'))) datePair[1] = structuredClone(previousDate);
  }
  return next;
}
