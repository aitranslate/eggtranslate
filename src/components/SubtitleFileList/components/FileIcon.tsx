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

  const colorClass = type === 'audio' ? 'text-green-400' :
                     type === 'video' ? 'text-purple-400' :
                     'text-blue-400';

  return (
    <IconComponent
      style={{ width: size, height: size }}
      className={`${colorClass} ${className || ''}`}
    />
  );
};
