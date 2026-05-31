import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ErrorBoundary } from './components/ErrorBoundary.tsx'
import './index.css'
import App from './App.tsx'

import { useTermsStore } from './stores/termsStore'
import { useHistoryStore } from './stores/historyStore'

// 应用启动时加载数据到 Zustand
// subtitleStore 使用 persist 中间件，自动从 localforage 恢复
async function initializeApp() {
  await Promise.all([
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