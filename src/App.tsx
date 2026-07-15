import { useEffect } from 'react';
import toast, { Toaster, ToastBar } from 'react-hot-toast';
import { MainApp } from '@/components/MainApp';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { bindAudioUnlock } from '@/utils/appSound';
import '@/index.css';

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
          // 未指定类型时的兜底
          duration: 3000,
          style: {
            background: '#ffffff',
            color: '#1d1d1f',
            border: '1px solid #e8e8ed',
            borderRadius: '12px',
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.08)',
            fontSize: '14px',
            fontWeight: '400',
          },
          success: {
            duration: 2500,
            iconTheme: {
              primary: '#10B981',
              secondary: '#fff',
            },
          },
          error: {
            duration: 4000,
            iconTheme: {
              primary: '#EF4444',
              secondary: '#fff',
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
