import { useMemo } from 'react';
import { Languages, Mic, Wand2, Edit3, Download, Trash2 } from 'lucide-react';
import { SubtitleFileMetadata } from '@/types';
import { canRetranscribe } from '@/utils/fileUtils';

interface FileActionButtonsProps {
  file: SubtitleFileMetadata;
  isTranslating: boolean;
  translationStats: {
    percentage: number;
  };
  isTranslatingGlobally: boolean;
  currentTranslatingFileId: string | null;
  onTranscribeAndTranslate: () => void;
  onTranscribe: () => void;
  onStartTranslation: () => void;
  onEdit: () => void;
  onExport: () => void;
  onDelete: () => void;
}

export const FileActionButtons: React.FC<FileActionButtonsProps> = ({
  file,
  isTranslating,
  translationStats,
  isTranslatingGlobally,
  currentTranslatingFileId,
  onTranscribeAndTranslate,
  onTranscribe,
  onStartTranslation,
  onEdit,
  onExport,
  onDelete,
}) => {
  const isTranscribing = useMemo(() =>
    file.transcriptionStatus === 'transcribing' ||
    file.transcriptionStatus === 'uploading' ||
    file.transcriptionStatus === 'converting',
    [file.transcriptionStatus]
  );

  const isBusy = isTranscribing || isTranslating || currentTranslatingFileId === file.id;

  const canTranscribeAndTranslate = useMemo(() => {
    if (isBusy) return false;
    if (translationStats.percentage === 100) return false;
    if (isTranslatingGlobally) return false;
    if (file.fileType === 'srt') return translationStats.percentage < 100;
    return canRetranscribe(file) || file.transcriptionStatus === 'completed';
  }, [isBusy, translationStats.percentage, isTranslatingGlobally, file]);

  return (
    <div className="flex items-center gap-2">
      {/* 转译按钮 */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onTranscribeAndTranslate();
        }}
        disabled={!canTranscribeAndTranslate}
        className={`flex items-center justify-center w-10 h-10 rounded-full transition-all duration-200 ${
          !canTranscribeAndTranslate
            ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
            : 'bg-violet-500 hover:bg-violet-600 text-white shadow-sm hover:shadow-md active:scale-95'
        }`}
        title={
          isBusy ? '处理中...'
          : translationStats.percentage === 100 ? '已完成'
          : isTranslatingGlobally ? '待处理'
          : '转译（转录+翻译）'
        }
      >
        {isBusy ? (
          <div className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full" />
        ) : (
          <Wand2 className="h-4 w-4" />
        )}
      </button>

      {/* 转录按钮 */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onTranscribe();
        }}
        disabled={!canRetranscribe(file) || isBusy}
        className={`flex items-center justify-center w-10 h-10 rounded-full transition-all duration-200 ${
          !canRetranscribe(file) || isBusy
            ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
            : 'bg-emerald-500 hover:bg-emerald-600 text-white shadow-sm hover:shadow-md active:scale-95'
        }`}
        title={
          isBusy
            ? '处理中...'
            : !canRetranscribe(file)
            ? file.transcriptionStatus === 'completed' && file.fileType === 'audio-video'
              ? '音频数据未缓存，需重新上传'
              : 'SRT文件无需转录'
            : '转录'
        }
      >
        <Mic className="h-4 w-4" />
      </button>

      {/* 翻译按钮 */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onStartTranslation();
        }}
        disabled={
          isBusy ||
          translationStats.percentage === 100 ||
          isTranslatingGlobally ||
          (file.fileType !== 'srt' && file.transcriptionStatus !== 'completed')
        }
        className={`
          flex items-center justify-center w-10 h-10 rounded-full transition-all duration-200
          ${translationStats.percentage === 100 || isBusy || isTranslatingGlobally || (file.fileType !== 'srt' && file.transcriptionStatus !== 'completed')
            ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
            : 'bg-blue-500 hover:bg-blue-600 text-white shadow-sm hover:shadow-md active:scale-95'
          }
        `}
        title={
          file.fileType !== 'srt' && file.transcriptionStatus !== 'completed'
            ? '请先完成转录'
            : translationStats.percentage === 100 ? '已完成'
            : isBusy ? '处理中...'
            : isTranslatingGlobally ? '待处理' : '开始翻译'
        }
      >
        <Languages className="h-4 w-4" />
      </button>

      {/* 编辑按钮 */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onEdit();
        }}
        className="flex items-center justify-center w-10 h-10 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-700 transition-all duration-200 active:scale-95"
        title="编辑"
      >
        <Edit3 className="h-4 w-4" />
      </button>

      {/* 导出按钮 */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onExport();
        }}
        disabled={(file.entryCount ?? 0) === 0 || isBusy}
        className={`flex items-center justify-center w-10 h-10 rounded-full transition-all duration-200 ${
          (file.entryCount ?? 0) === 0 || isBusy
            ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
            : 'bg-gray-100 hover:bg-gray-200 text-gray-700 active:scale-95'
        }`}
        title="导出"
      >
        <Download className="h-4 w-4" />
      </button>

      {/* 删除按钮 */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        className="flex items-center justify-center w-10 h-10 rounded-full bg-red-50 hover:bg-red-100 text-red-600 transition-all duration-200 active:scale-95"
        title="删除"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  );
};
