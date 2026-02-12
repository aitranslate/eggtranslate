# AssemblyAI 转录集成实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 集成 AssemblyAI 云端转录服务，替换本地 Parakeet 模型，保持 LLM 句子分割流程。

**Architecture:** 音视频文件 → 转换为 WAV → 上传 AssemblyAI → 获取单词时间戳 → LLM 组句 → 生成 SRT

**Tech Stack:** AssemblyAI JavaScript SDK, AudioContext API, Zustand, localStorage

---

## 前置检查

### Task 0: 验证环境依赖

**Files:**
- Check: `package.json`

**Step 1: 检查 parakeet.js 依赖**
```bash
grep "parakeet" package.json
```
Expected: 如果存在，记录版本号

**Step 2: 检查 AssemblyAI SDK**
```bash
pnpm list assemblyai
```
Expected: 未安装（需要后续安装）

---

## Phase 1: 基础设施

### Task 1: 安装 AssemblyAI SDK

**Files:**
- Modify: `package.json`

**Step 1: 安装依赖**
```bash
pnpm add assemblyai
```

**Step 2: 验证安装**
```bash
pnpm list assemblyai
```
Expected: 显示版本号（如 assemblyai@x.x.x）

**Step 3: 移除 parakeet.js（如果存在）**
```bash
pnpm remove parakeet.js
```

**Step 4: 提交**
```bash
git add package.json pnpm-lock.yaml
git commit -m "deps: 添加 assemblyai SDK，移除 parakeet.js"
```

---

### Task 2: 创建 AssemblyAI 配置常量

**Files:**
- Create: `src/constants/assemblyai.ts`

**Step 1: 创建配置文件**

```typescript
/**
 * AssemblyAI API 配置
 */

export const ASSEMBLYAI_CONFIG = {
  // API Keys（轮询使用）
  apiKeys: [
    'YOUR_API_KEY_1',
    'YOUR_API_KEY_2',
    // 添加更多 KEY
  ],

  // 语音模型（优先级顺序）
  speechModels: ["universal-3-pro", "universal-2"] as const,

  // 默认热词（用户可扩展）
  defaultKeyterms: [] as string[],
} as const;

// 支持的语言（用于 UI 显示）
export const SUPPORTED_LANGUAGES = {
  pro: ['English', 'Spanish', 'Portuguese', 'French', 'German', 'Italian'],
  fallback: '99+ languages',
} as const;
```

**Step 2: 运行类型检查**
```bash
npx tsc --noEmit
```
Expected: 无错误

**Step 3: 提交**
```bash
git add src/constants/assemblyai.ts
git commit -m "feat: 添加 AssemblyAI 配置常量"
```

---

### Task 3: 实现音视频转 WAV 工具

**Files:**
- Create: `src/utils/convertToWav.ts`
- Delete: `src/services/audioDecoder.ts`

**Step 1: 创建转换工具**

```typescript
/**
 * 将用户上传的音视频文件转换为 WAV 格式 Blob
 * @param file - 用户上传的文件 (mp4, avi, mp3, m4a等)
 * @returns 转换后的 wav 文件
 */
export async function convertToWav(file: File): Promise<Blob> {
  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

  // 1. 解码音视频文件 (浏览器原生支持从视频中提取音频流)
  const arrayBuffer = await file.arrayBuffer();
  const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);

  // 2. 将多声道转为单声道 (ASR 通常只需要单声道，且能减小一倍体积)
  const pcmData = audioBuffer.getChannelData(0); // 获取左声道数据
  const sampleRate = audioBuffer.sampleRate;

  // 3. 封装 WAV 头并返回 Blob
  const wavBuffer = encodeWAV(pcmData, sampleRate);
  audioCtx.close();

  return new Blob([wavBuffer], { type: 'audio/wav' });
}

/**
 * 辅助函数：为原始 PCM 数据添加 WAV 头部 (约44字节)
 */
function encodeWAV(samples: Float32Array, sampleRate: number) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  /* RIFF identifier */
  writeString(view, 0, 'RIFF');
  /* file length */
  view.setUint32(4, 36 + samples.length * 2, true);
  /* RIFF type */
  writeString(view, 8, 'WAVE');
  /* format chunk identifier */
  writeString(view, 12, 'fmt ');
  /* format chunk length */
  view.setUint32(16, 16, true);
  /* sample format (raw) */
  view.setUint16(20, 1, true);
  /* channel count */
  view.setUint16(22, 1, true);
  /* sample rate */
  view.setUint32(24, sampleRate, true);
  /* byte rate (sample rate * block align) */
  view.setUint32(28, sampleRate * 2, true);
  /* block align (channel count * bytes per sample) */
  view.setUint16(32, 2, true);
  /* bits per sample */
  view.setUint16(34, 16, true);
  /* data chunk identifier */
  writeString(view, 36, 'data');
  /* data chunk length */
  view.setUint32(40, samples.length * 2, true);

  // 写入 PCM 采样数据
  const offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset + i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }

  return buffer;
}

function writeString(view: DataView, offset: number, string: string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}
```

**Step 2: 删除旧的 audioDecoder.ts**
```bash
rm src/services/audioDecoder.ts
```

**Step 3: 运行类型检查**
```bash
npx tsc --noEmit
```
Expected: 可能显示 audioDecoder 相关错误（后续任务修复）

**Step 4: 提交**
```bash
git add src/utils/convertToWav.ts src/services/audioDecoder.ts
git commit -m "feat: 实现音视频转 WAV 工具，移除 audioDecoder"
```

---

### Task 4: 实现 AssemblyAI 服务客户端

**Files:**
- Create: `src/services/assemblyaiService.ts`

**Step 1: 创建服务类**

```typescript
import { AssemblyAI } from "assemblyai";
import { ASSEMBLYAI_CONFIG } from "@/constants/assemblyai";
import { convertToWav } from "@/utils/convertToWav";
import type { TranscriptionWord } from "@/types/transcription";
import { toAppError } from "@/utils/errors";

/**
 * AssemblyAI 转录服务
 * 封装 API 调用、KEY 轮询、错误处理
 */
export class AssemblyAIService {
  private keyIndex = 0;

  /**
   * 随机获取一个 KEY 并创建客户端
   */
  private createClient(): AssemblyAI {
    const keys = ASSEMBLYAI_CONFIG.apiKeys;
    const apiKey = keys[Math.floor(Math.random() * keys.length)];
    return new AssemblyAI({ apiKey });
  }

  /**
   * 转录音视频文件
   * @param mediaFile 音频或视频文件
   * @param options 热词等配置
   * @returns 单词级别时间戳数组
   */
  async transcribe(
    mediaFile: File,
    options: { keyterms?: string[] } = {}
  ): Promise<TranscriptionWord[]> {
    try {
      const client = this.createClient();

      // 1. 转换为 WAV
      const wavBlob = await convertToWav(mediaFile);
      const wavFile = new File([wavBlob], 'audio.wav', { type: 'audio/wav' });

      // 2. 调用 AssemblyAI
      const transcript = await client.transcripts.transcribe({
        audio: wavFile,
        speech_models: ASSEMBLYAI_CONFIG.speechModels,
        language_detection: true,
        keyterms_prompt: options.keyterms || ASSEMBLYAI_CONFIG.defaultKeyterms
      });

      // 3. 检查错误
      if (transcript.status === 'error') {
        throw new Error(`Transcription failed: ${transcript.error}`);
      }

      // 4. 转换为 TranscriptionWord 格式
      return transcript.words.map(w => ({
        text: w.text,
        start_time: w.start / 1000,  // 毫秒 → 秒
        end_time: w.end / 1000,
        confidence: w.confidence
      }));

    } catch (error) {
      const appError = toAppError(error, 'ASR 转录失败');
      console.error('[AssemblyAI]', appError.message, appError);
      throw appError;
    }
  }
}

// 导出单例
export const assemblyaiService = new AssemblyAIService();
```

**Step 2: 运行类型检查**
```bash
npx tsc --noEmit
```
Expected: 无错误

**Step 3: 提交**
```bash
git add src/services/assemblyaiService.ts
git commit -m "feat: 实现 AssemblyAI 服务客户端"
```

---

## Phase 2: 转录流程

### Task 5: 修改转录流程

**Files:**
- Modify: `src/services/transcriptionPipeline.ts:1-400`

**Step 1: 替换模型调用**

找到 `runTranscriptionPipeline` 函数，修改转录部分：

```typescript
// 旧代码（删除）
// import type { TranscriptionModel } from '@/types/transcription';
// import { DecodedAudio, decodeAudioFile } from './audioDecoder';
// import { findSilencePoints, createChunkPlan } from '@/utils/silenceDetection';
// const { pcm, duration } = await decodeAudioFile(fileRef, AUDIO_CONSTANTS.SAMPLE_RATE);
// const chunks = createChunkPlan(pcm, AUDIO_CONSTANTS.SAMPLE_RATE, silencePoints);
// const res = await model.transcribe(pcm, ...);

// 新代码（添加）
import { assemblyaiService } from './assemblyaiService';
import { ASSEMBLYAI_CONFIG } from '@/constants/assemblyai';
import dataManager from '@/services/dataManager';

export const runTranscriptionPipeline = async (
  fileRef: File,
  llmConfig: TranscriptionLLMConfig,
  callbacks: ProgressCallbacks = {}
): Promise<TranscriptionResult> => {
  // 1. AssemblyAI 转录（替换解码+静音检测+切片+模型调用）
  callbacks.onTranscribing?.();

  // 从 store 获取热词（所有分组的词汇合并）
  const config = await dataManager.getTranscriptionConfig();
  const allKeyterms = config.keytermGroups?.flatMap(g => g.keyterms) || [];

  const words = await assemblyaiService.transcribe(fileRef, {
    keyterms: allKeyterms
  });

  const duration = words[words.length - 1]?.end_time || 0;
  const totalChunks = 1;  // API 自动处理，不再切片

  await new Promise(r => setTimeout(r, API_CONSTANTS.STATE_UPDATE_DELAY_MS));
  toast(`转录完成，共 ${words.length} 个单词`);

  // 2. LLM 句子分割（保持不变）
  callbacks.onLLMMerging?.();

  const batches = createBatches(words);
  // ... 后续 LLM 处理逻辑保持不变 ...
};
```

**Step 2: 更新函数签名**
```typescript
// 移除 model 参数
export const runTranscriptionPipeline = async (
  fileRef: File,
  llmConfig: TranscriptionLLMConfig,  // 保持不变
  callbacks: ProgressCallbacks = {}
): Promise<TranscriptionResult> => {
```

**Step 3: 运行类型检查**
```bash
npx tsc --noEmit
```
Expected: 可能显示 TranscriptionModel 相关错误

**Step 4: 提交**
```bash
git add src/services/transcriptionPipeline.ts
git commit -m "refactor: 转录流程替换为 AssemblyAI API"
```

---

### Task 6: 简化 transcriptionStore

**Files:**
- Modify: `src/stores/transcriptionStore.ts`

**Step 1: 重写 Store**

```typescript
/**
 * 转录配置 Store
 * 简化版本：只管理热词分组
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { KeytermGroup } from '@/types/transcription';
import dataManager from '@/services/dataManager';

interface TranscriptionStore {
  // 热词分组
  keytermGroups: KeytermGroup[];

  // Actions
  updateKeytermGroups: (groups: KeytermGroup[]) => Promise<void>;
}

const DEFAULT_GROUPS: KeytermGroup[] = [
  { id: 'default', name: '通用', keyterms: [] }
];

export const useTranscriptionStore = create<TranscriptionStore>()(
  persist(
    (set, get) => ({
      keytermGroups: DEFAULT_GROUPS,

      updateKeytermGroups: async (groups) => {
        set({ keytermGroups: groups });
        await dataManager.saveTranscriptionConfig({ keytermGroups: groups });
      },
    }),
    {
      name: 'transcription-storage',
      partialize: (state) => ({
        keytermGroups: state.keytermGroups
      })
    }
  )
);

// 初始化：加载保存的配置
if (typeof window !== 'undefined') {
  (async () => {
    try {
      const savedConfig = await dataManager.getTranscriptionConfig();
      if (savedConfig?.keytermGroups) {
        useTranscriptionStore.setState({ keytermGroups: savedConfig.keytermGroups });
      }
    } catch (error) {
      console.error('[transcriptionStore] 初始化失败:', error);
    }
  })();
}

// 导出 hooks
export const useKeytermGroups = () => useTranscriptionStore((state) => state.keytermGroups);
export const useUpdateKeytermGroups = () => useTranscriptionStore((state) => state.updateKeytermGroups);
```

**Step 2: 更新 dataManager 类型**
```typescript
// src/services/dataManager/index.ts
export interface TranscriptionConfig {
  keytermGroups?: KeytermGroup[];
}
```

**Step 3: 运行类型检查**
```bash
npx tsc --noEmit
```
Expected: 可能显示类型不匹配错误

**Step 4: 提交**
```bash
git add src/stores/transcriptionStore.ts src/services/dataManager
git commit -m "refactor: 简化 transcriptionStore 为热词管理"
```

---

## Phase 3: UI 更新

### Task 7: 实现热词分组设置组件

**Files:**
- Create: `src/components/KeytermGroupsSettings.tsx`

**Step 1: 创建组件**

```typescript
import React, { useState } from 'react';
import { FolderOpen, Plus, X, Trash2, Edit2, Check } from 'lucide-react';
import type { KeytermGroup } from '@/types/transcription';

interface KeytermGroupsSettingsProps {
  groups: KeytermGroup[];
  onGroupsChange: (groups: KeytermGroup[]) => void;
}

export const KeytermGroupsSettings: React.FC<KeytermGroupsSettingsProps> = ({
  groups,
  onGroupsChange
}) => {
  const [activeGroupId, setActiveGroupId] = useState(groups[0]?.id || '');
  const [newKeyterm, setNewKeyterm] = useState('');
  const [newGroupName, setNewGroupName] = useState('');
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');

  const activeGroup = groups.find(g => g.id === activeGroupId);

  const addGroup = () => {
    if (newGroupName.trim()) {
      const newGroup: KeytermGroup = {
        id: `group-${Date.now()}`,
        name: newGroupName.trim(),
        keyterms: []
      };
      onGroupsChange([...groups, newGroup]);
      setNewGroupName('');
      setActiveGroupId(newGroup.id);
    }
  };

  const deleteGroup = (groupId: string) => {
    onGroupsChange(groups.filter(g => g.id !== groupId));
    if (activeGroupId === groupId) {
      setActiveGroupId(groups[0]?.id || '');
    }
  };

  const startEditGroup = (group: KeytermGroup) => {
    setEditingGroupId(group.id);
    setEditingName(group.name);
  };

  const saveEditGroup = () => {
    if (editingName.trim()) {
      onGroupsChange(groups.map(g =>
        g.id === editingGroupId ? { ...g, name: editingName.trim() } : g
      ));
      setEditingGroupId(null);
      setEditingName('');
    }
  };

  const addKeyterm = () => {
    if (activeGroup && newKeyterm.trim() && !activeGroup.keyterms.includes(newKeyterm.trim())) {
      onGroupsChange(groups.map(g =>
        g.id === activeGroupId
          ? { ...g, keyterms: [...g.keyterms, newKeyterm.trim()] }
          : g
      ));
      setNewKeyterm('');
    }
  };

  const removeKeyterm = (term: string) => {
    onGroupsChange(groups.map(g =>
      g.id === activeGroupId
        ? { ...g, keyterms: g.keyterms.filter(k => k !== term) }
        : g
    ));
  };

  return (
    <div className="space-y-6">
      {/* 热词分组 */}
      <div className="space-y-3">
        <h3 className="apple-heading-small">热词提示</h3>

        {/* 分组标签 */}
        <div className="flex flex-wrap gap-2">
          {groups.map((group) => (
            <div
              key={group.id}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition-all ${
                activeGroupId === group.id
                  ? 'bg-blue-100 text-blue-700'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
              onClick={() => setActiveGroupId(group.id)}
            >
              <FolderOpen className="h-4 w-4" />
              {editingGroupId === group.id ? (
                <input
                  type="text"
                  value={editingName}
                  onChange={(e) => setEditingName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && saveEditGroup()}
                  onClick={(e) => e.stopPropagation()}
                  className="bg-transparent border-none outline-none text-sm w-24"
                  autoFocus
                />
              ) : (
                <span className="text-sm font-medium">{group.name}</span>
              )}
              <span className="text-xs opacity-60">({group.keyterms.length})</span>
              {editingGroupId === group.id ? (
                <button
                  onClick={(e) => { e.stopPropagation(); saveEditGroup(); }}
                  className="hover:bg-blue-200 rounded p-0.5"
                >
                  <Check className="h-3 w-3" />
                </button>
              ) : (
                <div className="flex items-center gap-0.5">
                  <button
                    onClick={(e) => { e.stopPropagation(); startEditGroup(group); }}
                    className="hover:bg-blue-200 rounded p-0.5"
                  >
                    <Edit2 className="h-3 w-3" />
                  </button>
                  {groups.length > 1 && (
                    <button
                      onClick={(e) => { e.stopPropagation(); deleteGroup(group.id); }}
                      className="hover:bg-blue-200 rounded p-0.5"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}

          {/* 新建分组输入框 */}
          {newGroupName ? (
            <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-lg">
              <input
                type="text"
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addGroup()}
                onBlur={() => {
                  if (newGroupName.trim()) addGroup();
                  else setNewGroupName('');
                }}
                placeholder="分组名称"
                className="bg-transparent border-none outline-none text-sm w-24"
                autoFocus
              />
              <button
                onClick={addGroup}
                className="text-green-600 hover:text-green-700"
              >
                <Check className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => setNewGroupName('新建分组')}
              className="flex items-center gap-2 px-3 py-2 bg-gray-50 text-gray-600 rounded-lg hover:bg-gray-200 transition-colors"
            >
              <Plus className="h-4 w-4" />
              <span className="text-sm">新建分组</span>
            </button>
          )}
        </div>

        {/* 当前分组的热词列表 */}
        {activeGroup && (
          <div className="space-y-3">
            <p className="text-sm text-gray-600">
              {activeGroup.name}的热词列表
            </p>

            {activeGroup.keyterms.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {activeGroup.keyterms.map((term) => (
                  <div
                    key={term}
                    className="flex items-center gap-1 px-3 py-1.5 bg-gray-100 rounded-lg text-sm text-gray-700"
                  >
                    <span>{term}</span>
                    <button
                      onClick={() => removeKeyterm(term)}
                      className="hover:text-gray-900"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* 添加热词 */}
            <div className="flex gap-2">
              <input
                type="text"
                value={newKeyterm}
                onChange={(e) => setNewKeyterm(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addKeyterm()}
                placeholder="添加热词..."
                className="flex-1 p-3 bg-gray-50 border border-gray-200 rounded-lg text-gray-900 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all"
              />
              <button
                onClick={addKeyterm}
                className="apple-button apple-button-secondary"
              >
                <Plus className="h-4 w-4" />
                <span>添加</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 说明信息 */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
        <div className="flex items-start gap-3">
          <FolderOpen className="h-5 w-5 text-blue-600 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-blue-700">
            <p className="font-medium mb-1">热词提示说明</p>
            <p className="text-blue-600">
              按领域分组管理热词，提高专业术语识别准确率。所有分组的词汇将一起发送给 ASR 服务。
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
```

**Step 2: 运行类型检查**
```bash
npx tsc --noEmit
```
Expected: 无错误

**Step 3: 提交**
```bash
git add src/components/KeytermGroupsSettings.tsx
git commit -m "feat: 实现热词分组设置组件"
```

---

### Task 8: 重写 TranscriptionSettings 组件

**Files:**
- Modify: `src/components/TranscriptionSettings.tsx`

**Step 1: 完全重写组件**

```typescript
import React from 'react';
import { KeytermGroupsSettings } from './KeytermGroupsSettings';
import { useKeytermGroups, useUpdateKeytermGroups } from '@/stores/transcriptionStore';

export const TranscriptionSettings: React.FC = () => {
  const keytermGroups = useKeytermGroups();
  const updateKeytermGroups = useUpdateKeytermGroups();

  return (
    <div className="space-y-6">
      <KeytermGroupsSettings
        groups={keytermGroups}
        onGroupsChange={updateKeytermGroups}
      />
    </div>
  );
};
```

**Step 2: 运行类型检查**
```bash
npx tsc --noEmit
```
Expected: 无错误

**Step 3: 提交**
```bash
git add src/components/TranscriptionSettings.tsx
git commit -m "refactor: 重写 TranscriptionSettings 为热词管理"
```

---

## Phase 4: 类型定义和清理

### Task 9: 更新类型定义

**Files:**
- Modify: `src/types/transcription.ts`

**Step 1: 添加 KeytermGroup 类型**

```typescript
// 在文件末尾添加

export interface KeytermGroup {
  id: string;
  name: string;
  keyterms: string[];
}
```

**Step 2: 移除废弃类型**

删除以下类型定义：
- TranscriptionConfig（旧的模型配置）
- ModelStatus
- SubtitleFileMetadata 中与本地模型相关的字段

**Step 3: 更新 TranscriptionStatus**

```typescript
export type TranscriptionStatus =
  | 'idle'
  | 'uploading'      // 上传音频中
  | 'transcribing'    // API 转录中
  | 'llm_merging'     // LLM 组句中
  | 'completed'
  | 'failed';
```

**Step 4: 运行类型检查**
```bash
npx tsc --noEmit
```
Expected: 无错误

**Step 5: 提交**
```bash
git add src/types/transcription.ts
git commit -m "refactor: 更新转录类型定义"
```

---

### Task 10: 删除废弃组件和文件

**Files:**
- Delete: `src/components/TranscriptionPromptModal.tsx`
- Delete: `src/utils/silenceDetection.ts`
- Delete: `src/utils/batchProcessor.ts` (如果不再使用)

**Step 1: 删除文件**
```bash
rm src/components/TranscriptionPromptModal.tsx
rm src/utils/silenceDetection.ts
```

**Step 2: 检查并删除未使用的导入**

全局搜索并移除对已删除文件的引用：
```bash
grep -r "TranscriptionPromptModal" src/
grep -r "silenceDetection" src/
grep -r "audioDecoder" src/
```

删除相关导入和调用。

**Step 3: 运行类型检查**
```bash
npx tsc --noEmit
```
Expected: 可能显示未删除的引用错误

**Step 4: 提交**
```bash
git add -A
git commit -m "chore: 删除废弃的转录相关文件"
```

---

## Phase 5: 集成测试

### Task 11: 端到端测试

**Files:**
- Test: 手动测试整个应用

**Step 1: 启动应用**
```bash
pnpm dev
```

**Step 2: 测试热词管理**
1. 打开设置 → 转录设置
2. 创建新分组"医学术语"
3. 添加热词"hypertension"
4. 验证保存和加载

**Step 3: 测试转录流程**
1. 上传测试音频文件
2. 观察"上传中"状态
3. 观察"转录中"状态
4. 验证返回单词时间戳
5. 验证 LLM 组句正常工作

**Step 4: 检查错误**
```bash
# 查看控制台错误
# 检查 Network tab API 调用
```

**Step 5: 修复发现的问题**
如有问题，修复并提交。

**Step 6: 最终验证**
```bash
npx tsc --noEmit
pnpm build
```
Expected: 无类型错误，构建成功

---

### Task 12: 文档更新

**Files:**
- Create: `docs/assemblyai-integration.md`
- Modify: `CLAUDE.md` (如果需要)

**Step 1: 创建集成文档**

```markdown
# AssemblyAI 转录集成说明

## 概述
使用 AssemblyAI 云端转录服务，支持 99+ 种语言自动检测。

## 配置
在 `src/constants/assemblyai.ts` 中配置 API Keys。

## 热词管理
支持按领域分组管理热词，提高专业术语识别准确率。
```

**Step 2: 提交**
```bash
git add docs/
git commit -m "docs: 添加 AssemblyAI 集成文档"
```

---

## 完成清单

- [x] 安装 AssemblyAI SDK
- [x] 创建配置常量
- [x] 实现 WAV 转换工具
- [x] 实现 AssemblyAI 服务
- [x] 修改转录流程
- [x] 简化 Store
- [x] 实现热词分组 UI
- [x] 重写设置组件
- [x] 更新类型定义
- [x] 删除废弃文件
- [x] 端到端测试
- [x] 文档更新

---

**下一步：合并回 main 分支**
```bash
git checkout main
git merge feature/asr-api-integration
git push
```
