/**
 * Stores 统一导出
 *
 * 本项目使用 Zustand 替代 Context API 进行状态管理
 * 所有状态通过 stores 管理，组件通过 hooks 订阅
 */

// ============================================
// SubtitleStore
// ============================================

export {
  useSubtitleStore,
  useFiles,
  useSelectedFile,
  useFile
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
