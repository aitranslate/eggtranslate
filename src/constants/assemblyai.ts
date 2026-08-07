/**
 * AssemblyAI API 配置
 */

export const ASSEMBLYAI_CONFIG = {
  // 默认热词（用户可扩展）
  defaultKeyterms: [] as string[],
  /**
   * 模型路由：优先 Universal-3.5 Pro（约 18 语 + 更高精度），
   * 不支持的语言自动回落 Universal-2（99 语，如韩语等）。
   * 与官方文档默认列表一致；显式传入可避免部分账号「不传则只走 U2」。
   */
  speechModels: ['universal-3-5-pro', 'universal-2'] as const,
} as const;
