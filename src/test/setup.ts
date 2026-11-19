import { vi } from 'vitest';

// Mock localforage globally to avoid unhandled rejections in Node test env
// (Node has no IndexedDB/WebSQL/localStorage backends registered)
vi.mock('localforage', () => ({
  default: {
    getItem: vi.fn().mockResolvedValue(null),
    setItem: vi.fn().mockResolvedValue(undefined),
    removeItem: vi.fn().mockResolvedValue(undefined),
    keys: vi.fn().mockResolvedValue([]),
    config: vi.fn(),
    driver: vi.fn(),
  },
}));

// Node 环境没有 Web Storage，而 zustand/persist 在 store 创建时就抓 localStorage，
// 缺了它会在 import 阶段直接抛错（早期靠「这些测试恰好没被跑」掩盖）。
// 这里补一个内存版 Storage，让 store 测试在 Node 下也能真实读写。
class MemoryStorage implements Storage {
  #map = new Map<string, string>();

  get length(): number {
    return this.#map.size;
  }

  clear(): void {
    this.#map.clear();
  }

  getItem(key: string): string | null {
    return this.#map.has(key) ? this.#map.get(key)! : null;
  }

  key(index: number): string | null {
    return [...this.#map.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.#map.delete(key);
  }

  setItem(key: string, value: string): void {
    this.#map.set(String(key), String(value));
  }
}

if (typeof globalThis.localStorage === 'undefined') {
  const storage = new MemoryStorage();
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true });
  Object.defineProperty(globalThis, 'sessionStorage', {
    value: new MemoryStorage(),
    configurable: true,
  });
}
