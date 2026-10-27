// 与现有产品操作锁配合；不重建画布，不绕过真实检查点或SQLite保存ACK。
export async function commitWorkbookChange<T>(steps: {
  commitCurrent(): Promise<void>;
  plan(): T;
  prepare?(value: T): T;
  publish(value: T): void;
  flush(): Promise<void>;
  navigate(value: T): Promise<void>;
  rollback?(): void;
}) {
  let published = false;
  try {
    await steps.commitCurrent();
    const latest = steps.plan(); // 保存期间可能有后台结果完成，因此必须在ACK后读取最新根。
    const planned = steps.prepare ? steps.prepare(latest) : latest;
    published = true;
    steps.publish(planned);
    // 业务根与导航偏好在同一轮排空中确认后才切换页面。
    await steps.flush();
    await steps.navigate(planned);
    return planned;
  } catch (error) {
    if (published) {
      try { steps.rollback?.(); } catch { /* 保留原始保存或导航错误。 */ }
    }
    throw error;
  }
}
