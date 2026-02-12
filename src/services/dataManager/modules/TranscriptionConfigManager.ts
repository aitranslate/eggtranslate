import localforage from 'localforage';
import { toAppError } from '@/utils/errors';
import type { KeytermGroup } from '@/types/transcription';

/**
 * 转录配置管理器 - 负责转录配置的 CRUD 操作
 * 简化版本：只管理热词分组
 */
interface TranscriptionConfig {
  keytermGroups?: KeytermGroup[];
}

class TranscriptionConfigManager {
  private memoryStore: {
    transcription_config?: TranscriptionConfig;
  };

  private readonly TRANSCRIPTION_CONFIG_KEY = 'transcription_config';

  constructor(memoryStore: { transcription_config?: TranscriptionConfig }) {
    this.memoryStore = memoryStore;
  }

  /**
   * 获取转录配置
   */
  getTranscriptionConfig(): TranscriptionConfig | null {
    return this.memoryStore.transcription_config || null;
  }

  /**
   * 保存转录配置并持久化
   */
  async saveTranscriptionConfig(config: TranscriptionConfig): Promise<void> {
    try {
      // 更新内存中的数据
      this.memoryStore.transcription_config = config;

      // 持久化到 localforage
      await localforage.setItem(this.TRANSCRIPTION_CONFIG_KEY, config);
    } catch (error) {
      const appError = toAppError(error, '保存转录配置失败');
      console.error('[TranscriptionConfigManager]', appError.message, appError);
      throw appError;
    }
  }
}

export default TranscriptionConfigManager;

