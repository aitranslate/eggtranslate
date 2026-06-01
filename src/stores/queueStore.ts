/**
 * 队列状态 Store
 * 内存状态，不持久化。刷新页面后队列清空，需要用户重新触发。
 */

import { create } from 'zustand';

interface QueueState {
  taskQueue: string[];
  activeTaskId: string | null;

  setTaskQueue: (queue: string[]) => void;
  setActiveTaskId: (id: string | null) => void;
}

export const useQueueStore = create<QueueState>((set) => ({
  taskQueue: [],
  activeTaskId: null,

  setTaskQueue: (queue) => {
    set({ taskQueue: queue });
  },

  setActiveTaskId: (id) => {
    set({ activeTaskId: id });
  },
}));
