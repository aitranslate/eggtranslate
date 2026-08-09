import { FileText, Music, Video } from 'lucide-react';
import type { FileType } from '@/types';

interface FileIconProps {
  type?: FileType;
  size?: number;
  className?: string;
}

const getFileIconComponent = (type?: FileType): typeof FileText => {
  switch (type) {
    case 'audio':
      return Music;
    case 'video':
      return Video;
    case 'srt':
    default:
      return FileText;
  }
};

export const FileIcon: React.FC<FileIconProps> = ({ type, size = 20, className }) => {
  const IconComponent = getFileIconComponent(type);

  // 类型色：成功 / 品牌 / 次要文案 — 不引入独立紫
  const color =
    type === 'audio'
      ? 'var(--palette-success)'
      : type === 'video'
        ? 'var(--wb-brand)'
        : 'var(--wb-text-3)';

  return (
    <IconComponent
      style={{ width: size, height: size, color }}
      className={className || ''}
    />
  );
};
