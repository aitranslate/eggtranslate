import React, { useEffect, useRef } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { AlertTriangle } from 'lucide-react';
import { backdropFade, overlayPanelMotion } from '@/motion';

type ConfirmTone = 'danger' | 'default';

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
  const reduceMotion = useReducedMotion();
  const mask = backdropFade(reduceMotion);
  const panel = overlayPanelMotion(reduceMotion);

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
        e.stopImmediatePropagation();
        onClose();
      }
    };
    // capture：先于工作台 Esc 级联，避免关确认框同时取消任务选中
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
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
          {...mask}
          className="wb-alert-backdrop"
          onClick={onClose}
        >
          <motion.div
            ref={panelRef}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="wb-alert-title"
            aria-describedby="wb-alert-desc"
            {...panel}
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
