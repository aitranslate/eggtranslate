// 移动端导航菜单：CSS 变量适配亮/暗色，避免白底浅字
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import * as Dialog from '@radix-ui/react-dialog';
import { BookOpen, History, Settings as SettingsIcon, X, LayoutList } from 'lucide-react';

interface MobileMenuProps {
  isOpen: boolean;
  onClose: () => void;
  termsCount: number;
  historyCount: number;
  isSettingsRequired: boolean;
  onOpenTerms: () => void;
  onOpenHistory: () => void;
  onOpenSettings: () => void;
  onOpenWorkspace?: () => void;
  /** 已有底栏时只保留设置，避免重复导航 */
  settingsOnly?: boolean;
}

export const MobileMenu: React.FC<MobileMenuProps> = ({
  isOpen,
  onClose,
  termsCount,
  historyCount,
  isSettingsRequired,
  onOpenTerms,
  onOpenHistory,
  onOpenSettings,
  onOpenWorkspace,
  settingsOnly = false,
}) => {
  const reduce = useReducedMotion();

  const handleItem = (cb: () => void) => () => {
    cb();
    onClose();
  };

  return (
    <Dialog.Root open={isOpen} onOpenChange={(o) => !o && onClose()}>
      <AnimatePresence>
        {isOpen && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild>
              <motion.div
                className="m-menu-overlay"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
              />
            </Dialog.Overlay>
            <Dialog.Content asChild>
              <motion.div
                className="m-menu-panel"
                initial={reduce ? { opacity: 0 } : { opacity: 0, y: -16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduce ? { opacity: 0 } : { opacity: 0, y: -16 }}
                transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
              >
                <div className="m-menu-head">
                  <img src="/favicon.svg" alt="" width={22} height={22} draggable={false} />
                  <Dialog.Title asChild>
                    <span className="m-menu-title">蛋蛋字幕翻译</span>
                  </Dialog.Title>
                  <Dialog.Description className="sr-only">导航菜单</Dialog.Description>
                  <Dialog.Close asChild>
                    <button type="button" className="m-menu-close" aria-label="关闭">
                      <X className="w-4 h-4" />
                    </button>
                  </Dialog.Close>
                </div>

                <div className="m-menu-list">
                  {!settingsOnly && onOpenWorkspace && (
                    <button type="button" className="m-menu-row" onClick={handleItem(onOpenWorkspace)}>
                      <LayoutList className="w-4 h-4" />
                      <span className="m-menu-row-label">项目</span>
                    </button>
                  )}
                  {!settingsOnly && (
                    <button type="button" className="m-menu-row" onClick={handleItem(onOpenTerms)}>
                      <BookOpen className="w-4 h-4" />
                      <span className="m-menu-row-label">术语</span>
                      {termsCount > 0 && <span className="m-menu-badge">{termsCount}</span>}
                    </button>
                  )}
                  {!settingsOnly && (
                    <button type="button" className="m-menu-row" onClick={handleItem(onOpenHistory)}>
                      <History className="w-4 h-4" />
                      <span className="m-menu-row-label">历史</span>
                      {historyCount > 0 && <span className="m-menu-badge">{historyCount}</span>}
                    </button>
                  )}
                  <button
                    type="button"
                    className={`m-menu-row ${isSettingsRequired ? 'is-warn' : ''}`}
                    onClick={handleItem(onOpenSettings)}
                  >
                    <SettingsIcon className="w-4 h-4" />
                    <span className="m-menu-row-label">设置</span>
                    {isSettingsRequired && <span className="m-menu-badge warn">必须</span>}
                  </button>
                </div>
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
};

export default MobileMenu;
