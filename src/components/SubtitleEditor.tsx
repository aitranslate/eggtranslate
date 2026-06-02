import React, { useState, useCallback, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Edit3, Save, X, Search, FileText } from 'lucide-react';
import toast from 'react-hot-toast';
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
  const fileEntries = useFilesStore((state) => {
    if (!taskId) return EMPTY_ENTRIES;
    const task = state.tasks.find((t) => t.taskId === taskId);
    return task?.subtitle_entries ?? EMPTY_ENTRIES;
  });

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
    estimateSize: () => 120,
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

  const editingEntry = useMemo(
    () => editingId === null ? null : fileEntries.find((e) => e.id === editingId) ?? null,
    [editingId, fileEntries]
  );

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
          className="relative bg-white shadow-2xl w-full max-w-[calc(100vw-2rem)] md:max-w-[560px] lg:max-w-[680px] rounded-none md:rounded-2xl max-h-[100dvh] md:max-h-[90vh] overflow-hidden flex flex-col"
        >
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-gray-200 flex-shrink-0">
            <div className="flex items-center gap-3 min-w-0 flex-1">
              <div className="w-10 h-10 rounded-full bg-indigo-500 flex items-center justify-center flex-shrink-0">
                <FileText className="h-5 w-5 text-white" />
              </div>
              <div className="min-w-0 max-w-[calc(100%-100px)]">
                <h3 className="apple-heading-small truncate" title={file?.name || '未知文件'}>
                  字幕编辑器 - {file?.name || '未知文件'}
                </h3>
                <div className="text-sm text-gray-500">
                  {translationStats.total} 条字幕
                </div>
              </div>
            </div>

            <button
              onClick={onClose}
              className="p-2 hover:bg-gray-100 rounded-full transition-colors flex-shrink-0"
            >
              <X className="h-5 w-5 text-gray-500" />
            </button>
          </div>

          {/* Content */}
          <div className="p-6 overflow-hidden flex flex-col flex-1 min-h-0">
            <div className="space-y-4 flex flex-col flex-1 min-h-0">
              {/* Control Bar */}
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 flex-shrink-0">
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleMerge}
                    className="apple-button apple-button-secondary text-sm"
                    title="合并空字幕"
                  >
                    合并空字幕
                  </button>
                </div>

                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                  {/* Search */}
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                    <input
                      type="text"
                      placeholder="搜索字幕..."
                      value={searchInput}
                      onChange={(e) => setSearchInput(e.target.value)}
                      className="pl-10 pr-4 py-2 bg-gray-50 border border-gray-200 rounded-lg text-gray-900 placeholder-gray-400 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all"
                    />
                  </div>

                  {/* Filter */}
                  <select
                    value={filterType}
                    onChange={(e) => setFilterType(e.target.value as 'all' | 'translated' | 'untranslated')}
                    className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-2 text-gray-700 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all"
                  >
                    <option value="all">全部</option>
                    <option value="translated">已翻译</option>
                    <option value="untranslated">未翻译</option>
                  </select>
                </div>
              </div>

              {/* Stats */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 p-4 bg-gray-50 rounded-xl flex-shrink-0">
                <div className="text-center">
                  <div className="text-xl font-bold text-gray-900">{translationStats.total}</div>
                  <div className="text-xs text-gray-600">总数</div>
                </div>
                <div className="text-center">
                  <div className="text-xl font-bold text-emerald-600">{translationStats.translated}</div>
                  <div className="text-xs text-gray-600">已翻译</div>
                </div>
                <div className="text-center">
                  <div className="text-xl font-bold text-orange-600">{translationStats.untranslated}</div>
                  <div className="text-xs text-gray-600">未翻译</div>
                </div>
                <div className="text-center">
                  <div className="text-xl font-bold text-blue-600">{translationStats.percentage}%</div>
                  <div className="text-xs text-gray-600">完成率</div>
                </div>
              </div>

              {/* Inline Edit Form (悬浮在列表之上，不被 virtualizer 卸载) */}
              {editingEntry && (
                <div className="border-2 border-blue-400 rounded-xl p-4 bg-blue-50 flex-shrink-0">
                  <div className="text-sm text-gray-500 mb-2">
                    #{filteredEntries.findIndex((e) => e.id === editingEntry.id) + 1 || ''} |
                    {' '}{editingEntry.startTime} {'-->'} {editingEntry.endTime}
                  </div>
                  <div className="space-y-3">
                    <div>
                      <label className="block text-sm text-gray-700 mb-1">原文</label>
                      <textarea
                        value={editText}
                        onChange={(e) => setEditText(e.target.value)}
                        className="w-full p-3 bg-white border border-gray-200 rounded-lg text-gray-900 resize-none focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all"
                        rows={2}
                      />
                    </div>
                    <div>
                      <label className="block text-sm text-gray-700 mb-1">译文</label>
                      <textarea
                        value={editTranslation}
                        onChange={(e) => setEditTranslation(e.target.value)}
                        placeholder="请输入翻译..."
                        className="w-full p-3 bg-white border border-gray-200 rounded-lg text-gray-900 resize-none focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all"
                        rows={2}
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={onSaveEdit}
                        className="apple-button bg-emerald-500 hover:bg-emerald-600 text-sm"
                      >
                        <Save className="h-3 w-3" />
                        <span>保存</span>
                      </button>
                      <button
                        onClick={onCancelEdit}
                        className="apple-button apple-button-ghost text-red-600 hover:bg-red-50 text-sm"
                      >
                        <X className="h-3 w-3" />
                        <span>取消</span>
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Subtitle List - 虚拟化 */}
              <div
                ref={parentRef}
                className="flex-1 min-h-0 overflow-auto border border-gray-200 rounded-xl"
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
                    const isEditing = editingId === entry.id;
                    return (
                      <div
                        key={entry.id}
                        data-index={vItem.index}
                        ref={virtualizer.measureElement}
                        style={{
                          position: 'absolute',
                          top: 0,
                          left: 0,
                          width: '100%',
                          transform: `translateY(${vItem.start}px)`,
                        }}
                        className={`p-4 border-b border-gray-100 ${
                          isEditing ? 'bg-blue-50 border-blue-300' : 'hover:bg-gray-50'
                        }`}
                      >
                        <div className="flex items-start justify-between mb-2">
                          <div className="text-sm text-gray-500">
                            #{vItem.index + 1} | {entry.startTime} {'-->'} {entry.endTime}
                          </div>
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => onStartEdit(entry)}
                              className="p-1 hover:bg-gray-200 rounded-lg transition-colors"
                              title="编辑"
                            >
                              <Edit3 className="h-4 w-4 text-gray-500" />
                            </button>
                          </div>
                        </div>
                        <div className="space-y-1">
                          <div className="text-gray-900">{entry.text}</div>
                          <div className={`${entry.translatedText ? 'text-blue-600' : 'text-gray-400 italic'}`}>
                            {entry.translatedText || '未翻译'}
                          </div>
                        </div>
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
