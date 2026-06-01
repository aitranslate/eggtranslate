import React, { useCallback, useState, useRef } from 'react';
import { Upload, FileText } from 'lucide-react';
import { addFile } from '@/services/filesService';
import { motion } from 'framer-motion';
import toast from 'react-hot-toast';
import { useErrorHandler } from '@/hooks/useErrorHandler';

interface FileUploadProps {
  className?: string;
}

export const FileUpload: React.FC<FileUploadProps> = ({ className }) => {
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 使用统一错误处理
  const { handleError } = useErrorHandler();

  const handleFile = useCallback(async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.srt')) {
      toast.error('请选择有效的SRT文件');
      return;
    }

    try {
      await addFile(file);
      toast.success(`成功加载 ${file.name}`);
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
    if (files.length > 0) handleFile(files[0]);
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
    if (files.length > 0) handleFile(files[0]);
    
    // 重置文件输入框的值，确保可以再次选择同一个文件
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, [handleFile]);

  return (
    <div className={className}>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full"
      >
        <div
          className={`
            relative w-full p-8 border-2 border-dashed rounded-xl transition-all duration-300
            backdrop-blur-sm bg-white/10 hover:bg-white/20
            ${isDragging
              ? 'border-purple-400 bg-purple-500/20 scale-105'
              : 'border-white/30 hover:border-white/50'
            }
          `}
          onDrop={onDrop}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".srt"
            onChange={onFileSelect}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          />
          
          <div className="flex flex-col items-center justify-center space-y-4">
            <Upload className="h-12 w-12 text-white/80" />

            <div className="text-center">
              <h3 className="text-xl font-semibold text-white mb-2">
                {isDragging ? '放开文件即可上传' : '上传SRT字幕文件'}
              </h3>
              <p className="text-white/70">
                拖拽文件到此处或点击选择文件
              </p>
            </div>

            <div className="flex items-center space-x-2 text-sm text-white/60">
              <FileText className="h-4 w-4" />
              <span>支持 .srt 格式</span>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
};