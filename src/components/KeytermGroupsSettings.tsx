import React, { useState } from 'react';
import { FolderOpen, Plus, X, Trash2, Edit2, Check } from 'lucide-react';
import type { KeytermGroup } from '@/types/transcription';

interface KeytermGroupsSettingsProps {
  groups: KeytermGroup[];
  onGroupsChange: (groups: KeytermGroup[]) => void;
  /** 默认热词组：唯一的状态。选中 = 既显示其 keyterms 供编辑，又作为新任务的默认。null = 不使用。 */
  defaultKeytermGroupId: string | null;
  onDefaultGroupChange?: (groupId: string | null) => void;
}

export const KeytermGroupsSettings: React.FC<KeytermGroupsSettingsProps> = ({
  groups,
  onGroupsChange,
  defaultKeytermGroupId,
  onDefaultGroupChange
}) => {
  // 只有一个概念："选中"。选中 = 既默认 = 又在编辑。点击切换。
  // 没有选中时，不展示 keyterms 编辑区。
  const selectedGroupId = defaultKeytermGroupId;
  const selectedGroup = groups.find(g => g.id === selectedGroupId);

  const [newKeyterm, setNewKeyterm] = useState('');
  const [newGroupName, setNewGroupName] = useState('');
  const [renamingGroupId, setRenamingGroupId] = useState<string | null>(null);
  const [renamingName, setRenamingName] = useState('');

  const handleSelect = (group: KeytermGroup) => {
    // 选中的 → 取消；未选中的 → 选中
    if (defaultKeytermGroupId === group.id) {
      onDefaultGroupChange?.(null);
    } else {
      onDefaultGroupChange?.(group.id);
    }
  };

  const addGroup = () => {
    if (!newGroupName.trim()) return;
    const newGroup: KeytermGroup = {
      id: `group-${Date.now()}`,
      name: newGroupName.trim(),
      keyterms: []
    };
    onGroupsChange([...groups, newGroup]);
    setNewGroupName('');
    onDefaultGroupChange?.(newGroup.id);
  };

  const deleteGroup = (groupId: string) => {
    onGroupsChange(groups.filter(g => g.id !== groupId));
    if (defaultKeytermGroupId === groupId) {
      onDefaultGroupChange?.(null);
    }
  };

  const startEditGroup = (group: KeytermGroup) => {
    setRenamingGroupId(group.id);
    setRenamingName(group.name);
  };

  const saveEditGroup = () => {
    if (renamingName.trim() && renamingGroupId) {
      onGroupsChange(groups.map(g =>
        g.id === renamingGroupId ? { ...g, name: renamingName.trim() } : g
      ));
      setRenamingGroupId(null);
      setRenamingName('');
    }
  };

  const addKeyterm = () => {
    if (!selectedGroup || !newKeyterm.trim()) return;

    const newTerms = newKeyterm
      .split(',')
      .map(t => t.trim())
      .filter(t => t && !selectedGroup.keyterms.includes(t));

    if (newTerms.length === 0) return;

    onGroupsChange(groups.map(g =>
      g.id === selectedGroupId
        ? { ...g, keyterms: [...g.keyterms, ...newTerms] }
        : g
    ));
    setNewKeyterm('');
  };

  const removeKeyterm = (term: string) => {
    onGroupsChange(groups.map(g =>
      g.id === selectedGroupId
        ? { ...g, keyterms: g.keyterms.filter(k => k !== term) }
        : g
    ));
  };

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <h3 className="apple-heading-small">热词提示</h3>

        {/* 分组标签：蓝底 = 选中 = 默认 */}
        <div className="flex flex-wrap gap-2">
          {groups.map((group) => {
            const isSelected = defaultKeytermGroupId === group.id;
            return (
              <div
                key={group.id}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition-all ${
                  isSelected
                    ? 'bg-blue-500 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
                onClick={() => handleSelect(group)}
              >
                <FolderOpen className="h-4 w-4" />
                {renamingGroupId === group.id ? (
                  <input
                    type="text"
                    value={renamingName}
                    onChange={(e) => setRenamingName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && saveEditGroup()}
                    onClick={(e) => e.stopPropagation()}
                    className="bg-white/20 border-none outline-none text-sm w-24 text-white placeholder-white/60"
                    autoFocus
                  />
                ) : (
                  <span className="text-sm font-medium">{group.name}</span>
                )}
                <span className="text-xs opacity-60">({group.keyterms.length})</span>
                {renamingGroupId === group.id ? (
                  <button
                    onClick={(e) => { e.stopPropagation(); saveEditGroup(); }}
                    className="hover:bg-blue-600 rounded p-0.5"
                  >
                    <Check className="h-3 w-3" />
                  </button>
                ) : (
                  <div className="flex items-center gap-0.5">
                    <button
                      onClick={(e) => { e.stopPropagation(); startEditGroup(group); }}
                      className={`rounded p-0.5 ${isSelected ? 'hover:bg-blue-600' : 'hover:bg-blue-200'}`}
                      title="重命名"
                    >
                      <Edit2 className="h-3 w-3" />
                    </button>
                    {groups.length > 1 && (
                      <button
                        onClick={(e) => { e.stopPropagation(); deleteGroup(group.id); }}
                        className={`rounded p-0.5 ${isSelected ? 'hover:bg-blue-600' : 'hover:bg-blue-200'}`}
                        title="删除"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {newGroupName ? (
            <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-lg">
              <input
                type="text"
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addGroup()}
                onBlur={() => {
                  if (newGroupName.trim()) addGroup();
                  else setNewGroupName('');
                }}
                placeholder="分组名称"
                className="bg-transparent border-none outline-none text-sm w-24"
                autoFocus
              />
              <button
                onClick={addGroup}
                className="text-green-600 hover:text-green-700"
              >
                <Check className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => setNewGroupName('新建分组')}
              className="flex items-center gap-2 px-3 py-2 bg-gray-50 text-gray-600 rounded-lg hover:bg-gray-200 transition-colors"
            >
              <Plus className="h-4 w-4" />
              <span className="text-sm">新建分组</span>
            </button>
          )}
        </div>

        {/* 编辑区：只在有选中组时显示 */}
        {selectedGroup ? (
          <div className="space-y-3 pt-2">
            {selectedGroup.keyterms.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {selectedGroup.keyterms.map((term) => (
                  <div
                    key={term}
                    className="flex items-center gap-1 px-3 py-1.5 bg-gray-100 rounded-lg text-sm text-gray-700"
                  >
                    <span>{term}</span>
                    <button
                      onClick={() => removeKeyterm(term)}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex gap-2">
              <input
                type="text"
                value={newKeyterm}
                onChange={(e) => setNewKeyterm(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addKeyterm()}
                placeholder="添加热词，多个用逗号分隔"
                className="flex-1 p-3 bg-gray-50 border border-gray-200 rounded-lg text-gray-900 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all"
              />
              <button
                onClick={addKeyterm}
                className="apple-button apple-button-secondary"
              >
                <Plus className="h-4 w-4" />
                <span>添加</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="text-sm text-gray-500 p-3 bg-gray-50 rounded-lg">
            没有选中默认分组（新任务的 keyterms 留空）
          </div>
        )}
      </div>
    </div>
  );
};
