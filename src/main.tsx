import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ErrorBoundary } from './components/ErrorBoundary.tsx'
/** 色板必须先于 index.css 独立注入，避免经 Tailwind 处理时 :root token 丢失 */
import './theme/palette.css'
import './index.css'
import './mobile.css'
import App from './App.tsx'
import { logger } from '@/utils/logger'
import { rehydrateAppStores } from '@/stores/bootstrap'
import { initThemeFromStorage } from '@/stores/themeStore'
import { initSoundFromStorage } from '@/stores/soundStore'
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

/**
 * 曾启用 PWA/SW 与 FFmpeg Cache：注销旧 worker，并清理遗留 Cache Storage
 * （含历史 egg-ffmpeg-core*，已不再使用 FFmpeg.wasm）。
 */
async function cleanupLegacyServiceWorkers(): Promise<void> {
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
    // 不阻塞首屏：后台卸掉历史 SW / 废弃缓存
    void cleanupLegacyServiceWorkers()
  })
  .catch((error) => {
    logger.error('应用初始化失败（store 恢复）', error)
    // Still mount so the user can work with empty defaults if IDB is broken
    renderApp()
    void cleanupLegacyServiceWorkers()
  })
