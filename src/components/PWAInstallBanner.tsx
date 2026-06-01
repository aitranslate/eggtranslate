// src/components/PWAInstallBanner.tsx
// PWA 安装提示横幅。
// - 默认形态：紫蓝渐变 + 图标 + 标题 + 安装按钮 + 关闭按钮
// - iOS Safari 形态：步骤引导（分享 → 添加到主屏幕）
// 触发逻辑在 usePWAInstall hook；本组件只渲染 + 转发用户交互。

import type { CSSProperties } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { usePWAInstall } from '@/pwa/usePWAInstall';

export const PWAInstallBanner: React.FC = () => {
  const { shouldShow, isIOS, install, dismiss } = usePWAInstall();
  const reduce = useReducedMotion();

  return (
    <AnimatePresence>
      {shouldShow && (
        <motion.div
          className={isIOS ? undefined : 'banner-wrapper'}
          role="dialog"
          aria-label="安装应用到桌面"
          initial={reduce ? { opacity: 0 } : { opacity: 0, y: -24 }}
          animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0 }}
          exit={reduce ? { opacity: 0 } : { opacity: 0, y: -24 }}
          transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
          style={isIOS ? iosStyle : undefined}
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

const iosStyle: CSSProperties = {
  position: 'fixed',
  top: 12,
  left: '50%',
  transform: 'translateX(-50%)',
  zIndex: 1100,
  width: 'min(720px, calc(100vw - 24px))',
  borderRadius: 14,
  padding: '14px 16px',
  background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
  color: '#ffffff',
  boxShadow: '0 8px 32px rgba(102, 126, 234, 0.4)',
  fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
  display: 'flex',
  alignItems: 'center',
  gap: 14,
};

const StandardBanner: React.FC<{
  onInstall: () => void | Promise<void>;
  onDismiss: () => void;
}> = ({ onInstall, onDismiss }) => (
  <div className="banner-wrapper">
    <style>{standardStyles}</style>
    <div className="pwa-icon">🥚</div>
    <div className="pwa-text">
      <p className="pwa-title">安装到桌面</p>
      <p className="pwa-subtitle">获得独立窗口、桌面图标</p>
    </div>
    <div className="pwa-actions">
      <button className="pwa-install-btn" onClick={onInstall} type="button">
        安装
      </button>
      <button
        className="pwa-close-btn"
        onClick={onDismiss}
        type="button"
      >
        ✕
      </button>
    </div>
  </div>
);

const IOSGuide: React.FC<{ onDismiss: () => void }> = ({ onDismiss }) => (
  <div className="pwa-ios-guide">
    <style>{standardStyles}</style>
    <div className="pwa-icon">🥚</div>
    <div className="pwa-text">
      <p className="pwa-title">iOS 设备安装</p>
      <p className="pwa-ios-steps">
        点击底部分享按钮{' '}
        <kbd>⬆</kbd>{' '}
        选择{' '}
        <kbd>添加到主屏幕</kbd>
      </p>
    </div>
    <div className="pwa-actions">
      <button
        className="pwa-close-btn"
        onClick={onDismiss}
        type="button"
      >
        ✕
      </button>
    </div>
  </div>
);

// 内联 style —— 避免 CSS Modules 在测试环境下配置复杂度
const standardStyles = `
  .banner-wrapper,
  .pwa-ios-guide {
    position: fixed;
    top: 12px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 1100;
    width: min(720px, calc(100vw - 24px));
    border-radius: 14px;
    padding: 14px 16px;
    display: flex;
    align-items: center;
    gap: 14px;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: #ffffff;
    box-shadow: 0 8px 32px rgba(102, 126, 234, 0.4);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    box-sizing: border-box;
  }
  .pwa-icon {
    width: 40px;
    height: 40px;
    border-radius: 10px;
    background: rgba(255, 255, 255, 0.18);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 22px;
    flex-shrink: 0;
  }
  .pwa-text {
    flex: 1;
    min-width: 0;
  }
  .pwa-title {
    font-size: 14px;
    font-weight: 600;
    line-height: 1.3;
    margin: 0;
  }
  .pwa-subtitle {
    font-size: 12px;
    opacity: 0.85;
    line-height: 1.3;
    margin: 2px 0 0 0;
  }
  .pwa-ios-steps {
    font-size: 12px;
    opacity: 0.95;
    line-height: 1.5;
    margin: 4px 0 0 0;
  }
  .pwa-ios-steps kbd {
    background: rgba(255, 255, 255, 0.2);
    border: 1px solid rgba(255, 255, 255, 0.3);
    border-radius: 4px;
    padding: 1px 5px;
    font-family: inherit;
    font-size: 11px;
    margin: 0 2px;
  }
  .pwa-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
  }
  .pwa-install-btn {
    border: none;
    background: #ffffff;
    color: #4a3f8a;
    font-size: 13px;
    font-weight: 600;
    padding: 7px 14px;
    border-radius: 8px;
    cursor: pointer;
    font-family: inherit;
  }
  .pwa-install-btn:hover { background: #f5f4ff; }
  .pwa-install-btn:active { transform: scale(0.96); }
  .pwa-close-btn {
    border: none;
    background: transparent;
    color: #ffffff;
    font-size: 18px;
    line-height: 1;
    width: 28px;
    height: 28px;
    border-radius: 50%;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: inherit;
  }
  .pwa-close-btn:hover { background: rgba(255, 255, 255, 0.18); }
  @media (prefers-reduced-motion: reduce) {
    .pwa-install-btn, .pwa-close-btn { transition: none; }
  }
`;
