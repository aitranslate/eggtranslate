import React, { useState, useCallback } from 'react';
import { useHistoryStore } from '@/stores/historyStore';
import { calculateHistoryStats, findHistoryEntry } from '@/utils/historyHelpers';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Trash2,
  Calendar,
  FileText,
  BarChart3,
  Search
} from 'lucide-react';
import toast from 'react-hot-toast';
import { Button } from '@/components/ui';
import { getBaseName, exportEntries, buildEntriesZip } from '@/services/SubtitleExporter';
import { downloadZipFile, downloadSubtitleFile, type ExportFormat } from '@/utils/fileExport';
import { ExportButton } from '@/components/common/ExportButton';
import { TranslationHistoryEntry } from '@/types';
import { ConfirmDialog } from './ConfirmDialog';
import { useErrorHandler } from '@/hooks/useErrorHandler';
import { playAppSound } from '@/utils/appSound';
import { CountUp } from './motion/CountUp';

interface HistoryModalProps {
  isOpen?: boolean;
  onClose?: () => void;
  variant?: 'panel' | 'modal';
}

export const HistoryModal: React.FC<HistoryModalProps> = ({
  isOpen = true,
  onClose,
  variant = 'panel',
}) => {
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
    return history.filter(entry => entry.filename.toLowerCase().includes(term));
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
      playAppSound('delete');
      toast.success('历史记录已删除');
    } catch (error) {
      handleError(error, { context: { operation: '删除历史记录' } });
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
      playAppSound('delete');
      toast.success('已清空所有历史记录');
    } catch (error) {
      handleError(error, { context: { operation: '清空历史记录' } });
    } finally {
      setShowClearConfirm(false);
    }
  }, [clearHistory, handleError]);

  const formatDate = useCallback((timestamp: number) => {
    return new Date(timestamp).toLocaleString('zh-CN');
  }, []);

  const handleExport = useCallback(async (entry: TranslationHistoryEntry, format: ExportFormat) => {
    try {
      if (format === 'package') {
        const zipBlob = await buildEntriesZip(entry.subtitle_entries, getBaseName(entry.filename));
        downloadZipFile(zipBlob, `${getBaseName(entry.filename)}.zip`);
      } else {
        const content = exportEntries(entry.subtitle_entries, format);
        downloadSubtitleFile(content, entry.filename, 'srt', format);
      }
      toast.success('导出成功');
    } catch (error) {
      handleError(error, {
        context: { operation: '导出历史记录', fileName: entry.filename }
      });
    }
  }, [handleError]);

  if (variant === 'modal' && !isOpen) return null;

  const deletingEntry = deletingTaskId
    ? findHistoryEntry(history, deletingTaskId)
    : null;

  const body = (
    <>
      <div className={variant === 'panel' ? 'wb-panel-header' : 'flex items-center justify-between mb-6'}>
        <div className="flex items-center gap-2.5 min-w-0">
          <h2 className={variant === 'panel' ? 'wb-panel-title' : 'apple-heading-medium'}>
            历史
          </h2>
          <span className="wb-panel-chip">{history.length}</span>
        </div>
        {variant === 'modal' && onClose && (
          <Button variant="ghost" size="sm" onClick={onClose}>关闭</Button>
        )}
      </div>

      <div className={variant === 'panel' ? 'wb-panel-body' : ''}>
        <div className="wb-panel-stack" style={{ maxWidth: '100%' }}>
          <div className="wb-stats">
            <div>
              <div className="val">
                <CountUp value={stats.total} duration={0.7} />
              </div>
              <div className="lbl">记录</div>
            </div>
            <div>
              <div className="val blue">
                <CountUp value={stats.totalTokens} duration={0.7} />
              </div>
              <div className="lbl">总 Token</div>
            </div>
            <div>
              <div className="val green">
                <CountUp
                  value={history.length > 0 ? Math.round(stats.totalTokens / stats.total) : 0}
                  duration={0.7}
                />
              </div>
              <div className="lbl">平均 Token</div>
            </div>
            <div>
              <div className="val purple">
                <CountUp
                  value={history.reduce((sum, entry) => sum + entry.completedCount, 0)}
                  duration={0.7}
                />
              </div>
              <div className="lbl">总字幕</div>
            </div>
          </div>

          <div className="wb-tool-row" style={{ justifyContent: 'space-between' }}>
            <div className="wb-search" style={{ maxWidth: 320, flex: 1 }}>
              <Search />
              <input
                type="text"
                placeholder="搜索文件名…"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            <button
              type="button"
              className="wb-tool danger"
              onClick={onClear}
              disabled={history.length === 0}
            >
              <Trash2 className="h-3.5 w-3.5" />
              清空
            </button>
          </div>

          {filteredHistory.length === 0 ? (
            <div className="wb-card">
              <div className="wb-empty">
                {searchTerm ? '没有匹配的记录' : '暂无历史记录'}
              </div>
            </div>
          ) : (
            <div className="wb-hist-list">
              {filteredHistory.map((entry) => (
                <div key={entry.taskId} className="wb-hist-row">
                  <div className="min-w-0">
                    <div className="wb-hist-name" title={entry.filename}>
                      <FileText className="inline-block w-3.5 h-3.5 mr-1.5 opacity-50 align-[-2px]" />
                      {entry.filename}
                    </div>
                    <div className="wb-hist-meta">
                      <span className="inline-flex items-center gap-1">
                        <BarChart3 className="h-3 w-3" />
                        {entry.completedCount} 条
                      </span>
                      <span>{entry.totalTokens.toLocaleString()} tok</span>
                      <span className="inline-flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        {formatDate(entry.timestamp)}
                      </span>
                    </div>
                  </div>
                  <div className="wb-hist-acts">
                    <ExportButton
                      variant="icon"
                      disabled={!entry.subtitle_entries?.length}
                      hasTranslation={!!entry.subtitle_entries?.some(e => e.translatedText && e.translatedText.trim() !== '')}
                      onSelect={(format) => handleExport(entry, format)}
                    />
                    <button
                      type="button"
                      className="wb-proj-icon-btn danger"
                      onClick={() => onDelete(entry.taskId)}
                      title="删除"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );

  const dialogs = (
    <>
      <ConfirmDialog
        isOpen={showClearConfirm}
        onClose={() => setShowClearConfirm(false)}
        onConfirm={handleConfirmClear}
        title="清空历史？"
        message={`将删除全部 ${history.length} 条记录，且不可恢复。`}
        confirmText="清空"
        tone="danger"
      />
      <ConfirmDialog
        isOpen={showDeleteConfirm}
        onClose={() => {
          setShowDeleteConfirm(false);
          setDeletingTaskId(null);
        }}
        onConfirm={handleConfirmDelete}
        title="删除记录？"
        detail={deletingEntry?.filename}
        message="此历史记录将被永久删除。"
        confirmText="删除"
        tone="danger"
      />
    </>
  );

  if (variant === 'panel') {
    return (
      <div className="wb-panel">
        {body}
        {dialogs}
      </div>
    );
  }

  return (
    <>
      <AnimatePresence>
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 z-50"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.92, y: 24, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            className="bg-white shadow-2xl w-full max-w-[680px] rounded-2xl p-5 max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {body}
          </motion.div>
        </motion.div>
      </AnimatePresence>
      {dialogs}
    </>
  );
};
