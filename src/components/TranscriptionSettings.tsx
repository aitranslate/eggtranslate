import React from 'react';
import { KeytermGroupsSettings } from './KeytermGroupsSettings';
import { useKeytermGroups, useUpdateKeytermGroups, useKeytermsEnabled, useSetKeytermsEnabled } from '@/stores/transcriptionStore';

export const TranscriptionSettings: React.FC = () => {
  const keytermGroups = useKeytermGroups();
  const updateKeytermGroups = useUpdateKeytermGroups();
  const keytermsEnabled = useKeytermsEnabled();
  const setKeytermsEnabled = useSetKeytermsEnabled();

  return (
    <div className="space-y-6">
      <KeytermGroupsSettings
        groups={keytermGroups}
        onGroupsChange={updateKeytermGroups}
        keytermsEnabled={keytermsEnabled}
        onKeytermsEnabledChange={setKeytermsEnabled}
      />
    </div>
  );
};
