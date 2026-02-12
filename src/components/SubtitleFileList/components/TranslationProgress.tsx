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
  const progressInfo = useMemo(() => {
    let progressTitle: string;
    let progressPercent: number;
    let progressDetail: string;
    let tokensDisplay: string = '';

    switch (file.transcriptionStatus) {
      case 'uploading':
      case 'decoding':
      case 'chunking':
      case 'transcribing':
        progressTitle = '转录中';
        progressPercent = file.transcriptionProgress?.percent || 0;
        progressDetail = '正在处理音频...';
        break;

      case 'llm_merging':
      case 'completed':
        progressTitle = '转录完成';
        progressPercent = 100;
        progressDetail = `共 ${file.entryCount} 条字幕`;
        tokensDisplay = ''; // 转录阶段不显示 tokens
        break;

      case 'translating':
        progressTitle = '翻译中';
        progressPercent = file.translationProgress?.percent || 0;
        progressDetail = `${file.translatedCount || 0} / ${file.entryCount} 已翻译`;
        tokensDisplay = `${file.translationStats?.tokens || 0} tokens`;
        break;

      default:
        progressTitle = '等待转录';
        progressPercent = 0;
        progressDetail = '请先上传音视频文件';
        tokensDisplay = '';
    }

    const progressColor = progressPercent === 100
      ? 'from-emerald-500 to-green-500'
      : progressTitle === '转录中'
      ? 'from-teal-500 to-cyan-500'
      : 'from-blue-500 to-purple-500';

    return { progressTitle, progressPercent, progressColor, progressDetail, tokensDisplay };
  }, [file.transcriptionStatus, file.translationStatus, file.transcriptionProgress, file.translationProgress, file.translationStats, file.entryCount, file.translatedCount, translationStats]);

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
