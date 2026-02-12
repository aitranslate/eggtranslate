import { useState, useMemo } from 'react';
import { Languages, Mic, Edit3, Download, Trash2 } from 'lucide-react';
import { SubtitleFile, SubtitleFileMetadata } from '@/types';
import { canRetranscribe } from '@/utils/fileUtils';

interface FileActionButtonsProps {
  file: SubtitleFileMetadata;
  isTranslating: boolean;
  translationStats: {
    percentage: number;
  };
  isTranslatingGlobally: boolean;
  currentTranslatingFileId: string | null;
  onTranscribe: () => void;
  onStartTranslation: () => void;
  onEdit: () => void;
  onExport: (format: 'srt' | 'txt' | 'bilingual') => void;
  onDelete: () => void;
}

export const FileActionButtons: React.FC<FileActionButtonsProps> = ({
  file,
  isTranslating,
  translationStats,
  isTranslatingGlobally,
  currentTranslatingFileId,
  onTranscribe,
  onStartTranslation,
  onEdit,
  onExport,
  onDelete,
}) => {
  const [isExporting, setIsExporting] = useState(false);

  const isTranscribing = useMemo(() =>
    file.transcriptionStatus === 'transcribing' ||
    file.transcriptionStatus === 'uploading',
    [file.transcriptionStatus]
  );

  const handleExport = (format: 'srt' | 'txt' | 'bilingual') => {
    onExport(format);
    setIsExporting(false);
  };

  return (
    <div className="flex items-center gap-2">
      {/* 转录按钮 */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onTranscribe();
        }}
        disabled={!canRetranscribe(file) || isTranscribing}
        className={`flex items-center justify-center w-10 h-10 rounded-full transition-all duration-200 ${
          !canRetranscribe(file) || isTranscribing
            ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
            : 'bg-emerald-500 hover:bg-emerald-600 text-white shadow-sm hover:shadow-md active:scale-95'
        }`}
        title={
          isTranscribing
            ? '转录中...'
            : !canRetranscribe(file)
            ? file.transcriptionStatus === 'completed' && file.fileType === 'audio-video'
              ? '音频数据未缓存，需重新上传'
              : 'SRT文件无需转录'
            : '转录'
        }
      >
        {isTranscribing ? (
          <div className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full" />
        ) : (
          <Mic className="h-4 w-4" />
        )}
      </button>

      {/* 翻译按钮 */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onStartTranslation();
        }}
        disabled={
          isTranslating ||
          translationStats.percentage === 100 ||
          (isTranslatingGlobally && !isTranslating) ||
          (file.fileType !== 'srt' && file.transcriptionStatus !== 'completed')
        }
        className={`
          flex items-center justify-center w-10 h-10 rounded-full transition-all duration-200
          ${translationStats.percentage === 100
            ? 'bg-green-500 text-white shadow-sm'
            : isTranslating || currentTranslatingFileId === file.id
            ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
            : (isTranslatingGlobally && !isTranslating) || (file.fileType !== 'srt' && file.transcriptionStatus !== 'completed')
            ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
            : 'bg-blue-500 hover:bg-blue-600 text-white shadow-sm hover:shadow-md active:scale-95'
          }
        `}
        title={
          file.fileType !== 'srt' && file.transcriptionStatus !== 'completed'
            ? '请先完成转录'
            : translationStats.percentage === 100 ? '已完成'
            : isTranslating || currentTranslatingFileId === file.id ? '翻译中...'
            : (isTranslatingGlobally && !isTranslating) ? '待处理' : '开始翻译'
        }
      >
        {isTranslating || currentTranslatingFileId === file.id ? (
          <div className="animate-spin h-4 w-4 border-2 border-gray-400 border-t-transparent rounded-full" />
        ) : (
          <Languages className="h-4 w-4" />
        )}
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
      <div className="relative">
        <button
          onClick={(e) => {
            e.stopPropagation();
            setIsExporting(!isExporting);
          }}
          disabled={(file.entryCount ?? 0) === 0 || isTranslating}
          className={`flex items-center justify-center w-10 h-10 rounded-full transition-all duration-200 ${
            (file.entryCount ?? 0) === 0 || isTranslating
              ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
              : 'bg-gray-100 hover:bg-gray-200 text-gray-700 active:scale-95'
          }`}
          title="导出"
        >
          <Download className="h-4 w-4" />
        </button>

        {isExporting && (
          <>
            <div className="absolute bottom-full mb-2 right-0 z-50">
              <div className="bg-white rounded-xl shadow-xl border border-gray-200 p-1 min-w-[160px]">
                <button
                  onClick={() => handleExport('srt')}
                  className="w-full text-left px-4 py-3 text-sm text-gray-700 hover:bg-gray-100 rounded-lg transition-colors flex items-center gap-3"
                >
                  <span>📄</span>
                  <span>SRT 格式</span>
                </button>
                <button
                  onClick={() => handleExport('txt')}
                  className="w-full text-left px-4 py-3 text-sm text-gray-700 hover:bg-gray-100 rounded-lg transition-colors flex items-center gap-3"
                >
                  <span>📝</span>
                  <span>TXT 格式</span>
                </button>
                <button
                  onClick={() => handleExport('bilingual')}
                  className="w-full text-left px-4 py-3 text-sm text-gray-700 hover:bg-gray-100 rounded-lg transition-colors flex items-center gap-3"
                >
                  <span>🔄</span>
                  <span>双语对照</span>
                </button>
              </div>
            </div>

            <div
              className="fixed inset-0 z-40"
              onClick={() => setIsExporting(false)}
            />
          </>
        )}
      </div>

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
