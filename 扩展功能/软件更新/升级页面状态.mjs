const participants = new Map();

export function registerUpgradeParticipant(id, port) {
  participants.set(id, port);
  return () => { if (participants.get(id) === port) participants.delete(id); };
}
export function canPreparePageUpgrade() {
  return [...participants.values()].every(port => port.ready());
}
export async function flushPageUpgrade() {
  if (!canPreparePageUpgrade()) throw Error('工作台仍有操作或生成任务，请等待完成');
  for (const port of participants.values()) {
    await port.flush();
    if (!canPreparePageUpgrade()) throw Error('保存期间工作台状态发生变化');
  }
}
