/**
 * 任务级源/目标语言解析。
 * 优先任务字段；缺省（旧任务）回退全局设置。不改 ASR 自动检测。
 */

import type { SubtitleFileMetadata, TranslationConfig } from '@/types';

export type TaskLanguagePair = {
  sourceLanguage: string;
  targetLanguage: string;
};

/**
 * 从任务元数据 + 全局 config 解析本任务翻译应使用的语言对。
 */
export function resolveTaskLanguages(
  file: Pick<SubtitleFileMetadata, 'sourceLanguage' | 'targetLanguage'> | null | undefined,
  config: Pick<TranslationConfig, 'sourceLanguage' | 'targetLanguage'>
): TaskLanguagePair {
  const source =
    (file?.sourceLanguage && file.sourceLanguage.trim()) || config.sourceLanguage;
  const target =
    (file?.targetLanguage && file.targetLanguage.trim()) || config.targetLanguage;
  return { sourceLanguage: source, targetLanguage: target };
}

/**
 * 将全局 config 覆盖为任务语言（其余参数保持全局）。
 */
export function withTaskLanguages(
  config: TranslationConfig,
  file: Pick<SubtitleFileMetadata, 'sourceLanguage' | 'targetLanguage'> | null | undefined
): TranslationConfig {
  const langs = resolveTaskLanguages(file, config);
  if (
    langs.sourceLanguage === config.sourceLanguage &&
    langs.targetLanguage === config.targetLanguage
  ) {
    return config;
  }
  return {
    ...config,
    sourceLanguage: langs.sourceLanguage,
    targetLanguage: langs.targetLanguage,
  };
}

/**
 * 本任务翻译是否走 Agent 管线（任务级开关，创建/导入时从全局设置快照）。
 * 与 AI 断句一致：添加任务后开关跟随任务，改全局设置不影响既有任务；
 * 严格判定，未开启（含历史任务缺省）一律批译，不跟全局设置。
 */
export function resolveTaskAgentEnabled(
  file: Pick<SubtitleFileMetadata, 'agentTranslationEnabled'> | null | undefined
): boolean {
  return file?.agentTranslationEnabled === true;
}
