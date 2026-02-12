import { motion } from 'framer-motion';
import { Zap } from 'lucide-react';
import { SubtitleFile } from '@/types';
import { useMemo } from 'react';

interface TranslationProgressProps {
  file: SubtitleFile;
  translationStats?: {
    total: number;
    translated: number;
    untranslated: number;
    percentage: number;
    tokens: number;
  };
}

export const TranslationProgress: React.FC<TranslationProgressProps> = ({
  file,
  translationStats = { total: 0, translated: 0, untranslated: 0, percentage: 0, tokens: 0 }
}) => {
  const isTranscribing = useMemo(() =>
    file.transcriptionStatus === 'transcribing' ||
    file.transcriptionStatus === 'llm_merging' ||
    file.transcriptionStatus === 'loading_model' ||
    file.transcriptionStatus === 'decoding' ||
    file.transcriptionStatus === 'chunking',
    [file.transcriptionStatus]
  );

  const isTranslationPhase = useMemo(() =>
    file.fileType === 'srt' || (translationStats?.percentage ?? 0) > 0,
    [file.fileType, translationStats?.percentage]
  );

  const progressInfo = useMemo(() => {
    let progressTitle: string;
    if (isTranscribing) {
      progressTitle = '转录进度';
    } else if (isTranslationPhase) {
      progressTitle = '翻译进度';
    } else if (file.transcriptionStatus === 'completed') {
      progressTitle = '转录完成';
    } else {
      progressTitle = '转录进度';
    }

    let progressPercent: number;
    if (isTranscribing) {
      progressPercent = file.transcriptionProgress?.percent ?? 0;
    } else if (isTranslationPhase) {
      progressPercent = translationStats?.percentage ?? 0;
    } else if (file.transcriptionStatus === 'completed') {
      progressPercent = 100;
    } else {
      progressPercent = 0;
    }

    const progressColor = progressPercent === 100
      ? 'from-emerald-500 to-green-500'
      : isTranscribing
      ? 'from-teal-500 to-cyan-500'
      : 'from-blue-500 to-purple-500';

    let progressDetail: string;
    if (isTranscribing) {
      if (file.transcriptionStatus === 'transcribing') {
        if (file.transcriptionProgress?.percent) {
          progressDetail = `转录中 ${Math.floor(file.transcriptionProgress.percent)}%`;
        } else {
          progressDetail = '转录中...';
        }
      } else if (file.transcriptionStatus === 'llm_merging') {
        const batch = file.transcriptionProgress?.llmBatch || 0;
        const total = file.transcriptionProgress?.totalLlmBatches || 0;
        progressDetail = batch > 0 ? `LLM组句 ${batch} / ${total}` : '准备LLM组句...';
      } else {
        progressDetail = '处理中...';
      }
    } else if (isTranslationPhase) {
      progressDetail = `${translationStats?.translated ?? 0} / ${translationStats?.total ?? 0} 已翻译`;
    } else if (file.transcriptionStatus === 'completed') {
      progressDetail = `字幕 ${translationStats?.total ?? 0} 条`;
    } else {
      progressDetail = '等待转录';
    }

    return { progressTitle, progressPercent, progressColor, progressDetail };
  }, [isTranscribing, isTranslationPhase, file.transcriptionStatus, file.transcriptionProgress, translationStats]);

  const tokensDisplay = useMemo(() => {
    if (isTranscribing) {
      return '';  // 转录阶段不显示 tokens
    }
    if (file.transcriptionStatus === 'llm_merging') {
      const batch = file.transcriptionProgress?.llmBatch || 0;
      const total = file.transcriptionProgress?.totalLlmBatches || 0;
      if (batch > 0) {
        return `组句 ${batch}/${total}`;
      } else {
        return '准备组句...';
      }
    }
    if (file.translationStatus === 'translating') {
      return `${translationStats?.tokens ?? 0} tokens`;
    }
    return '';
  }, [isTranscribing, file.transcriptionStatus, file.translationStatus, file.transcriptionProgress, translationStats?.tokens]);

  return (
    <div className="flex-grow relative">
      {/* 左上方：进度标题 | 右上角：百分比 */}
      <div className="flex justify-between items-center mb-2">
        <span className="text-sm text-gray-600">{progressInfo.progressTitle}</span>
        <span className="text-sm font-medium text-gray-900">{progressInfo.progressPercent}%</span>
      </div>

      {/* 进度条 */}
      <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
        <motion.div
          className={`h-full rounded-full bg-gradient-to-r ${progressInfo.progressColor}`}
          initial={{ width: '0%' }}
          animate={{ width: `${progressInfo.progressPercent}%` }}
          transition={{ duration: 0.5, ease: 'easeInOut' }}
        />
      </div>

      {/* 左下角：进度详情 | 右下角：tokens */}
      <div className="flex justify-between text-xs text-gray-500 mt-1">
        <span>{progressInfo.progressDetail}</span>
        <span className="flex items-center gap-1">
          <Zap className="h-3 w-3" />
          <span>{tokensDisplay}</span>
        </span>
      </div>
    </div>
  );
};
