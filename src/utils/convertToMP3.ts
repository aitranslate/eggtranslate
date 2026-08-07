/**
 * 音视频 → 16kHz 单声道 MP3（ffmpeg.wasm）
 *
 * - 只抽取音频轨（-vn），不依赖浏览器 decodeAudioData 白名单
 * - 优先 WORKERFS/Blob 挂载，避免把整份巨型视频 write 进 WASM 内存
 * - 单例 + 队列：同时只跑一路转码（与串行导入一致）
 * - 用户无感：仍导出 convertToMP3 / warmupMp3Encoder 同名 API
 */
import { FFmpeg, FFFSType } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import { logger } from '@/utils/logger';

/** 与转录友好的规格：单声道 16kHz，体积远小于原视频 */
const TARGET_SR = 16000;
const TARGET_BITRATE = '64k';

/** 单线程 core：Cloudflare Pages 无需 COOP/COEP */
const CORE_BASE =
  'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm';

let ffmpegInstance: FFmpeg | null = null;
let loadPromise: Promise<FFmpeg> | null = null;
/** 串行化 exec，避免多文件抢同一 WASM 实例 */
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

/** 虚拟盘文件名：避免用户文件名里的空格、&、中文等坑 */
function safeInputName(file: File): string {
  const ext = extOf(file.name);
  return `input.${ext || 'bin'}`;
}

async function getFFmpeg(): Promise<FFmpeg> {
  if (ffmpegInstance?.loaded) return ffmpegInstance;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    const ffmpeg = new FFmpeg();
    ffmpeg.on('log', ({ message }) => {
      if (import.meta.env.DEV) {
        logger.info('[ffmpeg]', message);
      }
    });

    await ffmpeg.load({
      coreURL: await toBlobURL(`${CORE_BASE}/ffmpeg-core.js`, 'text/javascript'),
      wasmURL: await toBlobURL(
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

/**
 * 预热：空闲时拉取 ffmpeg-core，避免首次导入音视频卡在下载 WASM。
 */
export function warmupMp3Encoder(): void {
  if (typeof window === 'undefined') return;
  void getFFmpeg().catch((e) => {
    logger.warn('FFmpeg 预热失败（可忽略，首次转码时重试）', e);
  });
}

/**
 * 将任意常见音视频转为 16kHz mono MP3 Blob。
 * 已是较小 MP3 时仍统一重编码，保证采样率/声道与转录链路一致。
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
      // 清理可能残留的上次文件
      await safeDelete(ffmpeg, outputName);
      await safeUnmount(ffmpeg, mountDir);

      let inputPath = inputName;

      // 优先 WORKERFS + blobs：按安全名挂载，不把整文件拷进 MEMFS
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
          `[ffmpeg] WORKERFS 挂载: ${file.name} (${(file.size / 1024 / 1024).toFixed(1)}MB)`
        );
      } catch (mountErr) {
        logger.warn('[ffmpeg] WORKERFS 不可用，回退 writeFile', mountErr);
        // 回退：整文件写入 MEMFS（大文件可能 OOM）
        await ffmpeg.writeFile(inputName, await fetchFile(file));
        inputPath = inputName;
        wroteInput = true;
      }

      onProgress?.(0.02);

      const code = await ffmpeg.exec([
        '-i',
        inputPath,
        '-vn', // 只要音频
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

      // 拷贝脱离 WASM 堆，便于后续释放
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
      if (wroteInput) {
        await safeDelete(ffmpeg, inputName);
      }
      if (mounted) {
        await safeUnmount(ffmpeg, mountDir);
      }
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
