function completedEventReader(seenEvents) {
  let legacyIndex;
  return event => {
    if (seenEvents.has(event.id)) return true;
    // v2 stored the entire node task list and timestamp in every slot.
    // Match that history to the slot's own request without acknowledging a new request.
    if (!legacyIndex) {
      legacyIndex = new Map();
      for (const id of seenEvents) {
        let parts;
        try { parts = JSON.parse(id); } catch { continue; }
        if (!Array.isArray(parts) || parts.length !== 6 || !Array.isArray(parts[4])) continue;
        const key = JSON.stringify([parts[0], parts[2], parts[5]]);
        const group = legacyIndex.get(key) || [];
        group.push(parts); legacyIndex.set(key, group);
      }
    }
    let current;
    try { current = JSON.parse(event.id); } catch { return false; }
    if (!Array.isArray(current) || current.length !== 6 || !Array.isArray(current[4])) return false;
    const group = legacyIndex.get(JSON.stringify([current[0], current[2], current[5]])) || [];
    return group.some(previous => current[4].length
      ? current[4].every(taskId => previous[4].includes(taskId))
      : current[2] !== "node" || current[1] === previous[1] && current[3] === previous[3]);
  };
}

export function readCanvasCapsuleStatus(productId, active, storage, visible = true, acknowledge = true) {
  const key = `guan-canvas-status:${productId}`;
  const seenKey = `guan-canvas-status-seen:${productId}`;
  try {
    const raw = storage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : null;
    const status = ["loading", "error", "success"].includes(parsed?.status) ? parsed.status : "idle";
    const fingerprint = JSON.stringify([status, parsed?.taskId || "", parsed?.startedAt || 0]);
    const seenRaw = storage.getItem(seenKey);
    let seen;
    try { seen = seenRaw ? JSON.parse(seenRaw) : null; } catch { seen = null; }
    const events = Array.isArray(parsed?.events) ? parsed.events.filter(event =>
      typeof event?.id === "string" && ["success", "error"].includes(event.status)) : null;
    const seenEvents = new Set(seen?.version === 2 && Array.isArray(seen.events)
      ? seen.events.filter(value => typeof value === "string") : []);
    if (active && acknowledge && visible) {
      if (parsed) {
        if (events) {
          for (const event of events) seenEvents.add(event.id);
          const nextSeen = JSON.stringify({ version: 2, events: [...seenEvents].sort() });
          if (nextSeen !== seenRaw) storage.setItem(seenKey, nextSeen);
        } else if (status !== "loading") storage.setItem(seenKey, fingerprint);
      }
      return status === "loading" ? "loading" : "idle";
    }
    if (status === "loading") return "loading";
    if (events) {
      const wasSeen = completedEventReader(seenEvents);
      const unread = events.filter(event => event.represented !== true && seenRaw !== fingerprint && !wasSeen(event));
      return unread.some(event => event.status === "error") ? "error" : unread.length ? "success" : "idle";
    }
    return seenRaw === fingerprint ? "idle" : status;
  } catch {
    return "idle";
  }
}
