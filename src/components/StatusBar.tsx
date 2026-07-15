import React, { useMemo } from 'react';
import {
  useActiveLlmProfile,
  useIsTranslationConfigured,
  useIsTranslating,
  useTranslationTokensUsed,
} from '@/stores/translationConfigStore';
import { useFileCount, useFilesStore } from '@/stores/filesStore';
import { useQueueStore } from '@/stores/queueStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { getProviderById } from '@/constants/llmProviders';
import type { LlmProviderId } from '@/constants/llmProviders';
import { hasActivePhase } from '@/utils/uxHelpers';

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
  const openSettings = useWorkspaceStore((s) => s.openSettings);

  const activePhaseLabel = useFilesStore((s) => {
    for (const t of s.tasks) {
      if (t.phases?.translating?.status === 'active') {
        const p = t.phases.translating;
        if (p.totalEntries && p.entryCount != null) {
          return `翻译 ${p.entryCount}/${p.totalEntries}`;
        }
        return '翻译中';
      }
      if (t.phases?.transcribing?.status === 'active') {
        const p = t.phases.transcribing;
        if (p.progress > 0) return `转录 ${Math.round(p.progress)}%`;
        return '转录中';
      }
      if (t.phases?.converting?.status === 'active') return '转码中';
      if (hasActivePhase(t.phases)) return '处理中';
    }
    return null;
  });

  const providerName = useMemo(() => {
    try {
      return getProviderById(profile.presetId as LlmProviderId).shortName;
    } catch {
      return profile.name || 'LLM';
    }
  }, [profile.presetId, profile.name]);

  const modelShort = (profile.model || '').trim();
  const totalTokens = Math.max(tokensUsed || 0, historyTokens || 0);
  const busy = Boolean(activeTaskId || isTranslating || activePhaseLabel);

  return (
    <footer className="wb-statusbar" role="status" aria-live="polite">
      <div className="wb-statusbar-left">
        <span className={`wb-status-dot ${isConfigured ? 'ok' : 'warn'}`} />
        {isConfigured ? (
          <span className="wb-statusbar-item">
            <strong>{providerName}</strong>
            {modelShort ? <span className="wb-statusbar-muted"> · {modelShort}</span> : null}
          </span>
        ) : (
          <button
            type="button"
            className="wb-statusbar-item wb-statusbar-warn wb-statusbar-link"
            onClick={() => openSettings('translation')}
            title="打开设置配置 API"
            data-testid="statusbar-open-settings"
          >
            未配置 API
          </button>
        )}
        <span className="wb-statusbar-sep" aria-hidden />
        <span className="wb-statusbar-item wb-statusbar-muted">
          任务 {fileCount}
          {queueLen > 0 ? ` · 队列 ${queueLen}` : ''}
          {busy ? ` · ${activePhaseLabel || '处理中'}` : ''}
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
