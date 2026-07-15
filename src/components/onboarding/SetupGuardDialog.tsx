/**
 * 翻译 / 转录未配置时的启动守卫
 */

import React from 'react';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { useOnboardingStore } from '@/stores/onboardingStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { setupGuardCopy } from '@/utils/onboarding';

export const SetupGuardDialog: React.FC = () => {
  const kind = useOnboardingStore((s) => s.setupGuardKind);
  const closeSetupGuard = useOnboardingStore((s) => s.closeSetupGuard);
  const openSettings = useWorkspaceStore((s) => s.openSettings);

  const open = kind != null;
  const copy = kind ? setupGuardCopy(kind) : setupGuardCopy('translation');
  const focus = kind === 'transcription' ? 'transcription' : 'translation';

  return (
    <ConfirmDialog
      isOpen={open}
      onClose={closeSetupGuard}
      onConfirm={() => {
        openSettings(focus);
      }}
      title={copy.title}
      message={copy.message}
      confirmText={copy.confirmText}
      cancelText="取消"
      tone="default"
    />
  );
};
