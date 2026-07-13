import React, { useState, useEffect, useCallback, useRef, useLayoutEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import {
  ChevronDown,
  Eye,
  EyeOff,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import toast from 'react-hot-toast';
import type { LlmProfile } from '@/types';
import { type LlmProviderId } from '@/constants/llmProviders';
import {
  listLlmModels,
  MODEL_KIND_LABEL,
  type LlmModelInfo,
} from '@/utils/listLlmModels';
import { toastError } from '@/utils/appToast';
import { Input } from '@/components/ui';
import { ProviderPresetPicker } from './ProviderPresetPicker';
import { useTranslationConfigStore } from '@/stores/translationConfigStore';

interface ApiTestFormProps {
  profiles: LlmProfile[];
  /** 当前服务商 = activeProfile.id */
  activeProfile: LlmProfile;
  onSelectProvider: (id: LlmProviderId) => void;
  onUpdateActiveProfile: (patch: Partial<Omit<LlmProfile, 'id' | 'presetId'>>) => void;
}

export const ApiTestForm: React.FC<ApiTestFormProps> = ({
  profiles,
  activeProfile,
  onSelectProvider,
  onUpdateActiveProfile,
}) => {
  const [showApiKey, setShowApiKey] = useState(false);
  const selectedId = (activeProfile.presetId || activeProfile.id) as LlmProviderId;

  const [endpointOpen, setEndpointOpen] = useState(
    selectedId === 'custom' || !activeProfile.baseURL
  );

  const [chatModels, setChatModels] = useState<LlmModelInfo[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const [menuRect, setMenuRect] = useState<{
    left: number;
    width: number;
    top?: number;
    bottom?: number;
  } | null>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const configuredIds = useMemo(() => {
    const s = new Set<string>();
    for (const p of profiles) {
      if (p.apiKey?.trim()) s.add(p.id);
    }
    return s;
  }, [profiles]);

  const updateMenuPosition = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const maxH = 192;
    const spaceBelow = window.innerHeight - r.bottom - 8;
    const openUp = spaceBelow < Math.min(maxH, 120) && r.top > spaceBelow;
    setMenuRect({
      left: r.left,
      width: r.width,
      ...(openUp
        ? { bottom: window.innerHeight - r.top + 4 }
        : { top: r.bottom + 4 }),
    });
  }, []);

  const cacheModelList = useTranslationConfigStore((state) => state.cacheModelList);

  useEffect(() => {
    const cached = useTranslationConfigStore.getState().cachedModelLists[activeProfile.id] ?? [];
    setChatModels(cached);
    setPickerOpen(false);
    setFilter('');
    setEndpointOpen(selectedId === 'custom' || !activeProfile.baseURL);
    setShowApiKey(false);
  }, [activeProfile.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useLayoutEffect(() => {
    if (!pickerOpen) {
      setMenuRect(null);
      return;
    }
    updateMenuPosition();
  }, [pickerOpen, filter, chatModels.length, updateMenuPosition]);

  useEffect(() => {
    if (!pickerOpen) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (pickerRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setPickerOpen(false);
      setFilter('');
    };
    const onReposition = () => updateMenuPosition();
    document.addEventListener('mousedown', onDoc);
    window.addEventListener('resize', onReposition);
    window.addEventListener('scroll', onReposition, true);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      window.removeEventListener('resize', onReposition);
      window.removeEventListener('scroll', onReposition, true);
    };
  }, [pickerOpen, updateMenuPosition]);

  const handleSelectProvider = (id: LlmProviderId) => {
    onSelectProvider(id);
  };

  const onFetchModels = useCallback(async () => {
    setModelsLoading(true);
    setEndpointOpen(true);
    try {
      const { chatModels: chats, excludedModels } = await listLlmModels(
        activeProfile.baseURL,
        activeProfile.apiKey
      );
      setChatModels(chats);
      cacheModelList(activeProfile.id, chats);

      if (chats.length === 0) {
        toastError(
          excludedModels.length > 0
            ? `返回 ${excludedModels.length} 个模型，但都是生图/视频等，请手填对话模型名`
            : '未解析到可用对话模型，请手填'
        );
        return;
      }

      setPickerOpen(true);
      toast.success(
        excludedModels.length > 0
          ? `已加载 ${chats.length} 个对话模型（已过滤 ${excludedModels.length} 个非对话）`
          : `已加载 ${chats.length} 个对话模型`
      );

      if (!activeProfile.model) {
        onUpdateActiveProfile({ model: chats[0].id });
      }
    } catch (err) {
      setChatModels([]);
      toastError(err instanceof Error ? err.message : '获取模型失败');
    } finally {
      setModelsLoading(false);
    }
  }, [activeProfile.baseURL, activeProfile.apiKey, activeProfile.model, activeProfile.id, onUpdateActiveProfile, cacheModelList]);

  const filteredModels = chatModels.filter((m) =>
    !filter.trim() ? true : m.id.toLowerCase().includes(filter.trim().toLowerCase())
  );

  const canFetch = Boolean(activeProfile.baseURL?.trim() && activeProfile.apiKey?.trim());

  const modelMenu =
    pickerOpen &&
    chatModels.length > 0 &&
    menuRect &&
    createPortal(
      <div
        ref={menuRef}
        role="listbox"
        style={{
          position: 'fixed',
          left: menuRect.left,
          width: menuRect.width,
          top: menuRect.top,
          bottom: menuRect.bottom,
          zIndex: 9999,
        }}
        className="max-h-48 overflow-y-auto rounded-xl border border-gray-200 bg-white shadow-xl"
      >
        {filteredModels.length === 0 ? (
          <p className="px-3 py-2 text-xs text-gray-400">无匹配模型，可继续手填</p>
        ) : (
          filteredModels.map((m) => {
            const active = m.id === activeProfile.model;
            return (
              <button
                key={m.id}
                type="button"
                role="option"
                aria-selected={active}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onUpdateActiveProfile({ model: m.id });
                  setPickerOpen(false);
                  setFilter('');
                }}
                className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-left text-sm transition-colors ${
                  active ? 'bg-blue-50 text-blue-800' : 'text-gray-800 hover:bg-gray-50'
                }`}
              >
                <span className="truncate font-mono text-[13px]">{m.id}</span>
                <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500">
                  {MODEL_KIND_LABEL[m.kind]}
                </span>
              </button>
            );
          })
        )}
      </div>,
      document.body
    );

  return (
    <>
      {modelMenu}

      <ProviderPresetPicker
        selectedId={selectedId}
        activeModel={activeProfile.model}
        configuredIds={configuredIds}
        onSelect={handleSelectProvider}
      />

      <div className="md:col-span-2">
        <label className="block text-sm font-medium text-gray-700 mb-2">API 密钥 *</label>
        <div className="relative">
          <Input
            type={showApiKey ? 'text' : 'password'}
            value={activeProfile.apiKey}
            onChange={(e) => onUpdateActiveProfile({ apiKey: e.target.value })}
            placeholder="粘贴 API Key…"
            autoComplete="off"
            className="!pr-11"
          />
          <button
            type="button"
            onClick={() => setShowApiKey(!showApiKey)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            aria-label={showApiKey ? '隐藏密钥' : '显示密钥'}
          >
            {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
      </div>

      <div className="md:col-span-2">
        <button
          type="button"
          onClick={() => setEndpointOpen((v) => !v)}
          className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900 transition-colors"
          aria-expanded={endpointOpen}
        >
          <ChevronDown
            className={`w-4 h-4 transition-transform duration-200 ${endpointOpen ? 'rotate-0' : '-rotate-90'}`}
          />
          接口地址与模型
          {!endpointOpen && (
            <span className="text-xs text-gray-400 font-normal truncate max-w-[14rem] sm:max-w-xs">
              · {activeProfile.model || '未设模型'}
            </span>
          )}
        </button>

        <AnimatePresence initial={false}>
          {endpointOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
              className="overflow-hidden"
            >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Base URL</label>
                  <Input
                    value={activeProfile.baseURL}
                    onChange={(e) => onUpdateActiveProfile({ baseURL: e.target.value })}
                    placeholder="https://api.example.com/v1"
                  />
                </div>

                <div ref={pickerRef} className="relative">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <label className="block text-sm font-medium text-gray-700">模型</label>
                    <button
                      type="button"
                      onClick={onFetchModels}
                      disabled={!canFetch || modelsLoading}
                      className="inline-flex items-center gap-1 text-xs text-[var(--apple-blue)] hover:opacity-80 disabled:text-gray-400 disabled:cursor-not-allowed"
                    >
                      {modelsLoading ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <RefreshCw className="w-3.5 h-3.5" />
                      )}
                      {modelsLoading ? '获取中…' : '获取模型'}
                    </button>
                  </div>

                  <div className="relative">
                    <Input
                      ref={inputRef}
                      value={pickerOpen ? filter : activeProfile.model}
                      onChange={(e) => {
                        if (pickerOpen) setFilter(e.target.value);
                        else onUpdateActiveProfile({ model: e.target.value });
                      }}
                      onFocus={() => {
                        if (chatModels.length > 0) {
                          setPickerOpen(true);
                          setFilter('');
                        }
                      }}
                      placeholder={
                        chatModels.length > 0 ? '搜索或手填模型名' : '手填模型名，或点获取模型'
                      }
                      className="!pr-10"
                      autoComplete="off"
                    />
                    {chatModels.length > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          setPickerOpen((v) => !v);
                          setFilter('');
                        }}
                        className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600"
                        aria-label="打开模型列表"
                      >
                        <ChevronDown
                          className={`w-4 h-4 transition-transform ${pickerOpen ? 'rotate-180' : ''}`}
                        />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </>
  );
};
