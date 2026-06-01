import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { convertTaskToMetadata } from '../SubtitleFileManager';
import { generateStableFileId } from '@/utils/taskIdGenerator';
import type { SingleTask, FilePhases, PhaseProgress, SubtitleEntry } from '@/types';

// ============================================
// 测试工厂：构造符合 SingleTask 类型的最小数据
// ============================================

const makeEntry = (id: number, translatedText = ''): SubtitleEntry => ({
  id,
  startTime: '00:00:01,000',
  endTime: '00:00:02,000',
  text: `text-${id}`,
  translatedText,
  translationStatus: translatedText ? 'completed' : 'pending',
});

const makePhases = (overrides: Partial<Record<keyof Omit<FilePhases, 'workflow'>, Partial<PhaseProgress>>> = {}): FilePhases => ({
  workflow: 'translate',
  converting: { status: 'completed', progress: 100, tokens: 0, ...overrides.converting },
  transcribing: { status: 'completed', progress: 100, tokens: 0, ...overrides.transcribing },
  translating: { status: 'completed', progress: 100, tokens: 0, ...overrides.translating },
  splitting: { status: 'completed', progress: 100, tokens: 0, ...overrides.splitting },
});

interface MakeTaskOptions {
  taskId?: string;
  subtitle_filename?: string;
  subtitle_entries?: SubtitleEntry[];
  phases?: FilePhases;
  index?: number;
  selectedKeytermGroupId?: string | null;
  entryCount?: number;
  translatedCount?: number;
  fileType?: SingleTask['fileType'];
  fileSize?: number;
  duration?: number;
  fileRef?: File;
}

const makeTask = (overrides: MakeTaskOptions = {}): SingleTask => {
  // 用 spread 而非 ??，让 overrides 中的显式 undefined 能"穿透"默认值，
  // 便于测试老数据兼容（entryCount=undefined 走 fallback 路径）
  const base: SingleTask = {
    taskId: 'task-1',
    subtitle_filename: 'movie.srt',
    subtitle_entries: [],
    phases: makePhases(),
    index: 0,
    selectedKeytermGroupId: null,
    entryCount: 0,
    translatedCount: 0,
  };
  return { ...base, ...overrides };
};

// ============================================
// 测试套件
// ============================================

describe('convertTaskToMetadata', () => {
  // 固定 Date.now() 以便断言 lastModified
  const FIXED_NOW = 1_700_000_000_000;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ------------------------------------------
  // 1. 基础字段映射
  // ------------------------------------------
  describe('基础字段映射', () => {
    it('正确映射 taskId / name / fileType / fileSize', () => {
      const task = makeTask({
        taskId: 'task-abc',
        subtitle_filename: 'episode_01.srt',
        fileType: 'srt',
        fileSize: 12_345,
      });

      const result = convertTaskToMetadata(task);

      expect(result.taskId).toBe('task-abc');
      expect(result.name).toBe('episode_01.srt');
      expect(result.fileType).toBe('srt');
      expect(result.fileSize).toBe(12_345);
    });

    it('fileId 来自 generateStableFileId(taskId)', () => {
      const task = makeTask({ taskId: 'task-xyz' });

      const result = convertTaskToMetadata(task);

      expect(result.id).toBe(generateStableFileId('task-xyz'));
      expect(result.id).toBe('file_task-xyz');
    });

    it('lastModified 取当前时间戳', () => {
      const task = makeTask();
      const result = convertTaskToMetadata(task);
      expect(result.lastModified).toBe(FIXED_NOW);
    });

    it('duration 透传', () => {
      const task = makeTask({ duration: 3600 });
      const result = convertTaskToMetadata(task);
      expect(result.duration).toBe(3600);
    });
  });

  // ------------------------------------------
  // 2. H2 改造后的派生字段
  // ------------------------------------------
  describe('entryCount / translatedCount 派生字段', () => {
    it('H2 改造后：task.entryCount 与 translatedCount 直接透传', () => {
      const task = makeTask({ entryCount: 100, translatedCount: 50 });
      const result = convertTaskToMetadata(task);
      expect(result.entryCount).toBe(100);
      expect(result.translatedCount).toBe(50);
    });

    it('task.entryCount = 0 时透传为 0（?? 不把 0 视为缺失）', () => {
      // 注意：函数用 ?? 兜底，0 是合法值，不会回退到 entries.length
      const entries = Array.from({ length: 10 }, (_, i) => makeEntry(i + 1));
      const task = makeTask({ entryCount: 0, subtitle_entries: entries });
      const result = convertTaskToMetadata(task);
      expect(result.entryCount).toBe(0);
    });

    it('老数据兼容：task.entryCount = undefined 时回退到 subtitle_entries.length', () => {
      const entries = Array.from({ length: 7 }, (_, i) => makeEntry(i + 1));
      // 通过 unknown 绕过 TS 必填检查，模拟老数据
      const task: SingleTask = makeTask({ subtitle_entries: entries, entryCount: undefined as unknown as number });
      const result = convertTaskToMetadata(task);
      expect(result.entryCount).toBe(7);
    });

    it('task.translatedCount = undefined 时通过 filter 计算', () => {
      const entries = [
        makeEntry(1, '已翻译-1'),
        makeEntry(2, ''),
        makeEntry(3, '已翻译-3'),
        makeEntry(4, ''),
        makeEntry(5, '已翻译-5'),
      ];
      const task: SingleTask = makeTask({
        subtitle_entries: entries,
        translatedCount: undefined as unknown as number,
      });
      const result = convertTaskToMetadata(task);
      expect(result.translatedCount).toBe(3);
    });

    it('task.translatedCount = 0 时仍然透传为 0（不被误判为缺失）', () => {
      // translatedCount=0 是合法值（尚未翻译），应优先透传
      const task = makeTask({ translatedCount: 0, subtitle_entries: [makeEntry(1, '已翻译')] });
      const result = convertTaskToMetadata(task);
      expect(result.translatedCount).toBe(0);
    });
  });

  // ------------------------------------------
  // 3. phases 处理
  // ------------------------------------------
  describe('phases 处理', () => {
    it('task.phases 存在时直接透传', () => {
      const phases = makePhases({
        translating: { status: 'active', progress: 50, tokens: 200 },
        splitting: { status: 'upcoming', progress: 0, tokens: 0 },
      });
      const task = makeTask({ phases });
      const result = convertTaskToMetadata(task);
      expect(result.phases).toEqual(phases);
    });

    it('task.phases 缺失时回退到 createInitialPhases(isSrt, isTranslated)', () => {
      // 模拟老数据：phases 字段缺失
      const task = {
        taskId: 'task-1',
        subtitle_filename: 'old.srt',
        subtitle_entries: [],
        index: 0,
        selectedKeytermGroupId: null,
        entryCount: 0,
        translatedCount: 0,
        fileType: 'srt' as const,
        fileSize: 100,
      } as unknown as SingleTask;

      const result = convertTaskToMetadata(task);

      // SRT 文件 + 尚未翻译 (无 phases) → transcribing 已完成，translating 仍为 upcoming
      expect(result.phases.workflow).toBe('transcribe');
      expect(result.phases.converting).toMatchObject({ status: 'upcoming', tokens: 0 });
      expect(result.phases.transcribing).toMatchObject({ status: 'completed', progress: 100 });
      expect(result.phases.translating).toMatchObject({ status: 'upcoming', tokens: 0 });
      expect(result.phases.splitting).toMatchObject({ status: 'upcoming', tokens: 0 });
    });

    it('phases 缺失且 fileType 为 video 时，transcribing 也是 upcoming', () => {
      const task = {
        taskId: 'task-1',
        subtitle_filename: 'clip.mp4',
        subtitle_entries: [],
        index: 0,
        selectedKeytermGroupId: null,
        entryCount: 0,
        translatedCount: 0,
        fileType: 'video' as const,
        fileSize: 9999,
      } as unknown as SingleTask;

      const result = convertTaskToMetadata(task);
      expect(result.phases.transcribing.status).toBe('upcoming');
      expect(result.phases.translating.status).toBe('upcoming');
    });
  });

  // ------------------------------------------
  // 4. tokensUsed 计算
  // ------------------------------------------
  describe('tokensUsed 计算', () => {
    it('phases.translating.tokens + phases.splitting.tokens 之和', () => {
      const task = makeTask({
        phases: makePhases({
          translating: { tokens: 300 },
          splitting: { tokens: 75 },
        }),
      });
      const result = convertTaskToMetadata(task);
      expect(result.tokensUsed).toBe(375);
    });

    it('任一 phase tokens 缺失时按 0 计算', () => {
      const task = makeTask({
        phases: makePhases({
          translating: { tokens: 100 },
          splitting: { tokens: undefined as unknown as number },
        }),
      });
      const result = convertTaskToMetadata(task);
      expect(result.tokensUsed).toBe(100);
    });

    it('phases 整体缺失时 tokensUsed 为 0', () => {
      const task = {
        taskId: 'task-1',
        subtitle_filename: 'x.srt',
        subtitle_entries: [],
        index: 0,
        selectedKeytermGroupId: null,
        entryCount: 0,
        translatedCount: 0,
      } as unknown as SingleTask;

      const result = convertTaskToMetadata(task);
      expect(result.tokensUsed).toBe(0);
    });
  });

  // ------------------------------------------
  // 5. 边界 / 默认值
  // ------------------------------------------
  describe('边界 / 默认值', () => {
    it('subtitle_entries = undefined 视为空数组', () => {
      const task = {
        taskId: 'task-1',
        subtitle_filename: 'x.srt',
        subtitle_entries: undefined,
        phases: makePhases(),
        index: 0,
        selectedKeytermGroupId: null,
        entryCount: 0,
        translatedCount: 0,
      } as unknown as SingleTask;

      const result = convertTaskToMetadata(task);
      expect(result.entryCount).toBe(0);
      expect(result.translatedCount).toBe(0);
    });

    it('fileRef 透传', () => {
      const file = new File(['dummy'], 'movie.mp4', { type: 'video/mp4' });
      const task = makeTask({ fileRef: file });
      const result = convertTaskToMetadata(task);
      expect(result.fileRef).toBe(file);
    });

    it('fileRef 缺失时输出 undefined', () => {
      const task = makeTask();
      const result = convertTaskToMetadata(task);
      expect(result.fileRef).toBeUndefined();
    });

    it('fileType 缺失时默认为 srt', () => {
      const task = makeTask({ fileType: undefined });
      const result = convertTaskToMetadata(task);
      expect(result.fileType).toBe('srt');
    });

    it('fileSize 缺失时默认为 0', () => {
      const task = makeTask({ fileSize: undefined });
      const result = convertTaskToMetadata(task);
      expect(result.fileSize).toBe(0);
    });

    it('selectedKeytermGroupId 缺失时默认为 null', () => {
      const task = {
        taskId: 'task-1',
        subtitle_filename: 'x.srt',
        subtitle_entries: [],
        phases: makePhases(),
        index: 0,
        entryCount: 0,
        translatedCount: 0,
        selectedKeytermGroupId: undefined,
      } as unknown as SingleTask;

      const result = convertTaskToMetadata(task);
      expect(result.selectedKeytermGroupId).toBeNull();
    });

    it('selectedKeytermGroupId 有值时透传', () => {
      const task = makeTask({ selectedKeytermGroupId: 'group-42' });
      const result = convertTaskToMetadata(task);
      expect(result.selectedKeytermGroupId).toBe('group-42');
    });

    it('entriesVersion 固定为 0', () => {
      const task = makeTask();
      const result = convertTaskToMetadata(task);
      expect(result.entriesVersion).toBe(0);
    });
  });
});
