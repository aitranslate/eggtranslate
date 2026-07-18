/**
 * 懒加载表面的预取（与 lazySurfaces 组件分离，避免 react-refresh 告警）。
 * 在挂载 Suspense 前调用，减少冷缓存闪屏。
 */

export function prefetchMobileShell(): Promise<unknown> {
  return import('./mobile/MobileShell');
}

export function prefetchAgentProcessControl(): Promise<unknown> {
  return import('./agent/AgentProcessControl');
}
