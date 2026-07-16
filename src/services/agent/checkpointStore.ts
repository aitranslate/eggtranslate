/**
 * Agent job 断点（B1 术语 / B2 窗结果）— localforage，与 filesStore 隔离。
 */

import localforage from 'localforage';
import type { AgentJob, GlossaryEntry } from './types';

let store: LocalForage | null = null;

function getStore(): LocalForage {
  if (!store) {
    // 延迟创建，避免单测 mock localforage 时模块加载即炸
    store = localforage.createInstance({
      name: 'eggtranslate',
      storeName: 'agent_jobs',
    });
  }
  return store;
}

function jobKey(taskId: string) {
  return `agentJob:${taskId}`;
}

export async function loadAgentJob(taskId: string): Promise<AgentJob | null> {
  try {
    const job = await getStore().getItem<AgentJob>(jobKey(taskId));
    if (!job || job.schemaVersion !== 1) return null;
    return job;
  } catch {
    return null;
  }
}

export async function saveAgentJob(job: AgentJob): Promise<void> {
  job.updatedAt = Date.now();
  await getStore().setItem(jobKey(job.taskId), job);
}

export async function clearAgentJob(taskId: string): Promise<void> {
  await getStore().removeItem(jobKey(taskId));
}

export function computeAgentFingerprint(input: {
  entryTexts: string[];
  sourceLanguage: string;
  targetLanguage: string;
  windowSize: number;
  model: string;
  userTermsKey: string;
}): string {
  const payload = [
    input.sourceLanguage,
    input.targetLanguage,
    String(input.windowSize),
    input.model,
    input.userTermsKey,
    ...input.entryTexts,
  ].join('\n');
  // 轻量 hash（非加密）：足够判断配置/字幕是否变化
  let h = 2166136261;
  for (let i = 0; i < payload.length; i++) {
    h ^= payload.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

export function createEmptyJob(input: {
  taskId: string;
  fileId: string;
  fingerprint: string;
}): AgentJob {
  return {
    schemaVersion: 1,
    taskId: input.taskId,
    fileId: input.fileId,
    fingerprint: input.fingerprint,
    stage: 'terminology',
    glossary: [] as GlossaryEntry[],
    styleGuide: '',
    windowResults: {},
    updatedAt: Date.now(),
  };
}
