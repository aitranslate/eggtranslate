import React, { useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle } from 'lucide-react';

export type ConfirmTone = 'danger' | 'default';

interface ConfirmDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  /** 主说明（短句后果） */
  message: string;
  /** 可选：文件名/对象名，单独一行展示 */
  detail?: string;
  confirmText?: string;
  cancelText?: string;
  /** @deprecated 使用 tone；保留兼容旧调用 */
  confirmButtonClass?: string;
  tone?: ConfirmTone;
}

/**
 * 客户端式确认框（Alert）
 * 窄、右下角按钮、默认焦点在取消、Esc 关闭
 */
export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  detail,
  confirmText = '确认',
  cancelText = '取消',
  confirmButtonClass,
  tone = 'danger',
}) => {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    // 危险操作：焦点落在取消，避免误触 Enter 删除
    const t = window.setTimeout(() => cancelRef.current?.focus(), 30);
    return () => window.clearTimeout(t);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  const handleConfirm = () => {
    onConfirm();
    onClose();
  };

  const isDanger = tone === 'danger' || !!confirmButtonClass;

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          role="presentation"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.12 }}
          className="wb-alert-backdrop"
          onClick={onClose}
        >
          <motion.div
            ref={panelRef}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="wb-alert-title"
            aria-describedby="wb-alert-desc"
            initial={{ opacity: 0, scale: 0.96, y: 6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: 4 }}
            transition={{ duration: 0.14, ease: [0.4, 0, 0.2, 1] }}
            className="wb-alert"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="wb-alert-body">
              <div className={`wb-alert-icon ${isDanger ? 'danger' : ''}`} aria-hidden>
                <AlertTriangle className="w-4 h-4" strokeWidth={2} />
              </div>
              <div className="wb-alert-text">
                <h3 id="wb-alert-title" className="wb-alert-title">
                  {title}
                </h3>
                {detail ? (
                  <p className="wb-alert-detail" title={detail}>
                    {detail}
                  </p>
                ) : null}
                <p id="wb-alert-desc" className="wb-alert-msg">
                  {message}
                </p>
              </div>
            </div>

            <div className="wb-alert-actions">
              <button
                ref={cancelRef}
                type="button"
                className="wb-tool"
                onClick={onClose}
              >
                {cancelText}
              </button>
              <button
                type="button"
                className={
                  confirmButtonClass
                    ? `wb-tool primary ${confirmButtonClass}`
                    : isDanger
                      ? 'wb-tool wb-tool-danger-fill'
                      : 'wb-tool primary'
                }
                onClick={handleConfirm}
              >
                {confirmText}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
