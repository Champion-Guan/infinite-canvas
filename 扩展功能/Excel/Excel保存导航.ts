// 与现有产品操作锁配合；不重建画布，不绕过真实检查点或SQLite保存ACK。
export async function commitWorkbookChange<T>(steps: {
  commitCurrent(): Promise<void>;
  plan(): T;
  publish(value: T): void;
  flush(): Promise<void>;
  navigate(value: T): Promise<void>;
}) {
  await steps.commitCurrent();
  const planned = steps.plan(); // 保存期间可能有后台结果完成，因此必须在ACK后读取最新根。
  steps.publish(planned);
  // 失败保留完整内存根和现有重试队列，不删新产品，不覆盖后台已完成结果。
  await steps.flush();
  await steps.navigate(planned);
  return planned;
}
