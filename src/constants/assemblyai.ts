/**
 * AssemblyAI API 配置
 */

export const ASSEMBLYAI_CONFIG = {
  // 默认热词（用户可扩展）
  defaultKeyterms: [] as string[],
  /**
   * 模型路由：优先 AssemblyAI-STT-3.7（32 语，含原生 code-switching），
   * 不支持的语言自动回落 Universal-2（合计 99 语）。
   * 注：language_detection=true 时官方不再自动回落，必须把 universal-2 显式列进来。
   */
  speechModels: ['assemblyai-stt-3-7', 'universal-2'] as const,
} as const;
