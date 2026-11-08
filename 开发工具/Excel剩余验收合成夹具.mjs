// 仅生成隔离验收用合成文件，不修改应用或任何客户工作簿。
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';
import { 根目录 } from './公共.mjs';
import { 读取Excel视觉继承隔离记录 } from './接入Excel视觉继承隔离副本.mjs';

const bundleModules = '/Users/guanchengbin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const home = mkdtempSync(join(根目录, '.运行/Excel剩余夹具-'));
symlinkSync(bundleModules, join(home, 'node_modules'), 'dir');
const runtimeRequire = createRequire(join(home, '运行入口.mjs'));
const { Workbook, SpreadsheetFile } = await import(pathToFileURL(runtimeRequire.resolve('@oai/artifact-tool')).href);
const output = join(home, '合成夹具'); mkdirSync(output);
const rows = [
  ['Final English Prompts', null, null, null],
  ['Order', 'Product route / core advantage', 'Main Prompt', 'Detail Prompt 01 | 900 x 1200 | 3:4'],
  [1, '同名 | 铝合金 | 尺寸展示', 'Aluminium size [SIZE]', 'Dimensions [WIDTH] [HEIGHT]'],
  [2, '同名 | 塑料 | 核心卖点', 'Plastic benefit [BENEFIT]', 'Material [MATERIAL]'],
  ['Validation', null, 'Not a product', 'Not a product'],
];
const workbook = Workbook.create(), sheet = workbook.worksheets.add('Prompts');
sheet.getRange('A1:D5').values = rows;
sheet.showGridLines = false;
sheet.getRange('A1:D5').format.font = { name: 'Arial', size: 11 };
sheet.getRange('A1:D5').format.verticalAlignment = 'center';
sheet.getRange('A1:D5').format.rowHeight = 30;
sheet.getRange('A1:A5').format.columnWidth = 24;
sheet.getRange('B1:B5').format.columnWidth = 38;
sheet.getRange('C1:D5').format.columnWidth = 42;
sheet.getRange('A2:D2').format = { fill: '#332850', font: { name: 'Arial', size: 11, bold: true, color: '#FFFFFF' }, wrapText: true, rowHeight: 46 };
workbook.recalculate();
const inspected = await workbook.inspect({ kind: 'table', range: 'Prompts!A1:D5', include: 'values,formulas', tableMaxRows: 5, tableMaxCols: 4 });
writeFileSync(join(output, '合成内容.inspect.ndjson'), inspected.ndjson, { flag: 'wx' });
assert.deepEqual(sheet.getRange('A1:D5').values, rows);
const preview = await workbook.render({ sheetName: 'Prompts', range: 'A1:D5', scale: 1, format: 'png' });
writeFileSync(join(output, '合成内容预览.png'), new Uint8Array(await preview.arrayBuffer()), { flag: 'wx' });
const file = await SpreadsheetFile.exportXlsx(workbook), xlsxPath = join(output, '同名路线.xlsx');
await file.save(xlsxPath);

// Artifact Tool 无已文档化的 BIFF8/XLS 导出。仅用锁定应用里的 SheetJS 转换
// 此合成工作簿，补足旧二进制格式能力，不用它替换 XLSX 作者工具。
const integration = 读取Excel视觉继承隔离记录('.运行/Excel视觉继承-7nFs1T/Excel视觉继承接入记录.json');
const vendor = readFileSync(join(integration.副本, 'web/public/guan/Excel/xlsx.full.min.js'), 'utf8');
const context = vm.createContext({}); vm.runInContext(vendor, context);
const XLSX = context.XLSX; assert.equal(XLSX.version, '0.18.5');
const exported = XLSX.read(readFileSync(xlsxPath), { type: 'buffer' });
const bytes = Buffer.from(XLSX.write(exported, { type: 'array', bookType: 'biff8' }));
assert.equal(bytes.subarray(0, 8).toString('hex'), 'd0cf11e0a1b11ae1');
const binaryRows = JSON.parse(JSON.stringify(XLSX.utils.sheet_to_json(XLSX.read(bytes, { type: 'buffer' }).Sheets.Prompts, { header: 1, defval: null })));
assert.deepEqual(binaryRows, rows);
const xlsPath = join(output, '同名路线.xls'); writeFileSync(xlsPath, bytes, { flag: 'wx' });
const result = { output, xlsxPath, xlsPath, binaryHeader: bytes.subarray(0, 8).toString('hex'),
  xlsxSHA256: createHash('sha256').update(readFileSync(xlsxPath)).digest('hex'),
  xlsSHA256: createHash('sha256').update(bytes).digest('hex'), rows };
writeFileSync(join(output, '合成文件清单.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(result));
