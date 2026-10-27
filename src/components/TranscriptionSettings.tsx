import React from 'react';
import { ApiEndpointsSettings } from './ApiEndpointsSettings';
import { SrtCharsSettings } from './SrtCharsSettings';
import { AiSegmentationSettings } from './AiSegmentationSettings';
import { KeytermGroupsSettings } from './KeytermGroupsSettings';
import { AsrEngineSettings } from './SettingsModal/AsrEngineSettings';
import {
  useKeytermGroups,
  useUpdateKeytermGroups,
  useApiKeys,
  useSetApiKeys,
  useTranscriptionStore
} from '@/stores/transcriptionStore';

interface TranscriptionSettingsProps {
  /** 设置双栏内更紧凑 */
  compact?: boolean;
}

export const TranscriptionSettings: React.FC<TranscriptionSettingsProps> = ({
  compact = false,
}) => {
  const apiKeys = useApiKeys();
  const setApiKeys = useSetApiKeys();
  const asrEngine = useTranscriptionStore((state) => state.asrEngine);
  const keytermGroups = useKeytermGroups();
  const updateKeytermGroups = useUpdateKeytermGroups();
  const defaultKeytermGroupId = useTranscriptionStore((state) => state.defaultKeytermGroupId);
  const setDefaultKeytermGroupId = useTranscriptionStore((state) => state.setDefaultKeytermGroupId);

  return (
    <div className={compact ? 'space-y-4' : 'space-y-6'}>
      <AsrEngineSettings compact={compact} />
      {asrEngine === 'cloud' && (
        <ApiEndpointsSettings
          keys={apiKeys}
          onKeysChange={setApiKeys}
          compact={compact}
        />
      )}
      <SrtCharsSettings compact={compact} />
      <AiSegmentationSettings compact={compact} />
      {asrEngine === 'cloud' ? (
        <KeytermGroupsSettings
          groups={keytermGroups}
          onGroupsChange={updateKeytermGroups}
          defaultKeytermGroupId={defaultKeytermGroupId}
          onDefaultGroupChange={setDefaultKeytermGroupId}
          compact={compact}
        />
      ) : (
        <div className={compact ? 'space-y-1' : 'space-y-2'}>
          <h3
            className={
              compact ? 'text-xs font-semibold text-[var(--wb-text)]' : 'apple-heading-small'
            }
          >
            热词
          </h3>
          <p className="text-[10.5px] text-[var(--wb-text-3)]">
            本地引擎不支持热词（那是 AssemblyAI 的服务端特性），切回云端可用。
          </p>
        </div>
      )}
    </div>
  );
};
