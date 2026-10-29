export function noResultTaskFailure(job) {
  if (!job || job.result !== null || job.reason === 'result_save_unconfirmed') return null;
  if (job.state === 'accepted' || job.state === 'cancelled' && job.reason === 'interrupted_before_dispatch')
    return { state: 'failed', reason: 'interrupted_before_dispatch' };
  if (job.state === 'running' || job.state === 'uncertain' && job.reason === 'upstream_result_unknown' ||
      job.state === 'cancelled' && job.reason === 'upstream_result_missing')
    return { state: 'failed', reason: 'upstream_result_missing' };
  return null;
}

export function failNoResultTasks(jobs, now) {
  let changed = 0;
  for (const job of jobs) {
    const failure = noResultTaskFailure(job);
    if (!failure || job.state === failure.state && job.reason === failure.reason) continue;
    job.state = failure.state;
    job.reason = failure.reason;
    job.updatedAt = Math.max(now, job.updatedAt);
    changed++;
  }
  return changed;
}
