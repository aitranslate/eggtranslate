import React, { useState, useCallback, useMemo, useRef, memo, useEffect, forwardRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Search, FileText, X } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { SubtitleEntry } from '@/types';
import { useErrorHandler } from '@/hooks/useErrorHandler';
import { useFilesStore, useFile } from '@/stores/filesStore';
import {
  EMPTY_STREAMING_OVERLAY,
  calcDisplayTranslationProgress,
  mergeEntriesWithOverlay,
  useStreamingOverlayStore,
} from '@/stores/streamingOverlayStore';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import {
  useTranslationConfig,
  useTranslationConfigStore,
} from '@/stores/translationConfigStore';
import { LANGUAGE_OPTIONS } from '@/constants/languages';
import { normalizeSrtTime } from '@/utils/timeUtils';
import { getBilingualDisplayLines } from '@/utils/srtParser';
import { generateStableFileId } from '@/utils/taskIdGenerator';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { formatMatchCount, swapLanguages } from '@/utils/uxHelpers';
import { useAgentRunStore } from '@/stores/agentRunStore';
import { AgentProcessControl } from '@/components/agent/AgentProcessControl';
import { useIsMobile } from '@/hooks/useIsMobile';

const EMPTY_ENTRIES: SubtitleEntry[] = [];
/** 桌面虚拟列表行高：与 `.se-row { height: 68px }` 对齐 */
const ROW_HEIGHT = 68;
/**
 * 移动端堆叠卡片预估行高（P50–P75）。
 * 实际高度由 measureElement 校正；低估会导致滚动跳动/空白。
 */
const ROW_HEIGHT_MOBILE_ESTIMATE = 128;

interface SubtitleEditorProps {
  isOpen?: boolean;
  onClose?: () => void;
  fileId: string;
  variant?: 'panel' | 'modal';
}

type FocusField = 'text' | 'translation' | 'startTime' | 'endTime';

interface DisplayRowProps {
  entry: SubtitleEntry;
  index: number;
  start: number;
  onStartEdit: (entry: SubtitleEntry, field?: FocusField) => void;
  /** 仅「当前正在变长」的那一行显示闪烁光标 */
  showStreamCaret?: boolean;
  /** 任务处理中：禁止进入编辑 */
  readOnly?: boolean;
}

/**
 * 字幕正文展示：尊重 SRT 换行（\n）。
 * 同行中英粘连时仅视觉折成多行，不改数据、不拆到译文列。
 */
function MultiLineText({ text, emptyLabel }: { text: string; emptyLabel: string }) {
  if (!text) {
    return <span className="se-placeholder">{emptyLabel}</span>;
  }
  const lines = getBilingualDisplayLines(text);
  // 多行：逐行块级渲染，保留换行语义
  if (lines.length > 1) {
    return (
      <span className="se-text-stack">
        {lines.map((line, i) => (
          <span key={`${i}-${line.slice(0, 16)}`} className="se-text-line">
            {line}
          </span>
        ))}
      </span>
    );
  }
  // 单行：仍允许自动折行，不用 nowrap
  return <span className="se-text-plain">{text}</span>;
}

/** 只读行：序号 | 开始 | 结束 | 原文 | 译文（移动端堆叠为卡片） */
export const SubtitleDisplayRow = memo(
  forwardRef<HTMLDivElement, DisplayRowProps>(function SubtitleDisplayRow(
    { entry, index, start, onStartEdit, showStreamCaret = false, readOnly = false },
    ref
  ) {
  const isStreaming = entry.translationStatus === 'streaming';
  const isMissing = entry.translationStatus === 'missing';
  const tryEdit = (field: FocusField) => {
    if (readOnly) return;
    onStartEdit(entry, field);
  };
  return (
    <div
      ref={ref}
      data-index={index}
      data-testid={`subtitle-row-${entry.id}`}
      data-editing="false"
      data-readonly={readOnly ? 'true' : 'false'}
      data-status={entry.translationStatus}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        transform: `translateY(${start}px)`,
      }}
      className={`se-row${readOnly ? ' is-readonly' : ''}${isMissing ? ' is-missing' : ''}`}
      title={
        readOnly
          ? '任务处理中，完成后可编辑'
          : isMissing
            ? '本条无独立译文（模型漏条或合并），可点击补译'
            : undefined
      }
      onClick={() => tryEdit('translation')}
    >
      <div className="se-row-idx">#{index + 1}</div>
      <button
        type="button"
        className="se-row-time"
        title={readOnly ? '任务处理中，完成后可编辑' : '编辑开始时间'}
        disabled={readOnly}
        onClick={(e) => {
          e.stopPropagation();
          tryEdit('startTime');
        }}
      >
        {entry.startTime}
      </button>
      <button
        type="button"
        className="se-row-time"
        title={readOnly ? '任务处理中，完成后可编辑' : '编辑结束时间'}
        disabled={readOnly}
        onClick={(e) => {
          e.stopPropagation();
          tryEdit('endTime');
        }}
      >
        {entry.endTime}
      </button>
      <div
        className="se-row-src"
        title={entry.text}
        onClick={(e) => {
          e.stopPropagation();
          tryEdit('text');
        }}
      >
        <MultiLineText text={entry.text} emptyLabel="（空原文）" />
      </div>
      <div
        className={`se-row-dst ${entry.translatedText || isStreaming ? '' : 'empty'}${isStreaming ? ' is-streaming' : ''}${isMissing ? ' is-missing' : ''}`}
        title={
          entry.translatedText ||
          (readOnly
            ? '任务处理中，完成后可编辑'
            : isMissing
              ? '无独立译文，点击编辑或重新翻译'
              : undefined)
        }
        onClick={(e) => {
          e.stopPropagation();
          tryEdit('translation');
        }}
      >
        {isStreaming ? (
          <span className="se-text-plain se-stream-text">
            {entry.translatedText || ''}
            {showStreamCaret && <span className="se-stream-caret" aria-hidden />}
          </span>
        ) : (
          <MultiLineText
            text={entry.translatedText || ''}
            emptyLabel={
              isMissing
                ? '漏译 · 可重试或点击补全'
                : readOnly
                  ? '处理中…'
                  : '点击编辑译文'
            }
          />
        )}
      </div>
    </div>
  );
  })
);
SubtitleDisplayRow.displayName = 'SubtitleDisplayRow';

interface EditingRowProps {
  entry: SubtitleEntry;
  index: number;
  start: number;
  editText: string;
  editTranslation: string;
  editStartTime: string;
  editEndTime: string;
  focusField: FocusField;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  setEditText: (text: string) => void;
  setEditTranslation: (text: string) => void;
  setEditStartTime: (time: string) => void;
  setEditEndTime: (time: string) => void;
}

/**
 * 行内编辑：与只读行同一布局（桌面五列，移动端堆叠）。
 * Enter 保存 · Esc 取消 · 失焦保存
 */
export const SubtitleEditingRow = memo(
  forwardRef<HTMLDivElement, EditingRowProps>(function SubtitleEditingRow(
    {
      entry,
      index,
      start,
      editText,
      editTranslation,
      editStartTime,
      editEndTime,
      focusField,
      onSaveEdit,
      onCancelEdit,
      setEditText,
      setEditTranslation,
      setEditStartTime,
      setEditEndTime,
    },
    ref
  ) {
  const textRef = useRef<HTMLTextAreaElement>(null);
  const transRef = useRef<HTMLTextAreaElement>(null);
  const startRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLInputElement>(null);
  /** skip next blur save (Enter already saved / Esc cancelled) */
  const skipBlurSaveRef = useRef(false);

  useEffect(() => {
    const map = {
      text: textRef.current,
      translation: transRef.current,
      startTime: startRef.current,
      endTime: endRef.current,
    } as const;
    const el = map[focusField];
    if (!el) return;
    el.focus();
    if ('setSelectionRange' in el && typeof el.value === 'string') {
      const len = el.value.length;
      try {
        el.setSelectionRange(len, len);
      } catch {
        /* number-like inputs may not support selection */
      }
    }
  }, [focusField, entry.id]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        skipBlurSaveRef.current = true;
        onCancelEdit();
        return;
      }
      // Enter 保存（textarea 上 Shift+Enter 换行）
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        skipBlurSaveRef.current = true;
        onSaveEdit();
      }
    },
    [onCancelEdit, onSaveEdit]
  );

  const handleBlur = useCallback(
    (e: React.FocusEvent) => {
      // 焦点仍在本行另一输入框内 → 不保存
      const next = e.relatedTarget as Node | null;
      const root = e.currentTarget.closest('.se-row');
      if (root && next && root.contains(next)) return;
      if (skipBlurSaveRef.current) {
        skipBlurSaveRef.current = false;
        return;
      }
      // 延迟：等 Esc/Enter 标志先写入
      requestAnimationFrame(() => {
        if (skipBlurSaveRef.current) {
          skipBlurSaveRef.current = false;
          return;
        }
        onSaveEdit();
      });
    },
    [onSaveEdit]
  );

  return (
    <div
      ref={ref}
      data-index={index}
      data-testid={`subtitle-row-${entry.id}`}
      data-editing="true"
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        transform: `translateY(${start}px)`,
      }}
      className="se-row se-row-editing"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="se-row-idx">#{index + 1}</div>
      <input
        ref={startRef}
        type="text"
        inputMode="numeric"
        spellCheck={false}
        autoComplete="off"
        value={editStartTime}
        onChange={(e) => setEditStartTime(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        className="se-time-input"
        aria-label="开始时间"
        placeholder="00:00:00,000"
      />
      <input
        ref={endRef}
        type="text"
        inputMode="numeric"
        spellCheck={false}
        autoComplete="off"
        value={editEndTime}
        onChange={(e) => setEditEndTime(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        className="se-time-input"
        aria-label="结束时间"
        placeholder="00:00:00,000"
      />
      <textarea
        ref={textRef}
        value={editText}
        onChange={(e) => setEditText(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        className="se-inline-input se-row-src"
        rows={2}
        placeholder="原文"
        spellCheck={false}
      />
      <textarea
        ref={transRef}
        value={editTranslation}
        onChange={(e) => setEditTranslation(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        className="se-inline-input se-row-dst"
        rows={2}
        placeholder="译文"
        spellCheck={false}
      />
    </div>
  );
  })
);
SubtitleEditingRow.displayName = 'SubtitleEditingRow';

/** 兼容历史 value（en / zh 等）与 LANGUAGE_OPTIONS.value */
function langLabel(code: string): string {
  if (!code) return code;
  const direct = LANGUAGE_OPTIONS.find((l) => l.value === code);
  if (direct) return direct.label;
  const aliases: Record<string, string> = {
    en: '英语',
    eng: '英语',
    english: '英语',
    zh: '中文（简体）',
    'zh-cn': '中文（简体）',
    'zh-hans': '中文（简体）',
    'zh-tw': '中文（繁体）',
    'zh-hant': '中文（繁体）',
    ja: '日语',
    jp: '日语',
    ko: '韩语',
    fr: '法语',
    de: '德语',
    es: '西班牙语',
    ru: '俄语',
  };
  const key = code.trim().toLowerCase();
  if (aliases[key]) return aliases[key];
  const byNative = LANGUAGE_OPTIONS.find(
    (l) => l.nativeName.toLowerCase() === key || l.label === code
  );
  return byNative?.label ?? code;
}

export const SubtitleEditor: React.FC<SubtitleEditorProps> = ({
  isOpen = true,
  onClose,
  fileId,
  variant = 'panel',
}) => {
  const isMobile = useIsMobile();
  const file = useFile(fileId);
  const updateEntry = useFilesStore((state) => state.updateEntry);
  const config = useTranslationConfig();
  const updateConfig = useTranslationConfigStore((s) => s.updateConfig);
  const openSettings = useWorkspaceStore((s) => s.openSettings);

  const taskId = file?.taskId;
  const fileEntries = useFilesStore(
    useShallow((state) => {
      if (!taskId) return EMPTY_ENTRIES;
      const task = state.tasks.find((t) => t.taskId === taskId);
      return task?.subtitle_entries ?? EMPTY_ENTRIES;
    }),
  );

  // 流式 partial：独立 store，不触发 filesStore / persist
  const streamingOverlay = useStreamingOverlayStore(
    useShallow((s) => s.overlays[fileId] ?? EMPTY_STREAMING_OVERLAY)
  );
  const streamCaretEntryId = useStreamingOverlayStore(
    (s) => s.activeCaretByFile[fileId] ?? null
  );
  const agentRun = useAgentRunStore((s) => s.byFileId[fileId]);
  // 设置里的 Agent 开关只决定「下次」走哪条路径，不隐藏历史/当前运行态
  const agentUiVisible = Boolean(
    agentRun && (agentRun.active || agentRun.error || agentRun.actionLine)
  );

  // 从任务持久化快照回填大脑面板（刷新 / 关 Agent 开关后仍可见）
  useEffect(() => {
    if (!file?.taskId || !file.agentSnapshot) return;
    useAgentRunStore
      .getState()
      .hydrateFromSnapshot(fileId, file.taskId, file.agentSnapshot);
  }, [fileId, file?.taskId, file?.agentSnapshot]);
  const displayEntries = useMemo(
    () => mergeEntriesWithOverlay(fileEntries, streamingOverlay),
    [fileEntries, streamingOverlay]
  );

  /** 转码 / 转录 / 翻译进行中：禁止编辑（完成、失败、未开始可编） */
  const isTaskBusy = useMemo(() => {
    const p = file?.phases;
    if (!p) return false;
    return (
      p.converting?.status === 'active' ||
      p.transcribing?.status === 'active' ||
      p.translating?.status === 'active'
    );
  }, [file?.phases]);

  const { handleError } = useErrorHandler();

  const [editingId, setEditingId] = useState<number | null>(null);
  const [focusField, setFocusField] = useState<FocusField>('translation');
  const [editText, setEditText] = useState('');
  const [editTranslation, setEditTranslation] = useState('');
  const [editStartTime, setEditStartTime] = useState('');
  const [editEndTime, setEditEndTime] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const searchTerm = useDebouncedValue(searchInput, 300);
  const [filterType, setFilterType] = useState<'all' | 'translated' | 'untranslated'>('all');
  const draftRef = useRef({
    text: '',
    translation: '',
    startTime: '',
    endTime: '',
    id: null as number | null,
    fileId: null as string | null,
  });

  useEffect(() => {
    draftRef.current = {
      text: editText,
      translation: editTranslation,
      startTime: editStartTime,
      endTime: editEndTime,
      id: editingId,
      fileId,
    };
  }, [editText, editTranslation, editStartTime, editEndTime, editingId, fileId]);

  // 切换文件前先把当前草稿落盘到旧文件
  const prevFileIdRef = useRef(fileId);
  useEffect(() => {
    if (prevFileIdRef.current !== fileId) {
      const draft = draftRef.current;
      if (draft.id !== null && draft.fileId !== null) {
        const task = useFilesStore.getState().tasks.find((t) =>
          generateStableFileId(t.taskId) === draft.fileId
        );
        const original = task?.subtitle_entries.find((e) => e.id === draft.id);
        if (original && task) {
          const nextStart = normalizeSrtTime(draft.startTime) ?? original.startTime;
          const nextEnd = normalizeSrtTime(draft.endTime) ?? original.endTime;
          const unchanged =
            original.text === draft.text &&
            (original.translatedText || '') === draft.translation &&
            original.startTime === nextStart &&
            original.endTime === nextEnd;
          if (!unchanged) {
            const nextStatus = draft.translation.trim() ? 'completed' : 'pending';
            updateEntry(
              draft.fileId!,
              draft.id,
              draft.text,
              draft.translation,
              nextStatus,
              nextStart,
              nextEnd
            );
          }
        }
      }
      setEditingId(null);
      setEditText('');
      setEditTranslation('');
      setEditStartTime('');
      setEditEndTime('');
      setSearchInput('');
      setFilterType('all');
      prevFileIdRef.current = fileId;
    }
  }, [fileId, updateEntry]);

  const filteredEntries = useMemo(() => {
    let filtered = displayEntries || [];

    if (filterType === 'translated') {
      filtered = filtered.filter((entry) => entry.translatedText);
    } else if (filterType === 'untranslated') {
      filtered = filtered.filter((entry) => !entry.translatedText);
    }

    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter((entry) =>
        entry.text.toLowerCase().includes(term) ||
        (entry.translatedText && entry.translatedText.toLowerCase().includes(term))
      );
    }

    return filtered;
  }, [displayEntries, filterType, searchTerm]);

  const parentRef = useRef<HTMLDivElement>(null);
  const estimateSize = useCallback(
    () => (isMobile ? ROW_HEIGHT_MOBILE_ESTIMATE : ROW_HEIGHT),
    [isMobile]
  );
  const getItemKey = useCallback(
    (index: number) => filteredEntries[index]?.id ?? index,
    [filteredEntries]
  );
  const virtualizer = useVirtualizer({
    count: filteredEntries.length,
    getScrollElement: () => parentRef.current,
    estimateSize,
    getItemKey,
    overscan: 10,
  });

  // 筛选 / 断点变化后重测，避免沿用错误高度缓存
  useEffect(() => {
    virtualizer.measure();
  }, [virtualizer, filterType, searchTerm, fileId, isMobile, filteredEntries.length]);

  const clearDraft = useCallback(() => {
    setEditingId(null);
    setEditText('');
    setEditTranslation('');
    setEditStartTime('');
    setEditEndTime('');
  }, []);

  const onStartEdit = useCallback(
    (entry: SubtitleEntry, field: FocusField = 'translation') => {
      if (isTaskBusy) return;
      setEditingId(entry.id);
      setFocusField(field);
      setEditText(entry.text);
      setEditTranslation(entry.translatedText || '');
      setEditStartTime(entry.startTime);
      setEditEndTime(entry.endTime);
    },
    [isTaskBusy]
  );

  // 任务进入处理中时，强制退出编辑（不落盘，避免与流水线冲突）
  useEffect(() => {
    if (isTaskBusy && editingId !== null) {
      clearDraft();
    }
  }, [isTaskBusy, editingId, clearDraft]);

  const onSaveEdit = useCallback(() => {
    const { id, text, translation, startTime, endTime } = draftRef.current;
    if (id === null || !fileId) return;
    if (isTaskBusy) {
      clearDraft();
      return;
    }

    // 编辑以正式 entries 为准，避免流式 overlay 污染落盘
    const original = fileEntries.find((e) => e.id === id);
    if (!original) {
      clearDraft();
      return;
    }

    // 时间可宽松输入；解析失败则保留原值，避免脏数据写进 SRT
    const nextStart = normalizeSrtTime(startTime) ?? original.startTime;
    const nextEnd = normalizeSrtTime(endTime) ?? original.endTime;

    const unchanged =
      original.text === text &&
      (original.translatedText || '') === translation &&
      original.startTime === nextStart &&
      original.endTime === nextEnd;

    if (unchanged) {
      clearDraft();
      return;
    }

    try {
      // 与 filesStore 计数语义对齐：有译文 → completed，清空 → pending
      const nextStatus = translation.trim() ? 'completed' : 'pending';
      updateEntry(fileId, id, text, translation, nextStatus, nextStart, nextEnd);
      clearDraft();
    } catch (error) {
      handleError(error, {
        context: { operation: '保存字幕编辑' }
      });
    }
  }, [fileId, fileEntries, updateEntry, handleError, clearDraft, isTaskBusy]);

  const onCancelEdit = useCallback(() => {
    clearDraft();
  }, [clearDraft]);

  // 过滤条件变化导致当前编辑行被隐藏时，先保存草稿
  useEffect(() => {
    if (editingId !== null && !filteredEntries.some((e) => e.id === editingId)) {
      onSaveEdit();
    }
  }, [filteredEntries, editingId, onSaveEdit]);

  // 进度：已 completed + overlay 中「尚未 completed」的行（避免 store 已落库仍占 soft 导致 3 已译只见 2 条）
  const completedEntryIds = useMemo(() => {
    const set = new Set<number>();
    for (const e of fileEntries) {
      if (e.translationStatus === 'completed' && e.translatedText?.trim()) {
        set.add(e.id);
      }
    }
    return set;
  }, [fileEntries]);
  const streamingLineCount = useMemo(() => {
    if (!streamingOverlay) return 0;
    let n = 0;
    for (const key of Object.keys(streamingOverlay)) {
      const text = streamingOverlay[Number(key)] ?? streamingOverlay[key as unknown as number];
      if (!text) continue;
      const id = Number(key);
      if (completedEntryIds.has(id)) continue;
      n += 1;
    }
    return n;
  }, [streamingOverlay, completedEntryIds]);
  const translationStats = useMemo(() => {
    const total = file?.entryCount ?? 0;
    const hard = file?.translatedCount ?? 0;
    const { translated, percentage } = calcDisplayTranslationProgress(
      hard,
      total,
      streamingLineCount
    );
    return {
      total,
      translated,
      untranslated: Math.max(0, total - translated),
      percentage,
    };
  }, [file?.entryCount, file?.translatedCount, streamingLineCount]);

  const langStrip = useMemo(() => {
    const src = langLabel(config.sourceLanguage);
    const dst = langLabel(config.targetLanguage);
    return `${src} → ${dst}`;
  }, [config.sourceLanguage, config.targetLanguage]);

  const hasSearchOrFilter = Boolean(searchTerm) || filterType !== 'all';
  const matchCountLabel = formatMatchCount(filteredEntries.length, hasSearchOrFilter);

  const handleOpenLanguageSettings = useCallback(() => {
    openSettings();
  }, [openSettings]);

  const handleSwapLanguages = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      const next = swapLanguages(config.sourceLanguage, config.targetLanguage);
      void updateConfig(next);
    },
    [config.sourceLanguage, config.targetLanguage, updateConfig]
  );

  if (variant === 'modal' && !isOpen) {
    return null;
  }

  const editorBody = (
    <div className={variant === 'panel' ? 'wb-editor' : 'flex flex-col flex-1 min-h-0'}>
      <div className={variant === 'panel' ? 'wb-editor-toolbar' : 'flex items-center justify-between px-5 py-3 border-b flex-shrink-0'}>
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          <div
            className="w-8 h-8 rounded-[8px] flex items-center justify-center flex-shrink-0"
            style={{ background: 'var(--apple-blue-soft)', color: 'var(--apple-blue)' }}
          >
            <FileText className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="font-semibold text-[15px] truncate" title={file?.name || '未知文件'}>
              {file?.name || '未知文件'}
            </div>
            <div className="text-[13px] text-[var(--wb-text-3)] flex flex-wrap gap-x-2 gap-y-0.5 items-center">
              <button
                type="button"
                className="se-lang-strip"
                onClick={handleOpenLanguageSettings}
                title="打开设置修改语言"
                data-testid="editor-lang-strip"
              >
                {langStrip}
              </button>
              <button
                type="button"
                className="se-lang-swap"
                onClick={handleSwapLanguages}
                title="交换源语言与目标语言"
                aria-label="交换语言"
                data-testid="editor-lang-swap"
              >
                ⇄
              </button>
              <span>·</span>
              <span>{translationStats.total} 条</span>
              <span>·</span>
              <span>
                {translationStats.translated}/{translationStats.total} 已译 · {translationStats.percentage}%
              </span>
              {agentUiVisible && agentRun ? (
                <>
                  <span className="hidden sm:inline">·</span>
                  <AgentProcessControl status={agentRun} visible />
                </>
              ) : null}
            </div>
          </div>
        </div>
        {onClose && variant === 'modal' && (
          <button
            type="button"
            onClick={onClose}
            className="p-2 hover:bg-[var(--wb-panel-2)] rounded-full flex-shrink-0"
            aria-label="关闭"
          >
            <X className="h-5 w-5 text-[var(--wb-text-2)]" />
          </button>
        )}
      </div>

      <div className={variant === 'panel' ? 'wb-editor-body se-editor-body' : 'px-4 py-3 flex flex-col flex-1 min-h-0'}>
        <div className="se-toolbar flex-shrink-0">
          <div className="se-toolbar-progress">
            <div className="se-progress-track">
              <div
                className="se-progress-fill"
                style={{ width: `${translationStats.percentage}%` }}
              />
            </div>
            <span className="se-progress-label tabular-nums">
              {translationStats.percentage}%
            </span>
          </div>
          <div className="se-toolbar-filters">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--wb-text-3)]" />
              <input
                type="text"
                placeholder="搜索原文 / 译文…"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className="se-search-input"
              />
            </div>
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value as 'all' | 'translated' | 'untranslated')}
              className="se-filter-select"
            >
              <option value="all">全部</option>
              <option value="translated">已翻译</option>
              <option value="untranslated">未翻译</option>
            </select>
            {matchCountLabel && (
              <span className="se-match-count" data-testid="editor-match-count">
                {matchCountLabel}
              </span>
            )}
          </div>
        </div>

        <div className="se-table flex-1 min-h-0 flex flex-col">
          <div className="se-colhead" aria-hidden>
            <div className="se-colhead-idx">#</div>
            <div className="se-colhead-time">开始</div>
            <div className="se-colhead-time">结束</div>
            <div className="se-colhead-src">原文</div>
            <div className="se-colhead-dst">译文</div>
          </div>
          <div
            ref={parentRef}
            className="se-list flex-1 overflow-auto min-h-0"
            /* layout+style：避免 size/paint containment 在可变高 measure 前裁切行 */
            style={{ contain: 'layout style' }}
          >
            <div
              style={{
                height: `${virtualizer.getTotalSize()}px`,
                width: '100%',
                position: 'relative',
              }}
            >
              {virtualizer.getVirtualItems().map((vItem) => {
                const entry = filteredEntries[vItem.index];
                // 处理中不允许进入/停留编辑态
                if (!isTaskBusy && editingId === entry.id) {
                  return (
                    <SubtitleEditingRow
                      key={entry.id}
                      ref={virtualizer.measureElement}
                      entry={entry}
                      index={vItem.index}
                      start={vItem.start}
                      editText={editText}
                      editTranslation={editTranslation}
                      editStartTime={editStartTime}
                      editEndTime={editEndTime}
                      focusField={focusField}
                      onSaveEdit={onSaveEdit}
                      onCancelEdit={onCancelEdit}
                      setEditText={setEditText}
                      setEditTranslation={setEditTranslation}
                      setEditStartTime={setEditStartTime}
                      setEditEndTime={setEditEndTime}
                    />
                  );
                }
                return (
                  <SubtitleDisplayRow
                    key={entry.id}
                    ref={virtualizer.measureElement}
                    entry={entry}
                    index={vItem.index}
                    start={vItem.start}
                    onStartEdit={onStartEdit}
                    showStreamCaret={entry.id === streamCaretEntryId}
                    readOnly={isTaskBusy}
                  />
                );
              })}
            </div>

            {filteredEntries.length === 0 && (
              <div className="text-center py-10 text-[var(--wb-text-3)] text-sm">
                {searchTerm || filterType !== 'all' ? '没有找到匹配的字幕' : '没有字幕数据'}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  if (variant === 'panel') {
    return editorBody;
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
      >
        <motion.div
          initial={{ scale: 0.92, y: 24, opacity: 0 }}
          animate={{ scale: 1, y: 0, opacity: 1 }}
          exit={{ scale: 0.95, y: 8, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 280, damping: 28 }}
          className="relative bg-[var(--wb-panel)] shadow-2xl rounded-2xl overflow-hidden flex flex-col"
          style={{
            width: 'min(90vw, 1100px)',
            height: 'min(88vh, 760px)',
          }}
        >
          {editorBody}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};
