import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Clock, Zap } from 'lucide-react';
import { SubtitleEntry } from '@/types';
import {
  useTranslationConfigStore,
  useTranslationProgress,
  useTranslationTokensUsed
} from '@/stores/translationConfigStore';

interface ProgressDisplayProps {
  className?: string;
  entries: SubtitleEntry[];
}

export const ProgressDisplay: React.FC<ProgressDisplayProps> = ({ className, entries }) => {
  const progress = useTranslationProgress();
  const tokensUsed = useTranslationTokensUsed();
  const isTranslating = useTranslationConfigStore((state) => state.isTranslating);

  // 计算字幕条目进度
  const [subtitleProgress, setSubtitleProgress] = useState({ current: 0, total: 0 });

  useEffect(() => {
    if (entries.length > 0) {
      const completedCount = entries.filter(entry =>
        entry.translatedText && entry.translatedText.trim() !== ''
      ).length;

      setSubtitleProgress({
        current: completedCount,
        total: entries.length
      });
    }
  }, [entries]);

  // 如果没有翻译任务且没有进度，则不显示组件
  // 但如果有tokens使用记录，即使翻译完成也应该显示
  if (!isTranslating && progress.total === 0 && tokensUsed === 0) {
    return null;
  }

  // 使用字幕条目进度计算百分比
  const progressPercentage = subtitleProgress.total > 0 ? Math.round((subtitleProgress.current / subtitleProgress.total) * 100) : 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className={`backdrop-blur-sm bg-white/10 rounded-xl p-6 ${className}`}
    >
      <div className="space-y-4">
        {/* 标题 */}
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-white flex items-center space-x-2">
            <Clock className="h-5 w-5" />
            <span>翻译进度</span>
          </h3>
          <div className="text-sm text-white/70">
            {progressPercentage}%
          </div>
        </div>

        {/* 进度条 */}
        <div className="space-y-2">
          <div className="w-full bg-white/20 rounded-full h-3 overflow-hidden">
            <motion.div
              className={`h-full rounded-full ${
                progress.phase === 'completed'
                  ? 'bg-gradient-to-r from-green-400 to-emerald-400'
                  : 'bg-gradient-to-r from-purple-400 to-blue-400'
              }`}
              initial={{ width: '0%' }}
              animate={{ width: `${progressPercentage}%` }}
              transition={{ duration: 0.5, ease: 'easeInOut' }}
            />
          </div>
          
          <div className="flex justify-between text-sm text-white/70">
            <span>{subtitleProgress.current} / {subtitleProgress.total} 字幕已完成</span>
            <span className="flex items-center space-x-1">
              <Zap className="h-3 w-3" />
              <span>{tokensUsed} tokens</span>
            </span>
          </div>
        </div>

        {/* 状态信息 */}
        <div className="flex items-center justify-between">
          {/* 左下角：状态显示 */}
          <div className="flex items-center space-x-2">
            {isTranslating && progress.phase !== 'splitting' && (
              <div className="flex items-center space-x-2">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-purple-400"></div>
                <span className="text-sm text-purple-200">翻译中...</span>
              </div>
            )}

            {isTranslating && progress.phase === 'splitting' && (
              <div className="flex items-center space-x-2">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-cyan-400"></div>
                <span className="text-sm text-cyan-200">{progress.status || '断句对齐中...'}</span>
              </div>
            )}

            {progress.phase === 'completed' && (
              <div className="flex items-center space-x-2">
                <div className="rounded-full h-4 w-4 bg-green-400"></div>
                <span className="text-sm text-green-200">翻译完成</span>
              </div>
            )}
          </div>

          {/* 右下角：阶段指示器 */}
          <div className={`
            px-3 py-1 rounded-full text-xs font-medium
            ${progress.phase === 'direct'
              ? 'bg-purple-500/30 text-purple-200'
              : progress.phase === 'splitting'
              ? 'bg-cyan-500/30 text-cyan-200'
              : 'bg-green-500/30 text-green-200'
            }
          `}>
            {progress.phase === 'direct' ? '翻译阶段' : progress.phase === 'splitting' ? '断句阶段' : '已完成'}
          </div>
        </div>

        </div>
    </motion.div>
  );
};