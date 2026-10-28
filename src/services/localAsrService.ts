/**
 * 本地 ASR：Silero VAD（按 60 s 分段）+ Bark 3.0（wasm，WebGPU/CPU 双后端）。
 *
 * 输出与 assemblyaiService 同形：词表 { text, start, end }（秒），
 * 因此 pipeline 里的断句 / 字幕 / 翻译一行都不用改。
 *
 * 三层缓存：
 * 1. 原始权重（163 MB - 1.25 GB）→ IndexedDB（localforage），避免重复下载；
 * 2. 解码后的张量 → bark3 wasm 自己的 OPFS 缓存（首次约 12 s，二次约 2 s）；
 * 3. 页面内实例 → 同一模型只 create() 一次，后续任务复用。
 */

import localforage from 'localforage';
import type { AsrCheckpointWord } from '@/services/checkpoint';
import type { LocalAsrBackend, LocalAsrModelId } from '@/types/transcription';
import { logger } from '@/utils/logger';

export type { LocalAsrBackend, LocalAsrModelId };

/* ------------------------------------------------------------------ 模型目录 */

export interface LocalAsrModelInfo {
  id: LocalAsrModelId;
  label: string;
  /** 官方发布名，传给 wasm 做 modelInfo() 展示 */
  release: string;
  repo: string;
  file: string;
  bytes: number;
  /** 一行说明，直接显示在模型单选里 */
  note: string;
  /** 移动端是否默认开放（Pro 1.25 GB 不给手机） */
  mobileSafe: boolean;
}

const MS_BASE = 'https://modelscope.cn/models/ConwayResearch';

export const LOCAL_ASR_MODELS: readonly LocalAsrModelInfo[] = [
  {
    id: 'plus',
    label: 'Bark 3.0 Plus',
    release: 'Underdog-Bark-3.0-Plus',
    repo: 'Underdog-Bark-3.0-Plus',
    file: 'model.bark',
    bytes: 179524845,
    note: '低比特 · 速度优先',
    mobileSafe: true,
  },
  {
    id: 'bark3',
    label: 'Bark 3.0',
    release: 'Underdog-Bark-3.0',
    repo: 'Underdog-Bark-3.0',
    file: 'model.bark',
    bytes: 163398645,
    note: '低比特 · 体积最小',
    mobileSafe: true,
  },
  {
    id: 'clean',
    label: 'Bark 3.0 Clean',
    release: 'Underdog-Bark-3.0-Clean',
    repo: 'Underdog-Bark-3.0-Clean',
    file: 'model.bark',
    bytes: 179458613,
    note: '低比特 · 去口头语',
    mobileSafe: true,
  },
  {
    id: 'pro',
    label: 'Bark 3.0 Pro',
    release: 'Underdog-Bark-3.0-Pro',
    repo: 'Underdog-Bark-3.0-Pro',
    file: 'model.safetensors',
    bytes: 1254196636,
    note: 'bf16 · 精度最好',
    mobileSafe: false,
  },
] as const;

export const DEFAULT_LOCAL_MODEL: LocalAsrModelId = 'plus';

export function modelById(id: LocalAsrModelId): LocalAsrModelInfo {
  return LOCAL_ASR_MODELS.find((m) => m.id === id) ?? LOCAL_ASR_MODELS[0];
}

export function modelUrl(id: LocalAsrModelId): string {
  const m = modelById(id);
  return MS_BASE + '/' + m.repo + '/resolve/master/' + m.file;
}

/* ------------------------------------------------------------------ 进度模型 */

export type LocalAsrPhase = 'download' | 'decode' | 'load' | 'vad' | 'transcribe';

export interface LocalAsrProgress {
  phase: LocalAsrPhase;
  /** 0..1，整条本地链路的进度 */
  percent: number;
  detail?: string;
}

export interface LocalAsrOptions {
  model: LocalAsrModelId;
  backend: LocalAsrBackend;
  /** VAD 分段上限，默认 60 s */
  maxChunkSeconds?: number;
  onProgress?: (p: LocalAsrProgress) => void;
  signal?: AbortSignal;
}

export interface LocalAsrResult {
  words: AsrCheckpointWord[];
  language: string;
  /** 本地没有远端 id，用固定前缀 + 指纹占位，供 UI / checkpoint 显示 */
  transcriptId: string;
  keyFingerprint: string;
  durationSeconds: number;
}

/* ------------------------------------------------------------------ 缓存 */

function modelKey(id: LocalAsrModelId): string {
  return 'local_asr:model:' + id;
}

export async function hasLocalModel(id: LocalAsrModelId): Promise<boolean> {
  const blob = await localforage.getItem<Blob>(modelKey(id));
  return Boolean(blob && blob.size > 0);
}

/** 人类可读的大小：GB 两位小数，其余按 MB 取整（图里和 ModelScope 卡片一致） */
export function sizeLabel(bytes: number): string {
  if (bytes >= 1_000_000_000) return (bytes / 1_000_000_000).toFixed(2) + ' GB';
  return Math.round(bytes / 1_000_000) + ' MB';
}

/** 已缓存模型的字节数（UI 显示「已缓存」用） */
export async function cachedModelBytes(id: LocalAsrModelId): Promise<number> {
  const blob = await localforage.getItem<Blob>(modelKey(id));
  return blob?.size ?? 0;
}

export async function deleteLocalModel(id: LocalAsrModelId): Promise<void> {
  await localforage.removeItem(modelKey(id));
  await discardPartialModel(id);
  loadedModel = null;
}

async function loadModelBytes(id: LocalAsrModelId): Promise<Uint8Array> {
  const blob = await localforage.getItem<Blob>(modelKey(id));
  if (!blob || blob.size === 0) {
    throw new Error(
      '本地模型「' + modelById(id).label + '」还没下载：设置 → 转录 → 识别引擎'
    );
  }
  return new Uint8Array(await blob.arrayBuffer());
}

/* ------------------------------------------------------- 断点续传（分片） */

/**
 * 未完成的下载按 8 MB 分片存在 IndexedDB：
 * - 分片存 Blob（不复制字节），最后拼成一个 Blob（Blob 组合本身也不复制）
 * - 元数据记 received / total / etag，恢复时用 `Range` + `If-Range` 续传
 * - 服务器不认 Range 或 ETag 变了，就从 0 重来
 */
const CHUNK_BYTES = 8 * 1024 * 1024;

interface PartialMeta {
  received: number;
  total: number;
  etag: string | null;
  chunks: number;
  updatedAt: number;
}

function partMetaKey(id: LocalAsrModelId): string {
  return 'local_asr:part-meta:' + id;
}

function partChunkKey(id: LocalAsrModelId, index: number): string {
  return 'local_asr:part:' + id + ':' + index;
}

/** 未完成下载已落盘的字节数（0 = 没有暂停中的下载）。 */
export async function pendingModelBytes(id: LocalAsrModelId): Promise<number> {
  const meta = await localforage.getItem<PartialMeta>(partMetaKey(id));
  return meta?.received ?? 0;
}

/** 丢掉暂停中的分片（用户点「丢弃」时调用）。 */
export async function discardPartialModel(id: LocalAsrModelId): Promise<void> {
  const meta = await localforage.getItem<PartialMeta>(partMetaKey(id));
  if (meta) {
    for (let i = 0; i < meta.chunks; i += 1) {
      await localforage.removeItem(partChunkKey(id, i));
    }
  }
  await localforage.removeItem(partMetaKey(id));
}

async function readMeta(id: LocalAsrModelId): Promise<PartialMeta | null> {
  return localforage.getItem<PartialMeta>(partMetaKey(id));
}

/** 下载（支持取消后续传）。已有完整缓存时直接回调 100%。 */
export async function downloadLocalModel(
  id: LocalAsrModelId,
  onProgress?: (percent: number, received: number, total: number) => void,
  signal?: AbortSignal
): Promise<void> {
  const info = modelById(id);
  if ((await cachedModelBytes(id)) > 0) {
    onProgress?.(1, info.bytes, info.bytes);
    return;
  }

  const url = modelUrl(id);
  const resume = await readMeta(id);
  let received = resume?.received ?? 0;
  let total = resume?.total ?? info.bytes;
  let etag = resume?.etag ?? null;
  let chunks = resume?.chunks ?? 0;

  const fetchWith = (from: number) =>
    fetch(
      url,
      from > 0
        ? {
            signal,
            headers: etag
              ? { Range: 'bytes=' + from + '-', 'If-Range': etag }
              : { Range: 'bytes=' + from + '-' },
          }
        : { signal }
    );

  let resp = await fetchWith(received);
  // 续传被拒（服务器不支持 Range、或文件已更新）：清掉分片，从头来
  if (received > 0 && resp.status !== 206) {
    logger.info('[local-asr] 续传被拒（HTTP ' + resp.status + '），重新开始');
    await discardPartialModel(id);
    received = 0;
    chunks = 0;
    etag = null;
    total = info.bytes;
    resp = await fetchWith(0);
  }
  if (!resp.ok) {
    throw new Error('模型下载失败：HTTP ' + resp.status);
  }
  if (received === 0) {
    etag = resp.headers.get('etag') || resp.headers.get('x-linked-etag');
    const len = Number(resp.headers.get('content-length'));
    if (len) total = len;
  } else {
    const range = resp.headers.get('content-range');
    const parsed = range ? /\/(\d+)$/.exec(range) : null;
    if (parsed) total = Number(parsed[1]);
  }
  logger.info(
    '[local-asr] 下载 ' + (received > 0 ? '续传自 ' + sizeLabel(received) + ' / ' : '') + sizeLabel(total)
  );

  let buffer: BlobPart[] = [];
  let buffered = 0;

  const flushChunk = async () => {
    if (!buffered) return;
    await localforage.setItem(partChunkKey(id, chunks), new Blob(buffer));
    chunks += 1;
    buffer = [];
    buffered = 0;
    const meta: PartialMeta = { received, total, etag, chunks, updatedAt: Date.now() };
    await localforage.setItem(partMetaKey(id), meta);
  };

  try {
    const reader = resp.body?.getReader();
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        buffer.push(new Uint8Array(value));
        buffered += value.byteLength;
        received += value.byteLength;
        onProgress?.(Math.min(1, received / total), received, total);
        if (buffered >= CHUNK_BYTES) await flushChunk();
      }
    } else {
      const buf = await resp.arrayBuffer();
      buffer.push(new Uint8Array(buf));
      buffered += buf.byteLength;
      received += buf.byteLength;
      onProgress?.(1, received, total);
      await flushChunk();
    }
    await flushChunk();

    // 拼接：分片都是 Blob，new Blob([...]) 不复制字节
    const parts: Blob[] = [];
    for (let i = 0; i < chunks; i += 1) {
      const part = await localforage.getItem<Blob>(partChunkKey(id, i));
      if (part) parts.push(part);
    }
    const blob = new Blob(parts, { type: 'application/octet-stream' });
    if (blob.size !== total) {
      throw new Error(
        '模型下载不完整（' + blob.size + '/' + total + ' 字节），已保留，可继续下载'
      );
    }
    await localforage.setItem(modelKey(id), blob);
    await discardPartialModel(id);
    logger.info('[local-asr] 模型已缓存 ' + sizeLabel(blob.size));
  } catch (err) {
    // 取消或出错：把缓冲里最后一点也落盘，下次从断点继续
    try {
      await flushChunk();
    } catch {
      // 落盘失败也不影响把原始错误抛出去
    }
    throw err;
  }
}

/* ------------------------------------------------------------------ wasm */

interface BarkAsrInstance {
  modelInfo(): string;
  device(): string;
  backend(): string;
  /** 一次解码一整段（我们自己按 VAD 切点分段） */
  transcribe(samples: Float32Array): Promise<string>;
  transcribeChunked(samples: Float32Array, cuts: number[]): Promise<string>;
}

interface BarkModule {
  default: () => Promise<unknown>;
  BarkAsr: {
    create(bytes: Uint8Array, release: string, backend: string): Promise<BarkAsrInstance>;
  };
}

interface VadInstance {
  analyse(samples: Float32Array, maxSeconds?: number): string;
}

interface VadModule {
  default: () => Promise<unknown>;
  SileroVad: { create(): VadInstance };
}

const WASM_BASE = String(import.meta.env.BASE_URL) + 'wasm/';

let barkModule: Promise<BarkModule> | null = null;
let vadModule: Promise<VadModule> | null = null;
let vadInstance: VadInstance | null = null;
/** 当前已创建实例对应的「模型 + 设备」；切换任一项都要重建 */
let loadedModel: { key: string; instance: BarkAsrInstance } | null = null;

function engineKey(model: LocalAsrModelId, backend: LocalAsrBackend): string {
  return model + ':' + backend;
}

async function importWasm<T>(file: string): Promise<T> {
  const url = new URL(WASM_BASE + file, window.location.origin).href;
  // 运行时 URL：交给浏览器原生 ESM 加载，不进 Vite 依赖图
  return (await import(/* @vite-ignore */ url)) as T;
}

function ensureBark(): Promise<BarkModule> {
  if (!barkModule) {
    barkModule = (async () => {
      const mod = await importWasm<BarkModule>('bark3_wasm.js');
      await mod.default();
      return mod;
    })().catch((err) => {
      barkModule = null;
      throw err;
    });
  }
  return barkModule;
}

function ensureVad(): Promise<VadModule> {
  if (!vadModule) {
    vadModule = (async () => {
      const mod = await importWasm<VadModule>('silero_vad_wasm.js');
      await mod.default();
      return mod;
    })().catch((err) => {
      vadModule = null;
      throw err;
    });
  }
  return vadModule;
}

/**
 * 探测页面拿到的 WebGPU 适配器。
 *
 * 必须和引擎用同一组选项（high-performance），否则面板显示的和实际算的那块卡可能
 * 不是同一个。注意 Windows 上的 Chromium 会忽略这个提示，真正决定用哪块卡的是
 * 系统的「图形设置 → 按应用选择 GPU」（https://crbug.com/369219127）。
 */
/**
 * 把 WebGPU 的 vendor/architecture 换成能读的名字。
 *
 * 浏览器只肯给这几个字段（device / description 基本是空字符串，属于隐私保护），
 * 所以能显示到「NVIDIA Pascal」这一级，拿不到具体的产品型号。
 */
export function formatAdapterName(info: {
  vendor?: string;
  architecture?: string;
  device?: string;
}): string {
  const vendor = (info.vendor || '').trim();
  const arch = (info.architecture || '').trim();
  const lower = vendor.toLowerCase();
  const brand = lower.includes('nvidia')
    ? 'NVIDIA'
    : lower.includes('intel')
      ? 'Intel'
      : lower.includes('amd') || lower.includes('advanced micro')
        ? 'AMD'
        : lower.includes('apple')
          ? 'Apple'
          : lower.includes('qualcomm')
            ? 'Qualcomm'
            : lower.includes('google')
              ? 'Google'
              : vendor;
  const archLabel = arch
    .replace(/[-_]+/g, ' ')
    .replace(/\b[a-z]/g, (c) => c.toUpperCase())
    .trim();
  const parts = [brand, archLabel !== brand ? archLabel : ''].filter(Boolean);
  return parts.length ? parts.join(' ') : info.device || 'WebGPU 适配器';
}

export async function probeWebGpu(): Promise<{ available: boolean; name: string }> {
  const gpu = (
    navigator as Navigator & {
      gpu?: {
        requestAdapter(options?: { powerPreference?: 'high-performance' }): Promise<unknown>;
      };
    }
  ).gpu;
  if (!gpu) return { available: false, name: '浏览器不支持 WebGPU' };
  try {
    const adapter = (await gpu.requestAdapter({ powerPreference: 'high-performance' })) as {
      info?: { vendor?: string; architecture?: string; device?: string };
    } | null;
    if (!adapter) return { available: false, name: '没有可用适配器' };
    return { available: true, name: formatAdapterName(adapter.info ?? {}) };
  } catch (err) {
    return { available: false, name: err instanceof Error ? err.message : '探测失败' };
  }
}

/* ------------------------------------------------------------------ 音频 */

async function decodeTo16k(blob: Blob): Promise<Float32Array> {
  const arrayBuffer = await blob.arrayBuffer();
  const ctx = new AudioContext();
  try {
    const decoded = await ctx.decodeAudioData(arrayBuffer);
    const frames = Math.max(1, Math.ceil(decoded.duration * 16000));
    const offline = new OfflineAudioContext(1, frames, 16000);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start();
    const rendered = await offline.startRendering();
    return rendered.getChannelData(0);
  } finally {
    void ctx.close();
  }
}

/* ------------------------------------------------------------------ 主流程 */

const hasSpeechContent = (text: string): boolean => /[\p{L}\p{N}]/u.test(text);

/** 16 kHz 采样率；分段的样本下标都按它换算 */
const SAMPLE_RATE = 16_000;

/**
 * 解码器是否在打转：同一个词连续出现达到阈值次数。
 *
 * 贪心 TDT 解码在边界音频上会一路吐同一个 token（"tamb tamb ..."），一屏几十个；
 * 正常的句子不可能连续重复 6 次同一个词，拿它当重解的信号足够安全。
 */
export function isRepetitive(words: ReadonlyArray<{ text: string }>, threshold = 6): boolean {
  let run = 1;
  for (let i = 1; i < words.length; i += 1) {
    const prev = words[i - 1].text.trim().toLowerCase();
    const cur = words[i].text.trim().toLowerCase();
    run = cur === prev ? run + 1 : 1;
    if (run >= threshold) return true;
  }
  return false;
}

/** 每段两侧最多补 0.2 s 上下文；实际会用 VAD 找到的静音边界夹住它 */
const CHUNK_CONTEXT = 0.2;

/**
 * wasm 词表 → 管线词表（纯函数，便于测试）。
 *
 * 只做两件事：丢掉纯标点词、裁掉多余字段。单位保持秒，顺序保持原样。
 */
export function mapLocalWords(
  words: ReadonlyArray<{ text: string; start: number; end: number }>
): AsrCheckpointWord[] {
  return words
    .filter((w) => hasSpeechContent(w.text))
    .map((w) => ({ text: w.text, start: w.start, end: w.end }));
}

/**
 * 本地转写：解码 → VAD 切段（≤ maxChunkSeconds，默认 60 s）→ bark3 逐段解码 → 词表。
 *
 * words 与 AssemblyAI 的 extractWords 完全同形：秒、单调、无重叠。
 */
export async function transcribeLocal(
  audio: Blob,
  options: LocalAsrOptions
): Promise<LocalAsrResult> {
  const { model, backend, maxChunkSeconds = 60, onProgress, signal } = options;
  const info = modelById(model);
  const checkAbort = () => {
    if (signal?.aborted) throw new DOMException('已取消', 'AbortError');
  };

  onProgress?.({ phase: 'decode', percent: 0.02, detail: '解码音频' });
  const samplesPromise = decodeTo16k(audio);

  if (!(await hasLocalModel(model))) {
    onProgress?.({ phase: 'download', percent: 0.05, detail: '下载 ' + info.label });
    await downloadLocalModel(
      model,
      (p, received, total) => {
        onProgress?.({
          phase: 'download',
          percent: 0.05 + p * 0.35,
          detail:
            '下载 ' +
            info.label +
            ' ' +
            (received / 1024 / 1024).toFixed(0) +
            '/' +
            (total / 1024 / 1024).toFixed(0) +
            ' MB',
        });
      },
      signal
    );
  }
  checkAbort();

  const samples = await samplesPromise;
  checkAbort();
  onProgress?.({ phase: 'decode', percent: 0.42, detail: '音频就绪' });

  onProgress?.({ phase: 'load', percent: 0.45, detail: '加载 ' + info.label });
  const bark = await ensureBark();
  const wanted = engineKey(model, backend);
  if (loadedModel?.key !== wanted) {
    // 换模型或换设备都要重建实例：旧实例的权重和 pipeline 不通用
    loadedModel = null;
    const bytes = await loadModelBytes(model);
    const instance = await bark.BarkAsr.create(bytes, info.release, backend);
    loadedModel = { key: wanted, instance };
    logger.info('[local-asr] 引擎就绪：' + instance.modelInfo() + ' · ' + instance.device());
  }
  const engine = loadedModel.instance;
  checkAbort();

  onProgress?.({ phase: 'vad', percent: 0.55, detail: 'VAD 分段' });
  const vad = await ensureVad();
  if (!vadInstance) vadInstance = vad.SileroVad.create();
  const analysis = JSON.parse(vadInstance.analyse(samples, maxChunkSeconds)) as {
    cuts: number[];
    speech: [number, number][];
  };
  const cuts = Array.isArray(analysis.cuts) ? analysis.cuts : [];
  logger.info(
    '[local-asr] ' +
      (analysis.speech?.length ?? 0) +
      ' 个语音段，' +
      cuts.length +
      ' 个切点（≤' +
      maxChunkSeconds +
      's）'
  );
  checkAbort();

  // ④ 逐段解码。分段在 JS 里做，而不是交给 wasm 的 transcribeChunked：
  // 它在连续跑 30+ 段之后会稳定地吐出重复 token（Edge/Intel 集显上实测 561 个
  // "tamb"），而同样的音频逐段单独调用 transcribe() 是干净的。在 JS 里分段
  // 还顺带拿到了每段的进度和失败重试的抓手。
  const duration = samples.length / 16000;
  const speech = Array.isArray(analysis.speech) ? analysis.speech : [];
  /**
   * 上下文的真正用途是给编码器一点前置音频，让跨切点的词不被切掉；
   * 但它只能落在**静音**里——切点是静音中点，两侧各 0.2 s 只在静音足够宽时才
   * 成立。静音短的时候 0.2 s 会把邻句的起音带进来，贪心 TDT 解码器在那种边界上
   * 会一路重复同一个 token（实测 "tamb tamb ..."）。所以把上下文夹到静音范围内。
   */
  const silenceAround = (t: number, side: 'before' | 'after'): number | null => {
    let best: number | null = null;
    for (const [start, end] of speech) {
      if (side === 'before' && end <= t + 1e-3) best = best === null ? end : Math.max(best, end);
      if (side === 'after' && start >= t - 1e-3) best = best === null ? start : Math.min(best, start);
    }
    return best;
  };

  const bounds = [0, ...cuts.filter((c) => c > 0 && c < duration), duration];
  const spans: Array<[number, number]> = [];
  for (let i = 0; i < bounds.length - 1; i += 1) {
    const from = bounds[i];
    const to = bounds[i + 1];
    if (to <= from + 0.05) continue;
    // VAD 的 chunk_cuts 已经保证 ≤ maxChunkSeconds，这里再兜一层：编码器的注意力
    // 是 T² 的，一段 40 分钟能直接把显存撑爆，宁可多切一刀。
    const pieces = Math.ceil((to - from) / maxChunkSeconds);
    for (let k = 0; k < pieces; k += 1) {
      const pieceFrom = from + ((to - from) * k) / pieces;
      const pieceTo = k === pieces - 1 ? to : from + ((to - from) * (k + 1)) / pieces;
      spans.push([pieceFrom, pieceTo]);
    }
  }
  logger.info(
    '[local-asr] ' + spans.length + ' 段，最长 ' +
      Math.max(0, ...spans.map(([a, b]) => Math.round(b - a))) + ' s'
  );

  const collected: AsrCheckpointWord[] = [];
  const decodeSpan = async (from: number, to: number): Promise<AsrCheckpointWord[]> => {
    const a = Math.floor(from * SAMPLE_RATE);
    const b = Math.min(samples.length, Math.floor(to * SAMPLE_RATE));
    if (b <= a) return [];
    const json = JSON.parse(await engine.transcribe(samples.subarray(a, b))) as {
      words: { text: string; start: number; end: number }[];
    };
    return mapLocalWords(json.words);
  };

  for (let i = 0; i < spans.length; i += 1) {
    checkAbort();
    const [from, to] = spans[i];
    const prevSpeechEnd = silenceAround(from, 'before');
    const nextSpeechStart = silenceAround(to, 'after');
    const lo = Math.max(0, prevSpeechEnd ?? 0, from - CHUNK_CONTEXT);
    const hi = Math.min(duration, nextSpeechStart ?? duration, to + CHUNK_CONTEXT);

    // 上下文只落在静音里（见上面的 silenceAround），所以不会再出现"把邻句起音带进来"
    // 那种边界。万一仍然整段重复，只记日志、不改输出：压掉重复会把模型自己的
    // 问题藏起来，宁可让它出声，也好过悄悄改词。
    const offset = lo;
    const words = await decodeSpan(lo, hi);
    if (isRepetitive(words)) {
      logger.warn(
        '[local-asr] 这一段输出整段重复，请记录上下文：' + from.toFixed(1) + '-' + to.toFixed(1)
      );
    }

    for (const raw of words) {
      const word = {
        text: raw.text,
        start: raw.start + offset,
        end: Math.min(raw.end + offset, duration),
      };
      // 一个词只归它中点所在的那一段，跨切点的词不会重复
      const middle = 0.5 * (word.start + word.end);
      if (middle >= from && middle < to) collected.push(word);
    }
    onProgress?.({
      phase: 'transcribe',
      percent: 0.6 + (0.4 * (i + 1)) / spans.length,
      detail: '转写 ' + (i + 1) + '/' + spans.length,
    });
  }

  collected.sort((x, y) => x.start - y.start);
  const words = collected;

  onProgress?.({ phase: 'transcribe', percent: 1, detail: words.length + ' 词' });

  const lastEnd = words.length ? words[words.length - 1].end : duration;
  return {
    words,
    language: 'en',
    transcriptId: 'local:' + model + ':' + words.length + ':' + Math.round(lastEnd * 1000),
    keyFingerprint: 'local',
    durationSeconds: duration,
  };
}



/** 释放页面内的引擎实例（清理缓存时调用；换模型/设备会自动重建）。 */
export function unloadLocalEngine(): void {
  loadedModel = null;
}
