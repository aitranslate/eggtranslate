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
  const [isUploading, setIsUploading] = useState(false);
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
      setIsUploading(true);
      await addFile(file);
      toast.success(`成功加载 ${file.name}`);
    } catch (err) {
      handleError(err, {
        context: { operation: '加载文件', fileName: file.name }
      });
    } finally {
      setIsUploading(false);
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
          className="relative w-full p-12 border-2 border-dashed rounded-2xl bg-gray-50/50 border-gray-300"
          animate={isDragging
            ? { scale: 1.02, backgroundColor: 'rgba(0, 102, 255, 0.04)', borderColor: '#0066FF' }
            : { scale: 1, backgroundColor: 'rgba(249, 250, 251, 0.5)', borderColor: '#d1d5db' }
          }
          whileHover={!isDragging ? { borderColor: '#60a5fa' } : undefined}
          transition={{ type: 'spring', stiffness: 300, damping: 25 }}
          onDrop={onDrop}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          style={{ pointerEvents: isUploading ? 'none' : 'auto', opacity: isUploading ? 0.5 : 1 }}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".srt,.mp3,.wav,.m4a,.ogg,.flac,.mp4,.webm,.mkv,.avi,.mov,audio/*,video/*"
            multiple
            onChange={onFileSelect}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
            disabled={isUploading}
          />

          <div className="flex flex-col items-center justify-center space-y-6">
            {isUploading ? (
              <motion.div
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="animate-spin rounded-full h-16 w-16 border-2 border-blue-500 border-t-transparent"
              />
            ) : (
              <motion.div
                animate={isDragging ? { y: -4, scale: 1.05 } : { y: 0, scale: 1 }}
                transition={{ type: 'spring', stiffness: 400, damping: 18 }}
                className="w-16 h-16 rounded-full bg-blue-500 flex items-center justify-center shadow-lg shadow-blue-500/20"
              >
                <Upload className="h-8 w-8 text-white" />
              </motion.div>
            )}

            <div className="text-center">
              <h3 className="text-2xl font-semibold text-gray-900 mb-3">
                {isDragging ? '放开文件即可上传' : '拖拽上传 SRT 字幕或音视频文件'}
              </h3>
              <p className="text-gray-600 text-lg mb-2">
                {isUploading ? '正在加载...' : '拖拽多个文件到此处或点击选择文件'}
              </p>
              <p className="text-sm text-gray-500">
                支持 .srt .mp3 .wav .m4a .mp4 .webm .ogg 等格式
              </p>
            </div>

            <div className="flex items-center gap-2 text-sm text-gray-500">
              <FileText className="h-4 w-4" />
              <span>支持多文件上传</span>
            </div>
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
