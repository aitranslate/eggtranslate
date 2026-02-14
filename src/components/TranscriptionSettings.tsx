import React from 'react';
import { ApiEndpointsSettings } from './ApiEndpointsSettings';
import { SrtCharsSettings } from './SrtCharsSettings';
import { KeytermGroupsSettings } from './KeytermGroupsSettings';
import {
  useKeytermGroups,
  useUpdateKeytermGroups,
  useKeytermsEnabled,
  useSetKeytermsEnabled,
  useApiKeys,
  useSetApiKeys
} from '@/stores/transcriptionStore';

export const TranscriptionSettings: React.FC = () => {
  const apiKeys = useApiKeys();
  const setApiKeys = useSetApiKeys();
  const keytermGroups = useKeytermGroups();
  const updateKeytermGroups = useUpdateKeytermGroups();
  const keytermsEnabled = useKeytermsEnabled();
  const setKeytermsEnabled = useSetKeytermsEnabled();

  return (
    <div className="space-y-6">
      <ApiEndpointsSettings
        keys={apiKeys}
        onKeysChange={setApiKeys}
      />
      <SrtCharsSettings />
      <KeytermGroupsSettings
        groups={keytermGroups}
        onGroupsChange={updateKeytermGroups}
        keytermsEnabled={keytermsEnabled}
        onKeytermsEnabledChange={setKeytermsEnabled}
      />
    </div>
  );
};
