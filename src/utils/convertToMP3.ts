/**
 * FFmpeg.wasm：任意音视频 → 16kHz 单声道 MP3（只抽音轨）
 *
 * 唯一转码入口。调用方：filesService.addFile。
 * 转录链路只消费 IndexedDB 里的结果，不再二次转码。
 * core/wasm 经 Cache API 缓存，二次访问少下 ~30MB。
 */
import { FFmpeg, FFFSType } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import { logger } from '@/utils/logger';

const TARGET_SR = 16000;
const TARGET_BITRATE = '64k';

/** 单线程 core：Cloudflare Pages 无需 COOP/COEP */
const CORE_BASE =
  'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm';

const CACHE_NAME = 'egg-ffmpeg-core-v1';

let ffmpegInstance: FFmpeg | null = null;
let loadPromise: Promise<FFmpeg> | null = null;
/** 串行 exec，避免多文件抢同一 WASM 实例 */
let queue: Promise<unknown> = Promise.resolve();

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

function extOf(name: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(name || '');
  return m ? m[1].toLowerCase() : 'bin';
}

function safeInputName(file: File): string {
  return `input.${extOf(file.name) || 'bin'}`;
}

/**
 * 优先 Cache Storage，失败再网络；供 toBlobURL 使用的同源 blob。
 */
async function cachedBlobURL(url: string, mime: string): Promise<string> {
  try {
    if (typeof caches !== 'undefined') {
      const cache = await caches.open(CACHE_NAME);
      let res = await cache.match(url);
      if (!res) {
        res = await fetch(url);
        if (res.ok) {
          await cache.put(url, res.clone());
        }
      }
      if (res.ok) {
        const buf = await res.arrayBuffer();
        const blob = new Blob([buf], { type: mime });
        return URL.createObjectURL(blob);
      }
    }
  } catch (e) {
    logger.warn('[ffmpeg] Cache API 不可用，直连 CDN', e);
  }
  return toBlobURL(url, mime);
}

async function getFFmpeg(): Promise<FFmpeg> {
  if (ffmpegInstance?.loaded) return ffmpegInstance;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    const ffmpeg = new FFmpeg();
    // 转码热路径不打 log 到 React；仅 DEV 且可选
    if (import.meta.env.DEV) {
      ffmpeg.on('log', ({ message }) => {
        logger.info('[ffmpeg]', message);
      });
    }

    await ffmpeg.load({
      coreURL: await cachedBlobURL(`${CORE_BASE}/ffmpeg-core.js`, 'text/javascript'),
      wasmURL: await cachedBlobURL(
        `${CORE_BASE}/ffmpeg-core.wasm`,
        'application/wasm'
      ),
    });

    ffmpegInstance = ffmpeg;
    return ffmpeg;
  })().catch((err) => {
    loadPromise = null;
    ffmpegInstance = null;
    throw err;
  });

  return loadPromise;
}

/** 空闲预热：拉取/命中缓存 ffmpeg-core */
export function warmupFfmpeg(): void {
  if (typeof window === 'undefined') return;
  void getFFmpeg().catch((e) => {
    logger.warn('FFmpeg 预热失败（可忽略，首次转码时重试）', e);
  });
}

/**
 * 任意常见音视频 → 16kHz mono MP3 Blob。
 * 统一重编码，保证采样率/声道与转录链路一致。
 */
export async function convertToMP3(
  file: File,
  onProgress?: (progress: number) => void
): Promise<Blob> {
  return enqueue(async () => {
    const ffmpeg = await getFFmpeg();
    const inputName = safeInputName(file);
    const outputName = 'output.mp3';
    const mountDir = '/work';
    let mounted = false;
    let wroteInput = false;

    const onProg = ({ progress }: { progress: number }) => {
      if (typeof progress === 'number' && Number.isFinite(progress)) {
        onProgress?.(Math.min(1, Math.max(0, progress)));
      }
    };
    ffmpeg.on('progress', onProg);

    try {
      await safeDelete(ffmpeg, outputName);
      await safeUnmount(ffmpeg, mountDir);

      let inputPath = inputName;

      try {
        await ffmpeg.createDir(mountDir).catch(() => undefined);
        await ffmpeg.mount(
          FFFSType.WORKERFS,
          { blobs: [{ name: inputName, data: file }] },
          mountDir
        );
        inputPath = `${mountDir}/${inputName}`;
        mounted = true;
        logger.info(
          `[ffmpeg] WORKERFS: ${file.name} (${(file.size / 1024 / 1024).toFixed(1)}MB)`
        );
      } catch (mountErr) {
        logger.warn('[ffmpeg] WORKERFS 不可用，回退 writeFile', mountErr);
        await ffmpeg.writeFile(inputName, await fetchFile(file));
        inputPath = inputName;
        wroteInput = true;
      }

      onProgress?.(0.02);

      const code = await ffmpeg.exec([
        '-i',
        inputPath,
        '-vn',
        '-ac',
        '1',
        '-ar',
        String(TARGET_SR),
        '-c:a',
        'libmp3lame',
        '-b:a',
        TARGET_BITRATE,
        '-y',
        outputName,
      ]);

      if (code !== 0) {
        throw new Error(
          `音视频转码失败（ffmpeg exit ${code}）。请确认文件含音轨且未损坏。`
        );
      }

      const data = await ffmpeg.readFile(outputName);
      const bytes =
        data instanceof Uint8Array
          ? data
          : new TextEncoder().encode(String(data));

      if (!bytes.byteLength) {
        throw new Error('转码结果为空，可能文件没有音轨');
      }

      onProgress?.(1);
      logger.info(
        `[ffmpeg] 完成: ${(file.size / 1024 / 1024).toFixed(1)}MB → ${(bytes.byteLength / 1024 / 1024).toFixed(2)}MB MP3`
      );

      const copy = new Uint8Array(bytes.byteLength);
      copy.set(bytes);
      return new Blob([copy], { type: 'audio/mpeg' });
    } catch (error) {
      logger.error('FFmpeg 转码失败:', error);
      const msg = error instanceof Error ? error.message : '音视频转码失败';
      if (/memory|out of memory|OOM|allocation/i.test(msg)) {
        throw new Error(
          '文件过大，浏览器内存不足。请先导出音频后再导入，或压缩视频体积。'
        );
      }
      throw error instanceof Error ? error : new Error(msg);
    } finally {
      ffmpeg.off('progress', onProg);
      await safeDelete(ffmpeg, outputName);
      if (wroteInput) await safeDelete(ffmpeg, inputName);
      if (mounted) await safeUnmount(ffmpeg, mountDir);
    }
  });
}

async function safeDelete(ffmpeg: FFmpeg, name: string): Promise<void> {
  try {
    await ffmpeg.deleteFile(name);
  } catch {
    /* ignore */
  }
}

async function safeUnmount(ffmpeg: FFmpeg, mountDir: string): Promise<void> {
  try {
    await ffmpeg.unmount(mountDir);
  } catch {
    /* ignore */
  }
}
