import { useEffect, type CSSProperties } from 'react';
import toast, { Toaster, ToastBar } from 'react-hot-toast';
import { MainApp } from '@/components/MainApp';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { bindAudioUnlock } from '@/utils/appSound';
import '@/index.css';

/** 默认 Toast 使用主题 token，暗色下不出现死白卡片 */
const toastBaseStyle: CSSProperties = {
  background: 'var(--wb-panel, var(--apple-bg-primary, #ffffff))',
  color: 'var(--wb-text, var(--apple-text-primary, #1d1d1f))',
  border: '1px solid var(--wb-border, var(--apple-border-lighter, #e8e8ed))',
  borderRadius: '12px',
  boxShadow: '0 4px 12px rgba(0, 0, 0, 0.12)',
  fontSize: '14px',
  fontWeight: '400',
};

function App() {
  useEffect(() => {
    bindAudioUnlock();
  }, []);

  return (
    <ErrorBoundary>
      <MainApp />
      <Toaster
        position="top-right"
        toastOptions={{
          duration: 3000,
          style: toastBaseStyle,
          success: {
            duration: 2500,
            iconTheme: {
              primary: 'var(--apple-success, #10B981)',
              secondary: 'var(--wb-panel, #fff)',
            },
          },
          error: {
            duration: 4000,
            iconTheme: {
              primary: 'var(--apple-danger, #EF4444)',
              secondary: 'var(--wb-panel, #fff)',
            },
          },
        }}
      >
        {(t) => (
          <ToastBar toast={t}>
            {({ icon, message }) => {
              const dismissible = t.type !== 'loading';
              return (
                <div
                  role={dismissible ? 'button' : undefined}
                  tabIndex={dismissible ? 0 : undefined}
                  onClick={() => {
                    if (dismissible) toast.dismiss(t.id);
                  }}
                  onKeyDown={(e) => {
                    if (!dismissible) return;
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      toast.dismiss(t.id);
                    }
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    cursor: dismissible ? 'pointer' : 'default',
                  }}
                  title={dismissible ? '点击关闭' : undefined}
                >
                  {icon}
                  {message}
                </div>
              );
            }}
          </ToastBar>
        )}
      </Toaster>
    </ErrorBoundary>
  );
}

export default App;
