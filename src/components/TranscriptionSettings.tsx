import React from 'react';
import { ApiEndpointsSettings } from './ApiEndpointsSettings';
import { SrtCharsSettings } from './SrtCharsSettings';
import { KeytermGroupsSettings } from './KeytermGroupsSettings';
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
  const keytermGroups = useKeytermGroups();
  const updateKeytermGroups = useUpdateKeytermGroups();
  const defaultKeytermGroupId = useTranscriptionStore((state) => state.defaultKeytermGroupId);
  const setDefaultKeytermGroupId = useTranscriptionStore((state) => state.setDefaultKeytermGroupId);

  return (
    <div className={compact ? 'space-y-4' : 'space-y-6'}>
      <ApiEndpointsSettings
        keys={apiKeys}
        onKeysChange={setApiKeys}
        compact={compact}
      />
      <SrtCharsSettings compact={compact} />
      <KeytermGroupsSettings
        groups={keytermGroups}
        onGroupsChange={updateKeytermGroups}
        defaultKeytermGroupId={defaultKeytermGroupId}
        onDefaultGroupChange={setDefaultKeytermGroupId}
        compact={compact}
      />
    </div>
  );
};
