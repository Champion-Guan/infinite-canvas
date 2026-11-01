import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { ts } from "./检查首批功能适配.mjs";
import { 根目录 } from "./公共.mjs";

function load(source, dependencies) {
    const code = ts.transpileModule(source, {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText;
    const module = { exports: {} };
    new Function("require", "module", "exports", code)(
        id => {
            assert.ok(Object.hasOwn(dependencies, id), `未声明依赖：${id}`);
            return dependencies[id];
        },
        module,
        module.exports,
    );
    return module.exports;
}

const created = [];
const helper = load(readFileSync(`${根目录}/扩展功能/Excel画布/产品参数卡片默认.ts`, "utf8"), {
    "@/lib/canvas/canvas-node-factory": {
        createCanvasNode: (type, position, metadata) => {
            const node = { id: `node-${created.length + 1}`, type, position, metadata };
            created.push(node);
            return node;
        },
    },
    "@/types/canvas": {},
    "./旧版参数规则": {
        PROMPT_VARIABLES_NODE_TYPE: "guan:prompt-variables",
        buildPromptVariablesMetadata: () => ({ status: "success", promptVariableSource: "excel-marker" }),
    },
});

test("空白产品画布自动加入一张产品参数卡片", () => {
    const nodes = helper.ensureProductParameterNode([]);
    assert.equal(nodes.length, 1);
    assert.equal(nodes[0].type, "guan:prompt-variables");
    assert.deepEqual(nodes[0].position, { x: 300, y: 340 });
    assert.equal(created.length, 1);
});

test("已有产品参数卡片时不重复添加", () => {
    const existing = { id: "existing", type: "guan:prompt-variables", metadata: {} };
    const nodes = [existing];
    assert.strictEqual(helper.ensureProductParameterNode(nodes), nodes);
    assert.equal(created.length, 1);
});

test("新建产品和Excel新增产品都接入同一默认卡片工厂", () => {
    const source = readFileSync(`${根目录}/扩展功能/产品/产品操作.ts`, "utf8");
    const excel = readFileSync(`${根目录}/扩展功能/Excel/Excel产品归属.ts`, "utf8");
    assert.match(source, /ensureProductParameterNode\(created\.nodes\)/);
    assert.match(excel, /nodes: ensureProductParameterNode\(\[\]\)/);
});
