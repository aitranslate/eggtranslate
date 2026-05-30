import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Edit3, Save, X, Search, Filter, FileText } from 'lucide-react';
import toast from 'react-hot-toast';
import { SubtitleFile, SubtitleEntry } from '@/types';
import { useErrorHandler } from '@/hooks/useErrorHandler';
import { useSubtitleStore } from '@/stores/subtitleStore';

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
  const file = useSubtitleStore((state) => state.getFile(fileId));
  // 订阅 entriesVersion：当 entries 数据变更时触发重新读取
  const entriesVersion = useSubtitleStore((state) => state.getFile(fileId)?.entriesVersion ?? 0);
  const getFileEntries = useSubtitleStore((state) => state.getFileEntries);
  const updateEntry = useSubtitleStore((state) => state.updateEntry);
  const deleteEntry = useSubtitleStore((state) => state.deleteEntry);

  // Handle async entries loading
  const [entries, setEntries] = useState<SubtitleEntry[]>([]);

  useEffect(() => {
    let cancelled = false;
    getFileEntries(fileId).then(loadedEntries => {
      if (!cancelled) {
        setEntries(loadedEntries);
      }
    });
    return () => { cancelled = true; };
  }, [fileId, getFileEntries, entriesVersion]);

  const { handleError } = useErrorHandler();

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editText, setEditText] = useState('');
  const [editTranslation, setEditTranslation] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'translated' | 'untranslated'>('all');

  const fileEntries = useMemo(() => {
    return entries || [];
  }, [entries, entriesVersion]);

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

  const onStartEdit = useCallback((entry: SubtitleEntry) => {
    setEditingId(entry.id);
    setEditText(entry.text);
    setEditTranslation(entry.translatedText || '');
  }, []);

  const onSaveEdit = useCallback(async () => {
    if (editingId === null || !file?.id) return;

    try {
      await updateEntry(file.id, editingId, editText, editTranslation);
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

  const handleMerge = useCallback(async () => {
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
      await updateEntry(file.id, current.id, mergedText, current.translatedText, 'completed');
      await deleteEntry(file.id, next.id);
    }

    if (toMerge.length > 0) {
      const updateFileStatistics = useSubtitleStore.getState().updateFileStatistics;
      updateFileStatistics(file.id);
    }
  }, [file, fileEntries, updateEntry, deleteEntry]);

  const translationStats = useMemo(() => {
    const entriesArray = fileEntries || [];
    const translated = entriesArray.filter((entry) => entry.translatedText).length;
    return {
      total: entriesArray.length,
      translated,
      untranslated: entriesArray.length - translated,
      percentage: entriesArray.length > 0 ? Math.round((translated / entriesArray.length) * 100) : 0
    };
  }, [fileEntries]);

  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="relative max-w-4xl w-full max-h-[90vh] bg-white rounded-2xl shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
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
        <div className="p-6 overflow-y-auto max-h-[calc(90vh-88px)]">
          <div className="space-y-4">
            {/* Control Bar */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
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
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
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
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 p-4 bg-gray-50 rounded-xl">
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

            {/* Subtitle List */}
            <div className="space-y-3">
              <AnimatePresence>
                {filteredEntries.map((entry, index) => (
                  <motion.div
                    key={entry.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="border border-gray-200 rounded-xl p-4 bg-gray-50 hover:bg-gray-100 transition-colors"
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div className="text-sm text-gray-500">
                        #{index + 1} | {entry.startTime} {'-->'} {entry.endTime}
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

                    {editingId === entry.id ? (
                      <div className="space-y-3">
                        {/* Original Text */}
                        <div>
                          <label className="block text-sm text-gray-700 mb-1">原文</label>
                          <textarea
                            value={editText}
                            onChange={(e) => setEditText(e.target.value)}
                            className="w-full p-3 bg-white border border-gray-200 rounded-lg text-gray-900 resize-none focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all"
                            rows={2}
                          />
                        </div>

                        {/* Translation */}
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

                        {/* Action Buttons */}
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
                    ) : (
                      <div className="space-y-2">
                        <div className="text-gray-900">{entry.text}</div>
                        <div className={`${entry.translatedText ? 'text-blue-600' : 'text-gray-400 italic'}`}>
                          {entry.translatedText || '未翻译'}
                        </div>
                      </div>
                    )}
                  </motion.div>
                ))}
              </AnimatePresence>

              {filteredEntries.length === 0 && (
                <div className="text-center py-8 text-gray-500">
                  {searchTerm || filterType !== 'all' ? '没有找到匹配的字幕' : '没有字幕数据'}
                </div>
              )}
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
};
