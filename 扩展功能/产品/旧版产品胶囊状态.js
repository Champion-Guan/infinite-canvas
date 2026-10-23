export function readCanvasCapsuleStatus(productId, active, storage, visible = true, acknowledge = true) {
  const key = `guan-canvas-status:${productId}`;
  const seenKey = `guan-canvas-status-seen:${productId}`;
  try {
    const raw = storage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : null;
    const status = ["loading", "error", "success"].includes(parsed?.status) ? parsed.status : "idle";
    const fingerprint = JSON.stringify([status, parsed?.taskId || "", parsed?.startedAt || 0]);
    if (active && acknowledge) {
      if (visible && parsed && status !== "loading") storage.setItem(seenKey, fingerprint);
      return status === "loading" ? "loading" : "idle";
    }
    return status === "loading" ? "loading" : storage.getItem(seenKey) === fingerprint ? "idle" : status;
  } catch {
    return "idle";
  }
}
