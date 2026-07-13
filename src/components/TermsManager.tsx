import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { useTermsStore } from '@/stores/termsStore';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Trash2, X, Upload, Download, Search } from 'lucide-react';
import toast from 'react-hot-toast';
import { ConfirmDialog } from './ConfirmDialog';
import { downloadTextFile } from '@/utils/fileExport';
import { useErrorHandler } from '@/hooks/useErrorHandler';
import { Button } from '@/components/ui';
import type { Term } from '@/types';

/** 内联输入按内容伸缩的最小宽度（字符数） */
function inlineSize(value: string, min = 2, max = 28): number {
  const len = value.trim().length || value.length;
  return Math.min(max, Math.max(min, len + 1));
}

interface TermsManagerProps {
  isOpen?: boolean;
  onClose?: () => void;
  variant?: 'panel' | 'modal';
}

export const TermsManager: React.FC<TermsManagerProps> = ({
  isOpen = true,
  onClose,
  variant = 'panel',
}) => {
  const terms = useTermsStore((state) => state.terms);
  const addTerm = useTermsStore((state) => state.addTerm);
  const deleteTerm = useTermsStore((state) => state.deleteTerm);
  const updateTerm = useTermsStore((state) => state.updateTerm);
  const clearTerms = useTermsStore((state) => state.clearTerms);
  const saveTerms = useTermsStore((state) => state.saveTerms);

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

  const editDraftRef = useRef({
    index: null as number | null,
    original: '',
    translation: '',
    notes: '',
  });
  const skipBlurSaveRef = useRef(false);
  const editOriginalRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    editDraftRef.current = {
      index: editingIndex,
      original: editOriginal,
      translation: editTranslation,
      notes: editNotes,
    };
  }, [editingIndex, editOriginal, editTranslation, editNotes]);

  useEffect(() => {
    if (editingIndex === null) return;
    const el = editOriginalRef.current;
    if (!el) return;
    el.focus();
    const len = el.value.length;
    el.setSelectionRange(len, len);
  }, [editingIndex]);

  const onStartEdit = useCallback((index: number) => {
    setEditingIndex(index);
    setEditOriginal(terms[index].original);
    setEditTranslation(terms[index].translation);
    setEditNotes(terms[index].notes || '');
  }, [terms]);

  const onCancelEdit = useCallback(() => {
    skipBlurSaveRef.current = true;
    setEditingIndex(null);
    setEditOriginal('');
    setEditTranslation('');
    setEditNotes('');
  }, []);

  const onSaveEdit = useCallback(async () => {
    const draft = editDraftRef.current;
    if (draft.index === null) return;

    const original = draft.original.trim();
    const translation = draft.translation.trim();
    const notes = draft.notes.trim();

    if (!original || !translation) {
      toast.error('请输入原文和译文');
      return;
    }

    const prev = terms[draft.index];
    const unchanged =
      prev &&
      prev.original === original &&
      prev.translation === translation &&
      (prev.notes || '') === notes;

    if (unchanged) {
      setEditingIndex(null);
      setEditOriginal('');
      setEditTranslation('');
      setEditNotes('');
      return;
    }

    try {
      await updateTerm(draft.index, {
        original,
        translation,
        notes: notes || undefined,
      });
      setEditingIndex(null);
      setEditOriginal('');
      setEditTranslation('');
      setEditNotes('');
    } catch (error) {
      handleError(error, {
        context: { operation: '更新术语' }
      });
    }
  }, [terms, updateTerm, handleError]);

  const onEditKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onCancelEdit();
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        skipBlurSaveRef.current = true;
        void onSaveEdit();
      }
    },
    [onCancelEdit, onSaveEdit]
  );

  const onEditBlur = useCallback(
    (e: React.FocusEvent) => {
      const next = e.relatedTarget as Node | null;
      const root = e.currentTarget.closest('.wb-term-chip');
      if (root && next && root.contains(next)) return;
      if (skipBlurSaveRef.current) {
        skipBlurSaveRef.current = false;
        return;
      }
      requestAnimationFrame(() => {
        if (skipBlurSaveRef.current) {
          skipBlurSaveRef.current = false;
          return;
        }
        void onSaveEdit();
      });
    },
    [onSaveEdit]
  );

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

  /** 保留原始 store 下标，避免搜索过滤后编辑/删除打错行 */
  const filteredTerms = useMemo(() => {
    const items = terms.map((term, index) => ({ term, index }));
    if (!searchTerm.trim()) return items;

    const searchLower = searchTerm.toLowerCase();
    return items.filter(({ term }) =>
      term.original.toLowerCase().includes(searchLower) ||
      term.translation.toLowerCase().includes(searchLower) ||
      (term.notes || '').toLowerCase().includes(searchLower)
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

  if (variant === 'modal' && !isOpen) return null;

  const body = (
    <>
      <div className={variant === 'panel' ? 'wb-panel-header' : 'flex items-center justify-between mb-6'}>
        <div className="flex items-center gap-2.5 min-w-0">
          <h2 className={variant === 'panel' ? 'wb-panel-title' : 'apple-heading-medium'}>
            术语
          </h2>
          <span className="wb-panel-chip">{terms.length}</span>
        </div>
        {variant === 'modal' && onClose && (
          <Button variant="ghost" size="sm" onClick={onClose}>关闭</Button>
        )}
      </div>

      <div className={variant === 'panel' ? 'wb-panel-body !flex !flex-col' : 'space-y-4 flex-1 overflow-y-auto'}>
        <div className="wb-glossary-shell flex-1 min-h-0">
          <div className="wb-glossary-toolbar">
            <div className="wb-search">
              <Search />
              <input
                type="text"
                placeholder="搜索词条…"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            <div className="wb-tool-row" style={{ marginLeft: 'auto' }}>
              <button type="button" className="wb-tool" onClick={() => setShowImport(!showImport)}>
                <Upload className="h-3.5 w-3.5" />
                导入
              </button>
              <button type="button" className="wb-tool" onClick={onExport} disabled={terms.length === 0}>
                <Download className="h-3.5 w-3.5" />
                导出
              </button>
              <button type="button" className="wb-tool danger" onClick={onClearAll} disabled={terms.length === 0}>
                <Trash2 className="h-3.5 w-3.5" />
                清空
              </button>
            </div>
          </div>

          <AnimatePresence>
            {showImport && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden border-b border-[var(--wb-border)]"
              >
                <div className="p-2.5 space-y-2 bg-[var(--wb-panel-2)]">
                  <textarea
                    placeholder="每行一条：原文:译文 [备注]"
                    value={importText}
                    onChange={(e) => setImportText(e.target.value)}
                    rows={4}
                    className="apple-input !h-auto py-2 resize-none w-full text-xs"
                  />
                  <div className="wb-tool-row">
                    <button type="button" className="wb-tool primary" onClick={onImport}>确认导入</button>
                    <button type="button" className="wb-tool" onClick={() => setShowImport(false)}>取消</button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="wb-glossary-add">
            <input
              className="wb-glossary-field"
              placeholder="原文"
              value={newOriginal}
              onChange={(e) => setNewOriginal(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && onAddTerm()}
              aria-label="原文"
            />
            <input
              className="wb-glossary-field"
              placeholder="译文"
              value={newTranslation}
              onChange={(e) => setNewTranslation(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && onAddTerm()}
              aria-label="译文"
            />
            <input
              className="wb-glossary-field"
              placeholder="备注（可选）"
              value={newNotes}
              onChange={(e) => setNewNotes(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && onAddTerm()}
              aria-label="备注（可选）"
            />
            <button type="button" className="wb-tool primary wb-glossary-add-btn" onClick={onAddTerm}>
              <Plus className="h-3.5 w-3.5" />
              添加
            </button>
          </div>

          <div className="wb-glossary-scroll">
            {filteredTerms.length === 0 ? (
              <div className="wb-empty">
                {searchTerm ? '没有匹配词条' : '暂无术语，在上方添加或导入'}
              </div>
            ) : (
              <div className="wb-term-cloud" role="list" aria-label="术语标签">
                {filteredTerms.map(({ term, index }) =>
                  editingIndex === index ? (
                    <div
                      key={`edit-${index}`}
                      className="wb-term-chip is-editing"
                      role="listitem"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        ref={editOriginalRef}
                        className="wb-term-inline wb-term-src"
                        value={editOriginal}
                        onChange={(e) => setEditOriginal(e.target.value)}
                        onKeyDown={onEditKeyDown}
                        onBlur={onEditBlur}
                        size={inlineSize(editOriginal, 3)}
                        placeholder="原文"
                        aria-label="原文"
                        spellCheck={false}
                      />
                      <span className="wb-term-arrow" aria-hidden>
                        →
                      </span>
                      <input
                        className="wb-term-inline wb-term-dst"
                        value={editTranslation}
                        onChange={(e) => setEditTranslation(e.target.value)}
                        onKeyDown={onEditKeyDown}
                        onBlur={onEditBlur}
                        size={inlineSize(editTranslation, 3)}
                        placeholder="译文"
                        aria-label="译文"
                        spellCheck={false}
                      />
                      <input
                        className="wb-term-inline wb-term-note"
                        value={editNotes}
                        onChange={(e) => setEditNotes(e.target.value)}
                        onKeyDown={onEditKeyDown}
                        onBlur={onEditBlur}
                        size={inlineSize(editNotes || '备注', 2, 16)}
                        placeholder="备注"
                        aria-label="备注（可选）"
                        spellCheck={false}
                      />
                    </div>
                  ) : (
                    <div
                      key={`${term.original}-${index}`}
                      className="wb-term-chip"
                      role="listitem"
                      title={
                        term.notes
                          ? `${term.original} → ${term.translation}\n${term.notes}`
                          : `${term.original} → ${term.translation}`
                      }
                    >
                      <button
                        type="button"
                        className="wb-term-chip-main"
                        onClick={() => onStartEdit(index)}
                      >
                        <span className="wb-term-src">{term.original}</span>
                        <span className="wb-term-arrow" aria-hidden>
                          →
                        </span>
                        <span className="wb-term-dst">{term.translation}</span>
                        {term.notes ? (
                          <span className="wb-term-note">{term.notes}</span>
                        ) : null}
                      </button>
                      <button
                        type="button"
                        className="wb-term-chip-x"
                        onClick={() => onRemoveTerm(index)}
                        title="删除"
                        aria-label={`删除 ${term.original}`}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  )
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );

  const dialog = (
    <ConfirmDialog
      isOpen={showClearConfirm}
      onClose={() => setShowClearConfirm(false)}
      onConfirm={handleConfirmClear}
      title="清空术语？"
      message={`将删除全部 ${terms.length} 个词条，且不可恢复。`}
      confirmText="清空"
      tone="danger"
    />
  );

  if (variant === 'panel') {
    return (
      <div className="wb-panel">
        {body}
        {dialog}
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-white shadow-2xl w-full max-w-[680px] rounded-2xl p-5 max-h-[90vh] overflow-hidden flex flex-col"
      >
        {body}
      </motion.div>
      {dialog}
    </div>
  );
};
