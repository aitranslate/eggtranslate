import React, { useState } from 'react';
import { Key, Plus, HelpCircle } from 'lucide-react';

interface ApiKeysSettingsProps {
  keys: string;
  onKeysChange: (keys: string) => void;
}

export const ApiEndpointsSettings: React.FC<ApiKeysSettingsProps> = ({
  keys,
  onKeysChange
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
    <div className="space-y-3">
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-2">
          <h3 className="apple-heading-small">API KEY</h3>
          <a
            href="https://www.assemblyai.com/"
            target="_blank"
            rel="noopener noreferrer"
            title="没有?点击注册！"
            className="cursor-help text-gray-400 hover:text-blue-500 transition-colors"
          >
            <HelpCircle className="h-4 w-4" />
          </a>
        </div>
        <div className="text-xs text-gray-500">
          {keyList.length > 0 ? `已配置 ${keyList.length} 个` : '请添加 API KEY'}
        </div>
      </div>

      {/* 输入框和添加按钮 */}
      <div className="flex gap-2">
        <input
          type="password"
          value={localValue}
          onChange={(e) => setLocalValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              addKey();
            }
          }}
          placeholder="输入 AssemblyAI API KEY"
          className="flex-1 p-3 bg-gray-50 border border-gray-200 rounded-lg text-gray-900 placeholder-gray-400 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all"
        />
        <button
          onClick={addKey}
          className="apple-button apple-button-secondary"
        >
          <Plus className="h-4 w-4" />
          <span>添加</span>
        </button>
      </div>

      {/* 当前配置的 KEY 列表 */}
      {keyList.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {keyList.map((key, index) => (
            <div
              key={index}
              className="flex items-center gap-1 px-3 py-1.5 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700"
            >
              <Key className="h-3.5 w-3.5" />
              <span>{key.slice(0, 8)}...{key.slice(-4)}</span>
              <button
                onClick={() => removeKey(key)}
                className="ml-1 hover:text-red-600"
              >
                <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}

      {/* 分隔线 */}
      <div className="border-t border-gray-200" />
    </div>
  );
};
