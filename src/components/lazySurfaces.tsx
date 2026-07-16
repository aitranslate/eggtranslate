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

/**
 * 懒加载表面（用于主舞台内面板：术语 / 历史）。
 *
 * API：`fallback` 用默认参数，不用 `??`——否则 `fallback={null}` 会被当成空又变回占位。
 * 布局：设置类浮层不要把本组件挂在 `.workbench` / `.m-shell` 内部；
 * 浮层应与布局壳兄弟挂载（见 MainApp / MobileShell），由 SettingsModal 自行 portal。
 */
export function LazySurface({
  children,
  fallback = <SurfaceFallback />,
}: {
  children: ReactNode;
  /** 传 null 表示加载期完全不占位（浮层首次加载） */
  fallback?: ReactNode;
}) {
  return <Suspense fallback={fallback}>{children}</Suspense>;
}

export type LazySettingsModalProps = ComponentProps<typeof LazySettingsModal>;
export type LazyTermsManagerProps = ComponentProps<typeof LazyTermsManager>;
export type LazyHistoryModalProps = ComponentProps<typeof LazyHistoryModal>;
