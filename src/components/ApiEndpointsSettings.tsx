import React, { useState } from 'react';
import { Key, Plus, HelpCircle, X } from 'lucide-react';
import { Button, Input } from '@/components/ui';

interface ApiKeysSettingsProps {
  keys: string;
  onKeysChange: (keys: string) => void;
  compact?: boolean;
}

export const ApiEndpointsSettings: React.FC<ApiKeysSettingsProps> = ({
  keys,
  onKeysChange,
  compact = false,
}) => {
  const [localValue, setLocalValue] = useState('');

  const keyList = keys.split('|').map(k => k.trim()).filter(k => k);

  const addKey = () => {
    if (localValue.trim() && !keyList.includes(localValue.trim())) {
      const newKeys = [...keyList, localValue.trim()].join('|');
      onKeysChange(newKeys);
      setLocalValue('');
    }
  };

  const removeKey = (keyToRemove: string) => {
    const newKeys = keyList.filter(k => k !== keyToRemove).join('|');
    onKeysChange(newKeys);
  };

  return (
    <div className={compact ? 'space-y-2' : 'space-y-3'}>
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-1.5">
          <h3 className={compact ? 'text-xs font-semibold text-[var(--wb-text)]' : 'apple-heading-small'}>
            API KEY
          </h3>
          <a
            href="https://www.assemblyai.com/"
            target="_blank"
            rel="noopener noreferrer"
            title="注册 AssemblyAI"
            className="text-[var(--wb-text-3)] hover:text-[var(--wb-brand)] transition-colors"
          >
            <HelpCircle className="h-3.5 w-3.5" />
          </a>
        </div>
        <span className="text-[10.5px] text-[var(--wb-text-3)]">
          {keyList.length > 0 ? `${keyList.length} 个` : '未配置'}
        </span>
      </div>

      {!compact && (
        <p className="text-xs text-gray-500">
          多个 KEY 用 | 分隔，失败时自动轮询。
        </p>
      )}

      <div className="flex gap-1.5">
        <Input
          type="password"
          autoComplete="off"
          value={localValue}
          onChange={(e) => setLocalValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') addKey();
          }}
          placeholder="AssemblyAI API KEY"
          className="flex-1"
          inputSize="sm"
        />
        {compact ? (
          <button type="button" className="wb-tool" onClick={addKey}>
            <Plus className="h-3.5 w-3.5" />
            添加
          </button>
        ) : (
          <Button variant="secondary" size="sm" onClick={addKey}>
            <Plus className="h-4 w-4" />
            <span>添加</span>
          </Button>
        )}
      </div>

      {keyList.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {keyList.map((key, index) => (
            <div key={index} className="wb-chip">
              <Key className="h-3 w-3 opacity-60" />
              <span>
                {key.slice(0, 8)}…{key.slice(-4)}
              </span>
              <button type="button" onClick={() => removeKey(key)} aria-label="移除">
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
