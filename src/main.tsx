import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ErrorBoundary } from './components/ErrorBoundary.tsx'
import './index.css'
import App from './App.tsx'
import { flushAll } from './services/PhasePersistence'

import { useTranslationConfigStore } from './stores/translationConfigStore'
import { useTranscriptionStore } from './stores/transcriptionStore'
import { useSubtitleStore } from './stores/subtitleStore'
import { useTermsStore } from './stores/termsStore'
import { useHistoryStore } from './stores/historyStore'

// 页面关闭前 flush 所有脏数据
window.addEventListener('beforeunload', () => {
  flushAll();
});

// 应用启动时加载所有数据到 Zustand
// 注意：translationConfigStore 和 transcriptionStore 使用 persist 中间件，自动加载
async function initializeApp() {
  await Promise.all([
    useSubtitleStore.getState().loadFiles(),
    useTermsStore.getState().loadTerms(),
    useHistoryStore.getState().loadHistory(),
  ]);
}

initializeApp().then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </StrictMode>,
  )
}).catch(error => {
  console.error('[main] 应用初始化失败', error)
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </StrictMode>,
  )
})