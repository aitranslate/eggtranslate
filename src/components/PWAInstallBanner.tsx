// src/components/PWAInstallBanner.tsx
// PWA 安装提示横幅。
// - 默认形态：紫蓝渐变 + 图标 + 标题 + 安装按钮 + 关闭按钮
// - iOS Safari 形态：步骤引导（分享 → 添加到主屏幕）
// 触发逻辑在 usePWAInstall hook；本组件只渲染 + 转发用户交互。

import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { usePWAInstall } from '@/pwa/usePWAInstall';

const BANNER_STYLE: React.CSSProperties = {
  position: 'fixed',
  top: 12,
  left: '50%',
  transform: 'translateX(-50%)',
  zIndex: 1100,
  width: 'min(720px, calc(100vw - 24px))',
  borderRadius: 14,
  padding: '14px 16px',
  display: 'flex',
  alignItems: 'center',
  gap: 14,
  background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
  color: '#ffffff',
  boxShadow: '0 8px 32px rgba(102, 126, 234, 0.4)',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  boxSizing: 'border-box',
};

const ICON_STYLE: React.CSSProperties = {
  width: 40,
  height: 40,
  borderRadius: 10,
  background: 'rgba(255, 255, 255, 0.18)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 22,
  flexShrink: 0,
};

const TEXT_STYLE: React.CSSProperties = { flex: 1, minWidth: 0 };

const TITLE_STYLE: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 600,
  lineHeight: 1.3,
  margin: 0,
};

const ACTIONS_STYLE: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  flexShrink: 0,
};

const INSTALL_BTN_STYLE: React.CSSProperties = {
  border: 'none',
  background: '#ffffff',
  color: '#4a3f8a',
  fontSize: 13,
  fontWeight: 600,
  padding: '7px 14px',
  borderRadius: 8,
  cursor: 'pointer',
  fontFamily: 'inherit',
};

const CLOSE_BTN_STYLE: React.CSSProperties = {
  border: 'none',
  background: 'transparent',
  color: '#ffffff',
  fontSize: 18,
  lineHeight: 1,
  width: 28,
  height: 28,
  borderRadius: '50%',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontFamily: 'inherit',
};

export const PWAInstallBanner: React.FC = () => {
  const { shouldShow, isIOS, install, dismiss } = usePWAInstall();
  const reduce = useReducedMotion();

  return (
    <AnimatePresence>
      {shouldShow && (
        <motion.div
          role="dialog"
          aria-label="安装应用到桌面"
          style={BANNER_STYLE}
          initial={reduce ? { opacity: 0 } : { opacity: 0, y: -24 }}
          animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0 }}
          exit={reduce ? { opacity: 0 } : { opacity: 0, y: -24 }}
          transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
        >
          {isIOS ? (
            <IOSGuide onDismiss={dismiss} />
          ) : (
            <StandardBanner onInstall={install} onDismiss={dismiss} />
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
};

const StandardBanner: React.FC<{
  onInstall: () => void | Promise<void>;
  onDismiss: () => void;
}> = ({ onInstall, onDismiss }) => (
  <>
    <div style={ICON_STYLE}>🥚</div>
    <div style={TEXT_STYLE}>
      <p style={TITLE_STYLE}>安装到桌面</p>
      <p style={{ ...TITLE_STYLE, fontSize: 12, fontWeight: 400, opacity: 0.85, marginTop: 2 }}>
        获得独立窗口、桌面图标
      </p>
    </div>
    <div style={ACTIONS_STYLE}>
      <button style={INSTALL_BTN_STYLE} onClick={onInstall} type="button">
        安装
      </button>
      <button
        style={CLOSE_BTN_STYLE}
        onClick={onDismiss}
        type="button"
        aria-label="关闭"
      >
        ✕
      </button>
    </div>
  </>
);

const IOSGuide: React.FC<{ onDismiss: () => void }> = ({ onDismiss }) => (
  <>
    <div style={ICON_STYLE}>🥚</div>
    <div style={TEXT_STYLE}>
      <p style={TITLE_STYLE}>iOS 设备安装</p>
      <p style={{ ...TITLE_STYLE, fontSize: 12, fontWeight: 400, opacity: 0.95, lineHeight: 1.5, marginTop: 4 }}>
        点击底部分享按钮 <kbd style={{ background: 'rgba(255,255,255,0.2)', border: '1px solid rgba(255,255,255,0.3)', borderRadius: 4, padding: '1px 5px', fontSize: 11, margin: '0 2px' }}>⬆</kbd> 选择 <kbd style={{ background: 'rgba(255,255,255,0.2)', border: '1px solid rgba(255,255,255,0.3)', borderRadius: 4, padding: '1px 5px', fontSize: 11, margin: '0 2px' }}>添加到主屏幕</kbd>
      </p>
    </div>
    <div style={ACTIONS_STYLE}>
      <button
        style={CLOSE_BTN_STYLE}
        onClick={onDismiss}
        type="button"
        aria-label="关闭"
      >
        ✕
      </button>
    </div>
  </>
);
