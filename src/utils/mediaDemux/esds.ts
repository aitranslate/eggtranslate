/**
 * 从 mp4a sample description / esds 取出 DecoderSpecificInfo（AudioSpecificConfig）
 */
export function extractAudioSpecificConfig(description: unknown): Uint8Array | null {
  if (!description || typeof description !== 'object') return null;
  const desc = description as {
    esds?: {
      esd?: {
        descs?: Array<{
          tag?: number;
          data?: Uint8Array;
          descs?: Array<{ tag?: number; data?: Uint8Array; descs?: unknown[] }>;
        }>;
      };
      data?: Uint8Array;
    };
  };

  const walk = (nodes: unknown): Uint8Array | null => {
    if (!Array.isArray(nodes)) return null;
    for (const node of nodes) {
      if (!node || typeof node !== 'object') continue;
      const n = node as {
        tag?: number;
        data?: Uint8Array;
        descs?: unknown[];
      };
      if (n.tag === 5 && n.data && n.data.byteLength > 0) {
        const d = n.data instanceof Uint8Array ? n.data : new Uint8Array(n.data as ArrayBuffer);
        // 只保留有效 ASC 前缀（常见 2 字节，扩展可更长；去掉尾部 0 填充）
        let len = d.byteLength;
        while (len > 2 && d[len - 1] === 0) len--;
        return d.subarray(0, Math.max(2, len));
      }
      const nested = walk(n.descs);
      if (nested) return nested;
    }
    return null;
  };

  if (desc.esds?.esd?.descs) {
    const fromTree = walk(desc.esds.esd.descs);
    if (fromTree) return fromTree;
  }

  const raw = desc.esds?.data;
  if (raw && raw.byteLength > 4) {
    for (let i = 0; i < raw.byteLength - 2; i++) {
      if (raw[i] !== 0x05) continue;
      let j = i + 1;
      while (j < raw.byteLength && raw[j] === 0x80) j++;
      if (j >= raw.byteLength) break;
      const len = raw[j];
      const start = j + 1;
      if (len > 0 && start + len <= raw.byteLength) {
        return raw.subarray(start, start + len);
      }
    }
  }
  return null;
}
