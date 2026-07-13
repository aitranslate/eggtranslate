import React, { useState } from 'react';
import { FolderOpen, Plus, X, Trash2, Edit2, Check } from 'lucide-react';
import type { KeytermGroup } from '@/types/transcription';

interface KeytermGroupsSettingsProps {
  groups: KeytermGroup[];
  onGroupsChange: (groups: KeytermGroup[]) => void;
  defaultKeytermGroupId: string | null;
  onDefaultGroupChange?: (groupId: string | null) => void;
  compact?: boolean;
}

export const KeytermGroupsSettings: React.FC<KeytermGroupsSettingsProps> = ({
  groups,
  onGroupsChange,
  defaultKeytermGroupId,
  onDefaultGroupChange,
  compact = false,
}) => {
  const selectedGroupId = defaultKeytermGroupId;
  const selectedGroup = groups.find(g => g.id === selectedGroupId);

  const [newKeyterm, setNewKeyterm] = useState('');
  const [newGroupName, setNewGroupName] = useState('');
  const [renamingGroupId, setRenamingGroupId] = useState<string | null>(null);
  const [renamingName, setRenamingName] = useState('');

  const handleSelect = (group: KeytermGroup) => {
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
    }
    setRenamingGroupId(null);
    setRenamingName('');
  };

  const cancelEditGroup = () => {
    setRenamingGroupId(null);
    setRenamingName('');
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
    <div className={compact ? 'space-y-2' : 'space-y-3'}>
      <h3 className={compact ? 'text-xs font-semibold text-[var(--wb-text)]' : 'apple-heading-small'}>
        热词
      </h3>
      {!compact && (
        <p className="text-xs text-gray-500">上传时优先识别这些词，提高转录准确率。</p>
      )}

      <div className="flex flex-wrap gap-1.5">
        {groups.map((group) => {
          const isSelected = defaultKeytermGroupId === group.id;
          return (
            <div
              key={group.id}
              className={`wb-chip-btn ${isSelected ? 'is-active' : ''}`}
            >
              <button
                type="button"
                className="flex items-center gap-1 outline-none"
                onClick={() => handleSelect(group)}
                aria-pressed={isSelected}
              >
                <FolderOpen className="h-3.5 w-3.5" />
                {renamingGroupId === group.id ? (
                  <input
                    type="text"
                    value={renamingName}
                    onChange={(e) => setRenamingName(e.target.value)}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === 'Enter') saveEditGroup();
                      if (e.key === 'Escape') cancelEditGroup();
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className="border-0 outline-none text-inherit text-xs w-20 bg-transparent"
                    autoFocus
                  />
                ) : (
                  <span className="text-xs font-medium">{group.name}</span>
                )}
                <span className="text-[10px] opacity-60">({group.keyterms.length})</span>
              </button>
              {renamingGroupId === group.id ? (
                <button
                  type="button"
                  onClick={() => saveEditGroup()}
                  className="p-0.5 rounded hover:bg-black/10"
                >
                  <Check className="h-3 w-3" />
                </button>
              ) : (
                <div className="flex items-center gap-0.5">
                  <button
                    type="button"
                    onClick={() => startEditGroup(group)}
                    className="p-0.5 rounded hover:bg-black/10"
                    title="重命名"
                  >
                    <Edit2 className="h-3 w-3" />
                  </button>
                  {groups.length > 1 && (
                    <button
                      type="button"
                      onClick={() => deleteGroup(group.id)}
                      className="p-0.5 rounded hover:bg-black/10"
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
          <div className="wb-chip-btn">
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
              className="bg-transparent border-none outline-none text-xs w-20"
              autoFocus
            />
            <button type="button" onClick={addGroup} className="text-[var(--apple-success)]">
              <Check className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setNewGroupName('新建分组')}
            className="wb-chip-btn"
          >
            <Plus className="h-3.5 w-3.5" />
            <span className="text-xs">新建</span>
          </button>
        )}
      </div>

      {selectedGroup ? (
        <div className="space-y-2 pt-1">
          {selectedGroup.keyterms.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {selectedGroup.keyterms.map((term) => (
                <div key={term} className="wb-chip">
                  <span>{term}</span>
                  <button type="button" onClick={() => removeKeyterm(term)} aria-label={`删除 ${term}`}>
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="flex gap-1.5">
            <input
              type="text"
              value={newKeyterm}
              onChange={(e) => setNewKeyterm(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addKeyterm()}
              placeholder="热词，逗号分隔"
              className="apple-input wb-surface-input flex-1 text-xs"
            />
            <button type="button" className="wb-tool" onClick={addKeyterm}>
              <Plus className="h-3.5 w-3.5" />
              添加
            </button>
          </div>
        </div>
      ) : (
        <p className="text-[11px] text-[var(--wb-text-3)] py-1">点击分组设为默认并编辑</p>
      )}
    </div>
  );
};
