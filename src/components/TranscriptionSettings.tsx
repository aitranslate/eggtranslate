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

export const TranscriptionSettings: React.FC = () => {
  const apiKeys = useApiKeys();
  const setApiKeys = useSetApiKeys();
  const keytermGroups = useKeytermGroups();
  const updateKeytermGroups = useUpdateKeytermGroups();
  const defaultKeytermGroupId = useTranscriptionStore((state) => state.defaultKeytermGroupId);
  const setDefaultKeytermGroupId = useTranscriptionStore((state) => state.setDefaultKeytermGroupId);

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
        defaultKeytermGroupId={defaultKeytermGroupId}
        onDefaultGroupChange={setDefaultKeytermGroupId}
      />
    </div>
  );
};
