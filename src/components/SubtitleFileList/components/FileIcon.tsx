import { FileText, Music, Video } from 'lucide-react';
import type { FileType } from '@/types';

interface FileIconProps {
  type?: FileType;
  className?: string;
}

export const getFileIconComponent = (type?: FileType): typeof FileText => {
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

export const FileIcon: React.FC<FileIconProps> = ({ type, className }) => {
  const IconComponent = getFileIconComponent(type);

  const colorClass = type === 'audio' ? 'text-green-400' :
                     type === 'video' ? 'text-purple-400' :
                     'text-blue-400';

  return <IconComponent className={`h-5 w-5 ${colorClass} ${className || ''}`} />;
};
