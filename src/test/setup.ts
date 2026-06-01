import { vi } from 'vitest';

// Mock localforage globally to avoid unhandled rejections in Node test env
// (Node has no IndexedDB/WebSQL/localStorage backends registered)
vi.mock('localforage', () => ({
  default: {
    getItem: vi.fn().mockResolvedValue(null),
    setItem: vi.fn().mockResolvedValue(undefined),
    removeItem: vi.fn().mockResolvedValue(undefined),
    config: vi.fn(),
    driver: vi.fn(),
  },
}));
