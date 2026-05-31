/**
 * 字幕文件管理服务
 * 负责文件解析和元数据转换（不直接操作 localforage，由 store persist 中间件管理）
 */

import { SubtitleFileMetadata, SingleTask, FilePhases, PhaseProgress, WorkflowType } from '@/types';
import { parseSRT } from '@/utils/srtParser';
import { detectFileType } from '@/utils/fileFormat';
import localforage from 'localforage';
import { generateTaskId, generateStableFileId } from '@/utils/taskIdGenerator';

export interface LoadFileOptions {
  existingFilesCount: number;
}

export interface LoadFileResult {
  metadata: SubtitleFileMetadata & { fileRef?: File };
  task: SingleTask;
}

const UPCOMING: PhaseProgress = { status: 'upcoming', progress: 0, tokens: 0 };
const COMPLETED: PhaseProgress = { status: 'completed', progress: 100, tokens: 0 };

/**
 * 创建初始阶段状态
 * @param isSrt - 是否为 SRT 文件（无需转录）
 * @param isTranslated - 是否已完成翻译（从历史任务恢复时）
 * @param workflow - 工作流类型
 */
function createInitialPhases(isSrt: boolean, isTranslated: boolean, workflow: WorkflowType = 'transcribe'): FilePhases {
  return {
    workflow,
    converting: { ...UPCOMING },
    transcribing: isSrt ? { ...COMPLETED } : { ...UPCOMING },
    translating: isTranslated ? { ...COMPLETED } : { ...UPCOMING },
    splitting: { ...UPCOMING },
  };
}

/**
 * 从 File 对象加载字幕文件
 * 返回 task + metadata，由调用方（store）负责添加到 tasks 数组
 */
export async function loadFromFile(
  file: File,
  options: LoadFileOptions
): Promise<LoadFileResult> {
  const fileType = detectFileType(file.name);
  const index = options.existingFilesCount;
  const taskId = generateTaskId();
  const fileId = generateStableFileId(taskId);

  if (fileType === 'srt') {
    const content = await file.text();
    const entries = parseSRT(content);

    const newTask: SingleTask = {
      taskId,
      subtitle_entries: entries,
      subtitle_filename: file.name,
      phases: createInitialPhases(true, false, 'translate'),
      index,
      fileType: 'srt',
      fileSize: file.size,
    };

    return {
      metadata: {
        id: fileId,
        taskId,
        name: file.name,
        fileType: 'srt',
        fileSize: file.size,
        lastModified: file.lastModified,
        entryCount: entries.length,
        translatedCount: entries.filter(e => e.translatedText).length,
        phases: createInitialPhases(true, false, 'translate'),
        tokensUsed: 0,
        entriesVersion: 0
      },
      task: newTask
    };
  } else {
    const newTask: SingleTask = {
      taskId,
      subtitle_entries: [],
      subtitle_filename: file.name,
      phases: createInitialPhases(false, false),
      index,
      fileType,
      fileSize: file.size,
    };

    return {
      metadata: {
        id: fileId,
        taskId,
        name: file.name,
        fileType,
        fileSize: file.size,
        lastModified: file.lastModified,
        entryCount: 0,
        translatedCount: 0,
        phases: createInitialPhases(false, false),
        tokensUsed: 0,
        entriesVersion: 0,
        fileRef: file
      },
      task: newTask
    };
  }
}

/**
 * 清理 MP3 数据（独立于 persist 中间件管理）
 */
export async function removeMp3Data(taskId: string): Promise<void> {
  await localforage.removeItem(`mp3_data:${taskId}`);
}

// ============================================
// 辅助方法：元数据转换
// ============================================

/**
 * 将 SingleTask 转换为轻量级的 SubtitleFileMetadata
 * 只存储元数据，不存储完整的 entries 数组
 */
export function convertTaskToMetadata(task: SingleTask): SubtitleFileMetadata {
  const fileId = generateStableFileId(task.taskId);
  const entries = task.subtitle_entries || [];

  const entryCount = entries.length;
  const translatedCount = entries.filter(e => e.translatedText).length;
  const isSrt = (task.fileType || 'srt') === 'srt';
  const isTranslated = (task.phases?.translating?.tokens || 0) > 0;

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
    phases: task.phases || createInitialPhases(isSrt, isTranslated),
    tokensUsed: (task.phases?.translating?.tokens || 0) + (task.phases?.splitting?.tokens || 0),
    entriesVersion: 0,
    fileRef: task.fileRef
  };
}
