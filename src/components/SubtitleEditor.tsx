import React, { useState, useCallback, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Save, X, Search, FileText } from 'lucide-react';
import toast from 'react-hot-toast';
import { useShallow } from 'zustand/react/shallow';
import { SubtitleEntry } from '@/types';
import { useErrorHandler } from '@/hooks/useErrorHandler';
import { useFilesStore, useFile } from '@/stores/filesStore';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';

const EMPTY_ENTRIES: SubtitleEntry[] = [];

interface SubtitleEditorProps {
  isOpen: boolean;
  onClose: () => void;
  fileId: string;
}

export const SubtitleEditor: React.FC<SubtitleEditorProps> = ({
  isOpen,
  onClose,
  fileId
}) => {
  const file = useFile(fileId);
  const updateEntry = useFilesStore((state) => state.updateEntry);
  const deleteEntry = useFilesStore((state) => state.deleteEntry);

  const taskId = file?.taskId;
  // 用 useShallow 按条目 id+内容做浅比较：翻译回填只改单条 translatedText 时，
  // 若数组引用变化但各条目引用相同，不会触发下游重渲染。
  const fileEntries = useFilesStore(
    useShallow((state) => {
      if (!taskId) return EMPTY_ENTRIES;
      const task = state.tasks.find((t) => t.taskId === taskId);
      return task?.subtitle_entries ?? EMPTY_ENTRIES;
    }),
  );

  const { handleError } = useErrorHandler();

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editText, setEditText] = useState('');
  const [editTranslation, setEditTranslation] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const searchTerm = useDebouncedValue(searchInput, 300);
  const [filterType, setFilterType] = useState<'all' | 'translated' | 'untranslated'>('all');

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
    estimateSize: () => 80,
    overscan: 8,
  });

  const onStartEdit = useCallback((entry: SubtitleEntry) => {
    setEditingId(entry.id);
    setEditText(entry.text);
    setEditTranslation(entry.translatedText || '');
  }, []);

  const onSaveEdit = useCallback(() => {
    if (editingId === null || !file?.id) return;

    try {
      updateEntry(file.id, editingId, editText, editTranslation);
      setEditingId(null);
      setEditText('');
      setEditTranslation('');
      toast.success('保存成功');
    } catch (error) {
      handleError(error, {
        context: { operation: '保存字幕编辑' }
      });
    }
  }, [editingId, editText, editTranslation, updateEntry, handleError, file]);

  const onCancelEdit = useCallback(() => {
    setEditingId(null);
    setEditText('');
    setEditTranslation('');
  }, []);

  const handleMerge = useCallback(() => {
    if (!file?.id || !fileEntries.length) return;

    const toMerge: Array<{current: SubtitleEntry, next: SubtitleEntry}> = [];

    for (let i = 0; i < fileEntries.length - 1; i++) {
      const current = fileEntries[i];
      const next = fileEntries[i + 1];

      if (current.translatedText && !next.translatedText) {
        toMerge.push({ current, next });
      }
    }

    for (const { current, next } of toMerge) {
      const mergedText = `${current.text} ${next.text}`;
      updateEntry(file.id, current.id, mergedText, current.translatedText, 'completed');
      deleteEntry(file.id, next.id);
    }

  }, [file, fileEntries, updateEntry, deleteEntry]);

  const translationStats = useMemo(() => {
    const total = file?.entryCount ?? fileEntries.length;
    const translated = file?.translatedCount ?? fileEntries.filter((e) => e.translatedText).length;
    return {
      total,
      translated,
      untranslated: total - translated,
      percentage: total > 0 ? Math.round((translated / total) * 100) : 0,
    };
  }, [file?.entryCount, file?.translatedCount, fileEntries]);

  if (!isOpen) {
    return null;
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
        className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
      >
        <motion.div
          initial={{ scale: 0.92, y: 24, opacity: 0 }}
          animate={{ scale: 1, y: 0, opacity: 1 }}
          exit={{ scale: 0.95, y: 8, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 280, damping: 28 }}
          className="relative bg-white shadow-2xl rounded-none md:rounded-2xl overflow-hidden flex flex-col"
          style={{
            width: 'min(90vw, 1100px)',
            height: 'min(88vh, 760px)',
          }}
        >
          {/* Header - 精简单行 */}
          <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 flex-shrink-0">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <FileText className="h-4 w-4 text-indigo-500 flex-shrink-0" />
              <span className="font-medium text-gray-900 truncate" title={file?.name || '未知文件'}>
                {file?.name || '未知文件'}
              </span>
              <span className="text-sm text-gray-400 flex-shrink-0">
                · {translationStats.total} 条 · {translationStats.translated}/{translationStats.total} 已翻译 · {translationStats.percentage}%
              </span>
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-gray-100 rounded-full transition-colors flex-shrink-0"
            >
              <X className="h-5 w-5 text-gray-500" />
            </button>
          </div>

          {/* Content */}
          <div className="px-5 py-3 overflow-hidden flex flex-col flex-1 min-h-0">
            <div className="space-y-3 flex flex-col flex-1 min-h-0">
              {/* Control Bar - 单行紧凑 */}
              <div className="flex items-center justify-between gap-3 flex-shrink-0">
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleMerge}
                    className="apple-button apple-button-secondary text-sm"
                    title="合并空字幕"
                  >
                    合并空字幕
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  {/* Search */}
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                    <input
                      type="text"
                      placeholder="搜索..."
                      value={searchInput}
                      onChange={(e) => setSearchInput(e.target.value)}
                      className="pl-9 pr-3 py-1.5 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all w-40"
                    />
                  </div>

                  {/* Filter */}
                  <select
                    value={filterType}
                    onChange={(e) => setFilterType(e.target.value as 'all' | 'translated' | 'untranslated')}
                    className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-gray-700 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all"
                  >
                    <option value="all">全部</option>
                    <option value="translated">已翻译</option>
                    <option value="untranslated">未翻译</option>
                  </select>
                </div>
              </div>

              {/* 进度条 - 紧凑 */}
              <div className="flex items-center gap-3 flex-shrink-0">
                <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-emerald-500 transition-all"
                    style={{ width: `${translationStats.percentage}%` }}
                  />
                </div>
              </div>

              {/* Subtitle List - 虚拟化 */}
              <div
                ref={parentRef}
                className="flex-1 overflow-auto border border-gray-200 rounded-xl"
                style={{ minHeight: '40vh', contain: 'size' }}
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
                    const isEditing = editingId === entry.id;
                    return (
                      <div
                        key={entry.id}
                        data-index={vItem.index}
                        style={{
                          position: 'absolute',
                          top: 0,
                          left: 0,
                          width: '100%',
                          transform: `translateY(${vItem.start}px)`,
                        }}
                        className={`p-3 border-b cursor-pointer transition-colors overflow-hidden ${
                          isEditing ? 'bg-blue-50 border-blue-300' : 'hover:bg-gray-50 border-gray-100'
                        }`}
                        onClick={() => {
                          if (!isEditing) onStartEdit(entry);
                        }}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <div className="text-xs text-gray-500">
                            #{vItem.index + 1} | {entry.startTime} {'-->'} {entry.endTime}
                          </div>
                        </div>
                        {isEditing ? (
                          <div className="space-y-2" onClick={(e) => e.stopPropagation()}>
                            <textarea
                              value={editText}
                              onChange={(e) => setEditText(e.target.value)}
                              className="w-full p-2 bg-white border border-gray-200 rounded text-sm text-gray-900 resize-none focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/20"
                              rows={2}
                              placeholder="原文"
                              autoFocus
                            />
                            <textarea
                              value={editTranslation}
                              onChange={(e) => setEditTranslation(e.target.value)}
                              className="w-full p-2 bg-white border border-gray-200 rounded text-sm text-gray-900 resize-none focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/20"
                              rows={2}
                              placeholder="译文（输入后点保存）"
                            />
                            <div className="flex items-center gap-2">
                              <button
                                onClick={onSaveEdit}
                                className="px-3 py-1 bg-emerald-500 hover:bg-emerald-600 text-white text-sm rounded transition-colors flex items-center gap-1"
                              >
                                <Save className="h-3 w-3" />
                                <span>保存</span>
                              </button>
                              <button
                                onClick={onCancelEdit}
                                className="px-3 py-1 text-gray-500 hover:bg-gray-200 text-sm rounded transition-colors flex items-center gap-1"
                              >
                                <X className="h-3 w-3" />
                                <span>取消</span>
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="space-y-0.5">
                            <div className="text-sm text-gray-900">{entry.text}</div>
                            <div className={`text-sm ${entry.translatedText ? 'text-blue-600' : 'text-gray-400 italic'}`}>
                              {entry.translatedText || '未翻译（点击编辑）'}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {filteredEntries.length === 0 && (
                  <div className="text-center py-8 text-gray-500">
                    {searchTerm || filterType !== 'all' ? '没有找到匹配的字幕' : '没有字幕数据'}
                  </div>
                )}
              </div>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};
