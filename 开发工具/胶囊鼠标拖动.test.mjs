import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { transformWithEsbuild } from "../.运行/3100源/画布副本/web/node_modules/vite/dist/node/index.js";

const file = "扩展功能/产品/胶囊鼠标拖动.ts";
const { code } = await transformWithEsbuild(readFileSync(file, "utf8"), file, { loader: "ts", format: "cjs", target: "es2022", tsconfigRaw: "{}" });
const module = { exports: {} };
new Function("require", "module", "exports", code)(() => ({ useEffect() {} }), module, module.exports);
class Target {
  listeners = new Map();
  addEventListener(name, fn) { this.listeners.set(name, fn); }
  removeEventListener(name) { this.listeners.delete(name); }
  send(name, patch = {}) {
    const e = { pointerId: 1, pointerType: "mouse", button: 0, isPrimary: true, clientX: 200, detail: 1,
      preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; }, ...patch };
    this.listeners.get(name)?.(e); return e;
  }
}
function fixture() {
  const container = Object.assign(new Target(), {
    dataset: {}, scrollLeft: 200, scrollWidth: 1200, clientWidth: 400, captured: null,
    setPointerCapture(id) { this.captured = id; },
    hasPointerCapture(id) { return this.captured === id; },
    releasePointerCapture() { this.captured = null; },
    scrollTo({ left }) { this.scrollLeft = left; },
  });
  const host = new Target();
  return { container, host, cleanup: module.exports.bindCapsuleMouseDrag(container, host) };
}
test("按住鼠标左右拖动只改变滚动位置，超阈值后抑制切换和删除点击", () => {
  const f = fixture(); f.container.send("pointerdown");
  f.host.send("pointermove", { clientX: 197 }); assert.equal(f.container.scrollLeft, 200);
  f.host.send("pointermove", { clientX: 140 });
  assert.equal(f.container.scrollLeft, 260); assert.equal(f.container.dataset.capsuleDragging, "true");
  f.host.send("pointerup"); assert.equal(f.container.captured, null);
  const click = f.container.send("click"); assert.equal(click.prevented, true); assert.equal(click.stopped, true);
  f.cleanup(); assert.equal(f.host.listeners.size, 0); assert.equal(f.container.listeners.size, 0);
});
test("轻微移动仍单击，键盘点击不被之前的鼠标拖动抑制", () => {
  const f = fixture(); f.container.send("pointerdown"); f.host.send("pointermove", { clientX: 198 }); f.host.send("pointerup");
  assert.equal(f.container.send("click").prevented, undefined);
  f.container.send("pointerdown"); f.host.send("pointermove", { clientX: 100 }); f.host.send("pointerup");
  assert.equal(f.container.send("click", { detail: 0 }).prevented, undefined);
  f.container.send("pointerdown"); f.host.send("pointerup"); assert.equal(f.container.send("click").prevented, undefined);
  f.cleanup();
});
test("滚动限制在范围内，取消、失焦和卸载均释放拖动状态", () => {
  for (const end of ["pointercancel", "blur", "cleanup"]) {
    const f = fixture(); f.container.send("pointerdown"); f.host.send("pointermove", { clientX: -2000 });
    assert.equal(f.container.scrollLeft, 800);
    if (end === "cleanup") f.cleanup(); else { f.host.send(end); f.cleanup(); }
    assert.equal(f.container.dataset.capsuleDragging, undefined); assert.equal(f.container.captured, null);
  }
});
test("触摸、右键、修饰键及无溢出区域不接管原生操作", () => {
  for (const patch of [{ pointerType: "touch" }, { button: 2 }, { isPrimary: false }, { ctrlKey: true }]) {
    const f = fixture(); f.container.send("pointerdown", patch); f.host.send("pointermove", { clientX: 100 });
    assert.equal(f.container.scrollLeft, 200); f.cleanup();
  }
  const f = fixture(); f.container.scrollWidth = 300; f.container.send("pointerdown"); f.host.send("pointermove", { clientX: 100 });
  assert.equal(f.container.scrollLeft, 200); f.cleanup();
});
