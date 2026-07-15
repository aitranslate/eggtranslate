/**
 * 上手引导纯函数（可单测；UI / store 只接线）
 *
 * 双主路径：
 * - 字幕翻译：SRT → 配置 LLM → 翻译 → 导出
 * - 音视频转录：媒体 → 配置 AssemblyAI → 转录（可再翻译）→ 导出
 */

/** persist 名；改 schema 时 bump 后缀（v2…），避免与旧结构混读 */
export const ONBOARDING_STORAGE_KEY = 'eggtranslate:onboarding:v1';

/** 一次性 tip id */
export type OnboardingTipId =
  | 'after_sample_configured'
  | 'after_sample_unconfigured'
  | 'after_media_import'
  | 'export_formats';

/** Checklist 步骤 */
export type ChecklistStepId =
  | 'configure'
  | 'configure_transcription'
  | 'import'
  | 'finish';

export type StartIntent = 'translate' | 'full' | 'transcribe' | 'batch';

export type SetupGuardKind = 'translation' | 'transcription';

export type EmptyWorkspaceMode =
  | 'dragging'
  | 'fresh_unconfigured'
  | 'configured_empty'
  | 'has_files_unselected';

export type EmptyPrimaryAction = 'sample' | 'import' | 'select';

export interface EmptyWorkspaceCopy {
  mode: EmptyWorkspaceMode;
  title: string;
  description: string;
  /** 主 CTA 动作 */
  primary: EmptyPrimaryAction;
  showSample: boolean;
  showImport: boolean;
  showConfigure: boolean;
}

export interface ChecklistStepView {
  id: ChecklistStepId;
  label: string;
  done: boolean;
  /** 可选步：不阻塞「全部完成」 */
  optional?: boolean;
  settingsFocus?: 'translation' | 'transcription';
}

export interface DeriveChecklistInput {
  isConfigured: boolean;
  isTranscriptionConfigured: boolean;
  fileCount: number;
  /** 历史有记录，或任意任务翻译/转录完成，或用户已导出过 */
  hasFinishedOnce: boolean;
}

export interface EmptyWorkspaceInput {
  isDragging: boolean;
  fileCount: number;
  isConfigured: boolean;
}

/** AssemblyAI Key 是否已配置（非空即算） */
export function isTranscriptionApiConfigured(apiKeys: string | null | undefined): boolean {
  return Boolean(String(apiKeys ?? '').trim());
}

/** 未配置翻译 API 时，翻译相关启动应被守卫（纯转录除外） */
export function shouldGuardTranslationStart(
  isConfigured: boolean,
  intent: StartIntent = 'translate'
): boolean {
  if (intent === 'transcribe') return false;
  return isConfigured !== true;
}

/** 未配置 AssemblyAI 时，转录 / 转译 应被守卫 */
export function shouldGuardTranscriptionStart(
  apiKeys: string | null | undefined,
  intent: StartIntent = 'transcribe'
): boolean {
  if (intent === 'translate') return false;
  // batch 在 startAllUncompleted 里按文件类型分支，不经此 intent
  if (intent === 'batch') return false;
  return !isTranscriptionApiConfigured(apiKeys);
}

/**
 * full 路径守卫优先级：先转录 Key，再翻译 API
 * 返回需要展示的守卫类型，null 表示可继续
 */
export function resolveFullPathGuard(input: {
  isTranslationConfigured: boolean;
  transcriptionApiKeys: string | null | undefined;
}): SetupGuardKind | null {
  if (shouldGuardTranscriptionStart(input.transcriptionApiKeys, 'full')) {
    return 'transcription';
  }
  if (shouldGuardTranslationStart(input.isTranslationConfigured, 'full')) {
    return 'translation';
  }
  return null;
}

export function resolveEmptyWorkspaceMode(input: EmptyWorkspaceInput): EmptyWorkspaceMode {
  if (input.isDragging) return 'dragging';
  if (input.fileCount > 0) return 'has_files_unselected';
  if (!input.isConfigured) return 'fresh_unconfigured';
  return 'configured_empty';
}

export function resolveEmptyWorkspaceCopy(input: EmptyWorkspaceInput): EmptyWorkspaceCopy {
  const mode = resolveEmptyWorkspaceMode(input);

  switch (mode) {
    case 'dragging':
      return {
        mode,
        title: '松开以导入',
        description: '支持 SRT 字幕，或 MP4 / MP3 等音视频（可转录）',
        primary: 'import',
        showSample: false,
        showImport: false,
        showConfigure: false,
      };
    case 'fresh_unconfigured':
      return {
        mode,
        title: '字幕翻译 · 音视频转录',
        description: '先试用示例练翻译，或导入音视频做转录（需配置对应 API）',
        primary: 'sample',
        showSample: true,
        showImport: true,
        showConfigure: true,
      };
    case 'configured_empty':
      return {
        mode,
        title: '导入文件开始',
        description: 'SRT 直接翻译；音视频需配置 AssemblyAI 后转录',
        primary: 'import',
        showSample: true,
        showImport: true,
        showConfigure: false,
      };
    case 'has_files_unselected':
      return {
        mode,
        title: '选择一个项目',
        description: '从左侧打开任务，或导入新的字幕 / 音视频',
        primary: 'select',
        showSample: true,
        showImport: true,
        showConfigure: false,
      };
  }
}

export function deriveChecklistSteps(input: DeriveChecklistInput): ChecklistStepView[] {
  return [
    {
      id: 'configure',
      label: '配置翻译 API',
      done: input.isConfigured === true,
      settingsFocus: 'translation',
    },
    {
      id: 'configure_transcription',
      label: '配置转录 API（音视频）',
      done: input.isTranscriptionConfigured === true,
      optional: true,
      settingsFocus: 'transcription',
    },
    {
      id: 'import',
      label: '导入字幕 / 音视频或试用示例',
      done: input.fileCount > 0,
    },
    {
      id: 'finish',
      // 与 hasFinishedOnceEvidence 对齐：译/转完成、历史或导出任一即可
      label: '完成一次转录或翻译',
      done: input.hasFinishedOnce === true,
    },
  ];
}

// ---------- 导出 tip：任务完成跟踪（OnboardingHost 接线，可单测） ----------

type PhaseStatusLike = { status?: string } | null | undefined;

export interface TaskPhaseSlice {
  taskId: string;
  phases: {
    translating?: PhaseStatusLike;
    transcribing?: PhaseStatusLike;
  };
}

function isTaskEligibleForExportTip(task: TaskPhaseSlice): boolean {
  return (
    task.phases.translating?.status === 'completed' ||
    task.phases.transcribing?.status === 'completed'
  );
}

export function collectExportEligibleTaskIds(tasks: readonly TaskPhaseSlice[]): string[] {
  return tasks.filter(isTaskEligibleForExportTip).map((t) => t.taskId);
}

/** 启动时种子：已有完成任务全部记入，避免回访误弹 tip */
export function seedAcknowledgedExportTaskIds(tasks: readonly TaskPhaseSlice[]): Set<string> {
  return new Set(collectExportEligibleTaskIds(tasks));
}

/**
 * 找出第一个「新完成」且尚未 acknowledge 的 taskId。
 * 未 acknowledge 的候选可在 tip 槽位空闲时重试（不要在 showTip 失败时提前写入）。
 */
export function nextUnacknowledgedExportTaskId(
  eligibleIds: readonly string[],
  acknowledged: ReadonlySet<string>
): string | null {
  for (const id of eligibleIds) {
    if (!acknowledged.has(id)) return id;
  }
  return null;
}

/** 删除任务后修剪 acknowledge 集合 */
export function pruneAcknowledgedTaskIds(
  acknowledged: ReadonlySet<string>,
  existingTaskIds: ReadonlySet<string>
): Set<string> {
  const next = new Set<string>();
  for (const id of acknowledged) {
    if (existingTaskIds.has(id)) next.add(id);
  }
  return next;
}

/**
 * 尝试弹出 export_formats tip。
 * - tip 已永久看过 → 将当前 eligible 全部 acknowledge，不再尝试
 * - 槽位被占用 → 不 acknowledge，等 activeTip 清空后重试
 * - 成功展示 → 仅 acknowledge 该 taskId
 */
export function tryShowExportFormatsTip(input: {
  eligibleIds: readonly string[];
  acknowledged: ReadonlySet<string>;
  completedTips: readonly string[];
  showTipIfNew: (id: 'export_formats') => boolean;
}): { acknowledged: Set<string>; shown: boolean } {
  const { eligibleIds, completedTips, showTipIfNew } = input;
  const acknowledged = new Set(input.acknowledged);

  if (isTipCompleted(completedTips, 'export_formats')) {
    for (const id of eligibleIds) acknowledged.add(id);
    return { acknowledged, shown: false };
  }

  const candidate = nextUnacknowledgedExportTaskId(eligibleIds, acknowledged);
  if (!candidate) return { acknowledged, shown: false };

  if (showTipIfNew('export_formats')) {
    acknowledged.add(candidate);
    return { acknowledged, shown: true };
  }

  return { acknowledged, shown: false };
}

/** 可选步不阻塞完成 */
export function isChecklistComplete(steps: ChecklistStepView[]): boolean {
  const required = steps.filter((s) => !s.optional);
  return required.length > 0 && required.every((s) => s.done);
}

/**
 * 是否展示 Checklist：
 * - dismissed → 不显示
 * - forceShow（设置里「重新查看」）→ 显示（即使步骤已完成）
 * - 否则仅未全部完成时显示
 */
export function shouldShowChecklist(input: {
  dismissed: boolean;
  steps: ChecklistStepView[];
  forceShow?: boolean;
}): boolean {
  if (input.dismissed) return false;
  if (input.forceShow) return true;
  return !isChecklistComplete(input.steps);
}

export function isTipCompleted(
  completedTips: readonly string[] | ReadonlySet<string>,
  tipId: OnboardingTipId
): boolean {
  if (completedTips instanceof Set) return completedTips.has(tipId);
  return (completedTips as readonly string[]).includes(tipId);
}

/** 示例导入后应展示的 tip */
export function resolveSampleFollowUpTip(isConfigured: boolean): OnboardingTipId {
  return isConfigured ? 'after_sample_configured' : 'after_sample_unconfigured';
}

export function tipCopy(tipId: OnboardingTipId): {
  title: string;
  body: string;
  /** 主按钮：打开设置焦点 */
  actionFocus?: 'translation' | 'transcription';
  actionLabel?: string;
} {
  switch (tipId) {
    case 'after_sample_configured':
      return {
        title: '下一步：开始翻译',
        body: '在项目行或详情底栏点击「开始翻译 / 翻译」，即可生成译文。',
      };
    case 'after_sample_unconfigured':
      return {
        title: '可先浏览原文',
        body: '配置翻译 API 后即可开始翻译。选择服务商并填入密钥。',
        actionFocus: 'translation',
        actionLabel: '配置翻译 API',
      };
    case 'after_media_import':
      return {
        title: '音视频需配置转录',
        body: '在设置中填写 AssemblyAI API Key，即可开始转录生成字幕；之后还可继续翻译。',
        actionFocus: 'transcription',
        actionLabel: '配置转录 API',
      };
    case 'export_formats':
      return {
        title: '导出字幕',
        body: '支持原文、译文、双语（原上译下 / 原下译上）或打包下载。',
      };
  }
}

export function setupGuardCopy(kind: SetupGuardKind): {
  title: string;
  message: string;
  confirmText: string;
} {
  if (kind === 'transcription') {
    return {
      title: '需要配置转录 API',
      message:
        '音视频转录使用 AssemblyAI。请在设置 → 转录 中填入 API Key。密钥仅保存在本机浏览器。',
      confirmText: '去配置转录',
    };
  }
  return {
    title: '需要配置翻译 API',
    message: '开始翻译前，请先在设置中选择服务商并填入 API Key。密钥仅保存在本机浏览器。',
    confirmText: '去配置翻译',
  };
}

/** 是否已有「完成一次」的证据（供 store / UI 派生） */
export function hasFinishedOnceEvidence(input: {
  historyCount: number;
  hasExported: boolean;
  anyTranslationCompleted: boolean;
  anyTranscriptionCompleted?: boolean;
}): boolean {
  return (
    input.hasExported === true ||
    input.historyCount > 0 ||
    input.anyTranslationCompleted === true ||
    input.anyTranscriptionCompleted === true
  );
}

export function isMediaImportFileName(name: string): boolean {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  return ['mp3', 'wav', 'm4a', 'ogg', 'flac', 'mp4', 'webm', 'mkv', 'avi', 'mov'].includes(ext);
}
