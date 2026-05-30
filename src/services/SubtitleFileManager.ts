/**
 * 字幕文件管理服务
 * 负责文件加载、更新、删除等CRUD操作
 */

import { SubtitleEntry, FileType, SubtitleFileMetadata, TranscriptionStatus, SingleTask } from '@/types';
import type { SubtitleFile } from '@/types/transcription';
import { parseSRT } from '@/utils/srtParser';
import { detectFileType } from '@/utils/fileFormat';
import dataManager from '@/services/dataManager';
import { generateTaskId, generateStableFileId } from '@/utils/taskIdGenerator';

// 重新导出类型，保持向后兼容
export type { SubtitleFile };

export interface LoadFileOptions {
  existingFilesCount: number;
}

/**
 * 从 File 对象加载字幕文件
 * Phase 3: 返回 SubtitleFileMetadata（元数据）
 *
 * 注意：音视频文件需要保留 fileRef，所以返回类型是联合
 */
export async function loadFromFile(
  file: File,
  options: LoadFileOptions
): Promise<SubtitleFileMetadata & { fileRef?: File }> {
  const fileType = detectFileType(file.name);

  if (fileType === 'srt') {
    // SRT 文件：读取文本内容
    const content = await file.text();
    const entries = parseSRT(content);

    // 创建批处理任务
    const index = options.existingFilesCount;
    const taskId = await dataManager.createNewTask(file.name, entries, index, {
      fileType: 'srt',
      fileSize: file.size
    });
    const fileId = generateStableFileId(taskId);

    // ✅ Phase 3: 返回元数据
    return {
      id: fileId,
      taskId,
      name: file.name,
      fileType: 'srt',
      fileSize: file.size,
      lastModified: file.lastModified,
      entryCount: entries.length,
      translatedCount: entries.filter(e => e.translatedText).length,
      transcriptionStatus: 'completed',
      tokensUsed: 0,
      entriesVersion: 0
    };
  } else {
    // ✅ 音视频文件：也立即创建任务（空条目），转录完成后更新
    const index = options.existingFilesCount;
    const taskId = await dataManager.createNewTask(file.name, [], index, {
      fileType: fileType,
      fileSize: file.size
    });
    const fileId = generateStableFileId(taskId);

    // ✅ Phase 3: 返回元数据（fileRef 作为额外属性保留）
    return {
      id: fileId,
      taskId,
      name: file.name,
      fileType: fileType,
      fileSize: file.size,
      lastModified: file.lastModified,
      entryCount: 0,
      translatedCount: 0,
      transcriptionStatus: 'idle',
      tokensUsed: 0,
      entriesVersion: 0,
      fileRef: file // 保留原始文件引用用于后续转录
    };
  }
}

/**
 * 更新字幕条目（内存更新，不持久化）
 * @deprecated 直接使用 dataManager.updateTaskSubtitleEntryInMemory
 */
export function updateEntryInMemory(
  files: SubtitleFile[],
  fileId: string,
  entryId: number,
  text: string,
  translatedText?: string
): SubtitleFile | null {
  const file = files.find(f => f.id === fileId);
  if (!file) return null;

  // 更新内存中的数据
  dataManager.updateTaskSubtitleEntryInMemory(
    file.taskId,
    entryId,
    text,
    translatedText
  );

  return file;
}

/**
 * 删除文件
 * Phase 3: 接收 SubtitleFileMetadata（但需要 taskId）
 */
export async function removeFile(file: SubtitleFileMetadata | SubtitleFile): Promise<void> {
  const taskId = 'taskId' in file ? file.taskId : file.currentTaskId;
  await dataManager.removeTask(taskId);
}

/**
 * 从 dataManager 恢复文件列表（返回元数据，不包含完整 entries）
 * Phase 3: 改为返回轻量级元数据数组
 */
export async function restoreFiles(): Promise<SubtitleFileMetadata[]> {
  const batchTasks = dataManager.getBatchTasks();
  if (!batchTasks || batchTasks.tasks.length === 0) {
    return [];
  }

  // ✅ Phase 3: 使用 convertTaskToMetadata 转换为轻量级元数据
  return batchTasks.tasks.map(task => convertTaskToMetadata(task));
}

/**
 * 从 dataManager 恢复完整文件列表（包含 entries）
 * @deprecated 使用 restoreFiles() 获取元数据，通过 subtitleStore.getFileEntries() 获取完整数据
 */
export async function restoreFilesWithEntries(): Promise<SubtitleFile[]> {
  const batchTasks = dataManager.getBatchTasks();
  if (!batchTasks || batchTasks.tasks.length === 0) {
    return [];
  }

  return batchTasks.tasks.map((task) => {
    const entries = task.subtitle_entries || [];
    return {
      id: generateStableFileId(task.taskId),
      name: task.subtitle_filename,
      size: task.fileSize || 0,
      lastModified: Date.now(),
      entries,
      filename: task.subtitle_filename,
      currentTaskId: task.taskId,
      type: task.fileType === 'srt' ? 'srt' : undefined,
      fileType: task.fileType,
      fileSize: task.fileSize,
      duration: task.duration,
      transcriptionStatus: (task.subtitle_entries && task.subtitle_entries.length > 0) ? 'completed' : 'idle' as const,
      entryCount: entries.length,
      translatedCount: entries.filter(e => e.translatedText).length
    };
  });
}

/**
 * 清空所有数据
 */
export async function clearAllData(): Promise<void> {
  await dataManager.clearBatchTasks();
}

// ============================================
// 辅助方法：Phase 1 - 元数据转换
// ============================================

/**
 * 将 DataManager 的 SingleTask 转换为轻量级的 SubtitleFileMetadata
 * 用于 Phase 3：只存储元数据，不存储完整的 entries 数组
 *
 * @param task - DataManager 中的 SingleTask 对象
 * @returns 轻量级的 SubtitleFileMetadata
 */
export function convertTaskToMetadata(task: SingleTask): SubtitleFileMetadata {
  const fileId = generateStableFileId(task.taskId);
  const entries = task.subtitle_entries || [];

  // 计算统计信息
  const entryCount = entries.length;
  const translatedCount = entries.filter(e => e.translatedText).length;

  // 确定转录状态
  const hasEntries = entries.length > 0;
  const transcriptionStatus: TranscriptionStatus = hasEntries ? 'completed' : 'idle';

  // 获取转录进度
  const transcriptionProgress = task.translation_progress
    ? {
        percent: task.translation_progress.total > 0
          ? Math.round((task.translation_progress.completed / task.translation_progress.total) * 100)
          : 0,
        tokens: task.translation_progress.tokens
      }
    : undefined;

  return {
    id: fileId,
    taskId: task.taskId,
    name: task.subtitle_filename,
    fileType: task.fileType || 'srt',
    fileSize: task.fileSize || 0,
    lastModified: Date.now(),
    duration: task.duration,
    entryCount,
    translatedCount,
    transcriptionStatus,
    transcriptionProgress,
    tokensUsed: task.translation_progress?.tokens || 0,
    entriesVersion: 0
  };
}
