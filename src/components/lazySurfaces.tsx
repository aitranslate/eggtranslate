/**
 * 工作台非关键路径的懒加载表面（设置 / 术语 / 历史）。
 * 冷启动不拉取这些模块的完整依赖图；首次打开时再动态 import。
 */
import React, { Suspense, type ComponentProps, type ReactNode } from 'react';

export const LazySettingsModal = React.lazy(() =>
  import('./SettingsModal').then((m) => ({ default: m.SettingsModal }))
);

export const LazyTermsManager = React.lazy(() =>
  import('./TermsManager').then((m) => ({ default: m.TermsManager }))
);

export const LazyHistoryModal = React.lazy(() =>
  import('./HistoryModal').then((m) => ({ default: m.HistoryModal }))
);

/** 面板/抽屉加载中的轻量占位 */
export function SurfaceFallback({ label = '加载中…' }: { label?: string }) {
  return (
    <div
      className="flex items-center justify-center min-h-[120px] text-sm"
      style={{ color: 'var(--wb-text-3, #a1a1a6)' }}
      role="status"
      aria-live="polite"
    >
      {label}
    </div>
  );
}

export function LazySurface({
  children,
  fallback,
}: {
  children: ReactNode;
  fallback?: ReactNode;
}) {
  return <Suspense fallback={fallback ?? <SurfaceFallback />}>{children}</Suspense>;
}

export type LazySettingsModalProps = ComponentProps<typeof LazySettingsModal>;
export type LazyTermsManagerProps = ComponentProps<typeof LazyTermsManager>;
export type LazyHistoryModalProps = ComponentProps<typeof LazyHistoryModal>;
