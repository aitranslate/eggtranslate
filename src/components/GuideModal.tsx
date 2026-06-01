// src/components/GuideModal.tsx
import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import { guideSections } from '@/data/guideContent';

interface GuideModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const GuideModal: React.FC<GuideModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
        className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 z-50"
        onClick={onClose}
      >
      <motion.div
        initial={{ scale: 0.92, y: 24, opacity: 0 }}
        animate={{ scale: 1, y: 0, opacity: 1 }}
        exit={{ scale: 0.95, y: 8, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 280, damping: 28 }}
        className="relative max-w-2xl w-full max-h-[90vh] bg-white rounded-2xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <h2 className="apple-heading-medium">使用指南</h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-full transition-colors active:scale-90"
            aria-label="关闭"
          >
            <X className="h-5 w-5 text-gray-500" />
          </button>
        </div>

        {/* 内容区域 - stagger 入场 */}
        <div className="overflow-y-auto p-6 md:p-8 max-h-[calc(90vh-88px)]">
          <motion.div
            initial="hidden"
            animate="show"
            variants={{ hidden: {}, show: { transition: { staggerChildren: 0.07, delayChildren: 0.1 } } }}
            className="space-y-8"
          >
            {guideSections.map((section, index) => (
              <motion.section
                key={section.id}
                variants={{
                  hidden: { opacity: 0, y: 12 },
                  show: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 240, damping: 22 } },
                }}
                className={`pb-6 ${index < guideSections.length - 1 ? 'border-b border-gray-200' : ''}`}
              >
                <h3 className="apple-heading-small mb-3">{section.title}</h3>
                <div className="text-gray-700 leading-relaxed whitespace-pre-line">
                  {section.content}
                </div>
              </motion.section>
            ))}
          </motion.div>
        </div>
      </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};
