import { describe, expect, it } from 'vitest';
import { scanTopLevelBoxes } from '@/utils/mediaDemux/mp4Extract';

/** 拼一个只有 box 头的假文件：size(4) + type(4) + 载荷 */
function boxes(spec: Array<[string, number]>): Blob {
  const parts: BlobPart[] = [];
  for (const [type, payload] of spec) {
    const size = 8 + payload;
    const head = new Uint8Array(8);
    new DataView(head.buffer).setUint32(0, size);
    for (let i = 0; i < 4; i += 1) head[4 + i] = type.charCodeAt(i);
    parts.push(head, new Uint8Array(payload));
  }
  return new Blob(parts);
}

describe('scanTopLevelBoxes', () => {
  it('finds moov after a large mdat (non-faststart layout)', async () => {
    const file = boxes([
      ['ftyp', 24],
      ['mdat', 5_000],
      ['moov', 120],
    ]);
    const found = await scanTopLevelBoxes(file);
    expect(found.map((b) => b.type)).toEqual(['ftyp', 'mdat', 'moov']);
    expect(found[1].start).toBe(32);
    expect(found[2].start).toBe(32 + 8 + 5_000);
    expect(found[2].size).toBe(128);
  });

  it('stops at a truncated box instead of looping', async () => {
    const file = boxes([['ftyp', 24]]);
    const truncated = new Blob([file, new Uint8Array([0, 0, 0, 99])]);
    const found = await scanTopLevelBoxes(truncated);
    expect(found.map((b) => b.type)).toEqual(['ftyp']);
  });

  it('handles 64-bit box sizes', async () => {
    const head = new Uint8Array(16);
    const view = new DataView(head.buffer);
    view.setUint32(0, 1);
    head.set([0x6d, 0x64, 0x61, 0x74], 4);
    view.setBigUint64(8, 16n + 32n); // 头 16 字节（含 largesize）+ 载荷 32
    const file = new Blob([head, new Uint8Array(32)]);
    const found = await scanTopLevelBoxes(file);
    expect(found[0]).toMatchObject({ type: 'mdat', start: 0, size: 48 });
  });
});
