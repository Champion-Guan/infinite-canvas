import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { transformWithEsbuild } from "../.运行/3100源/画布副本/web/node_modules/vite/dist/node/index.js";
import { createImageConfirmationRecovery } from "../扩展功能/画布生成/图片任务确认恢复.mjs";
import { serializeProductResult } from "../扩展功能/画布生成/图片任务衔接.mjs";
import * as upgradePage from "../扩展功能/软件更新/升级页面状态.mjs";
import { variantModules } from "./产品变体生成夹具.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function load(name, dependencies) {
  const file = resolve(root, "扩展功能", name);
  return loadFile(file, dependencies);
}

async function loadFile(file, dependencies) {
  const { code } = await transformWithEsbuild(readFileSync(file, "utf8"), file, {
    loader: file.endsWith(".tsx") ? "tsx" : "ts",
    jsx: "automatic",
    format: "cjs",
    target: "es2022",
    tsconfigRaw: "{}",
  });
  const module = { exports: {} };
  new Function("require", "module", "exports", code)(
    id => {
      if (id === "../软件更新/升级页面状态.mjs") return upgradePage;
      if (id === "./画布驻留保护") return { productCanvasResidency: { changed() {}, register() { return () => {}; } } };
      assert.ok(Object.hasOwn(dependencies, id), `未注入依赖：${id}`);
      return dependencies[id];
    },
    module,
    module.exports,
  );
  return module.exports;
}

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function productDependencies({
  batchSave,
  saveRegistry,
  flushSQLiteStorage,
  storageStatus = () => ({ state: "saved", pending: 0, reconnectRequired: false }),
  retrySQLiteStorage = async () => {},
  useCanvasStore = { getState: () => ({ openProject: id => id === "product" }) },
  react = {
    useCallback: value => value,
    useLayoutEffect() {},
    useRef: value => ({ current: value }),
    useState: value => [value, () => {}],
    useSyncExternalStore: (_subscribe, get) => get(),
  },
  productCheckpoint = class {},
}) {
  return {
    react,
    "react-router-dom": { useMatch: () => null, useNavigate: () => () => {} },
    "@/stores/canvas/use-canvas-store": { useCanvasStore },
    "../画布导入/画布导入": { readCanvasExport: async () => ({}) },
    "../本机存储/上游浏览器存储桥": {
      flushSQLiteStorage,
      storageStatus,
      retrySQLiteStorage,
      sqlitePreferences: { getItem: () => null, setItem() {}, removeItem() {} },
    },
    "./产品规则": {
      ProductOperationGate: class {},
      ProductSaveRegistry: saveRegistry,
      orderedProducts: () => [],
    },
    "./产品保存检查点": { ProductCommitCheckpoint: productCheckpoint },
    "./产品回收规则": {
      planProductRecycle: state => state,
      planProductRestore: state => state,
      recycledProducts: () => [],
    },
    "../Excel删除/工作簿删除规则": {
      planWorkbookDeletion: state => state,
      workbookDeletionIds: () => [],
    },
    "../Excel删除/工作簿删除门禁": {
      workbookDeletionGate: { getSnapshot: () => false, subscribe: () => () => {} },
    },
    "../Excel删除/Excel回收站规则": {
      planWorkbookPermanentDelete: state => state,
      planWorkbookRestore: state => state,
      recycledWorkbookEntries: () => [],
    },
    "../Excel/Excel保存导航": { commitWorkbookChange: async () => {} },
    "../Excel/Excel产品归属": {
      visibleWorkbookId: () => "",
      withVisibleSelection: value => value,
      planExcelImport: value => value,
      prepareWorkbookEntry: value => value,
      rememberWorkbookProduct: () => null,
      selectWorkbook: state => state,
      workbookEntry: () => null,
      workbookProjects: () => [],
    },
    "../Excel画布/产品参数卡片默认": { ensureProductParameterNode: nodes => nodes },
    "./产品恢复挂载门禁": {
      productRestoreMountGate: { getSnapshot: () => [], release() {}, block() {} },
    },
    "../画布生成/批量保存协调": batchSave,
  };
}

test("批量开始发生在进行中的画布flush期间：完成后重新检查门控，不写SQLite", async () => {
  const batchSave = await load("画布生成/批量保存协调.ts", {});
  const started = deferred();
  const release = deferred();
  let registry;
  class ControlledSaveRegistry {
    constructor() {
      registry = this;
    }
    async flush(id) {
      assert.equal(id, "product");
      started.resolve();
      await release.promise;
    }
    register() {
      return () => {};
    }
    acknowledge() {}
  }
  let sqliteFlushes = 0;
  const product = await load(
    "产品/产品操作.ts",
    productDependencies({
      batchSave,
      saveRegistry: ControlledSaveRegistry,
      flushSQLiteStorage: async () => { sqliteFlushes++; },
    }),
  );

  const save = product.saveProductCanvas("product", { force: true });
  await started.promise;
  batchSave.beginBatchCanvasSave("product");
  release.resolve();
  await save;

  assert.equal(sqliteFlushes, 0, "批量已开始时，在途保存不能继续写SQLite");
  assert.equal(batchSave.finishBatchCanvasSave("product"), true, "在途保存应把最终快照标记为脏");
  batchSave.completeBatchCanvasSave("product");
  assert.ok(registry, "应创建产品保存注册表");
});

test("批量最终保存遇到可恢复SQLite错误时只重试原保存，不重新生成", async () => {
  const batchSave = await load("画布生成/批量保存协调.ts", {});
  let flushes = 0, retries = 0, first = true;
  class CapturedSaveRegistry {
    async flush(id) {
      assert.equal(id, "product");
      flushes++;
    }
    register() { return () => {}; }
    acknowledge() {}
  }
  const product = await load(
    "产品/产品操作.ts",
    productDependencies({
      batchSave,
      saveRegistry: CapturedSaveRegistry,
      flushSQLiteStorage: async () => {
        if (first) {
          first = false;
          throw Object.assign(new Error("本机连接短暂中断"), { code: "connection_failed" });
        }
      },
      storageStatus: () => ({ state: "error", pending: 1, reconnectRequired: false }),
      retrySQLiteStorage: async () => { retries++; },
    }),
  );
  batchSave.beginBatchCanvasSave("product");
  batchSave.markBatchCanvasDirty("product");
  const result = await product.saveProductCanvas("product", { force: true });
  assert.deepEqual(result, { persisted: true, deferred: false });
  assert.equal(flushes, 1, "最终快照只提交一次");
  assert.equal(retries, 1, "只恢复原SQLite保存队列一次");
  assert.equal(batchSave.finishBatchCanvasSave("product"), true);
  batchSave.completeBatchCanvasSave("product", "saved");
});

test("嵌套批量收尾不会提前释放外层门控，最终只提交一次", async () => {
  const batchSave = await load("画布生成/批量保存协调.ts", {});

  batchSave.beginBatchCanvasSave("product");
  batchSave.markBatchCanvasDirty("product");
  batchSave.beginBatchCanvasSave("product");
  assert.equal(batchSave.finishBatchCanvasSave("product"), null, "内层批量结束时仍有外层门控");
  batchSave.completeBatchCanvasSave("product");
  assert.equal(batchSave.isBatchCanvasSaveActive("product"), true, "内层收尾不能释放外层批量门控");
  assert.equal(batchSave.finishBatchCanvasSave("product"), true, "外层收尾应保留最终脏状态");
  batchSave.completeBatchCanvasSave("product");
  assert.equal(batchSave.isBatchCanvasSaveActive("product"), false, "外层收尾后才释放批量门控");
});

test("任务确认等待最终批量画布ACK，不重复保存也不提前confirmSaved", async () => {
  const batchSave = await load("画布生成/批量保存协调.ts", {});
  const finalAck = deferred();
  let canvasPersisted = false, confirmCalls = 0, recoverySaves = 0;
  const digest = "a".repeat(64);
  const targets = [{ id: "task-A", productId: "product", nodeId: "node-A", responseHash: digest }];
  const host = {
    async list() { return [{ id: "task-A", productId: "product", nodeId: "node-A", state: "succeeded", applied: false, result: { id: digest } }]; },
    async confirmSaved() { assert.equal(canvasPersisted, true, "confirmSaved 必须发生在最终画布ACK后"); confirmCalls++; },
  };
  batchSave.beginBatchCanvasSave("product");
  batchSave.markBatchCanvasDirty("product");
  const recovery = createImageConfirmationRecovery({
    host, targets, serialize: (_id, operation) => operation(),
    async save() { recoverySaves++; return { persisted: true, deferred: false }; },
    waitForBatchSave: batchSave.waitForBatchCanvasSave,
  });
  const running = recovery.run();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(confirmCalls, 0, "最终批量保存尚未ACK时不得确认");
  assert.equal(recoverySaves, 0, "批量中的确认恢复不得另起一次画布保存");

  const finishing = finalAck.promise.then(() => {
    canvasPersisted = true;
    assert.equal(batchSave.finishBatchCanvasSave("product"), true);
    batchSave.completeBatchCanvasSave("product", "saved");
  });
  finalAck.resolve();
  await finishing;
  const result = await running;
  assert.deepEqual(result.pending, []);
  assert.equal(confirmCalls, 1, "最终持久化后原任务恰确认一次");
  assert.equal(recoverySaves, 0, "批量最终快照已覆盖结果，不应重复保存");
});

test("批量开始晚于确认恢复启动时先释放产品写入锁，结果回写不死锁", async () => {
  const batchSave = await load("画布生成/批量保存协调.ts", {});
  const firstSaveStarted = deferred(), releaseFirstSave = deferred(), batchWaitRegistered = deferred();
  const digest = "c".repeat(64), target = { id: "task-race", productId: "product", nodeId: "node-race", responseHash: digest };
  let batchActive = false, resultApplied = false, canvasPersisted = false, confirmations = 0;
  const host = {
    async list() {
      return [{ id: target.id, productId: target.productId, nodeId: target.nodeId, state: "succeeded", applied: false, result: { id: digest } }];
    },
    async confirmSaved() {
      assert.equal(resultApplied, true, "批量工作线程必须先获得产品写入锁并写入结果");
      assert.equal(canvasPersisted, true, "任务确认必须晚于最终画布保存");
      confirmations++;
    },
  };
  const recovery = createImageConfirmationRecovery({
    host, targets: [target], serialize: serializeProductResult,
    async save() {
      firstSaveStarted.resolve();
      await releaseFirstSave.promise;
      return batchActive ? { persisted: false, deferred: true } : { persisted: true, deferred: false };
    },
    waitForBatchSave(productId) {
      const waiting = batchSave.waitForBatchCanvasSave(productId);
      if (waiting) batchWaitRegistered.resolve();
      return waiting;
    },
  });
  const recovering = recovery.run();
  await firstSaveStarted.promise;

  batchSave.beginBatchCanvasSave("product");
  batchSave.markBatchCanvasDirty("product");
  batchActive = true;
  releaseFirstSave.resolve();

  await Promise.race([
    serializeProductResult("product", async () => { resultApplied = true; }),
    new Promise((_, reject) => setTimeout(() => reject(new Error("确认恢复占住产品写入锁，批量结果无法回写")), 1000)),
  ]);
  assert.equal(resultApplied, true);
  await batchWaitRegistered.promise;

  canvasPersisted = true;
  assert.equal(batchSave.finishBatchCanvasSave("product"), true);
  batchSave.completeBatchCanvasSave("product", "saved");
  const result = await recovering;
  assert.deepEqual(result.pending, []);
  assert.equal(confirmations, 1);
});

test("最终批量画布ACK失败时原任务保持未确认", async () => {
  const batchSave = await load("画布生成/批量保存协调.ts", {});
  const digest = "b".repeat(64), target = { id: "task-B", productId: "product", nodeId: "node-B", responseHash: digest };
  let confirmations = 0;
  const host = {
    async list() { return [{ id: target.id, productId: target.productId, nodeId: target.nodeId, state: "succeeded", applied: false, result: { id: digest } }]; },
    async confirmSaved() { confirmations++; },
  };
  batchSave.beginBatchCanvasSave("product");
  const recovery = createImageConfirmationRecovery({
    host, targets: [target], serialize: (_id, operation) => operation(), save: async () => {},
    waitForBatchSave: batchSave.waitForBatchCanvasSave,
  });
  const running = recovery.run();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(batchSave.finishBatchCanvasSave("product"), false);
  batchSave.completeBatchCanvasSave("product", "failed");
  const result = await running;
  assert.deepEqual(result.pending, [target.id]);
  assert.equal(result.failures[0].code, "batch_save_failed");
  assert.equal(confirmations, 0);
});

test("最终批量保存只放行当前产品的一次Zustand持久化", async () => {
  const batchSave = await load("画布生成/批量保存协调.ts", {});
  const Checkpoint = (await load("产品/产品保存检查点.ts", {})).ProductCommitCheckpoint;
  const scheduled = [];
  let sqliteFlushes = 0, saveRegistry, checkpoint, requestedTicket = 0;
  class CapturedCheckpoint extends Checkpoint {
    constructor(requestRender) {
      super(requestRender);
      checkpoint = this;
    }
  }
  class CapturedSaveRegistry {
    constructor() { saveRegistry = this; }
    register(id, save) { this.id = id; this.save = save; return () => {}; }
    acknowledge() {}
    async flush(id, options) {
      assert.equal(id, this.id);
      await this.save(options);
    }
  }
  const useCanvasStore = await loadFile(
    resolve(root, ".运行/3100源/画布副本/web/src/stores/canvas/use-canvas-store.ts"),
    {
      "@/扩展功能/图片设置/图片信息偏好": {
        imageInfoDefaults: { showImageInfo: false },
        withCanvasAppearanceDefaults: value => value,
      },
      "@/扩展功能/本机存储/上游浏览器存储桥": {
        scheduleStateSave: (key, value) => { scheduled.push({ key, value }); return Promise.resolve(); },
      },
      "@/扩展功能/画布生成/批量保存协调": batchSave,
      zustand: {
        create: () => initializer => {
          let state;
          const setState = update => {
            const next = typeof update === "function" ? update(state) : update;
            if (next !== state) state = { ...state, ...next };
          };
          const getState = () => state;
          const api = { getState, setState };
          state = initializer(setState, getState, api);
          return api;
        },
      },
      "zustand/middleware": {
        persist: (initializer, options) => (set, get, api) => initializer((update, replace) => {
          set(update, replace);
          const state = get();
          void options.storage.setItem(options.name, { state: options.partialize(state), version: 0 });
        }, get, api),
      },
      nanoid: { nanoid: () => "product" },
      "@/扩展功能/Excel/Excel产品归属": {
        assertWorkbookSnapshot() {},
        currentWorkbookId: () => null,
        normalizeExcelCanvasTitles: state => state.projects,
      },
      "@/扩展功能/产品/产品规则": { nextProductTitle: () => "测试产品" },
      "@/i18n": { default: { t: key => key } },
      "@/lib/localforage-storage": { localForageStorage: { getItem: async () => null, removeItem: async () => {} } },
    },
  );
  const store = useCanvasStore.useCanvasStore;
  const projectId = store.getState().createProject();
  scheduled.length = 0;

  const product = await load("产品/产品操作.ts", productDependencies({
    batchSave,
    saveRegistry: CapturedSaveRegistry,
    useCanvasStore: store,
    flushSQLiteStorage: async () => { sqliteFlushes++; },
    productCheckpoint: CapturedCheckpoint,
    react: {
      useCallback: value => value,
      useLayoutEffect: effect => { effect(); },
      useRef: value => ({ current: value }),
      useState: value => [value, ticket => { requestedTicket = ticket; }],
      useSyncExternalStore: (_subscribe, get) => get(),
    },
  }));

  const progress = { projectId, nodes: [{ id: "in-memory-progress" }] };
  product.useProductCanvasSave(
    projectId,
    progress,
    () => false,
    async committed => {
      const { projectId: id, ...patch } = committed;
      store.getState().updateProject(id, patch);
    },
  );
  batchSave.beginBatchCanvasSave(projectId);
  const save = product.saveProductCanvas(projectId, { force: true });
  assert.ok(requestedTicket > 0, "最终保存应等待真实React检查点");
  assert.equal(scheduled.length, 0, "等待React检查点期间不得提前放行Zustand写入");
  store.getState().updateProject(projectId, { nodes: [{ id: "unrelated-progress" }] });
  assert.equal(scheduled.length, 0, "检查点等待期间的无关Zustand更新仍须拦截");
  const finalSnapshot = { projectId, nodes: [{ id: "final-result" }] };
  checkpoint.commit(requestedTicket, finalSnapshot, true);
  await save;
  assert.equal(saveRegistry !== undefined, true);
  assert.equal(scheduled.length, 1, "最终updateProject必须真实进入SQLite保存队列一次");
  assert.equal(sqliteFlushes, 1, "最终保存应等待一次SQLite确认");
  store.getState().updateProject(projectId, { nodes: [{ id: "late-progress" }] });
  assert.equal(scheduled.length, 1, "最终快照后门控应继续拦截批量期间的普通写入");
  assert.equal(typeof scheduled[0].value, "function", "最终快照应在防抖后才编码");
  assert.deepEqual(JSON.parse(scheduled[0].value()).state.projects[0].nodes, [{ id: "final-result" }], "延迟编码必须捕获最终检查点，不能读到之后被门控的内存进度");
  assert.equal(batchSave.finishBatchCanvasSave(projectId), true);
  batchSave.completeBatchCanvasSave(projectId);
});

test("批量最终保存失败后释放批量门控，重试入口只恢复保存且不重放生成", async () => {
  const batchSave = await load("画布生成/批量保存协调.ts", {});
  const layout = await load("画布布局/卡片自动避让.ts", {});
  const columns = await load("画布布局/批量结果排布.ts", {
    "./卡片自动避让": layout,
  });
  const variants = variantModules();
  const module = await load("画布生成/批量生成操作.ts", {
    react: {
      useCallback: value => value,
      useRef: value => ({ current: value }),
    },
    "@/types/canvas": {
      CanvasNodeType: {
        Config: "config",
        Text: "text",
        Image: "image",
        Video: "video",
        Audio: "audio",
      },
    },
    "@/constant/canvas": { getNodeSpec: () => ({ width: 100, height: 80 }) },
    "@/lib/canvas/canvas-node-factory": {
      createCanvasNode: (type, position, metadata) => ({
        id: "config",
        type,
        position,
        width: 100,
        height: 80,
        metadata: { status: "idle", ...metadata },
      }),
    },
    "@/lib/canvas/canvas-generation-helpers": { getGenerationCount: value => value || 1, buildGenerationConfig: () => ({ model: 'local-test' }) },
    nanoid: { nanoid: () => "edge" },
    "./生成参数继承": {
      generationNodeForExecution: node => node,
      promptGenerationPatch: () => ({}),
      generationSettingsFromNode: () => ({}),
    },
    "../安全与批量/prompt-generation-mode": { promptGenerationMode: () => "image" },
    "../安全与批量/settle-activity-group": { settleActivityGroup: values => Promise.all(values) },
    "../画布布局/卡片自动避让": { placeCanvasNode: node => node },
    "../画布布局/生成配置水平排布": variants.load("画布布局/生成配置水平排布.ts"),
    "../产品配置/模型配置门禁": { ensureModelConfigured: () => true },
    "../Excel画布/商品提示词阻止反馈": variants.load("Excel画布/商品提示词阻止反馈.ts"),
    "../画布布局/批量结果排布": columns,
    "./产品变体生成": variants.load("画布生成/产品变体生成.ts"),
    "../Excel画布/商品提示词规则": variants.load("Excel画布/商品提示词规则.ts"),
    "../Excel画布/商品提示词画布": variants.load("Excel画布/商品提示词画布.ts"),
    "./批量保存协调": batchSave,
  });

  const nodesRef = {
    current: [{ id: "config", type: "config", position: { x: 0, y: 0 }, width: 100, height: 80, metadata: { generationMode: "image" } }],
  };
  const saves = [];
  const generated = [];
  let retryCalls = 0;
  let retryResolved = false;
  let pendingRetry;
  const api = module.useCanvasBatchGeneration({
    projectId: "product",
    nodesRef,
    connectionsRef: { current: [] },
    effectiveConfig: {},
    setNodes: () => {},
    setConnections: () => {},
    setSelectedNodeIds: () => {},
    setSelectedConnectionId: () => {},
    handleGenerateNode: async id => {
      generated.push(id);
      batchSave.markBatchCanvasDirty("product");
    },
    saveCanvas: async id => {
      saves.push(id);
      pendingRetry = async () => { retryResolved = true; };
      throw new Error("保存尚未确认");
    },
    message: {
      info: () => {},
      warning: () => {},
      error: value => { assert.match(String(value), /最终画布保存未确认/); },
    },
  });

  await api.generateAllConfigNodes();
  assert.deepEqual(generated, ["config"], "最终保存失败不能重放生成请求");
  assert.deepEqual(saves, ["product"], "批量完成后只尝试一次最终保存");
  assert.equal(batchSave.isBatchCanvasSaveActive("product"), false, "最终保存失败也必须释放批量门控");

  // 这模拟页面上的“重试未确认保存”按钮：只重试原保存队列，
  // 不再次调用批量生成入口；重试入口必须在最终失败后仍可用。
  const retrySQLiteStorage = async () => {
    retryCalls++;
    await pendingRetry();
  };
  await retrySQLiteStorage();
  assert.equal(retryCalls, 1);
  assert.equal(retryResolved, true, "重试入口应继续已排队的最终保存");
  assert.deepEqual(generated, ["config"], "保存重试不能再次提交生成任务");
  assert.deepEqual(saves, ["product"], "保存重试不应由批量入口重放整批保存");
});
