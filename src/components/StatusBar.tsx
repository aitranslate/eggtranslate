import React, { useMemo } from 'react';
import {
  useActiveLlmProfile,
  useIsTranslationConfigured,
  useIsTranslating,
  useTranslationTokensUsed,
} from '@/stores/translationConfigStore';
import { useFileCount, useFilesStore } from '@/stores/filesStore';
import { useQueueStore } from '@/stores/queueStore';
import { getProviderById } from '@/constants/llmProviders';
import type { LlmProviderId } from '@/constants/llmProviders';

export const StatusBar: React.FC = () => {
  const profile = useActiveLlmProfile();
  const isConfigured = useIsTranslationConfigured();
  const isTranslating = useIsTranslating();
  const tokensUsed = useTranslationTokensUsed();
  const fileCount = useFileCount();
  const queueLen = useQueueStore((s) => s.taskQueue.length);
  const activeTaskId = useQueueStore((s) => s.activeTaskId);
  const historyTokens = useFilesStore((s) =>
    s.tasks.reduce((sum, t) => sum + (t.phases?.translating?.tokens || 0), 0)
  );

  const providerName = useMemo(() => {
    try {
      return getProviderById(profile.presetId as LlmProviderId).shortName;
    } catch {
      return profile.name || 'LLM';
    }
  }, [profile.presetId, profile.name]);

  const modelShort = (profile.model || '').trim();
  const totalTokens = Math.max(tokensUsed || 0, historyTokens || 0);

  return (
    <footer className="wb-statusbar" role="status" aria-live="polite">
      <div className="wb-statusbar-left">
        <span className={`wb-status-dot ${isConfigured ? 'ok' : 'warn'}`} />
        <span className="wb-statusbar-item">
          {isConfigured ? (
            <>
              <strong>{providerName}</strong>
              {modelShort ? <span className="wb-statusbar-muted"> · {modelShort}</span> : null}
            </>
          ) : (
            <span className="wb-statusbar-warn">未配置 API</span>
          )}
        </span>
        <span className="wb-statusbar-sep" aria-hidden />
        <span className="wb-statusbar-item wb-statusbar-muted">
          任务 {fileCount}
          {queueLen > 0 ? ` · 队列 ${queueLen}` : ''}
          {activeTaskId || isTranslating ? ' · 处理中' : ''}
        </span>
      </div>
      <div className="wb-statusbar-right">
        <span className="wb-statusbar-item wb-statusbar-muted" title="本次会话 / 任务累计 Token">
          Tokens {totalTokens.toLocaleString()}
        </span>
      </div>
    </footer>
  );
};
