import { describe, it, expect } from 'vitest';
import { mapPool } from '../asyncPool';

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('mapPool', () => {
  it('returns empty for empty input', async () => {
    const fn = async () => 1;
    await expect(mapPool([], 4, fn)).resolves.toEqual([]);
  });

  it('preserves order with concurrency > length', async () => {
    const out = await mapPool([3, 1, 2], 8, async (n) => n * 10);
    expect(out).toEqual([30, 10, 20]);
  });

  it('keeps at most N in flight', async () => {
    let live = 0;
    let peak = 0;
    await mapPool([1, 2, 3, 4, 5, 6], 2, async () => {
      live += 1;
      peak = Math.max(peak, live);
      await delay(15);
      live -= 1;
    });
    expect(peak).toBe(2);
  });

  it('treats 0 / NaN concurrency as 1', async () => {
    const seen: number[] = [];
    await mapPool([1, 2, 3], 0, async (n) => {
      seen.push(n);
      return n;
    });
    expect(seen).toEqual([1, 2, 3]);
    await expect(mapPool([7], Number.NaN, async (n) => n)).resolves.toEqual([7]);
  });

  it('does not start new work after a failure', async () => {
    const started: number[] = [];
    await expect(
      mapPool([0, 1, 2, 3, 4], 2, async (n) => {
        started.push(n);
        if (n === 1) throw new Error('boom');
        await delay(20);
      })
    ).rejects.toThrow('boom');
    expect(started).not.toContain(4);
  });
});
