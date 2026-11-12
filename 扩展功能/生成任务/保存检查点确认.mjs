import { assertGenerationActive, recoverGenerationResponse } from './本机任务响应恢复.mjs';

const staleCheckpoint = error => ['generation_canvas_unconfirmed', 'generation_canvas_unsaved'].includes(error?.code);
/** Refresh a stale whole-workspace proof without applying the result twice. */
export async function confirmGenerationCheckpoint({ read, apply, checkpoint, signal, retryWait } = {}) {
  const recovery = { signal, wait: retryWait };
  for (let attempt = 0; ; attempt++) {
    assertGenerationActive(signal);
    try {
      const proof = attempt === 0 && checkpoint ? checkpoint : await recoverGenerationResponse(read, recovery);
      return await recoverGenerationResponse(() => apply(proof), recovery);
    } catch (error) {
      assertGenerationActive(signal);
      if (!staleCheckpoint(error) || attempt >= 2) throw error;
      // Only idempotent proof reads and acknowledgement are repeated.
    }
  }
}
