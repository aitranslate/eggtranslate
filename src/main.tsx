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

initializeApp()
  .then(() => {
    renderApp()
  })
  .catch((error) => {
    logger.error('应用初始化失败（store 恢复）', error)
    // Still mount so the user can work with empty defaults if IDB is broken
    renderApp()
  })
