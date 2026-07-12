import React from 'react';
import { BookOpen } from 'lucide-react';

interface HelpButtonProps {
  onClick: () => void;
}

export const HelpButton: React.FC<HelpButtonProps> = ({ onClick }) => {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="帮助指南"
      className="fixed bottom-6 right-6 z-40 w-14 h-14 md:w-16 md:h-16 bg-blue-500 rounded-full shadow-lg flex items-center justify-center text-white hover:scale-105 active:scale-95 transition-transform duration-150"
    >
      <BookOpen className="w-6 h-6" />
    </button>
  );
};

export default React.memo(HelpButton);
