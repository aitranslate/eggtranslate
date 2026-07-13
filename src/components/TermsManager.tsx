import React, { useState, useCallback, useMemo } from 'react';
import { useTermsStore } from '@/stores/termsStore';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Trash2, Edit3, Save, X, Upload, Download, Search } from 'lucide-react';
import toast from 'react-hot-toast';
import { ConfirmDialog } from './ConfirmDialog';
import { downloadTextFile } from '@/utils/fileExport';
import { useErrorHandler } from '@/hooks/useErrorHandler';
import { Button, Input } from '@/components/ui';
import type { Term } from '@/types';

interface TermsManagerProps {
  isOpen: boolean;
  onClose: () => void;
}

export const TermsManager: React.FC<TermsManagerProps> = ({ isOpen, onClose }) => {
  const terms = useTermsStore((state) => state.terms);
  const addTerm = useTermsStore((state) => state.addTerm);
  const deleteTerm = useTermsStore((state) => state.deleteTerm);
  const updateTerm = useTermsStore((state) => state.updateTerm);
  const clearTerms = useTermsStore((state) => state.clearTerms);
  const saveTerms = useTermsStore((state) => state.saveTerms);

  // 派生 importTerms：从文本解析术语行并保存
  const importTerms = useCallback(async (termsText: string) => {
    const lines = termsText.split('\n').filter(line => line.trim());
    const newTerms: Term[] = [];
    const lineRegex = /^(.+?):\s*(.+?)(?:\s*\[(.+)\])?$/;

    for (const line of lines) {
      const match = line.match(lineRegex);
      if (match) {
        newTerms.push({
          original: match[1].trim(),
          translation: match[2].trim(),
          notes: match[3]?.trim()
        });
      }
    }

    await saveTerms(newTerms);
    toast.success('术语导入成功');
  }, [saveTerms]);

  // 派生 exportTerms：将术语列表序列化为可导入的文本
  const exportTerms = useCallback(() => {
    return terms.map(term => {
      if (term.notes) {
        return `${term.original}: ${term.translation} [${term.notes}]`;
      }
      return `${term.original}: ${term.translation}`;
    }).join('\n');
  }, [terms]);

  const { handleError } = useErrorHandler();

  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editOriginal, setEditOriginal] = useState('');
  const [editTranslation, setEditTranslation] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [newOriginal, setNewOriginal] = useState('');
  const [newTranslation, setNewTranslation] = useState('');
  const [newNotes, setNewNotes] = useState('');
  const [importText, setImportText] = useState('');
  const [showImport, setShowImport] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  const onAddTerm = useCallback(async () => {
    if (!newOriginal.trim() || !newTranslation.trim()) {
      toast.error('请输入原文和译文');
      return;
    }

    try {
      await addTerm({
        original: newOriginal.trim(),
        translation: newTranslation.trim(),
        notes: newNotes.trim() || undefined
      });
      setNewOriginal('');
      setNewTranslation('');
      setNewNotes('');
      toast.success('术语添加成功');
    } catch (error) {
      handleError(error, {
        context: { operation: '添加术语' }
      });
    }
  }, [newOriginal, newTranslation, newNotes, addTerm, handleError]);

  const onRemoveTerm = useCallback(async (index: number) => {
    try {
      await deleteTerm(index);
      toast.success('术语已删除');
    } catch (error) {
      handleError(error, {
        context: { operation: '删除术语' }
      });
    }
  }, [deleteTerm, handleError]);

  const onStartEdit = useCallback((index: number) => {
    setEditingIndex(index);
    setEditOriginal(terms[index].original);
    setEditTranslation(terms[index].translation);
    setEditNotes(terms[index].notes || '');
  }, [terms]);

  const onSaveEdit = useCallback(async () => {
    if (editingIndex === null) return;

    if (!editOriginal.trim() || !editTranslation.trim()) {
      toast.error('请输入原文和译文');
      return;
    }

    try {
      await updateTerm(editingIndex, {
        original: editOriginal.trim(),
        translation: editTranslation.trim(),
        notes: editNotes.trim() || undefined
      });
      setEditingIndex(null);
      setEditOriginal('');
      setEditTranslation('');
      setEditNotes('');
      toast.success('术语更新成功');
    } catch (error) {
      handleError(error, {
        context: { operation: '更新术语' }
      });
    }
  }, [editingIndex, editOriginal, editTranslation, editNotes, updateTerm, handleError]);

  const onCancelEdit = useCallback(() => {
    setEditingIndex(null);
    setEditOriginal('');
    setEditTranslation('');
    setEditNotes('');
  }, []);

  const onImport = useCallback(async () => {
    if (!importText.trim()) {
      toast.error('请输入要导入的术语');
      return;
    }

    try {
      await importTerms(importText.trim());
      setImportText('');
      setShowImport(false);
    } catch (error) {
      handleError(error, {
        context: { operation: '导入术语' }
      });
    }
  }, [importText, importTerms, handleError]);

  const onExport = useCallback(() => {
    const content = exportTerms();
    if (!content) {
      toast.error('没有可导出的术语');
      return;
    }

    downloadTextFile(content, 'terms.txt');
    toast.success('术语导出成功');
  }, [exportTerms]);

  const filteredTerms = useMemo(() => {
    if (!searchTerm.trim()) return terms;

    const searchLower = searchTerm.toLowerCase();
    return terms.filter((term) =>
      term.original.toLowerCase().includes(searchLower) ||
      term.translation.toLowerCase().includes(searchLower)
    );
  }, [terms, searchTerm]);

  const onClearAll = useCallback(async () => {
    if (terms.length === 0) return;
    setShowClearConfirm(true);
  }, [terms.length]);

  const handleConfirmClear = useCallback(async () => {
    try {
      await clearTerms();
      toast.success('已清空所有术语');
    } catch (error) {
      handleError(error, {
        context: { operation: '清空术语' }
      });
    } finally {
      setShowClearConfirm(false);
    }
  }, [clearTerms, handleError]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="bg-white shadow-2xl w-full max-w-[calc(100vw-2rem)] md:max-w-[560px] lg:max-w-[680px] rounded-none md:rounded-2xl p-4 md:p-6 max-h-[100dvh] md:max-h-[90vh] overflow-hidden flex flex-col"
      >
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <h2 className="apple-heading-medium">术语管理</h2>
            <span className="px-2.5 py-1 text-sm font-medium rounded-full bg-[var(--apple-blue-soft)] text-[var(--apple-blue)]">
              {terms.length} 个术语
            </span>
          </div>
          <Button iconOnly onClick={onClose} aria-label="关闭">
            <X className="h-5 w-5" />
          </Button>
        </div>

        <div className="space-y-6 flex-1 overflow-y-auto">
          {/* 添加术语 */}
          <div className="space-y-4">
            <h3 className="apple-heading-small">添加新术语</h3>
            <div className="grid grid-cols-12 gap-3 items-center">
              <Input
                placeholder="原文"
                value={newOriginal}
                onChange={(e) => setNewOriginal(e.target.value)}
                className="col-span-3"
                onKeyDown={(e) => e.key === 'Enter' && onAddTerm()}
              />
              <Input
                placeholder="译文"
                value={newTranslation}
                onChange={(e) => setNewTranslation(e.target.value)}
                className="col-span-3"
                onKeyDown={(e) => e.key === 'Enter' && onAddTerm()}
              />
              <Input
                placeholder="说明（可选）"
                value={newNotes}
                onChange={(e) => setNewNotes(e.target.value)}
                className="col-span-4"
                onKeyDown={(e) => e.key === 'Enter' && onAddTerm()}
              />
              <Button onClick={onAddTerm} className="col-span-2">
                <Plus className="h-4 w-4" />
                <span>添加</span>
              </Button>
            </div>
          </div>

          {/* 导入/导出 */}
          <div className="space-y-4">
            <h3 className="apple-heading-small">导入/导出</h3>
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="secondary" size="sm" onClick={() => setShowImport(!showImport)}>
                <Upload className="h-4 w-4" />
                <span>导入术语</span>
              </Button>
              <Button variant="secondary" size="sm" onClick={onExport} disabled={terms.length === 0}>
                <Download className="h-4 w-4" />
                <span>导出术语</span>
              </Button>
              <Button variant="danger" size="sm" onClick={onClearAll} disabled={terms.length === 0}>
                <Trash2 className="h-4 w-4" />
                <span>清空全部</span>
              </Button>
            </div>

            <AnimatePresence>
              {showImport && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="space-y-3"
                >
                  <textarea
                    placeholder="请输入术语，每行一个，原文和译文用冒号(:)分隔，例如：原文:译文..."
                    value={importText}
                    onChange={(e) => setImportText(e.target.value)}
                    rows={6}
                    className="apple-input !h-auto py-3 resize-none"
                  />
                  <div className="flex gap-3">
                    <Button variant="secondary" size="sm" onClick={onImport}>
                      确认导入
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setShowImport(false)}>
                      取消
                    </Button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* 术语列表 */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="apple-heading-small">术语列表</h3>
              <div className="flex items-center gap-3">
                {/* 搜索框 */}
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <input
                    type="text"
                    placeholder="搜索..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-10 pr-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-gray-900 placeholder-gray-400 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all w-40"
                  />
                </div>
              </div>
            </div>

            <div className="space-y-2 h-80 overflow-y-auto">
              <AnimatePresence>
                {filteredTerms.length === 0 ? (
                  <div className="text-center py-8 text-gray-500">
                    {searchTerm ? '没有找到匹配的术语' : '暂无术语，请添加术语或导入术语列表'}
                  </div>
                ) : (
                  filteredTerms.map((term, index) => (
                    <motion.div
                      key={index}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      className="border border-gray-200 rounded-xl p-4 bg-gray-50 hover:bg-gray-100 transition-colors"
                    >
                      {editingIndex === index ? (
                        <div className="space-y-3">
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                            <input
                              type="text"
                              value={editOriginal}
                              onChange={(e) => setEditOriginal(e.target.value)}
                              className="w-full p-2 bg-white border border-gray-200 rounded-lg text-gray-900 focus:outline-none focus:border-blue-500 transition-colors"
                              placeholder="原文"
                            />
                            <input
                              type="text"
                              value={editTranslation}
                              onChange={(e) => setEditTranslation(e.target.value)}
                              className="w-full p-2 bg-white border border-gray-200 rounded-lg text-gray-900 focus:outline-none focus:border-blue-500 transition-colors"
                              placeholder="译文"
                            />
                            <input
                              type="text"
                              value={editNotes}
                              onChange={(e) => setEditNotes(e.target.value)}
                              className="w-full p-2 bg-white border border-gray-200 rounded-lg text-gray-700 placeholder-gray-400 focus:outline-none focus:border-blue-500 transition-colors"
                              placeholder="说明（可选）"
                            />
                          </div>
                          <div className="flex items-center gap-2">
                            <Button size="sm" onClick={onSaveEdit}>
                              <Save className="h-3.5 w-3.5" />
                              <span>保存</span>
                            </Button>
                            <Button variant="ghost" size="sm" onClick={onCancelEdit}>
                              <X className="h-3.5 w-3.5" />
                              <span>取消</span>
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center justify-between">
                          <div className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div>
                              <div className="text-sm text-gray-500 mb-1">原文</div>
                              <div className="text-gray-900 font-medium">{term.original}</div>
                            </div>
                            <div>
                              <div className="text-sm text-gray-500 mb-1">译文</div>
                              <div className="text-blue-600 font-medium">{term.translation}</div>
                            </div>
                            <div>
                              <div className="text-sm text-gray-500 mb-1">说明</div>
                              <div className={term.notes ? 'text-gray-700' : 'text-gray-400 italic'}>
                                {term.notes || '无'}
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-1 ml-4">
                            <button
                              onClick={() => onStartEdit(index)}
                              className="p-2 hover:bg-gray-200 rounded-lg transition-colors"
                            >
                              <Edit3 className="h-4 w-4 text-gray-500" />
                            </button>
                            <button
                              onClick={() => onRemoveTerm(index)}
                              className="p-2 hover:bg-red-100 rounded-lg transition-colors"
                            >
                              <Trash2 className="h-4 w-4 text-red-500" />
                            </button>
                          </div>
                        </div>
                      )}
                    </motion.div>
                  ))
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>
      </motion.div>

      {/* 清空术语确认对话框 */}
      <ConfirmDialog
        isOpen={showClearConfirm}
        onClose={() => setShowClearConfirm(false)}
        onConfirm={handleConfirmClear}
        title="确认清空"
        message={`确定要清空所有 ${terms.length} 个术语吗？此操作不可恢复。`}
        confirmText="确认清空"
        confirmButtonClass="bg-red-500 hover:bg-red-600 text-white"
      />
    </div>
  );
};
