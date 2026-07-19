import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ErrorBoundary } from './components/ErrorBoundary.tsx'
import './index.css'
import './mobile.css'
import App from './App.tsx'
import { logger } from '@/utils/logger'
import { rehydrateAppStores } from '@/stores/bootstrap'
import { initThemeFromStorage } from '@/stores/themeStore'
import { initSoundFromStorage } from '@/stores/soundStore'
import { warmupMp3Encoder } from '@/utils/convertToMP3'

initThemeFromStorage()
initSoundFromStorage()

function renderApp() {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </StrictMode>,
  )
}

/**
 * Bootstrap: rehydrate all persisted stores, THEN mount UI.
 * User never interacts with a store that is still loading from IndexedDB.
 */
async function initializeApp() {
  await rehydrateAppStores()
}

/** 曾启用 PWA/SW：启动时注销旧 worker 并清 Cache Storage，避免旧 precache 劫持新构建 */
async function unregisterLegacyServiceWorkers(): Promise<void> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
  try {
    const regs = await navigator.serviceWorker.getRegistrations()
    await Promise.all(regs.map((r) => r.unregister()))
    if (typeof caches !== 'undefined') {
      const keys = await caches.keys()
      await Promise.all(keys.map((k) => caches.delete(k)))
    }
  } catch (error) {
    logger.warn('注销旧 Service Worker 失败（可忽略）', error)
  }
}

initializeApp()
  .then(() => {
    renderApp()
    // 不阻塞首屏：后台卸掉历史 SW
    void unregisterLegacyServiceWorkers()
    // 空闲时预热 MP3 Worker：避免「首次上传视频」撞上 Vite 依赖预构建整页刷新
    const warm = () => warmupMp3Encoder()
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(warm, { timeout: 2500 })
    } else {
      window.setTimeout(warm, 800)
    }
  })
  .catch((error) => {
    logger.error('应用初始化失败（store 恢复）', error)
    // Still mount so the user can work with empty defaults if IDB is broken
    renderApp()
    void unregisterLegacyServiceWorkers()
  })
