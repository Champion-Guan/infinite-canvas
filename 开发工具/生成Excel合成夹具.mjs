// 仅生成无真实客户信息的隔离验收工作簿；不读取任何私人工作簿。
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
const require = createRequire('/Users/guanchengbin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json');
const { Workbook, SpreadsheetFile } = require('@oai/artifact-tool');
const output = resolve(process.argv[2]); mkdirSync(output, { recursive: true });
const header = ['Order', 'Product route / core advantage', 'Main Prompt', 'Detail Prompt 01 | 900 x 1200 | 3:4'];
const variants = [
  ['A.xlsx', [[1, '铝合金支架 | 尺寸展示', 'Main [NAME]', 'Detail size [SIZE]'], [2, '塑料支架 | 核心卖点', 'Main benefit [NAME]', 'Detail [MATERIAL]']]],
  ['A-重传.xlsx', [[2, '塑料支架 | 核心卖点', 'Updated B [NAME]', 'Updated [MATERIAL]'], [1, '铝合金支架 | 尺寸展示', 'Updated A [NAME]', 'Updated size [SIZE]'], [3, '新增支架', 'New [NAME]', 'New detail']]],
  ['B.xlsx', [[1, '独立产品B', 'Other workbook [NAME]', 'Other size [SIZE]']]],
  ['无提示词.xlsx', null],
];
for (const [name, rows] of variants) {
  const wb = Workbook.create();
  const data = wb.worksheets.add('Data'); data.getRange('A1:B2').values = [['SKU', '标题'], ['COMPETITOR', '竞品不能创建产品']];
  if (rows) {
    const sheet = wb.worksheets.add('Prompts');
    sheet.getRange('A1:D' + (rows.length + 2)).values = [['Final English Prompts', null, null, null], header, ...rows];
  }
  wb.recalculate();
  console.log(name, (await wb.inspect({ kind: 'sheet,table', maxChars: 2000, tableMaxRows: 6, tableMaxCols: 4 })).ndjson);
  if (name === 'A.xlsx') {
    const preview = await wb.render({ sheetName: 'Prompts', range: 'A1:D4', scale: 1, format: 'png' });
    writeFileSync(join(output, '合成工作簿预览.png'), new Uint8Array(await preview.arrayBuffer()));
  }
  await (await SpreadsheetFile.exportXlsx(wb)).save(join(output, name));
}
writeFileSync(join(output, '中文.csv'), 'Order,Product route / core advantage,Main Prompt,Detail Prompt 01\n1,中文CSV产品,主图 [NAME],尺寸 [SIZE]\n');
console.log('合成夹具目录：' + output);
