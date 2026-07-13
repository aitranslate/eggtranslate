import React, { useState, useCallback, useMemo, useRef, memo, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Search, FileText, X } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { SubtitleEntry } from '@/types';
import { useErrorHandler } from '@/hooks/useErrorHandler';
import { useFilesStore, useFile } from '@/stores/filesStore';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useTranslationConfig } from '@/stores/translationConfigStore';
import { LANGUAGE_OPTIONS } from '@/constants/languages';
import { normalizeSrtTime } from '@/utils/timeUtils';
import { getBilingualDisplayLines } from '@/utils/srtParser';
import { generateStableFileId } from '@/utils/taskIdGenerator';

const EMPTY_ENTRIES: SubtitleEntry[] = [];
/** 五列平铺；原文/译文可显示 SRT 内建换行（约 2 行） */
const ROW_HEIGHT = 68;

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

/** 只读行：序号 | 开始 | 结束 | 原文 | 译文 */
export const SubtitleDisplayRow = memo<DisplayRowProps>(({ entry, index, start, onStartEdit }) => {
  return (
    <div
      data-index={index}
      data-testid={`subtitle-row-${entry.id}`}
      data-editing="false"
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: ROW_HEIGHT,
        transform: `translateY(${start}px)`,
      }}
      className="se-row"
      onClick={() => onStartEdit(entry, 'translation')}
    >
      <div className="se-row-idx">#{index + 1}</div>
      <button
        type="button"
        className="se-row-time"
        title="编辑开始时间"
        onClick={(e) => {
          e.stopPropagation();
          onStartEdit(entry, 'startTime');
        }}
      >
        {entry.startTime}
      </button>
      <button
        type="button"
        className="se-row-time"
        title="编辑结束时间"
        onClick={(e) => {
          e.stopPropagation();
          onStartEdit(entry, 'endTime');
        }}
      >
        {entry.endTime}
      </button>
      <div
        className="se-row-src"
        title={entry.text}
        onClick={(e) => {
          e.stopPropagation();
          onStartEdit(entry, 'text');
        }}
      >
        <MultiLineText text={entry.text} emptyLabel="（空原文）" />
      </div>
      <div
        className={`se-row-dst ${entry.translatedText ? '' : 'empty'}`}
        title={entry.translatedText || undefined}
        onClick={(e) => {
          e.stopPropagation();
          onStartEdit(entry, 'translation');
        }}
      >
        <MultiLineText text={entry.translatedText || ''} emptyLabel="点击编辑译文" />
      </div>
    </div>
  );
});
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
 * 行内编辑：与只读行同一五列布局。
 * Enter 保存 · Esc 取消 · 失焦保存
 */
export const SubtitleEditingRow = memo<EditingRowProps>(({
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
}) => {
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
      data-index={index}
      data-testid={`subtitle-row-${entry.id}`}
      data-editing="true"
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: ROW_HEIGHT,
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
});
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
  const file = useFile(fileId);
  const updateEntry = useFilesStore((state) => state.updateEntry);
  const config = useTranslationConfig();

  const taskId = file?.taskId;
  const fileEntries = useFilesStore(
    useShallow((state) => {
      if (!taskId) return EMPTY_ENTRIES;
      const task = state.tasks.find((t) => t.taskId === taskId);
      return task?.subtitle_entries ?? EMPTY_ENTRIES;
    }),
  );

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
            updateEntry(draft.fileId!, draft.id, draft.text, draft.translation, undefined, nextStart, nextEnd);
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
    let filtered = fileEntries || [];

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
  }, [fileEntries, filterType, searchTerm]);

  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: filteredEntries.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
  });

  const clearDraft = useCallback(() => {
    setEditingId(null);
    setEditText('');
    setEditTranslation('');
    setEditStartTime('');
    setEditEndTime('');
  }, []);

  const onStartEdit = useCallback((entry: SubtitleEntry, field: FocusField = 'translation') => {
    setEditingId(entry.id);
    setFocusField(field);
    setEditText(entry.text);
    setEditTranslation(entry.translatedText || '');
    setEditStartTime(entry.startTime);
    setEditEndTime(entry.endTime);
  }, []);

  const onSaveEdit = useCallback(() => {
    const { id, text, translation, startTime, endTime } = draftRef.current;
    if (id === null || !fileId) return;

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
      updateEntry(fileId, id, text, translation, undefined, nextStart, nextEnd);
      clearDraft();
    } catch (error) {
      handleError(error, {
        context: { operation: '保存字幕编辑' }
      });
    }
  }, [fileId, fileEntries, updateEntry, handleError, clearDraft]);

  const onCancelEdit = useCallback(() => {
    clearDraft();
  }, [clearDraft]);

  // 过滤条件变化导致当前编辑行被隐藏时，先保存草稿
  useEffect(() => {
    if (editingId !== null && !filteredEntries.some((e) => e.id === editingId)) {
      onSaveEdit();
    }
  }, [filteredEntries, editingId, onSaveEdit]);

  const translationStats = useMemo(() => {
    const total = file?.entryCount ?? 0;
    const translated = file?.translatedCount ?? 0;
    return {
      total,
      translated,
      untranslated: total - translated,
      percentage: total > 0 ? Math.round((translated / total) * 100) : 0,
    };
  }, [file?.entryCount, file?.translatedCount]);

  const langStrip = useMemo(() => {
    const src = langLabel(config.sourceLanguage);
    const dst = langLabel(config.targetLanguage);
    return `${src} → ${dst}`;
  }, [config.sourceLanguage, config.targetLanguage]);

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
            <div className="text-[13px] text-[var(--wb-text-3)] flex flex-wrap gap-x-2 gap-y-0.5">
              <span>{langStrip}</span>
              <span>·</span>
              <span>{translationStats.total} 条</span>
              <span>·</span>
              <span>
                {translationStats.translated}/{translationStats.total} 已译 · {translationStats.percentage}%
              </span>
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
            style={{ contain: 'strict' }}
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
                if (editingId === entry.id) {
                  return (
                    <SubtitleEditingRow
                      key={entry.id}
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
                    entry={entry}
                    index={vItem.index}
                    start={vItem.start}
                    onStartEdit={onStartEdit}
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
