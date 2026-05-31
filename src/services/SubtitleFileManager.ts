/**
 * 字幕文件管理服务
 * 负责文件加载、更新、删除等CRUD操作
 */

import { SubtitleEntry, FileType, SubtitleFileMetadata, SingleTask, FilePhases, PhaseProgress, WorkflowType } from '@/types';
import { parseSRT } from '@/utils/srtParser';
import { detectFileType } from '@/utils/fileFormat';
import localforage from 'localforage';
import { generateTaskId, generateStableFileId } from '@/utils/taskIdGenerator';
import type { BatchTasks } from '@/types';

export interface LoadFileOptions {
  existingFilesCount: number;
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
 * 返回 SubtitleFileMetadata（元数据）
 *
 * 注意：音视频文件需要保留 fileRef，所以返回类型是联合
 */
export async function loadFromFile(
  file: File,
  options: LoadFileOptions
): Promise<SubtitleFileMetadata & { fileRef?: File }> {
  const fileType = detectFileType(file.name);
  const index = options.existingFilesCount;
  const taskId = generateTaskId();

  if (fileType === 'srt') {
    // SRT 文件：读取文本内容
    const content = await file.text();
    const entries = parseSRT(content);

    // 直接写入 localforage
    const batchTasks = await localforage.getItem<BatchTasks>('batch_tasks') || { tasks: [] };
    const newTask: SingleTask = {
      taskId,
      subtitle_entries: entries,
      subtitle_filename: file.name,
      phases: createInitialPhases(true, false, 'translate'),
      index,
      fileType: 'srt',
      fileSize: file.size,
    };
    batchTasks.tasks.push(newTask);
    await localforage.setItem('batch_tasks', batchTasks);

    const fileId = generateStableFileId(taskId);

    return {
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
    };
  } else {
    // 音视频文件：也立即创建任务（空条目），转录完成后更新
    const batchTasks = await localforage.getItem<BatchTasks>('batch_tasks') || { tasks: [] };
    const newTask: SingleTask = {
      taskId,
      subtitle_entries: [],
      subtitle_filename: file.name,
      phases: createInitialPhases(false, false),
      index,
      fileType,
      fileSize: file.size,
    };
    batchTasks.tasks.push(newTask);
    await localforage.setItem('batch_tasks', batchTasks);

    const fileId = generateStableFileId(taskId);

    return {
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
      fileRef: file // 保留原始文件引用用于后续转录
    };
  }
}

/**
 * 删除文件
 */
export async function removeFile(file: SubtitleFileMetadata): Promise<void> {
  const taskId = file.taskId;
  const batchTasks = await localforage.getItem<BatchTasks>('batch_tasks');
  if (batchTasks) {
    batchTasks.tasks = batchTasks.tasks.filter(t => t.taskId !== taskId);
    await localforage.setItem('batch_tasks', batchTasks);
  }
  await localforage.removeItem(`mp3_data:${taskId}`);
}

/**
 * 从 localforage 恢复文件列表（返回元数据，不包含完整 entries）
 * 检测中断的处理：任何 phase 状态为 'active' 说明实际处理已中断，标记为 'failed'
 */
export async function restoreFiles(): Promise<SubtitleFileMetadata[]> {
  const batchTasks = await localforage.getItem<BatchTasks>('batch_tasks');
  if (!batchTasks || batchTasks.tasks.length === 0) {
    return [];
  }

  let modified = false;
  for (const task of batchTasks.tasks) {
    const phases = task.phases;
    if (phases) {
      for (const phase of ['converting', 'transcribing', 'translating', 'splitting'] as const) {
        if (phases[phase]?.status === 'active') {
          phases[phase] = { status: 'failed', progress: 0, tokens: phases[phase].tokens || 0 };
          modified = true;
        }
      }
    }
  }

  if (modified) {
    await localforage.setItem('batch_tasks', batchTasks);
  }

  return batchTasks.tasks.map(task => convertTaskToMetadata(task));
}

/**
 * 清空所有数据
 */
export async function clearAllData(): Promise<void> {
  await localforage.setItem('batch_tasks', { tasks: [] });
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
    tokensUsed: task.phases?.translating?.tokens || 0,
    entriesVersion: 0
  };
}