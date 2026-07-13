import React, { useCallback, useState, useRef } from 'react';
import { Upload, FileText } from 'lucide-react';
import { addFile } from '@/services/filesService';
import toast from 'react-hot-toast';
import { useErrorHandler } from '@/hooks/useErrorHandler';

interface BatchFileUploadProps {
  className?: string;
  /** 侧栏紧凑样式 */
  compact?: boolean;
}

export const BatchFileUpload: React.FC<BatchFileUploadProps> = ({ className, compact = false }) => {
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { handleError } = useErrorHandler();

  const handleFile = useCallback(async (file: File) => {
    const ext = file.name.toLowerCase().split('.').pop();

    const supportedTypes = ['srt', 'mp3', 'wav', 'm4a', 'ogg', 'flac', 'mp4', 'webm', 'mkv', 'avi', 'mov'];

    if (!ext || !supportedTypes.includes(ext)) {
      toast.error(`不支持的文件格式，请选择 .srt 字幕或音视频文件`);
      return;
    }

    try {
      await addFile(file);
    } catch (err) {
      handleError(err, {
        context: { operation: '加载文件', fileName: file.name }
      });
    }
  }, [handleError]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files);
    files.forEach(file => handleFile(file));
  }, [handleFile]);

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const onDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const onFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    files.forEach(file => handleFile(file));

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, [handleFile]);

  if (compact) {
    return (
      <div className={className}>
        <div
          className={`wb-drop ${isDragging ? 'drag' : ''}`}
          onDrop={onDrop}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".srt,.mp3,.wav,.m4a,.ogg,.flac,.mp4,.webm,.mkv,.avi,.mov,audio/*,video/*"
            multiple
            onChange={onFileSelect}
          />
          <div className="wb-drop-icon">
            <Upload className="h-4 w-4" />
          </div>
          <h3>{isDragging ? '放开即可导入' : '拖入视频 / 字幕'}</h3>
          <p>支持 MP4 / MOV / SRT / WAV 等，可多选</p>
        </div>
      </div>
    );
  }

  return (
    <div className={className}>
      <div className="w-full">
        <div
          className={`relative w-full p-5 sm:p-8 lg:p-12 border-2 border-dashed rounded-2xl transition duration-200 ${
            isDragging
              ? 'scale-[1.01] bg-blue-500/[0.04] border-blue-500'
              : 'bg-gray-50/50 border-gray-300 hover:border-blue-400'
          }`}
          onDrop={onDrop}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".srt,.mp3,.wav,.m4a,.ogg,.flac,.mp4,.webm,.mkv,.avi,.mov,audio/*,video/*"
            multiple
            onChange={onFileSelect}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          />

          <div className="flex flex-col items-center justify-center space-y-6">
            <div
              className={`w-10 h-10 sm:w-12 sm:h-12 lg:w-16 lg:h-16 rounded-full bg-blue-500 flex items-center justify-center shadow-lg shadow-blue-500/20 transition-transform duration-200 ${
                isDragging ? '-translate-y-1 scale-105' : ''
              }`}
            >
              <Upload className="h-5 w-5 sm:h-6 sm:w-6 lg:h-8 lg:w-8 text-white" />
            </div>

            <div className="text-center">
              <h3 className="text-base sm:text-lg lg:text-2xl font-semibold text-gray-900 mb-2 sm:mb-3">
                {isDragging ? '放开文件即可上传' : '点击或拖拽上传文件'}
              </h3>
              <p className="text-gray-600 text-sm sm:text-base lg:text-lg mb-2">
                支持 SRT / 音视频，可多选
              </p>
              <p className="text-xs sm:text-sm text-gray-500 hidden sm:block">
                支持 .srt .mp3 .wav .m4a .mp4 .webm .ogg 等格式
              </p>
            </div>

            <div className="flex items-center gap-2 text-sm text-gray-500">
              <FileText className="h-4 w-4" />
              <span>支持多文件上传（可并行）</span>
            </div>
          </div>

          <div className="flex sm:hidden gap-2 mt-2">
            <label className="flex-1 flex items-center justify-center gap-1.5 py-2 bg-gray-100 rounded-lg text-xs text-gray-700 cursor-pointer">
              📷 拍照
              <input
                type="file"
                accept="image/*"
                capture="environment"
                onChange={onFileSelect}
                className="hidden"
              />
            </label>
            <label className="flex-1 flex items-center justify-center gap-1.5 py-2 bg-gray-100 rounded-lg text-xs text-gray-700 cursor-pointer">
              🎤 录音
              <input
                type="file"
                accept="audio/*"
                // @ts-expect-error - "microphone" is valid HTML5 capture value but missing from React.InputHTMLAttributes types
                capture="microphone"
                onChange={onFileSelect}
                className="hidden"
              />
            </label>
          </div>

          <div
            className={`pointer-events-none absolute inset-0 rounded-2xl ring-2 ring-blue-500 ring-offset-2 ring-offset-white transition-opacity duration-150 ${
              isDragging ? 'opacity-100' : 'opacity-0'
            }`}
          />
        </div>
      </div>
    </div>
  );
};
