import React, { useState, useCallback } from 'react';
import { Play, Download, Settings } from 'lucide-react';
import { useTermsStore } from '@/stores/termsStore';
import { useHistoryStore } from '@/stores/historyStore';
import { motion } from 'framer-motion';
import toast from 'react-hot-toast';
import { downloadSubtitleFile } from '@/utils/fileExport';
import { generateTaskId } from '@/utils/taskIdGenerator';
import {
  executeTranslation,
  saveTranslationHistory,
  type TranslationConfig
} from '@/services/TranslationOrchestrator';
import { toSRT, toTXT, toBilingual } from '@/utils/srtParser';
import { API_CONSTANTS } from '@/constants/api';
import { useErrorHandler } from '@/hooks/useErrorHandler';
import { getRelevantTerms, formatTermsForPrompt } from '@/utils/termsHelpers';
import type { SubtitleEntry, Term, TranslationStatus } from '@/types';
import { useTranslationConfigStore, useFilesStore } from '@/stores';

interface TranslationControlsProps {
  className?: string;
  onOpenSettings?: () => void;
  entries: SubtitleEntry[];
  filename: string;
  fileId: string;
}

export const TranslationControls: React.FC<TranslationControlsProps> = ({
  className,
  onOpenSettings,
  entries,
  filename,
  fileId
}) => {
  const {
    config,
    isTranslating,
    progress,
    tokensUsed,
    isConfigured,
    translateBatch,
    updateProgress,
    startTranslation,
    stopTranslation,
    completeTranslation
  } = useTranslationConfigStore();

  const updateEntryInStore = useFilesStore((state) => state.updateEntry);

  const terms = useTermsStore((state) => state.terms);
  const addHistory = useHistoryStore((state) => state.addHistory);

  // 使用统一错误处理
  const { handleError } = useErrorHandler();

  const [isExporting, setIsExporting] = useState(false);

  // Local wrapper for updateEntry to match the expected signature
  const updateEntry = useCallback(async (id: number, text: string, translatedText: string, status?: TranslationStatus) => {
    await updateEntryInStore(fileId, id, text, translatedText, status);
  }, [fileId, updateEntryInStore]);

  // 适配 orchestrator 期望的 (text, before, after) 签名：把 terms 绑定到 helpers
  const getRelevantTermsForCallback = useCallback(
    (text: string, contextBefore?: string, contextAfter?: string) =>
      getRelevantTerms(terms, text, contextBefore, contextAfter),
    [terms]
  );

  // orchestrator 期望 (terms: Term[]) => string，helpers 签名已一致，直接透传
  const formatTermsForPromptCallback = useCallback(
    (termsToFormat: Term[]) => formatTermsForPrompt(termsToFormat),
    []
  );

  const onStartTranslation = useCallback(async () => {
    if (!entries.length) {
      toast.error('请先上传SRT文件');
      return;
    }

    if (!isConfigured) {
      toast.error('请先配置API设置');
      onOpenSettings?.();
      return;
    }

    try {
      // 初始化翻译状态
      const controller = await startTranslation();

      // 生成任务ID
      const taskId = generateTaskId();

      // 准备翻译配置
      const translationConfig: TranslationConfig = {
        batchSize: config.batchSize,
        contextBefore: config.contextBefore,
        contextAfter: config.contextAfter,
        threadCount: config.threadCount
      };

      // 准备翻译回调
      const callbacks = {
        translateBatch,
        updateEntry,
        updateProgress,
        getRelevantTerms: getRelevantTermsForCallback,
        formatTermsForPrompt: formatTermsForPromptCallback
      };

      // 执行翻译流程
      await executeTranslation(
        {
          entries,
          filename,
          config: translationConfig,
          controller,
          taskId
        },
        callbacks
      );

      // 添加短暂延迟，确保所有tokens更新都已完成
      await new Promise(resolve => setTimeout(resolve, API_CONSTANTS.STATE_UPDATE_DELAY_MS));

      await completeTranslation(taskId);

      // 保存历史记录
      await saveTranslationHistory(taskId, filename, tokensUsed, addHistory);
    } catch (error) {
      // 使用统一错误处理
      handleError(error, {
        context: { operation: '翻译', fileName: filename }
      });
      await stopTranslation();
    }
  }, [
    entries,
    filename,
    isConfigured,
    config,
    tokensUsed,
    updateEntry,
    translateBatch,
    updateProgress,
    startTranslation,
    stopTranslation,
    completeTranslation,
    getRelevantTermsForCallback,
    formatTermsForPromptCallback,
    onOpenSettings,
    addHistory,
    handleError
  ]);

  const onExport = useCallback(
    async (format: 'srt' | 'txt' | 'bilingual') => {
      if (!entries.length) {
        toast.error('没有可导出的字幕');
        return;
      }

      setIsExporting(true);

      try {
        let content = '';
        let extension: 'srt' | 'txt' = 'txt';

        switch (format) {
          case 'srt':
            content = toSRT(entries, true);
            extension = 'srt';
            break;
          case 'txt':
            content = toTXT(entries, true);
            extension = 'txt';
            break;
          case 'bilingual':
            content = toBilingual(entries);
            extension = 'srt';
            break;
        }

        downloadSubtitleFile(content, filename, extension, 'trans');
        toast.success('导出成功');
      } catch (error) {
        handleError(error, {
          context: { operation: '导出字幕' },
          showToast: false // 不显示 toast，因为我们显示 toast.error
        });
        toast.error('导出失败');
      } finally {
        setIsExporting(false);
      }
    },
    [entries, filename, handleError]
  );

  if (!entries.length) {
    return null;
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className={`backdrop-blur-sm bg-white/10 rounded-xl p-6 ${className}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-4">
        {/* 翻译控制 */}
        <div className="flex items-center space-x-3">
          {/* 主控制按钮 */}
          {isTranslating ? (
            <button
              disabled
              className="flex items-center space-x-2 px-6 py-3 rounded-lg font-medium bg-orange-500/20 text-orange-200 border border-orange-500/30 cursor-not-allowed"
            >
              <div className="animate-spin h-4 w-4 border-2 border-orange-300 border-t-transparent rounded-full"></div>
              <span>翻译中...</span>
            </button>
          ) : (
            <button
              onClick={onStartTranslation}
              disabled={!isConfigured || isExporting}
              className={`flex items-center space-x-2 px-6 py-3 rounded-lg font-medium transition-all duration-200 ${
                isConfigured
                  ? 'bg-purple-500/20 hover:bg-purple-500/30 text-purple-200 border border-purple-500/30 hover:scale-105'
                  : 'bg-gray-500/20 text-gray-400 border border-gray-500/30 cursor-not-allowed'
              }`}
            >
              <Play className="h-4 w-4" />
              <span>开始翻译</span>
            </button>
          )}

          {!isConfigured && (
            <button
              onClick={onOpenSettings}
              className="flex items-center space-x-2 px-4 py-3 rounded-lg bg-orange-500/20 hover:bg-orange-500/30 text-orange-200 border border-orange-500/30 transition-all duration-200"
            >
              <Settings className="h-4 w-4" />
              <span>配置API</span>
            </button>
          )}
        </div>

        {/* 导出控制 */}
        <div className="flex items-center space-x-2">
          <div className="relative">
            <button
              onClick={() => setIsExporting(!isExporting)}
              disabled={entries.length === 0 || isTranslating}
              className="flex items-center space-x-2 px-4 py-3 rounded-lg bg-blue-500/20 hover:bg-blue-500/30 text-blue-200 border border-blue-500/30 transition-all duration-200 hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Download className="h-4 w-4" />
              <span>导出</span>
            </button>

            {isExporting && (
              <div className="absolute bottom-full mb-2 right-0 z-50">
                <div className="bg-black/90 backdrop-blur-sm rounded-lg p-1 space-y-1 min-w-[140px] shadow-2xl border border-white/20">
                  <button
                    onClick={() => {
                      onExport('srt');
                      setIsExporting(false);
                    }}
                    className="w-full text-left px-4 py-3 text-sm text-white hover:bg-white/20 rounded-md transition-colors duration-150 flex items-center space-x-2"
                  >
                    <span>📄</span>
                    <span>SRT 格式</span>
                  </button>
                  <button
                    onClick={() => {
                      onExport('txt');
                      setIsExporting(false);
                    }}
                    className="w-full text-left px-4 py-3 text-sm text-white hover:bg-white/20 rounded-md transition-colors duration-150 flex items-center space-x-2"
                  >
                    <span>📝</span>
                    <span>TXT 格式</span>
                  </button>
                  <button
                    onClick={() => {
                      onExport('bilingual');
                      setIsExporting(false);
                    }}
                    className="w-full text-left px-4 py-3 text-sm text-white hover:bg-white/20 rounded-md transition-colors duration-150 flex items-center space-x-2"
                  >
                    <span>🔄</span>
                    <span>双语对照</span>
                  </button>
                </div>
              </div>
            )}

            {/* 点击外部区域关闭菜单的遮罩层 */}
            {isExporting && (
              <div
                className="fixed inset-0 z-40"
                onClick={() => setIsExporting(false)}
              />
            )}
          </div>
        </div>
      </div>

      {/* 统计信息 */}
      {!isTranslating && progress.total === 0 && (
        <div className="mt-4 flex flex-wrap items-center justify-between text-sm text-white/70">
          <div className="flex items-center space-x-4">
            <span>字幕条数: {entries.length}</span>
            <span>Token消耗: {tokensUsed}</span>
          </div>
        </div>
      )}
    </motion.div>
  );
};
