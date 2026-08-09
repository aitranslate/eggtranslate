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
import { isFfmpegCacheName } from '@/utils/convertToMP3'

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
 * 曾启用 PWA/SW：注销旧 worker，并只删除非 FFmpeg 的 Cache Storage。
 * 绝不能 wipe `egg-ffmpeg-core*`，否则 Cache API 缓存形同虚设、每次冷启动重下 ~30MB。
 * FFmpeg 预热改在首次媒体导入路径（addMediaFile），纯 SRT 用户不预拉 WASM。
 */
async function cleanupLegacyServiceWorkers(): Promise<void> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
  try {
    const regs = await navigator.serviceWorker.getRegistrations()
    await Promise.all(regs.map((r) => r.unregister()))
    if (typeof caches !== 'undefined') {
      const keys = await caches.keys()
      await Promise.all(
        keys
          .filter((k) => !isFfmpegCacheName(k))
          .map((k) => caches.delete(k)),
      )
    }
  } catch (error) {
    logger.warn('注销旧 Service Worker 失败（可忽略）', error)
  }
}

initializeApp()
  .then(() => {
    renderApp()
    // 不阻塞首屏：后台卸掉历史 SW（保留 FFmpeg cache）
    void cleanupLegacyServiceWorkers()
  })
  .catch((error) => {
    logger.error('应用初始化失败（store 恢复）', error)
    // Still mount so the user can work with empty defaults if IDB is broken
    renderApp()
    void cleanupLegacyServiceWorkers()
  })
