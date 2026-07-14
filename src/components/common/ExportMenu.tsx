/**
 * 导出格式下拉菜单（Portal 版本）
 *
 * 用 createPortal 渲染到 document.body，彻底脱离父级 stacking context，
 * 避免被兄弟卡片（如 framer-motion 的 transform 创建的层叠上下文）遮挡。
 *
 * 菜单位置基于触发按钮的 getBoundingClientRect() 计算，右对齐、向下展开。
 */

import { useEffect, useCallback, useState, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { FileText, Languages, AlignVerticalJustifyStart, AlignVerticalJustifyEnd, Package } from 'lucide-react';
import { type ExportFormat, FORMAT_LABELS } from '@/utils/fileExport';

// ============================================
// 菜单项定义
// ============================================

interface MenuItem {
  format: ExportFormat;
  label: string;
  icon: React.ReactNode;
}

const TEXT_FORMAT_ITEMS: MenuItem[] = [
  { format: 'src', label: '原文', icon: <FileText className="w-4 h-4" /> },
  { format: 'trans', label: '译文', icon: <Languages className="w-4 h-4" /> },
  { format: 'src_trans', label: '双语(原上译下)', icon: <AlignVerticalJustifyStart className="w-4 h-4" /> },
  { format: 'trans_src', label: '双语(原下译上)', icon: <AlignVerticalJustifyEnd className="w-4 h-4" /> },
];

const PACKAGE_ITEM: MenuItem = {
  format: 'package',
  label: FORMAT_LABELS.package,
  icon: <Package className="w-4 h-4" />,
};

const MENU_WIDTH = 188;

// ============================================
// Props
// ============================================

interface ExportMenuProps {
  /** 是否展开 */
  isOpen: boolean;
  /** 关闭回调 */
  onClose: () => void;
  /** 当前选中格式（用于高亮） */
  currentFormat?: ExportFormat;
  /** 是否有译文（控制译文/双语项是否可点） */
  hasTranslation?: boolean;
  /** 选择格式回调 */
  onSelect: (format: ExportFormat) => void;
  /** 触发按钮的 ref，用于计算菜单定位 */
  triggerRef: React.RefObject<HTMLElement | null>;
}

export const ExportMenu: React.FC<ExportMenuProps> = ({
  isOpen,
  onClose,
  currentFormat = 'trans',
  hasTranslation = true,
  onSelect,
  triggerRef,
}) => {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  // 计算并更新菜单位置（基于触发按钮的视口位置）
  const updatePos = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setPos({
      top: rect.bottom + 8,
      left: rect.right - MENU_WIDTH,
    });
  }, [triggerRef]);

  // 菜单打开时计算位置，并监听 scroll/resize 重新定位
  useLayoutEffect(() => {
    if (!isOpen) return;
    updatePos();
    window.addEventListener('scroll', updatePos, true);
    window.addEventListener('resize', updatePos);
    return () => {
      window.removeEventListener('scroll', updatePos, true);
      window.removeEventListener('resize', updatePos);
    };
  }, [isOpen, updatePos]);

  // Escape 键关闭（capture，避免与工作台取消选中抢 Esc）
  useEffect(() => {
    if (!isOpen) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      onClose();
    };
    window.addEventListener('keydown', handleEsc, true);
    return () => window.removeEventListener('keydown', handleEsc, true);
  }, [isOpen, onClose]);

  const handleSelect = useCallback(
    (format: ExportFormat) => {
      onClose();
      onSelect(format);
    },
    [onClose, onSelect]
  );

  const isDisabledItem = (format: ExportFormat): boolean => {
    if (!hasTranslation && (format === 'trans' || format === 'src_trans' || format === 'trans_src')) return true;
    return false;
  };

  if (typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      {isOpen && pos && (
        <>
          {/* 外部遮罩：点击关闭（覆盖整个视口，z 极高确保在最上层） */}
          <div
            className="fixed inset-0"
            style={{ zIndex: 9998 }}
            onClick={onClose}
            onMouseDown={(e) => e.stopPropagation()}
          />

          {/* 菜单容器（fixed 定位，基于触发按钮位置） */}
          <motion.div
            style={{
              position: 'fixed',
              top: pos.top,
              left: pos.left,
              zIndex: 9999,
              transformOrigin: 'top right',
            }}
            className="bg-white border border-gray-200 shadow-xl rounded-xl p-1.5 min-w-[188px]"
            initial={{ opacity: 0, scale: 0.96, y: -6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: -6 }}
            transition={{ type: 'spring', stiffness: 420, damping: 28 }}
          >
            {/* 文本格式项 */}
            <div role="menu">
              {TEXT_FORMAT_ITEMS.map((item, i) => {
                const fmt = item.format;
                const active = currentFormat === fmt;
                const disabled = isDisabledItem(fmt);

                return (
                  <motion.button
                    key={fmt}
                    role="menuitem"
                    disabled={disabled}
                    className={`
                      w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors relative
                      ${active ? 'bg-blue-50 text-blue-600 font-medium' : 'text-gray-700 hover:bg-blue-50/60 hover:text-blue-600'}
                      ${disabled ? 'opacity-30 pointer-events-none text-gray-300 hover:bg-transparent hover:text-gray-300 cursor-not-allowed' : 'cursor-pointer'}
                    `}
                    initial={{ opacity: 0, x: -6 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.03, duration: 0.15 }}
                    onClick={() => !disabled && handleSelect(fmt)}
                  >
                    {/* 选中态左侧蓝色竖条 */}
                    {active && (
                      <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-4 bg-blue-500 rounded-full ml-1" />
                    )}
                    {item.icon}
                    <span>{item.label}</span>
                  </motion.button>
                );
              })}
            </div>

            {/* 分隔线 */}
            <div className="border-t my-1 border-gray-100" />

            {/* 打包项 */}
            <motion.button
              key="package"
              role="menuitem"
              className={`
                w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors relative cursor-pointer
                ${currentFormat === 'package' ? 'bg-blue-50 text-blue-600 font-medium' : 'text-gray-700 hover:bg-blue-50/60 hover:text-blue-600'}
              `}
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 4 * 0.03, duration: 0.15 }}
              onClick={() => handleSelect('package')}
            >
              {currentFormat === 'package' && (
                <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-4 bg-blue-500 rounded-full ml-1" />
              )}
              {PACKAGE_ITEM.icon}
              <span>{PACKAGE_ITEM.label}</span>
            </motion.button>
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body
  );
};
