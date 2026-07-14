/**
 * 流式翻译临时层（内存 only，不持久化）。
 *
 * 设计目标：流式逐字更新 **不** 写入 filesStore，避免：
 * - 整表 tasks JSON.stringify + IDB persist 排队
 * - 侧栏 / useFile / useFiles 等订阅者每帧重渲
 * - 虚拟列表因全量 entries 引用抖动而失效 memo
 *
 * 字幕编辑器将 overlay 与 subtitle_entries 合并展示；
 * 批次定稿时才 batchUpdateEntries 写入正式译文。
 */

import { create } from 'zustand';
import type { SubtitleEntry } from '@/types';

export type StreamingOverlay = Record<number, string>;

interface StreamingOverlayState {
  /** fileId → entryId → partial 译文 */
  overlays: Record<string, StreamingOverlay>;
  /**
   * 每个文件当前「正在变长」的那一行 id，用于只闪一个光标；
   * 其它已出字的流式行不再带竖线，避免满屏闪烁。
   */
  activeCaretByFile: Record<string, number>;
  /**
   * 合并写入 partial（内部 rAF 合并，同帧多次调用只 set 一次）。
   */
  applyPartials: (fileId: string, updates: Array<{ id: number; text: string }>) => void;
  /** 定稿/失败后清掉指定条目的 overlay（同步，并取消 pending） */
  clearIds: (fileId: string, ids: number[]) => void;
  clearFile: (fileId: string) => void;
}

/** 待刷入 store 的缓冲：fileId → entryId → text */
const pendingByFile = new Map<string, Map<number, string>>();
let rafId = 0;
/** clear 时递增，使进行中的 rAF 失效，避免定稿后闪回旧 partial */
let epoch = 0;

function ensurePending(fileId: string): Map<number, string> {
  let m = pendingByFile.get(fileId);
  if (!m) {
    m = new Map();
    pendingByFile.set(fileId, m);
  }
  return m;
}

function scheduleFlush(flush: () => void) {
  if (rafId !== 0) return;
  const scheduledAt = epoch;
  const run = () => {
    rafId = 0;
    // 期间发生过 clear：丢弃本次，若仍有 pending 再排一帧
    if (scheduledAt !== epoch) {
      if (pendingByFile.size > 0) scheduleFlush(flush);
      return;
    }
    flush();
  };
  rafId =
    typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame(run)
      : (setTimeout(run, 16) as unknown as number);
}

function bumpEpoch() {
  epoch += 1;
}

export const useStreamingOverlayStore = create<StreamingOverlayState>((set, get) => {
  const flushPending = () => {
    if (pendingByFile.size === 0) return;

    const batch = new Map(pendingByFile);
    pendingByFile.clear();

    set((state) => {
      let changed = false;
      const nextOverlays = { ...state.overlays };
      const nextCarets = { ...state.activeCaretByFile };

      for (const [fileId, entryMap] of batch) {
        if (entryMap.size === 0) continue;
        const prev = nextOverlays[fileId] ?? {};
        let fileOverlay: StreamingOverlay | null = null;
        // 本帧「字变长」的最后一行 → 唯一光标
        let caretId: number | null = null;

        for (const [id, text] of entryMap) {
          if (prev[id] === text) continue;
          if (!fileOverlay) fileOverlay = { ...prev };
          const prevLen = (prev[id] ?? '').length;
          fileOverlay[id] = text;
          if (text.length >= prevLen) {
            caretId = id;
          }
        }

        if (fileOverlay) {
          nextOverlays[fileId] = fileOverlay;
          if (caretId != null) nextCarets[fileId] = caretId;
          changed = true;
        }
      }

      return changed
        ? { overlays: nextOverlays, activeCaretByFile: nextCarets }
        : state;
    });
  };

  return {
    overlays: {},
    activeCaretByFile: {},

    applyPartials: (fileId, updates) => {
      if (!fileId || updates.length === 0) return;
      const pending = ensurePending(fileId);
      let touched = false;
      for (const u of updates) {
        if (pending.get(u.id) === u.text) continue;
        pending.set(u.id, u.text);
        touched = true;
      }
      if (!touched) return;
      scheduleFlush(flushPending);
    },

    clearIds: (fileId, ids) => {
      if (!fileId || ids.length === 0) return;

      bumpEpoch();

      const pending = pendingByFile.get(fileId);
      if (pending) {
        for (const id of ids) pending.delete(id);
        if (pending.size === 0) pendingByFile.delete(fileId);
      }

      // 若其它条目仍有 pending，重新排程 flush
      if (pendingByFile.size > 0) {
        scheduleFlush(flushPending);
      }

      const prev = get().overlays[fileId];
      const caretId = get().activeCaretByFile[fileId];
      const caretCleared = caretId != null && ids.includes(caretId);

      if (!prev && !caretCleared) return;

      const nextOverlay: StreamingOverlay | undefined = prev ? { ...prev } : undefined;
      if (nextOverlay) {
        for (const id of ids) {
          delete nextOverlay[id];
        }
      }

      set((state) => {
        const overlays = { ...state.overlays };
        const activeCaretByFile = { ...state.activeCaretByFile };

        if (nextOverlay) {
          if (Object.keys(nextOverlay).length === 0) {
            delete overlays[fileId];
          } else {
            overlays[fileId] = nextOverlay;
          }
        }
        if (caretCleared) {
          delete activeCaretByFile[fileId];
        }
        return { overlays, activeCaretByFile };
      });
    },

    clearFile: (fileId) => {
      if (!fileId) return;
      bumpEpoch();
      pendingByFile.delete(fileId);
      if (pendingByFile.size > 0) {
        scheduleFlush(flushPending);
      }

      const hasOverlay = fileId in get().overlays;
      const hasCaret = fileId in get().activeCaretByFile;
      if (!hasOverlay && !hasCaret) return;

      set((state) => {
        const overlays = { ...state.overlays };
        const activeCaretByFile = { ...state.activeCaretByFile };
        delete overlays[fileId];
        delete activeCaretByFile[fileId];
        return { overlays, activeCaretByFile };
      });
    },
  };
});

/** 稳定空对象，避免 selector 每次新建 {} */
export const EMPTY_STREAMING_OVERLAY: StreamingOverlay = Object.freeze({});

/**
 * 正在流式出字的行数（已有 partial 文本）。
 * 用于 UI 进度：流式已「看见」的行应推进度，而不是等整批 completed。
 */
export function countStreamingLines(overlay: StreamingOverlay | undefined): number {
  if (!overlay) return 0;
  let n = 0;
  for (const key in overlay) {
    if (overlay[key] && overlay[key].length > 0) n += 1;
  }
  return n;
}

/**
 * 展示用翻译进度（不写 filesStore）。
 * - hard：已 completed 的 translatedCount
 * - soft：overlay 里已出字的行（与 hard 不重叠）
 * 进度条 / 侧栏轨条应跟「人眼看到的译文」同步，而非仅批次落库节奏。
 */
export function calcDisplayTranslationProgress(
  translatedCount: number,
  entryCount: number,
  streamingLines: number
): { translated: number; total: number; percentage: number } {
  const total = Math.max(0, entryCount);
  const hard = Math.max(0, translatedCount);
  const soft = Math.min(Math.max(0, streamingLines), Math.max(0, total - hard));
  const translated = Math.min(total, hard + soft);
  return {
    translated,
    total,
    percentage: total > 0 ? Math.round((translated / total) * 100) : 0,
  };
}

/** 合并正式条目与流式 overlay（未命中 overlay 的条目保持同一引用，利于 memo） */
export function mergeEntriesWithOverlay(
  entries: SubtitleEntry[],
  overlay: StreamingOverlay | undefined
): SubtitleEntry[] {
  if (!overlay) return entries;
  let hasAny = false;
  for (const _k in overlay) {
    hasAny = true;
    break;
  }
  if (!hasAny) return entries;

  return entries.map((e) => {
    const partial = overlay[e.id];
    if (partial === undefined) return e;
    return {
      ...e,
      translatedText: partial,
      translationStatus: 'streaming' as const,
    };
  });
}

/** 测试辅助：重置模块级 rAF/pending（单测用） */
export function __resetStreamingOverlayForTests() {
  pendingByFile.clear();
  if (rafId !== 0) {
    if (typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(rafId);
    } else {
      clearTimeout(rafId);
    }
    rafId = 0;
  }
  epoch = 0;
  useStreamingOverlayStore.setState({ overlays: {}, activeCaretByFile: {} });
}
