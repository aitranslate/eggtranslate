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
  defaultKeytermGroupId?: string | null;
  /** 创建任务时写入的默认源语言（来自全局设置） */
  defaultSourceLanguage?: string;
  /** 创建任务时写入的默认目标语言（来自全局设置） */
  defaultTargetLanguage?: string;
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
  };
}

/**
 * 从音视频文件获取时长（不需要转码）
 * 直接读取文件头的元数据，速度很快
 */
export function getMediaDuration(file: File): Promise<number | undefined> {
  return new Promise((resolve) => {
    const element = file.type.startsWith('audio/')
      ? document.createElement('audio')
      : document.createElement('video');

    element.src = URL.createObjectURL(file);
    element.onloadedmetadata = () => {
      URL.revokeObjectURL(element.src);
      resolve(element.duration);
    };
    element.onerror = () => {
      URL.revokeObjectURL(element.src);
      resolve(undefined);
    };
  });
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
  const selectedKeytermGroupId = options.defaultKeytermGroupId ?? null;
  const sourceLanguage = options.defaultSourceLanguage;
  const targetLanguage = options.defaultTargetLanguage;

  // 音视频文件立即获取 duration（不需要转码）
  const duration = fileType !== 'srt' ? await getMediaDuration(file) : undefined;

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
      selectedKeytermGroupId,
      sourceLanguage,
      targetLanguage,
      entryCount: entries.length,
      translatedCount: entries.filter(e => e.translatedText).length,
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
        entriesVersion: 0,
        selectedKeytermGroupId,
        sourceLanguage,
        targetLanguage,
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
      duration,
      selectedKeytermGroupId,
      sourceLanguage,
      targetLanguage,
      entryCount: 0,
      translatedCount: 0,
    };

    return {
      metadata: {
        id: fileId,
        taskId,
        name: file.name,
        fileType,
        fileSize: file.size,
        duration,
        lastModified: file.lastModified,
        entryCount: 0,
        translatedCount: 0,
        phases: createInitialPhases(false, false),
        tokensUsed: 0,
        entriesVersion: 0,
        selectedKeytermGroupId,
        sourceLanguage,
        targetLanguage,
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
    entryCount: task.entryCount ?? entries.length,
    translatedCount: task.translatedCount ?? entries.filter((e) => e.translatedText).length,
    phases: task.phases || createInitialPhases(isSrt, isTranslated),
    tokensUsed: (task.phases?.translating?.tokens || 0),
    entriesVersion: 0,
    selectedKeytermGroupId: task.selectedKeytermGroupId ?? null,
    sourceLanguage: task.sourceLanguage,
    targetLanguage: task.targetLanguage,
    translationPath: task.translationPath,
    agentSnapshot: task.agentSnapshot ?? null,
    fileRef: task.fileRef
  };
}
