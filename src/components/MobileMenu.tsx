// src/components/MobileMenu.tsx
// 移动端导航抽屉：Radix Dialog + slide-down 动画
// 当 isOpen=true 时从顶部滑出 200ms，backdrop 半透明。

import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import * as Dialog from '@radix-ui/react-dialog';
import { BookOpen, History, Settings as SettingsIcon, X } from 'lucide-react';

interface MobileMenuProps {
  isOpen: boolean;
  onClose: () => void;
  termsCount: number;
  historyCount: number;
  isSettingsRequired: boolean;
  onOpenTerms: () => void;
  onOpenHistory: () => void;
  onOpenSettings: () => void;
}

const PANEL_STYLE: React.CSSProperties = {
  position: 'fixed',
  top: 12,
  left: 12,
  right: 12,
  maxWidth: 480,
  margin: '0 auto',
  background: '#ffffff',
  borderRadius: 14,
  padding: 12,
  boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
  zIndex: 1100,
};

const ROW_BASE: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '10px 8px',
  borderRadius: 8,
  fontSize: 13,
  cursor: 'pointer',
  border: 'none',
  background: 'transparent',
  width: '100%',
  textAlign: 'left',
};

export const MobileMenu: React.FC<MobileMenuProps> = ({
  isOpen,
  onClose,
  termsCount,
  historyCount,
  isSettingsRequired,
  onOpenTerms,
  onOpenHistory,
  onOpenSettings,
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
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                style={{
                  position: 'fixed',
                  inset: 0,
                  background: 'rgba(0,0,0,0.3)',
                  zIndex: 1099,
                }}
              />
            </Dialog.Overlay>
            <Dialog.Content asChild>
              <motion.div
                initial={reduce ? { opacity: 0 } : { opacity: 0, y: -16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduce ? { opacity: 0 } : { opacity: 0, y: -16 }}
                transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                style={PANEL_STYLE}
              >
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '6px 0',
                  borderBottom: '1px solid #f0f0f0',
                  marginBottom: 6,
                }}>
                  <span style={{ fontSize: 14 }}>🥚</span>
                  <Dialog.Title asChild>
                    <span style={{ fontSize: 13, fontWeight: 600, flex: 1 }}>
                      蛋蛋字幕翻译
                    </span>
                  </Dialog.Title>
                  <Dialog.Description className="sr-only">导航菜单</Dialog.Description>
                  <Dialog.Close asChild>
                    <button
                      aria-label="关闭"
                      style={{
                        width: 32, height: 32, border: 'none',
                        background: '#f5f5f7', borderRadius: '50%',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 14, cursor: 'pointer',
                      }}
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </Dialog.Close>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <button
                    onClick={handleItem(onOpenTerms)}
                    style={ROW_BASE}
                    className="hover:bg-gray-50"
                  >
                    <BookOpen className="w-4 h-4" />
                    <span style={{ flex: 1 }}>术语</span>
                    {termsCount > 0 && (
                      <span style={{
                        background: 'var(--apple-blue)', color: '#fff',
                        fontSize: 10, padding: '1px 6px', borderRadius: 8,
                      }}>
                        {termsCount}
                      </span>
                    )}
                  </button>

                  <button
                    onClick={handleItem(onOpenHistory)}
                    style={ROW_BASE}
                    className="hover:bg-gray-50"
                  >
                    <History className="w-4 h-4" />
                    <span style={{ flex: 1 }}>历史</span>
                    {historyCount > 0 && (
                      <span style={{
                        background: 'var(--apple-blue)', color: '#fff',
                        fontSize: 10, padding: '1px 6px', borderRadius: 8,
                      }}>
                        {historyCount}
                      </span>
                    )}
                  </button>

                  <button
                    onClick={handleItem(onOpenSettings)}
                    style={{
                      ...ROW_BASE,
                      background: isSettingsRequired ? '#fff5e6' : 'transparent',
                      color: isSettingsRequired ? '#ff9500' : '#1d1d1f',
                    }}
                    className="hover:bg-gray-50"
                  >
                    <SettingsIcon className="w-4 h-4" />
                    <span style={{ flex: 1 }}>设置</span>
                    {isSettingsRequired && (
                      <span style={{
                        background: '#ff9500', color: '#fff',
                        fontSize: 10, padding: '1px 6px', borderRadius: 8,
                      }}>
                        必须
                      </span>
                    )}
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
