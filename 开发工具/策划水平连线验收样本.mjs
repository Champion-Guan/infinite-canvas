import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { variantModules } from "./产品变体生成夹具.mjs";

// 使用真实方案落地函数生成无媒体、无模型调用的原工作台导入样本。
let sequence = 0;
const loader = variantModules({ nanoid: { nanoid: () => "水平连线-" + ++sequence } });
const { productPlanOps } = loader.load("Excel画布/商品提示词画布.ts");
const { productMainImagesPatch } = loader.load("Excel画布/产品主图规则.ts");
const nodes = [], connections = [];
for (const [index, height] of [520, 800].entries()) {
    const parameter = { id: "水平连线参数-" + index, type: "guan:prompt-variables", title: "参数卡 · " + height + "px",
        position: { x: 100, y: 100 + index * 1000 }, width: 420, height,
        metadata: { productPlatform: "未指定", productLanguage: "中文", productBrief: { nameCategory: "水平连线验收", dimensions: "仅验收排布" },
            productRequirements: "本地合成验收，不提交模型请求", ...productMainImagesPatch([]) } };
    nodes.push(parameter);
    const plan = { overview: { buyers: "本地验收", sellingPoints: "端口对齐", concerns: "小折弯", consistency: "水平同高", sequence: "单张" },
        style: "本地验收", assumptions: [], pendingFacts: [], images: [{
            key: "alignment-" + index, kind: "main", name: "水平直线验收",
            buyerQuestion: "验收端口是否同高", evidence: "当前真实落地函数", composition: "不生图", constraints: "不调用模型",
            copyLayout: "本地验收", checks: "检查连线和刷新", delivery: { width: 1800, height: 2400, format: "png", maxMB: 10 },
            prompt: { chinese: "仅用于本地画布水平连线验收，不执行生成。", english: "Local canvas alignment verification only. Do not generate." }, variants: {},
        }] };
    for (const op of productPlanOps(parameter, plan, nodes, connections, "local-alignment-check")) {
        if (op.type === "add_node") nodes.push({ id: op.id, type: op.nodeType, title: op.title, position: op.position,
            width: op.width, height: op.height, metadata: op.metadata });
        if (op.type === "update_node") { const node = nodes.find(node => node.id === op.id); Object.assign(node, op.patch);
            node.metadata = { ...node.metadata, ...op.metadata }; }
        if (op.type === "connect_nodes") connections.push({ id: "水平连线-edge-" + connections.length, fromNodeId: op.fromNodeId, toNodeId: op.toNodeId });
    }
}
const now = new Date().toISOString();
const project = { id: "策划水平连线验收20261113", title: "策划水平连线验收（本地合成）", nodes, connections,
    viewport: { x: 40, y: 40, k: .72 }, createdAt: now, updatedAt: now };
const require = createRequire(resolve(".运行/3100源/画布副本/web/package.json"));
const { zipSync, strToU8 } = require("fflate");
const directory = resolve(".运行/策划水平连线验收20261113");
mkdirSync(directory, { recursive: true });
const file = resolve(directory, "策划水平连线验收.zip");
writeFileSync(file, zipSync({ "projects.json": strToU8(JSON.stringify({ app: "infinite-canvas", version: 3, projects: [{ project, files: [] }] })) }));
console.log(JSON.stringify({ file, nodes: nodes.length, connections: connections.length,
    coordinates: nodes.map(node => ({ id: node.id, type: node.type, x: node.position.x, y: node.position.y, height: node.height })) }));
