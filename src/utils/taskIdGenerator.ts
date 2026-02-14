/**
 * 任务ID和文件ID生成工具
 */

/**
 * 生成新的任务ID
 * @returns 唯一的任务ID
 */
export const generateTaskId = (): string => {
  return `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
};

/**
 * 基于任务ID生成稳定的文件ID
 * @param taskId 任务ID
 * @returns 文件ID
 */
export const generateStableFileId = (taskId: string): string => {
  return `file_${taskId}`;
};
