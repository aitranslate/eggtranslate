import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';

interface ConfirmDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  confirmButtonClass?: string;
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmText = '确认',
  cancelText = '取消',
  confirmButtonClass = 'bg-red-500 hover:bg-red-600 text-white'
}) => {
  const handleConfirm = () => {
    onConfirm();
    onClose();
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.88, y: 16, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.94, y: 8, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 320, damping: 26 }}
            className="bg-white rounded-2xl p-6 w-full max-w-md shadow-2xl border border-gray-200"
            onClick={(e) => e.stopPropagation()}
          >
            <motion.div
              initial="hidden"
              animate="show"
              variants={{ hidden: {}, show: { transition: { staggerChildren: 0.06, delayChildren: 0.08 } } }}
              className="space-y-6"
            >
              {/* 标题和关闭按钮 */}
              <motion.div
                variants={{ hidden: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0 } }}
                className="flex items-center justify-between"
              >
                <h3 className="apple-heading-small">{title}</h3>
                <button
                  onClick={onClose}
                  className="p-2 hover:bg-gray-100 rounded-full transition-colors active:scale-90"
                  aria-label="关闭"
                >
                  <X className="h-5 w-5 text-gray-500" />
                </button>
              </motion.div>

              {/* 内容 */}
              <motion.div
                variants={{ hidden: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0 } }}
              >
                <p className="text-gray-700">{message}</p>
              </motion.div>

              {/* 按钮 */}
              <motion.div
                variants={{ hidden: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0 } }}
                className="flex gap-3"
              >
                <button
                  onClick={onClose}
                  className="apple-button apple-button-ghost flex-1 active:scale-[0.97]"
                >
                  {cancelText}
                </button>
                <button
                  onClick={handleConfirm}
                  className={`apple-button flex-1 active:scale-[0.97] ${confirmButtonClass}`}
                >
                  {confirmText}
                </button>
              </motion.div>
            </motion.div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
