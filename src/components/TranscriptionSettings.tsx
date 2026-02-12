import React from 'react';
import { KeytermGroupsSettings } from './KeytermGroupsSettings';
import { useKeytermGroups, useUpdateKeytermGroups } from '@/stores/transcriptionStore';

export const TranscriptionSettings: React.FC = () => {
  const keytermGroups = useKeytermGroups();
  const updateKeytermGroups = useUpdateKeytermGroups();

  return (
    <div className="space-y-6">
      <KeytermGroupsSettings
        groups={keytermGroups}
        onGroupsChange={updateKeytermGroups}
      />
    </div>
  );
};
