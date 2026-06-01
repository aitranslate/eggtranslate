import React from 'react';
import { motion } from 'framer-motion';
import { BookOpen } from 'lucide-react';

interface HelpButtonProps {
  onClick: () => void;
}

export const HelpButton: React.FC<HelpButtonProps> = ({ onClick }) => {
  return (
    <motion.button
      onClick={onClick}
      aria-label="帮助指南"
      whileHover={{ scale: 1.08, boxShadow: '0 12px 32px rgba(0, 102, 255, 0.35)' }}
      whileTap={{ scale: 0.92 }}
      transition={{ type: 'spring', stiffness: 400, damping: 18 }}
      className="fixed bottom-6 right-6 z-40 w-14 h-14 md:w-16 md:h-16 bg-blue-500 rounded-full shadow-lg flex items-center justify-center text-white"
    >
      <BookOpen className="w-6 h-6" />
    </motion.button>
  );
};

export default React.memo(HelpButton);
