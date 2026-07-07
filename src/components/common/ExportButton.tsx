/**
 * 导出按钮（普通按钮 + 点击弹出格式菜单）
 *
 * 两种变体：
 * - variant="icon"   单文件图标按钮（Download 图标，w-8 h-8）
 * - variant="button"  批量文字按钮（图标 + "全部导出"，apple-button-secondary 样式）
 *
 * 交互：点击按钮 → 弹出导出格式菜单（Portal 渲染到 body）→ 选择格式后触发 onSelect(format)
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { Download } from 'lucide-react';
import type { ExportFormat } from '@/utils/fileExport';
import { ExportMenu } from './ExportMenu';

interface ExportButtonProps {
  /** 'icon' = 单文件图标按钮；'button' = 批量文字按钮 */
  variant?: 'icon' | 'button';
  /** 是否禁用 */
  disabled?: boolean;
  /** 是否有译文（控制译文/双语菜单项是否可点） */
  hasTranslation?: boolean;
  /** 选择格式后回调（触发导出） */
  onSelect: (format: ExportFormat) => void;
}

const DEFAULT_FORMAT: ExportFormat = 'trans';

export const ExportButton: React.FC<ExportButtonProps> = ({
  variant = 'button',
  disabled = false,
  hasTranslation = true,
  onSelect,
}) => {
  const [open, setOpen] = useState(false);
  const [currentFormat, setCurrentFormat] = useState<ExportFormat>(DEFAULT_FORMAT);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // 无译文时若当前选中是依赖译文的格式，自动切回 src（仅更新高亮，不触发导出）
  useEffect(() => {
    if (!hasTranslation && currentFormat !== 'src' && currentFormat !== 'package') {
      setCurrentFormat('src');
    }
  }, [hasTranslation, currentFormat]);

  const handleSelect = useCallback(
    (format: ExportFormat) => {
      setCurrentFormat(format);
      onSelect(format);
    },
    [onSelect]
  );

  const toggleMenu = () => {
    if (disabled) return;
    setOpen((prev) => !prev);
  };

  // 图标变体：单文件导出按钮
  if (variant === 'icon') {
    return (
      <div className="relative inline-flex" onClick={(e) => e.stopPropagation()}>
        <button
          ref={buttonRef}
          onClick={toggleMenu}
          disabled={disabled}
          className="flex items-center justify-center w-8 h-8 rounded-md transition-all duration-200 hover:bg-gray-100 text-gray-500 hover:text-gray-900 disabled:opacity-30 disabled:cursor-not-allowed"
          title="导出"
          aria-label="导出"
        >
          <Download className="w-4 h-4" />
        </button>
        <ExportMenu
          isOpen={open}
          onClose={() => setOpen(false)}
          currentFormat={currentFormat}
          hasTranslation={hasTranslation}
          onSelect={handleSelect}
          triggerRef={buttonRef}
        />
      </div>
    );
  }

  // 文字变体：批量导出按钮（与"清空"同风格）
  return (
    <div className="relative inline-flex">
      <button
        ref={buttonRef}
        onClick={toggleMenu}
        disabled={disabled}
        className="apple-button apple-button-secondary px-5 py-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <Download className="h-4 w-4" />
        <span>全部导出</span>
      </button>
      <ExportMenu
        isOpen={open}
        onClose={() => setOpen(false)}
        currentFormat={currentFormat}
        hasTranslation={hasTranslation}
        onSelect={handleSelect}
        triggerRef={buttonRef}
      />
    </div>
  );
};
