import { motion } from 'framer-motion';
import { Zap } from 'lucide-react';
import { SubtitleFileMetadata } from '@/types';
import { useMemo } from 'react';

interface TranslationProgressProps {
  file: SubtitleFileMetadata;
  isTranslating: boolean;
  translationStats?: {
    total: number;
    translated: number;
    untranslated: number;
    percentage: number;
    tokens: number;
  };
}

const FlowingGradientBar: React.FC = () => {
  return (
    <div className="w-full h-2 overflow-hidden rounded-full bg-gray-200 relative">
      <motion.div
        className="h-full w-1/3 rounded-full"
        style={{
          background: 'linear-gradient(90deg, transparent, #14b8a6, #22d3ee, #14b8a6, transparent)',
        }}
        animate={{
          x: ['-100%', '300%'],
        }}
        transition={{
          duration: 1.5,
          repeat: Infinity,
          ease: 'linear',
        }}
      />
    </div>
  );
};

export const TranslationProgress: React.FC<TranslationProgressProps> = ({
  file,
  isTranslating,
  translationStats = { total: 0, translated: 0, untranslated: 0, percentage: 0, tokens: 0 }
}) => {
  const isTranscribing = file.transcriptionStatus === 'uploading' || file.transcriptionStatus === 'transcribing';

  const progressInfo = useMemo(() => {
    if (isTranslating) {
      return {
        title: '翻译中',
        percent: translationStats.percentage,
        detail: `${translationStats.translated}/${translationStats.total} 条`,
        color: 'from-blue-500 to-purple-500'
      };
    }

    switch (file.transcriptionStatus) {
      case 'completed':
        return {
          title: '转录完成',
          percent: 100,
          detail: `共 ${file.entryCount} 条字幕`,
          color: 'from-emerald-500 to-green-500'
        };

      default:
        return {
          title: '',
          percent: 0,
          detail: '',
          color: 'from-gray-400 to-gray-500'
        };
    }
  }, [isTranslating, translationStats, file.transcriptionStatus, file.entryCount]);

  if (isTranscribing) {
    return (
      <div className="flex-grow relative">
        <FlowingGradientBar />
      </div>
    );
  }

  return (
    <div className="flex-grow relative">
      <div className="flex justify-between items-center mb-2">
        <span className="text-sm text-gray-600">{progressInfo.title}</span>
        <span className="text-sm font-medium text-gray-900">{progressInfo.percent}%</span>
      </div>

      <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
        <motion.div
          className={`h-full rounded-full bg-gradient-to-r ${progressInfo.color}`}
          initial={{ width: '0%' }}
          animate={{ width: `${progressInfo.percent}%` }}
          transition={{ duration: 0.5, ease: 'easeInOut' }}
        />
      </div>

      <div className="flex justify-between text-xs text-gray-500 mt-1">
        <span>{progressInfo.detail}</span>
        {(file.transcriptionStatus === 'completed' || !file.transcriptionStatus) && (
          <span className="flex items-center gap-1">
            <Zap className="h-3 w-3" />
            <span>{translationStats.tokens}</span>
          </span>
        )}
      </div>
    </div>
  );
};
