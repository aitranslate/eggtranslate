/**
 * 有界并发：固定 worker 抢任务，谁做完谁接下一条。
 * 任一任务抛错后不再领取新任务（进行中的会做完），再把第一个错误抛出。
 */
export async function mapPool<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) return [];
  const raw = Number(concurrency);
  const limit = Math.max(1, Math.min(Number.isFinite(raw) ? Math.floor(raw) : 1, items.length));
  const results = new Array<R>(items.length);
  let next = 0;
  let stopped = false;
  let firstError: unknown;

  async function worker(): Promise<void> {
    while (true) {
      if (stopped) return;
      const i = next++;
      if (i >= items.length) return;
      try {
        results[i] = await fn(items[i], i);
      } catch (err) {
        stopped = true;
        firstError ??= err;
        throw err;
      }
    }
  }

  const settled = await Promise.allSettled(Array.from({ length: limit }, () => worker()));
  if (firstError !== undefined) throw firstError;
  const rejected = settled.find((s): s is PromiseRejectedResult => s.status === 'rejected');
  if (rejected) throw rejected.reason;
  return results;
}
