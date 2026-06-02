import React, { useCallback, useState, useRef } from 'react';
import { Upload, FileText, CheckCircle } from 'lucide-react';
import { addFile } from '@/services/filesService';
import { motion, AnimatePresence } from 'framer-motion';
import toast from 'react-hot-toast';
import { useErrorHandler } from '@/hooks/useErrorHandler';

interface BatchFileUploadProps {
  className?: string;
}

export const BatchFileUpload: React.FC<BatchFileUploadProps> = ({ className }) => {
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
      // 不锁住组件：addFile 内部用 toast 反馈进度，
      // 用户可以继续拖拽/选择新文件（多个上传可并行）
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


  return (
    <div className={className}>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        className="w-full"
      >
        {/* 批量上传区域 - Apple 风格 */}
        <motion.div
          className="relative w-full p-5 sm:p-8 lg:p-12 border-2 border-dashed rounded-2xl bg-gray-50/50 border-gray-300"
          animate={isDragging
            ? { scale: 1.02, backgroundColor: 'rgba(0, 102, 255, 0.04)', borderColor: '#0066FF' }
            : { scale: 1, backgroundColor: 'rgba(249, 250, 251, 0.5)', borderColor: '#d1d5db' }
          }
          whileHover={!isDragging ? { borderColor: '#60a5fa' } : undefined}
          transition={{ type: 'spring', stiffness: 300, damping: 25 }}
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
            <motion.div
              animate={isDragging ? { y: -4, scale: 1.05 } : { y: 0, scale: 1 }}
              transition={{ type: 'spring', stiffness: 400, damping: 18 }}
              className="w-10 h-10 sm:w-12 sm:h-12 lg:w-16 lg:h-16 rounded-full bg-blue-500 flex items-center justify-center shadow-lg shadow-blue-500/20"
            >
              <Upload className="h-5 w-5 sm:h-6 sm:w-6 lg:h-8 lg:w-8 text-white" />
            </motion.div>

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

          {/* 移动端特有：拍照/录音快捷入口（≥640px 隐藏） */}
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

          {/* 拖入时的遮罩高亮 */}
          <AnimatePresence>
            {isDragging && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="pointer-events-none absolute inset-0 rounded-2xl ring-2 ring-blue-500 ring-offset-2 ring-offset-white"
              />
            )}
          </AnimatePresence>
        </motion.div>

      </motion.div>
    </div>
  );
};
