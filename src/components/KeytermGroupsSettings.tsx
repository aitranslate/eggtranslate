import React, { useState } from 'react';
import { FolderOpen, Plus, X, Trash2, Edit2, Check, Star } from 'lucide-react';
import type { KeytermGroup } from '@/types/transcription';

interface KeytermGroupsSettingsProps {
  groups: KeytermGroup[];
  onGroupsChange: (groups: KeytermGroup[]) => void;
  /** 默认热词组：v2 唯一的状态。新任务用这个组的 keyterms；null = 不使用。 */
  defaultKeytermGroupId: string | null;
  onDefaultGroupChange?: (groupId: string | null) => void;
}

export const KeytermGroupsSettings: React.FC<KeytermGroupsSettingsProps> = ({
  groups,
  onGroupsChange,
  defaultKeytermGroupId,
  onDefaultGroupChange
}) => {
  // 正在编辑的组（展示 keyterms 输入区）。默认跟随 defaultKeytermGroupId；
  // 没有默认时回退到第一组，保持可编辑。
  const [editingGroupId, setEditingGroupId] = useState<string>(
    () => defaultKeytermGroupId ?? groups[0]?.id ?? ''
  );
  const [newKeyterm, setNewKeyterm] = useState('');
  const [newGroupName, setNewGroupName] = useState('');
  const [renamingGroupId, setRenamingGroupId] = useState<string | null>(null);
  const [renamingName, setRenamingName] = useState('');

  const editingGroup = groups.find(g => g.id === editingGroupId);

  const addGroup = () => {
    if (!newGroupName.trim()) return;
    const newGroup: KeytermGroup = {
      id: `group-${Date.now()}`,
      name: newGroupName.trim(),
      keyterms: []
    };
    onGroupsChange([...groups, newGroup]);
    setNewGroupName('');
    // 新建的组自动成为默认 + 进入编辑
    onDefaultGroupChange?.(newGroup.id);
    setEditingGroupId(newGroup.id);
  };

  const deleteGroup = (groupId: string) => {
    onGroupsChange(groups.filter(g => g.id !== groupId));
    if (defaultKeytermGroupId === groupId) {
      // 删除当前默认组 → 默认清空
      onDefaultGroupChange?.(null);
    }
    if (editingGroupId === groupId) {
      setEditingGroupId(groups.find(g => g.id !== groupId)?.id ?? '');
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
    if (!editingGroup || !newKeyterm.trim()) return;

    const newTerms = newKeyterm
      .split(',')
      .map(t => t.trim())
      .filter(t => t && !editingGroup.keyterms.includes(t));

    if (newTerms.length === 0) return;

    onGroupsChange(groups.map(g =>
      g.id === editingGroupId
        ? { ...g, keyterms: [...g.keyterms, ...newTerms] }
        : g
    ));
    setNewKeyterm('');
  };

  const removeKeyterm = (term: string) => {
    onGroupsChange(groups.map(g =>
      g.id === editingGroupId
        ? { ...g, keyterms: g.keyterms.filter(k => k !== term) }
        : g
    ));
  };

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h3 className="apple-heading-small">热词提示</h3>
          <span className="text-xs text-gray-500">
            点击分组切换默认；点击名称进入编辑
          </span>
        </div>

        {/* 分组标签 */}
        <div className="flex flex-wrap gap-2">
          {groups.map((group) => {
            const isDefault = defaultKeytermGroupId === group.id;
            const isEditing = editingGroupId === group.id;
            return (
              <div
                key={group.id}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition-all ${
                  isEditing
                    ? 'bg-blue-100 text-blue-700'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                } ${isDefault ? 'ring-2 ring-blue-500' : ''}`}
                onClick={() => {
                  // 整张卡片：点 chip 切换默认（再次点已选中的 → 取消）
                  if (isDefault) {
                    onDefaultGroupChange?.(null);
                  } else {
                    onDefaultGroupChange?.(group.id);
                  }
                  setEditingGroupId(group.id);
                }}
              >
                <FolderOpen className="h-4 w-4" />
                {renamingGroupId === group.id ? (
                  <input
                    type="text"
                    value={renamingName}
                    onChange={(e) => setRenamingName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && saveEditGroup()}
                    onClick={(e) => e.stopPropagation()}
                    className="bg-transparent border-none outline-none text-sm w-24"
                    autoFocus
                  />
                ) : (
                  <span
                    className="text-sm font-medium"
                    onClick={(e) => {
                      e.stopPropagation();
                      // 点名称：进入该组编辑（不改变默认）
                      setEditingGroupId(group.id);
                    }}
                  >
                    {group.name}
                  </span>
                )}
                <span className="text-xs opacity-60">({group.keyterms.length})</span>
                {isDefault && <Star className="h-3 w-3 fill-blue-500 text-blue-500" />}
                {renamingGroupId === group.id ? (
                  <button
                    onClick={(e) => { e.stopPropagation(); saveEditGroup(); }}
                    className="hover:bg-blue-200 rounded p-0.5"
                  >
                    <Check className="h-3 w-3" />
                  </button>
                ) : (
                  <div className="flex items-center gap-0.5">
                    <button
                      onClick={(e) => { e.stopPropagation(); startEditGroup(group); }}
                      className="hover:bg-blue-200 rounded p-0.5"
                      title="重命名"
                    >
                      <Edit2 className="h-3 w-3" />
                    </button>
                    {groups.length > 1 && (
                      <button
                        onClick={(e) => { e.stopPropagation(); deleteGroup(group.id); }}
                        className="hover:bg-blue-200 rounded p-0.5"
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

        {/* 编辑区：当前组的 keyterms 列表 */}
        {editingGroup ? (
          <div className="space-y-3">
            <div className="text-sm text-gray-700 flex items-center gap-2">
              <span>正在编辑：</span>
              <span className="font-medium text-blue-700">{editingGroup.name}</span>
              {defaultKeytermGroupId === editingGroup.id && (
                <span className="text-xs text-blue-600 bg-blue-50 px-2 py-0.5 rounded">
                  默认分组
                </span>
              )}
            </div>
            {editingGroup.keyterms.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {editingGroup.keyterms.map((term) => (
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
            没有可编辑的分组
          </div>
        )}
      </div>
    </div>
  );
};
