import React, { useState, useCallback } from 'react';
import { useHistoryStore } from '@/stores/historyStore';
import { calculateHistoryStats, findHistoryEntry } from '@/utils/historyHelpers';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  Trash2,
  Calendar,
  FileText,
  BarChart3,
  Search,
  Download
} from 'lucide-react';
import toast from 'react-hot-toast';
import { exportTaskZip, getBaseName } from '@/services/SubtitleExporter';
import { downloadZipFile } from '@/utils/fileExport';
import { TranslationHistoryEntry } from '@/types';
import { ConfirmDialog } from './ConfirmDialog';
import { useErrorHandler } from '@/hooks/useErrorHandler';
import { CountUp } from './motion/CountUp';

interface HistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const HistoryModal: React.FC<HistoryModalProps> = ({ isOpen, onClose }) => {
  const history = useHistoryStore((state) => state.history);
  const deleteHistory = useHistoryStore((state) => state.removeHistory);
  const clearHistory = useHistoryStore((state) => state.clearHistory);

  const { handleError } = useErrorHandler();

  const [searchTerm, setSearchTerm] = useState('');
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deletingTaskId, setDeletingTaskId] = useState<string | null>(null);

  const stats = calculateHistoryStats(history);

  const filteredHistory = React.useMemo(() => {
    if (!searchTerm) return history;

    const term = searchTerm.toLowerCase();
    return history.filter(entry =>
      entry.filename.toLowerCase().includes(term)
    );
  }, [history, searchTerm]);

  const onDelete = useCallback(async (taskId: string) => {
    const entry = findHistoryEntry(history, taskId);
    if (!entry) return;

    setDeletingTaskId(taskId);
    setShowDeleteConfirm(true);
  }, [history]);

  const handleConfirmDelete = useCallback(async () => {
    if (!deletingTaskId) return;

    try {
      await deleteHistory(deletingTaskId);
      toast.success('历史记录已删除');
    } catch (error) {
      handleError(error, {
        context: { operation: '删除历史记录' }
      });
    } finally {
      setShowDeleteConfirm(false);
      setDeletingTaskId(null);
    }
  }, [deleteHistory, deletingTaskId, handleError]);

  const onClear = useCallback(async () => {
    if (history.length === 0) return;
    setShowClearConfirm(true);
  }, [history.length]);

  const handleConfirmClear = useCallback(async () => {
    try {
      await clearHistory();
      toast.success('已清空所有历史记录');
    } catch (error) {
      handleError(error, {
        context: { operation: '清空历史记录' }
      });
    } finally {
      setShowClearConfirm(false);
    }
  }, [clearHistory, handleError]);

  const formatDate = useCallback((timestamp: number) => {
    return new Date(timestamp).toLocaleString('zh-CN');
  }, []);

  const onExport = useCallback(async (entry: TranslationHistoryEntry) => {
    try {
      const zipBlob = await exportTaskZip(entry.taskId);
      const zipName = `${getBaseName(entry.filename)}.zip`;
      downloadZipFile(zipBlob, zipName);
      toast.success('导出成功');
    } catch (error) {
      handleError(error, {
        context: { operation: '导出历史记录', fileName: entry.filename }
      });
    }
  }, [handleError]);

  if (!isOpen) return null;

  const deletingEntry = deletingTaskId
    ? findHistoryEntry(history, deletingTaskId)
    : null;

  return (
    <>
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 z-50"
        onClick={onClose}
      >
      <motion.div
        initial={{ scale: 0.92, y: 24, opacity: 0 }}
        animate={{ scale: 1, y: 0, opacity: 1 }}
        exit={{ scale: 0.95, y: 8, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 280, damping: 28 }}
        className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-4xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05, duration: 0.3 }}
          className="flex items-center justify-between mb-6"
        >
          <div className="flex items-center gap-3">
            <h2 className="apple-heading-medium">翻译历史</h2>
            <span className="px-2.5 py-1 bg-purple-100 text-purple-700 text-sm rounded-full font-medium">
              {history.length} 条记录
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-full transition-colors active:scale-95"
          >
            <X className="h-5 w-5 text-gray-500" />
          </button>
        </motion.div>

        {/* 统计信息 - 数字 CountUp */}
        <motion.div
          initial="hidden"
          animate="show"
          variants={{ hidden: {}, show: { transition: { staggerChildren: 0.08, delayChildren: 0.1 } } }}
          className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6"
        >
          {[
            { value: stats.total, color: 'text-gray-900', label: '总记录数' },
            { value: stats.totalTokens, color: 'text-blue-600', label: '总Token数' },
            { value: history.length > 0 ? Math.round(stats.totalTokens / stats.total) : 0, color: 'text-emerald-600', label: '平均Token' },
            { value: history.reduce((sum, entry) => sum + entry.completedCount, 0), color: 'text-purple-600', label: '总字幕数' },
          ].map((stat, i) => (
            <motion.div
              key={i}
              variants={{
                hidden: { opacity: 0, y: 12 },
                show: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 240, damping: 22 } },
              }}
              whileHover={{ y: -2, boxShadow: '0 6px 16px rgba(0,0,0,0.06)' }}
              className="bg-gray-50 rounded-xl p-4 text-center cursor-default"
            >
              <div className={`text-2xl font-bold ${stat.color}`}>
                <CountUp value={stat.value} duration={1.0} />
              </div>
              <div className="text-sm text-gray-600 mt-0.5">{stat.label}</div>
            </motion.div>
          ))}
        </motion.div>

        {/* 搜索和操作 */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2, duration: 0.3 }}
          className="flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-4 mb-6"
        >
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              type="text"
              placeholder="搜索历史记录..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10 pr-4 py-2 w-full bg-gray-50 border border-gray-200 rounded-lg text-gray-900 placeholder-gray-400 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all"
            />
          </div>

          <button
            onClick={onClear}
            disabled={history.length === 0}
            className="apple-button apple-button-ghost text-red-600 hover:bg-red-50 disabled:opacity-50 disabled:cursor-not-allowed active:scale-95"
          >
            <Trash2 className="h-4 w-4" />
            <span>清空历史</span>
          </button>
        </motion.div>

        {/* 历史记录列表 */}
        <div className="space-y-3">
          <AnimatePresence>
            {filteredHistory.length === 0 ? (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="text-center py-12 text-gray-500"
              >
                {searchTerm ? '没有找到匹配的记录' : '暂无历史记录'}
              </motion.div>
            ) : (
              filteredHistory.map((entry, idx) => (
                <motion.div
                  key={entry.taskId}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0, transition: { delay: 0.25 + idx * 0.04 } }}
                  exit={{ opacity: 0, y: -10, transition: { duration: 0.2 } }}
                  whileHover={{ y: -2, boxShadow: '0 6px 16px rgba(0,0,0,0.05)' }}
                  className="border border-gray-200 rounded-xl p-4 bg-gray-50"
                >
                  <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                    <div className="flex-1 space-y-2">
                      {/* 文件名 */}
                      <div className="flex items-center gap-3">
                        <FileText className="h-5 w-5 text-blue-500 flex-shrink-0" />
                        <span className="text-gray-900 font-medium truncate max-w-[200px] sm:max-w-[300px]" title={entry.filename}>
                          {entry.filename}
                        </span>
                        <span className="px-2 py-1 text-xs rounded-full text-emerald-700 bg-emerald-100 flex-shrink-0">
                          已完成
                        </span>
                      </div>

                      {/* 统计信息 */}
                      <div className="flex flex-wrap items-center text-sm text-gray-600 gap-4">
                        <div className="flex items-center gap-1">
                          <BarChart3 className="h-3 w-3" />
                          <span>{entry.completedCount} 条字幕</span>
                        </div>
                        <span>{entry.totalTokens.toLocaleString()} tokens</span>
                      </div>

                      {/* 完成时间 */}
                      <div className="flex items-center text-sm text-gray-500 gap-1">
                        <Calendar className="h-3 w-3" />
                        <span>完成时间: {formatDate(entry.timestamp)}</span>
                      </div>
                    </div>

                    {/* 操作按钮 */}
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => onExport(entry)}
                        disabled={!entry.subtitle_entries?.length}
                        className="apple-button apple-button-secondary text-sm disabled:opacity-50 disabled:cursor-not-allowed active:scale-95"
                      >
                        <Download className="h-3 w-3" />
                        <span>导出</span>
                      </button>

                      <button
                        onClick={() => onDelete(entry.taskId)}
                        className="apple-button apple-button-ghost text-red-600 hover:bg-red-50 text-sm active:scale-95"
                      >
                        <Trash2 className="h-3 w-3" />
                        <span>删除</span>
                      </button>
                    </div>
                  </div>
                </motion.div>
              ))
            )}
          </AnimatePresence>
        </div>
      </motion.div>
      </motion.div>
    </AnimatePresence>

      {/* 清空历史确认对话框 */}
      <ConfirmDialog
        isOpen={showClearConfirm}
        onClose={() => setShowClearConfirm(false)}
        onConfirm={handleConfirmClear}
        title="确认清空"
        message={`确定要清空所有 ${history.length} 条历史记录吗？此操作不可恢复。`}
        confirmText="确认清空"
        confirmButtonClass="bg-red-500 hover:bg-red-600 text-white"
      />

      {/* 删除历史记录确认对话框 */}
      <ConfirmDialog
        isOpen={showDeleteConfirm}
        onClose={() => {
          setShowDeleteConfirm(false);
          setDeletingTaskId(null);
        }}
        onConfirm={handleConfirmDelete}
        title="确认删除"
        message={deletingEntry ? `确定要删除历史记录 "${deletingEntry.filename}" 吗？此操作不可恢复。` : ''}
        confirmText="确认删除"
        confirmButtonClass="bg-red-500 hover:bg-red-600 text-white"
      />
    </>
  );
};
