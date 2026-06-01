import React from 'react';
import { Toaster } from 'react-hot-toast';
import { TermsProvider } from '@/contexts/TermsContext';
import { HistoryProvider } from '@/contexts/HistoryContext';
import { MainApp } from '@/components/MainApp';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import '@/index.css';

function App() {
  return (
    <ErrorBoundary>
      <HistoryProvider>
        <TermsProvider>
          <MainApp />
          <Toaster
            position="top-right"
            toastOptions={{
              duration: 4000,
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
                iconTheme: {
                  primary: '#10B981',
                  secondary: '#fff',
                },
              },
              error: {
                iconTheme: {
                  primary: '#EF4444',
                  secondary: '#fff',
                },
              },
            }}
          />
        </TermsProvider>
      </HistoryProvider>
    </ErrorBoundary>
  );
}

export default App;
