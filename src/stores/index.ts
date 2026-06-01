/**
 * Stores 统一导出
 *
 * 本项目使用 Zustand 替代 Context API 进行状态管理
 * 所有状态通过 stores 管理，组件通过 hooks 订阅
 */

// ============================================
// FilesStore (新)
// ============================================

export {
  useFilesStore,
  useFiles,
  useFile,
  useSelectedFile
} from './filesStore';

// ============================================
// QueueStore (新)
// ============================================

export { useQueueStore } from './queueStore';

// ============================================
// Services (新)
// ============================================

export { addFile, removeFile, selectFile, clearAll } from '@/services/filesService';
export { startTranscription } from '@/services/transcriptionService';
export { startTranslation } from '@/services/translationService';
export { enqueueTask, dequeueTask, enqueueAllUncompleted, processNext } from '@/services/queueService';

// ============================================
// SubtitleStore (旧 - 拆分完成后将删除)
// ============================================

export {
  useSubtitleStore,
  useFiles as useFilesLegacy,
  useSelectedFile as useSelectedFileLegacy,
  useFile as useFileLegacy
} from './subtitleStore';

// ============================================
// TranslationConfigStore
// ============================================

export {
  useTranslationConfigStore,
  useTranslationConfig,
  useIsTranslationConfigured,
  useIsTranslating,
  useTranslationProgress,
  useTranslationTokensUsed
} from './translationConfigStore';

// ============================================
// TranscriptionStore
// ============================================

export {
  useTranscriptionStore,
  useKeytermGroups,
  useUpdateKeytermGroups
} from './transcriptionStore';

// ============================================
// TermsStore
// ============================================

export { useTermsStore } from './termsStore';

// ============================================
// HistoryStore
// ============================================

export { useHistoryStore } from './historyStore';
