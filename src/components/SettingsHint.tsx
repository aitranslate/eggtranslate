import React from 'react';

interface SettingsHintProps {
  children: React.ReactNode;
  /** 保留 prop 兼容；动画已去掉以减轻设置页重量 */
  delay?: number;
}

/** 设置说明文案：纯 DOM，不拉 framer-motion */
export const SettingsHint: React.FC<SettingsHintProps> = ({ children }) => (
  <p className="text-xs text-[var(--wb-text-3)] leading-relaxed">{children}</p>
);
