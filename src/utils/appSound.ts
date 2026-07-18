/**
 * 应用音效（Web Audio 合成，无资源文件）
 * - confirm：开始 / 全部开始 入队确认
 * - success / error：任务结果
 * - delete：删除 / 清空确认反馈（软下行，非报警）
 * - 受 soundStore 开关控制
 * - confirm / result / delete 分轨去抖，互不抢占
 *
 * 浏览器限制：AudioContext 默认 suspended，需在用户手势内 resume。
 * 启动时注册一次性 pointerdown 预解锁，避免「点了开始却仍静音」。
 */

import { useSoundStore } from '@/stores/soundStore';

export type AppSoundKind = 'confirm' | 'success' | 'error' | 'delete';

const RESULT_MIN_INTERVAL_MS = 500;
const CONFIRM_MIN_INTERVAL_MS = 350;
const DELETE_MIN_INTERVAL_MS = 350;

let audioCtx: AudioContext | null = null;
let lastResultAt = 0;
let lastConfirmAt = 0;
let lastDeleteAt = 0;
let unlockBound = false;

type AudioContextCtor = new () => AudioContext;

function getAudioContext(): AudioContext | null {
  const g = globalThis as typeof globalThis & {
    AudioContext?: AudioContextCtor;
    webkitAudioContext?: AudioContextCtor;
  };
  const Ctx = g.AudioContext ?? g.webkitAudioContext;
  if (!Ctx) return null;
  if (!audioCtx || audioCtx.state === 'closed') {
    audioCtx = new Ctx();
  }
  return audioCtx;
}

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

/** 在用户手势链路内尽量 resume；返回是否已 running */
async function ensureRunning(ctx: AudioContext): Promise<boolean> {
  if (ctx.state === 'running') return true;
  try {
    await ctx.resume();
  } catch {
    return false;
  }
  // resume() 后 DOM 类型未收窄，用字符串比较
  return String(ctx.state) === 'running';
}

/**
 * 应用启动后调用一次：任意首次点击预创建并解锁 AudioContext，
 * 后续任务音不必再等「第一次手势刚好叠上 resume」。
 */
export function bindAudioUnlock(): void {
  if (unlockBound || typeof window === 'undefined') return;
  unlockBound = true;

  const unlock = () => {
    const ctx = getAudioContext();
    if (!ctx) return;
    void ensureRunning(ctx).then((running) => {
      // 已解锁：自摘除监听，后续点击/按键不再触发
      if (!running) return;
      window.removeEventListener('pointerdown', unlock, { capture: true });
      window.removeEventListener('keydown', unlock, { capture: true });
    });
  };

  // 捕获阶段，尽量赶在业务 handler 之前解锁
  window.addEventListener('pointerdown', unlock, { capture: true, passive: true });
  window.addEventListener('keydown', unlock, { capture: true, passive: true });
}

function tone(
  ctx: AudioContext,
  {
    frequency,
    start,
    duration,
    gain = 0.12,
    type = 'sine',
  }: {
    frequency: number;
    start: number;
    duration: number;
    gain?: number;
    type?: OscillatorType;
  }
) {
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(frequency, start);

  // linearRamp 比 exponential 更稳（避免极短包络失败静音）
  const peak = Math.max(0.001, gain);
  g.gain.setValueAtTime(0, start);
  g.gain.linearRampToValueAtTime(peak, start + 0.012);
  g.gain.linearRampToValueAtTime(0, start + duration);

  osc.connect(g);
  g.connect(ctx.destination);
  osc.start(start);
  osc.stop(start + duration + 0.03);
}

/** 入队确认：短、清晰、可听见 */
function playConfirm(ctx: AudioContext) {
  const t0 = ctx.currentTime + 0.01;
  tone(ctx, { frequency: 660, start: t0, duration: 0.08, gain: 0.1 });
}

function playSuccess(ctx: AudioContext) {
  const t0 = ctx.currentTime + 0.01;
  tone(ctx, { frequency: 523.25, start: t0, duration: 0.1, gain: 0.11 });
  tone(ctx, { frequency: 698.46, start: t0 + 0.09, duration: 0.14, gain: 0.13 });
}

function playError(ctx: AudioContext) {
  const t0 = ctx.currentTime + 0.01;
  tone(ctx, { frequency: 240, start: t0, duration: 0.12, gain: 0.11, type: 'triangle' });
  tone(ctx, { frequency: 180, start: t0 + 0.1, duration: 0.16, gain: 0.1, type: 'triangle' });
}

/** 删除：短下行，比 error 更轻，不带警报感 */
function playDelete(ctx: AudioContext) {
  const t0 = ctx.currentTime + 0.01;
  tone(ctx, { frequency: 392, start: t0, duration: 0.07, gain: 0.09 }); // G4
  tone(ctx, { frequency: 294, start: t0 + 0.06, duration: 0.1, gain: 0.08 }); // D4
}

function schedule(kind: AppSoundKind, ctx: AudioContext) {
  if (kind === 'confirm') playConfirm(ctx);
  else if (kind === 'success') playSuccess(ctx);
  else if (kind === 'delete') playDelete(ctx);
  else playError(ctx);
}

function markDebounce(kind: AppSoundKind, now: number): boolean {
  if (kind === 'confirm') {
    if (now - lastConfirmAt < CONFIRM_MIN_INTERVAL_MS) return false;
    lastConfirmAt = now;
    return true;
  }
  if (kind === 'delete') {
    if (now - lastDeleteAt < DELETE_MIN_INTERVAL_MS) return false;
    lastDeleteAt = now;
    return true;
  }
  if (now - lastResultAt < RESULT_MIN_INTERVAL_MS) return false;
  lastResultAt = now;
  return true;
}

/**
 * 播放应用音效。关闭开关 / 去抖 / 浏览器限制时静默失败。
 */
export function playAppSound(kind: AppSoundKind): void {
  if (!useSoundStore.getState().soundEnabled) return;

  const now = nowMs();
  if (!markDebounce(kind, now)) return;

  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    if (ctx.state === 'running') {
      schedule(kind, ctx);
      return;
    }

    // 手势内同步发起 resume；就绪后再播
    void ensureRunning(ctx).then((ok) => {
      if (!ok) return;
      schedule(kind, ctx);
    });
  } catch {
    /* ignore — sound is best-effort */
  }
}

/** 测试用：重置模块内状态 */
export function __resetAppSoundForTests() {
  lastResultAt = 0;
  lastConfirmAt = 0;
  lastDeleteAt = 0;
  audioCtx = null;
  unlockBound = false;
}
