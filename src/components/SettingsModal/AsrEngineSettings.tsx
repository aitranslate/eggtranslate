import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Download, Play, Trash2, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { useTranscriptionStore } from '@/stores/transcriptionStore';
import { useTranslationConfigStore } from '@/stores/translationConfigStore';
import { useIsMobile } from '@/hooks/useIsMobile';
import {
  LOCAL_ASR_MODELS,
  cachedModelBytes,
  deleteLocalModel,
  discardPartialModel,
  downloadLocalModel,
  isEngineLoaded,
  pendingModelBytes,
  probeWebGpu,
  sizeLabel,
  unloadLocalEngine,
} from '@/services/localAsrService';
import type { AsrEngine, LocalAsrModelId } from '@/types/transcription';

const ENGINE_LABELS: Array<{ id: AsrEngine; label: string }> = [
  { id: 'cloud', label: '云端 AssemblyAI' },
  { id: 'local', label: '本地 Bark 3.0' },
];

const BACKEND_LABELS: Array<{ id: 'auto' | 'gpu' | 'cpu'; label: string }> = [
  { id: 'auto', label: '自动（有 WebGPU 就用）' },
  { id: 'gpu', label: 'WebGPU' },
  { id: 'cpu', label: 'CPU（慢，但兼容）' },
];

interface DownloadState {
  pct: number;
  text: string;
}

interface AsrEngineSettingsProps {
  compact?: boolean;
}

/**
 * 识别引擎设置：云端 AssemblyAI / 本地 Bark 3.0（wasm）。
 *
 * 下载按钮跟着每一行模型走，互不影响：谁没下载谁就有「下载」，下载中显示自己的
 * 百分比与「停止」，已缓存显示「已缓存」+ 清除。底部的模型选择只决定用哪个。
 */
export const AsrEngineSettings: React.FC<AsrEngineSettingsProps> = ({ compact = false }) => {
  const engine = useTranscriptionStore((s) => s.asrEngine);
  const setEngine = useTranscriptionStore((s) => s.setAsrEngine);
  const model = useTranscriptionStore((s) => s.localAsrModel);
  const setModel = useTranscriptionStore((s) => s.setLocalAsrModel);
  const backend = useTranscriptionStore((s) => s.localAsrBackend);
  const setBackend = useTranscriptionStore((s) => s.setLocalAsrBackend);
  const isMobile = useIsMobile();
  const sourceLanguage = useTranslationConfigStore((s) => s.config.sourceLanguage);

  const [cached, setCached] = useState<Record<string, number>>({});
  /** 暂停中的下载：模型 id -> 已落盘字节数 */
  const [partials, setPartials] = useState<Record<string, number>>({});
  const [downloads, setDownloads] = useState<Record<string, DownloadState>>({});
  const [gpu, setGpu] = useState<{ available: boolean; name: string } | null>(null);
  /** 引擎是否还占着显存（转录结束后会闲置释放，也可以在下面手动释放） */
  const [engineLoaded, setEngineLoaded] = useState(false);
  const controllers = useRef<Record<string, AbortController>>({});

  useEffect(() => {
    const tick = () => setEngineLoaded(isEngineLoaded());
    tick();
    const id = window.setInterval(tick, 2000);
    return () => window.clearInterval(id);
  }, []);

  const refreshCache = useCallback(async () => {
    const cachedPairs = await Promise.all(
      LOCAL_ASR_MODELS.map(async (m) => [m.id, await cachedModelBytes(m.id)] as const)
    );
    const partialPairs = await Promise.all(
      LOCAL_ASR_MODELS.map(async (m) => [m.id, await pendingModelBytes(m.id)] as const)
    );
    setCached(Object.fromEntries(cachedPairs));
    setPartials(Object.fromEntries(partialPairs));
  }, []);

  useEffect(() => {
    void refreshCache();
  }, [refreshCache]);

  useEffect(() => {
    void probeWebGpu().then(setGpu);
  }, []);

  const patchDownload = useCallback((id: LocalAsrModelId, next: DownloadState | null) => {
    setDownloads((prev) => {
      const copy = { ...prev };
      if (next) copy[id] = next;
      else delete copy[id];
      return copy;
    });
  }, []);

  const onDownload = useCallback(
    async (id: LocalAsrModelId) => {
      if (controllers.current[id]) return;
      const ctrl = new AbortController();
      controllers.current[id] = ctrl;
      patchDownload(id, { pct: 0, text: '准备下载…' });
      try {
        await downloadLocalModel(
          id,
          (p, received, total) => {
            patchDownload(id, {
              pct: Math.round(p * 100),
              text: sizeLabel(received) + ' / ' + sizeLabel(total),
            });
          },
          ctrl.signal
        );
        await refreshCache();
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          toast.error('下载失败：' + (err as Error).message);
        }
      } finally {
        delete controllers.current[id];
        patchDownload(id, null);
        // 取消会留下分片，刷新一下「已暂停 xx%」状态
        void refreshCache();
      }
    },
    [patchDownload, refreshCache]
  );

  const onCancel = useCallback((id: LocalAsrModelId) => {
    controllers.current[id]?.abort();
    delete controllers.current[id];
    setDownloads((prev) => {
      const copy = { ...prev };
      delete copy[id];
      return copy;
    });
  }, []);

  /** 暂停中的下载：继续 / 丢弃 */
  const onResume = useCallback(
    (id: LocalAsrModelId) => {
      void onDownload(id);
    },
    [onDownload]
  );

  const onDiscard = useCallback(
    async (id: LocalAsrModelId) => {
      await discardPartialModel(id);
      await refreshCache();
    },
    [refreshCache]
  );

  const onDelete = useCallback(
    async (id: LocalAsrModelId) => {
      await deleteLocalModel(id);
      if (id === model) unloadLocalEngine();
      await refreshCache();
    },
    [model, refreshCache]
  );

  const models = isMobile ? LOCAL_ASR_MODELS.filter((m) => m.mobileSafe) : LOCAL_ASR_MODELS;

  return (
    <div className={compact ? 'space-y-2' : 'space-y-3'}>
      <div className="flex items-center justify-between">
        <h3
          className={
            compact ? 'text-xs font-semibold text-[var(--wb-text)]' : 'apple-heading-small'
          }
        >
          识别引擎
        </h3>
        <span className="text-[10.5px] text-[var(--wb-text-3)]">
          {engine === 'local' ? '音频不出本机' : '云端 API'}
        </span>
      </div>

      <div className="wb-seg" role="group" aria-label="识别引擎">
        {ENGINE_LABELS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={engine === item.id ? 'is-active' : ''}
            onClick={() => setEngine(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {engine === 'local' && (
        <div className="space-y-2">
          <div className="space-y-1.5">
            {models.map((m) => {
              const bytes = cached[m.id] ?? 0;
              const downloading = downloads[m.id];
              const active = model === m.id;
              return (
                <div
                  key={m.id}
                  className={
                    'rounded-lg border transition-colors ' +
                    (active
                      ? 'border-[var(--wb-brand)] bg-[var(--wb-brand-soft)]'
                      : 'border-[var(--wb-border)] hover:bg-[var(--wb-panel-2)]')
                  }
                >
                  <div className="flex items-center gap-2 px-2.5 py-2">
                    <label className="flex flex-1 min-w-0 items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        className="h-3.5 w-3.5"
                        name="local-asr-model"
                        checked={active}
                        onChange={() => setModel(m.id)}
                      />
                      <span className="min-w-0">
                        <span className="block text-xs font-medium text-[var(--wb-text)]">
                          {m.label}
                        </span>
                        <span className="block text-[10.5px] text-[var(--wb-text-3)]">
                          {sizeLabel(m.bytes)} · {m.note}
                        </span>
                      </span>
                    </label>

                    <span className="flex shrink-0 items-center gap-1">
                      {downloading ? (
                        <>
                          <span className="text-[10.5px] tabular-nums text-[var(--wb-text-3)]">
                            {downloading.pct}%
                          </span>
                          <button
                            type="button"
                            className="wb-proj-icon-btn"
                            title="停止下载"
                            aria-label={'停止下载 ' + m.label}
                            onClick={() => onCancel(m.id)}
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </>
                      ) : bytes > 0 ? (
                        <>
                          <span className="text-[10.5px] text-[var(--wb-text-3)]">已缓存</span>
                          <button
                            type="button"
                            className="wb-proj-icon-btn"
                            title={'清除 ' + m.label + ' 缓存'}
                            aria-label={'清除 ' + m.label + ' 缓存'}
                            onClick={() => void onDelete(m.id)}
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </>
                      ) : (partials[m.id] ?? 0) > 0 ? (
                        <>
                          <span className="text-[10.5px] tabular-nums text-[var(--wb-text-3)]">
                            已暂停 {Math.round(((partials[m.id] ?? 0) / m.bytes) * 100)}%
                          </span>
                          <button
                            type="button"
                            className="wb-proj-icon-btn"
                            title={'继续下载 ' + m.label}
                            aria-label={'继续下载 ' + m.label}
                            onClick={() => onResume(m.id)}
                          >
                            <Play className="h-3 w-3" />
                          </button>
                          <button
                            type="button"
                            className="wb-proj-icon-btn"
                            title={'丢弃 ' + m.label + ' 的未完成下载'}
                            aria-label={'丢弃 ' + m.label + ' 的未完成下载'}
                            onClick={() => void onDiscard(m.id)}
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          className="wb-proj-icon-btn"
                          title={'下载 ' + m.label + '（' + sizeLabel(m.bytes) + '）'}
                          aria-label={'下载 ' + m.label + '（' + sizeLabel(m.bytes) + '）'}
                          onClick={() => void onDownload(m.id)}
                        >
                          <Download className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </span>
                  </div>

                  {downloading && (
                    <div className="px-2.5 pb-2 -mt-0.5">
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--wb-border)]">
                        <div
                          className="h-full rounded-full bg-[var(--wb-brand)] transition-[width]"
                          style={{ width: downloading.pct + '%' }}
                        />
                      </div>
                      <p className="mt-1 text-[10.5px] text-[var(--wb-text-3)]">
                        {downloading.text} · 可关闭面板，下载会继续
                      </p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[10.5px] text-[var(--wb-text-3)] w-14 shrink-0">计算设备</span>
            <select
              className="text-xs rounded-md border border-[var(--wb-border)] bg-[var(--wb-bg)] px-2 py-1"
              value={backend}
              onChange={(e) => setBackend(e.target.value as 'auto' | 'gpu' | 'cpu')}
            >
              {BACKEND_LABELS.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.label}
                </option>
              ))}
            </select>
          </div>

          <p
            className="text-[10.5px] text-[var(--wb-text-3)] leading-relaxed"
            title="WebGPU 用哪块显卡由系统和浏览器决定：Windows 设置 → 系统 → 显示 → 图形 → 找到浏览器 → 选「高性能」"
          >
            {gpu
              ? gpu.available
                ? '显卡：' + gpu.name + ' · WebGPU 就绪'
                : 'WebGPU 不可用（' + gpu.name + '），会退回 CPU'
              : '正在探测 WebGPU…'}
            {' · '}VAD 每 60 s 一段；模型来自 ModelScope 官方镜像。
            {engineLoaded && (
              <>
                {' · '}
                <button
                  type="button"
                  className="underline decoration-dotted underline-offset-2 hover:text-[var(--wb-text-2)]"
                  title="马上把显存还给驱动；下次转录会重新加载模型（约 1 s）并重新编译管线"
                  onClick={() => {
                    unloadLocalEngine();
                    setEngineLoaded(false);
                    toast.success('已释放显存');
                  }}
                >
                  释放显存
                </button>
              </>
            )}
          </p>

          {sourceLanguage !== 'English' && (
            <p className="text-[10.5px] leading-relaxed text-[var(--wb-brand)]">
              当前源语言是「{sourceLanguage}」：本地模型只支持英文，请切回云端或把源语言改成英语。
            </p>
          )}
        </div>
      )}

      {engine === 'cloud' && (
        <p className="text-[10.5px] text-[var(--wb-text-3)]">
          云端识别在 AssemblyAI 服务器完成，需要下面的 API Key；切到「本地」可离线、免 Key。
        </p>
      )}
    </div>
  );
};
