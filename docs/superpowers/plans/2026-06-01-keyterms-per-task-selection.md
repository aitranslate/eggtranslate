# 任务级热词选择 - 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修正热词功能的语义 bug（从"全部组合并"改为"单组选择"），并在任务卡片头部新增下拉选择器。

**Architecture:** 数据层新增 per-task 字段（`selectedKeytermGroupId`）+ 全局默认字段（`defaultKeytermGroupId`）。Service 层从 flatMap 改为单组查询。UI 层在文件头部加紧凑下拉，全局关闭时禁用 + tooltip 提示。

**Tech Stack:** Zustand 5, TypeScript 5.6, React 18, Vitest

**预计工作量：** 半天

**前置依赖：** 阶段 3 完成（subtitleStore 已拆分）

---

## 文件清单

### 修改文件（6 个）
- `src/types/index.ts` - 新增 `selectedKeytermGroupId` 字段到 `SubtitleFileMetadata`
- `src/stores/filesStore.ts` - 升级 version 3 + migrate + 新增 setter
- `src/stores/transcriptionStore.ts` - 新增 `defaultKeytermGroupId` 字段
- `src/components/KeytermGroupsSettings.tsx` - 选中分组时更新 default
- `src/services/filesService.ts` - addFile 时设置默认 selectedKeytermGroupId
- `src/services/transcriptionService.ts` - 改用单组查询替代 flatMap
- `src/components/SubtitleFileList/components/SubtitleFileItem.tsx` - 加下拉选择器
- `src/services/__tests__/transcriptionService.test.ts` - 新增测试用例

### 不新建文件

---

## 任务列表

### Task 1: 在 `SubtitleFileMetadata` 类型加 `selectedKeytermGroupId`

**Files:**
- Modify: `D:\EggTranslate\src\types\index.ts` (在 `SubtitleFileMetadata` 接口)

- [ ] **Step 1: 读取 `SubtitleFileMetadata` 定义**

读取 `D:\EggTranslate\src\types\index.ts`，找到 `SubtitleFileMetadata` interface。

预期位置：约 L50-74。

- [ ] **Step 2: 加新字段**

在 `// 音视频原始文件引用（不持久化，仅内存）` 这行**之前**插入：

```ts
  /** 该文件要使用的热词分组 ID；null 表示不使用热词 */
  selectedKeytermGroupId: string | null;
```

完整 `SubtitleFileMetadata` 修改后：

```ts
export interface SubtitleFileMetadata {
  id: string;
  taskId: string;
  name: string;
  fileType: FileType;
  fileSize: number;
  lastModified: number;
  duration?: number;

  // 缓存的统计信息
  entryCount: number;
  translatedCount: number;

  // 阶段状态
  phases: FilePhases;

  // 全局 tokens
  tokensUsed: number;

  // entries 版本号
  entriesVersion: number;

  /** 该文件要使用的热词分组 ID；null 表示不使用热词 */
  selectedKeytermGroupId: string | null;

  // 音视频原始文件引用（不持久化，仅内存）
  fileRef?: File;
}
```

- [ ] **Step 3: 验证**

```bash
cd /d/EggTranslate && pnpm exec tsc -b 2>&1 | head -10
```

预期：出现"Property 'selectedKeytermGroupId' is missing" 错误（因为现有 task 数据没这字段）。这是预期的，下个 task 修复。

- [ ] **Step 4: 提交**

```bash
git add src/types/index.ts
git commit -m "feat(types): 在 SubtitleFileMetadata 加 selectedKeytermGroupId 字段"
```

---

### Task 2: 在 `useTranscriptionStore` 加 `defaultKeytermGroupId`

**Files:**
- Modify: `D:\EggTranslate\src\stores\transcriptionStore.ts`

- [ ] **Step 1: 加新字段到 interface**

在 `interface TranscriptionState` 中加：

```ts
  /** 新任务的默认热词分组；null = 默认不使用 */
  defaultKeytermGroupId: string | null;
  setDefaultKeytermGroupId: (id: string | null) => void;
```

- [ ] **Step 2: 加初始 state**

在 `(set) => ({` 块中加：

```ts
      defaultKeytermGroupId: null,
```

- [ ] **Step 3: 加 setter 实现**

在 `setAiSegmentationEnabled` 方法之后加：

```ts
      setDefaultKeytermGroupId: (id) => {
        set({ defaultKeytermGroupId: id });
      },
```

- [ ] **Step 4: 持久化 partialize**

在 `partialize` 块加 `defaultKeytermGroupId: state.defaultKeytermGroupId,`：

```ts
      partialize: (state) => ({
        apiKeys: state.apiKeys,
        keytermGroups: state.keytermGroups,
        keytermsEnabled: state.keytermsEnabled,
        subtitleLengthPreset: state.subtitleLengthPreset,
        aiSegmentationEnabled: state.aiSegmentationEnabled,
        defaultKeytermGroupId: state.defaultKeytermGroupId
      }),
```

- [ ] **Step 5: 验证**

```bash
cd /d/EggTranslate && pnpm run build 2>&1 | tail -3
```

预期：build 成功（TS 错误应该消失了，因为下个 task 修复）

- [ ] **Step 6: 提交**

```bash
git add src/stores/transcriptionStore.ts
git commit -m "feat(store): 在 useTranscriptionStore 加 defaultKeytermGroupId 全局默认字段"
```

---

### Task 3: 升级 `useFilesStore` 到 version 3 + migrate + 新增 setter

**Files:**
- Modify: `D:\EggTranslate\src\stores\filesStore.ts`

- [ ] **Step 1: 加 setter 到 FilesState interface**

在 `interface FilesState` 中加：

```ts
  setSelectedKeytermGroupId: (fileId: string, groupId: string | null) => void;
```

- [ ] **Step 2: 加实现**

在 `setWorkflow` 方法之后加：

```ts
      setSelectedKeytermGroupId: (fileId, groupId) => {
        const file = get().getFile(fileId);
        if (!file) return;
        set((state) => ({
          tasks: state.tasks.map((t) =>
            t.taskId === file.taskId ? { ...t, selectedKeytermGroupId: groupId } : t
          ),
        }));
      },
```

- [ ] **Step 3: 升级 persist version + migrate**

**Before** (L260-264):
```ts
      version: 2,
      migrate: (persistedState: unknown, version: number) => {
        if (persistedState && typeof persistedState === 'object' && 'tasks' in persistedState) {
          return persistedState as { tasks: SingleTask[]; selectedFileId: string | null };
        }
        return { tasks: [], selectedFileId: null };
      },
```

**After:**
```ts
      version: 3,
      migrate: (persistedState: unknown, version: number) => {
        if (persistedState && typeof persistedState === 'object' && 'tasks' in persistedState) {
          const state = persistedState as { tasks: SingleTask[]; selectedFileId: string | null };
          if (version < 3) {
            // 老任务没有 selectedKeytermGroupId 字段，默认 null
            return {
              ...state,
              tasks: state.tasks.map((t) => ({ ...t, selectedKeytermGroupId: null })),
            };
          }
          return state;
        }
        return { tasks: [], selectedFileId: null };
      },
```

- [ ] **Step 4: 验证**

```bash
cd /d/EggTranslate && pnpm run build 2>&1 | tail -3
```

预期：build 成功

- [ ] **Step 5: 提交**

```bash
git add src/stores/filesStore.ts
git commit -m "feat(store): useFilesStore 升级 v3 + 新增 setSelectedKeytermGroupId"
```

---

### Task 4: 更新 `KeytermGroupsSettings` 点击分组时更新默认

**Files:**
- Modify: `D:\EggTranslate\src\components\KeytermGroupsSettings.tsx`

- [ ] **Step 1: 加 prop**

在 `interface KeytermGroupsSettingsProps` 加：

```ts
  onDefaultGroupChange: (groupId: string | null) => void;
```

加到 props 列表：

```ts
export const KeytermGroupsSettings: React.FC<KeytermGroupsSettingsProps> = ({
  groups,
  onGroupsChange,
  keytermsEnabled,
  onKeytermsEnabledChange,
  onDefaultGroupChange
}) => {
```

- [ ] **Step 2: 在 group 点击时触发 onDefaultGroupChange**

找到分组 tab 的 `onClick`，修改为：

**Before:**
```tsx
              onClick={() => setActiveGroupId(group.id)}
```

**After:**
```tsx
              onClick={() => {
                setActiveGroupId(group.id);
                onDefaultGroupChange(group.id);
              }}
```

- [ ] **Step 3: 验证**

```bash
cd /d/EggTranslate && pnpm run build 2>&1 | tail -3
```

预期：build 失败（因为 `TranscriptionSettings` 还没传新 prop）。这是预期的。

- [ ] **Step 4: 提交**

```bash
git add src/components/KeytermGroupsSettings.tsx
git commit -m "feat(ui): KeytermGroupsSettings 点击分组触发 onDefaultGroupChange"
```

---

### Task 5: 在 `TranscriptionSettings` 接线新 prop

**Files:**
- Modify: `D:\EggTranslate\src\components\TranscriptionSettings.tsx`

- [ ] **Step 1: 读取文件**

读取 `D:\EggTranslate\src\components\TranscriptionSettings.tsx`，找到现有的 keyterm 相关 hooks 和 `<KeytermGroupsSettings>` 的使用位置。

- [ ] **Step 2: 加 hook**

在文件顶部 imports 之后加：

```ts
const setDefaultKeytermGroupId = useTranscriptionStore((state) => state.setDefaultKeytermGroupId);
```

- [ ] **Step 3: 传给 KeytermGroupsSettings**

在 `<KeytermGroupsSettings` 组件上添加 prop：

```tsx
        onDefaultGroupChange={setDefaultKeytermGroupId}
```

完整 props 应类似：
```tsx
      <KeytermGroupsSettings
        groups={keytermGroups}
        onGroupsChange={updateKeytermGroups}
        keytermsEnabled={keytermsEnabled}
        onKeytermsEnabledChange={setKeytermsEnabled}
        onDefaultGroupChange={setDefaultKeytermGroupId}
      />
```

- [ ] **Step 4: 验证**

```bash
cd /d/EggTranslate && pnpm run build 2>&1 | tail -3
```

预期：build 成功

- [ ] **Step 5: 提交**

```bash
git add src/components/TranscriptionSettings.tsx
git commit -m "feat(ui): TranscriptionSettings 接线 defaultKeytermGroupId 设置"
```

---

### Task 6: 更新 `filesService.addFile` 设置默认 selectedKeytermGroupId

**Files:**
- Modify: `D:\EggTranslate\src\services\filesService.ts`

- [ ] **Step 1: 加 import**

在 imports 区域加：

```ts
import { useTranscriptionStore } from '@/stores/transcriptionStore';
```

- [ ] **Step 2: 修改 addFile 实现**

**Before:**
```ts
export async function addFile(file: File): Promise<string> {
  try {
    const result = await loadFromFile(file, {
      existingFilesCount: useFilesStore.getState().tasks.length,
    });
    const taskWithRef = { ...result.task, fileRef: file };
    useFilesStore.getState().addTask(taskWithRef);
    return result.metadata.id;
  } catch (error) {
    ...
  }
}
```

**After:**
```ts
export async function addFile(file: File): Promise<string> {
  try {
    const result = await loadFromFile(file, {
      existingFilesCount: useFilesStore.getState().tasks.length,
    });
    
    // 默认从设置中获取热词分组
    const transcriptionStore = useTranscriptionStore.getState();
    const defaultGroupId = transcriptionStore.keytermsEnabled
      ? transcriptionStore.defaultKeytermGroupId
      : null;
    
    const taskWithRef = { ...result.task, fileRef: file, selectedKeytermGroupId: defaultGroupId };
    useFilesStore.getState().addTask(taskWithRef);
    return result.metadata.id;
  } catch (error) {
    ...
  }
}
```

- [ ] **Step 3: 验证**

```bash
cd /d/EggTranslate && pnpm run build 2>&1 | tail -3
```

预期：build 成功

- [ ] **Step 4: 提交**

```bash
git add src/services/filesService.ts
git commit -m "feat(service): addFile 新任务设置默认 selectedKeytermGroupId"
```

---

### Task 7: 修正 `transcriptionService.startTranscription` 改用单组

**Files:**
- Modify: `D:\EggTranslate\src\services\transcriptionService.ts`

- [ ] **Step 1: 加 filesStore import**

在 imports 区域加：

```ts
import { useFilesStore } from '@/stores/filesStore';
```

- [ ] **Step 2: 替换 allKeyterms 计算**

**Before** (L42-47):
```ts
    const { keytermGroups, keytermsEnabled } = useTranscriptionStore.getState();
    const allKeyterms = keytermsEnabled ? keytermGroups.flatMap((g) => g.keyterms) : [];
```

**After:**
```ts
    const { keytermGroups, keytermsEnabled } = useTranscriptionStore.getState();
    const task = useFilesStore.getState().tasks.find((t) => t.taskId === file.taskId);
    const groupId = task?.selectedKeytermGroupId;
    const allKeyterms = (() => {
      if (!keytermsEnabled) return [];
      if (!groupId) return [];
      const group = keytermGroups.find((g) => g.id === groupId);
      return group?.keyterms ?? [];
    })();
```

- [ ] **Step 3: 验证**

```bash
cd /d/EggTranslate && pnpm run build 2>&1 | tail -3
```

预期：build 成功

- [ ] **Step 4: 提交**

```bash
git add src/services/transcriptionService.ts
git commit -m "fix(service): 修正 transcriptionService 单组查询热词（不再 flatMap）"
```

---

### Task 8: 更新 transcriptionService 测试

**Files:**
- Modify: `D:\EggTranslate\src\services\__tests__\transcriptionService.test.ts`

- [ ] **Step 1: 读取现有测试**

读取文件，查看现有 `makeTask` 工厂。

- [ ] **Step 2: 更新 makeTask 工厂**

**Before** (`makeTask` 工厂):
```ts
const makeTask = (file: any) => ({
  taskId: file.taskId,
  subtitle_filename: file.name,
  subtitle_entries: [],
  phases: file.phases,
  fileType: file.fileType,
  fileSize: file.fileSize,
});
```

**After:**
```ts
const makeTask = (file: any) => ({
  taskId: file.taskId,
  subtitle_filename: file.name,
  subtitle_entries: [],
  phases: file.phases,
  fileType: file.fileType,
  fileSize: file.fileSize,
  selectedKeytermGroupId: file.selectedKeytermGroupId ?? null,
  index: 0,
});
```

- [ ] **Step 3: 更新 makeFile 工厂支持 selectedKeytermGroupId**

修改 `makeFile` 的 overrides 类型：

**Before:**
```ts
const makeFile = (overrides: Partial<{
  id: string;
  taskId: string;
  fileType: 'srt' | 'audio' | 'video';
  fileRef: File | undefined;
  transcribingStatus: 'upcoming' | 'active' | 'completed' | 'failed';
  convertingStatus: 'upcoming' | 'active' | 'completed' | 'failed';
}> = {}) => {
```

**After:**
```ts
const makeFile = (overrides: Partial<{
  id: string;
  taskId: string;
  fileType: 'srt' | 'audio' | 'video';
  fileRef: File | undefined;
  transcribingStatus: 'upcoming' | 'active' | 'completed' | 'failed';
  convertingStatus: 'upcoming' | 'active' | 'completed' | 'failed';
  selectedKeytermGroupId: string | null;
}> = {}) => {
```

并在返回对象中加：
```ts
    selectedKeytermGroupId: overrides.selectedKeytermGroupId ?? null,
```

- [ ] **Step 4: 现有测试可能已传 fileRef，补 ensure all defaults**

检查现有测试是否仍能通过。`useTranscriptionStore` mock 默认值是：
```ts
keytermGroups: [],
keytermsEnabled: false,
```

之前 `allKeyterms` flatten 永远是空数组。现在加判断后行为一致（keytermsEnabled=false → []）。所以现有 7 个测试应该仍然通过。

跑测试验证：
```bash
cd /d/EggTranslate && pnpm test src/services/__tests__/transcriptionService.test.ts
```

预期：7 个测试通过

- [ ] **Step 5: 加新测试（验证单组查询）**

在文件末尾加：

```ts
  it('sends keyterms from the selected group only (not all groups)', async () => {
    const mediaFile = new File([''], 'test.mp3', { type: 'audio/mpeg' });
    useFilesStore.setState({
      tasks: [makeTask(makeFile({ 
        fileRef: mediaFile, 
        selectedKeytermGroupId: 'group-medical' 
      }))] as any,
    });
    useTranscriptionStore.setState({
      apiKeys: 'test-key',
      keytermsEnabled: true,
      keytermGroups: [
        { id: 'group-medical', name: '医学', keyterms: ['Aortic stenosis', 'Echocardiogram'] },
        { id: 'group-legal', name: '法律', keyterms: ['Voir dire', 'Habeas corpus'] },
      ],
    });

    const mp3Blob = new Blob(['mp3 data'], { type: 'audio/mpeg' });
    vi.mocked(convertToMP3).mockResolvedValue(mp3Blob);
    vi.mocked(runTranscriptionPipeline).mockResolvedValue({
      entries: [],
      language: 'en',
    });

    await startTranscription('file_t1');

    expect(runTranscriptionPipeline).toHaveBeenCalledWith(
      expect.anything(),
      ['Aortic stenosis', 'Echocardiogram'],  // 只发 medical 组
      expect.anything()
    );
  });

  it('sends no keyterms when selectedKeytermGroupId is null', async () => {
    const mediaFile = new File([''], 'test.mp3', { type: 'audio/mpeg' });
    useFilesStore.setState({
      tasks: [makeTask(makeFile({ 
        fileRef: mediaFile, 
        selectedKeytermGroupId: null 
      }))] as any,
    });
    useTranscriptionStore.setState({
      apiKeys: 'test-key',
      keytermsEnabled: true,
      keytermGroups: [{ id: 'g1', name: 'G1', keyterms: ['term1'] }],
    });

    vi.mocked(convertToMP3).mockResolvedValue(new Blob());
    vi.mocked(runTranscriptionPipeline).mockResolvedValue({
      entries: [],
      language: 'en',
    });

    await startTranscription('file_t1');

    expect(runTranscriptionPipeline).toHaveBeenCalledWith(
      expect.anything(),
      [],  // 不发任何 keyterms
      expect.anything()
    );
  });

  it('sends no keyterms when keytermsEnabled is false (master switch off)', async () => {
    const mediaFile = new File([''], 'test.mp3', { type: 'audio/mpeg' });
    useFilesStore.setState({
      tasks: [makeTask(makeFile({ 
        fileRef: mediaFile, 
        selectedKeytermGroupId: 'g1'  // 选了组但全局关闭
      }))] as any,
    });
    useTranscriptionStore.setState({
      apiKeys: 'test-key',
      keytermsEnabled: false,  // 主开关关闭
      keytermGroups: [{ id: 'g1', name: 'G1', keyterms: ['term1'] }],
    });

    vi.mocked(convertToMP3).mockResolvedValue(new Blob());
    vi.mocked(runTranscriptionPipeline).mockResolvedValue({
      entries: [],
      language: 'en',
    });

    await startTranscription('file_t1');

    expect(runTranscriptionPipeline).toHaveBeenCalledWith(
      expect.anything(),
      [],
      expect.anything()
    );
  });

  it('sends empty array when selectedKeytermGroupId points to non-existent group', async () => {
    const mediaFile = new File([''], 'test.mp3', { type: 'audio/mpeg' });
    useFilesStore.setState({
      tasks: [makeTask(makeFile({ 
        fileRef: mediaFile, 
        selectedKeytermGroupId: 'non-existent-id' 
      }))] as any,
    });
    useTranscriptionStore.setState({
      apiKeys: 'test-key',
      keytermsEnabled: true,
      keytermGroups: [{ id: 'g1', name: 'G1', keyterms: ['term1'] }],
    });

    vi.mocked(convertToMP3).mockResolvedValue(new Blob());
    vi.mocked(runTranscriptionPipeline).mockResolvedValue({
      entries: [],
      language: 'en',
    });

    await startTranscription('file_t1');

    expect(runTranscriptionPipeline).toHaveBeenCalledWith(
      expect.anything(),
      [],
      expect.anything()
    );
  });
```

- [ ] **Step 6: 跑全部测试**

```bash
cd /d/EggTranslate && pnpm test
```

预期：所有测试通过（49 + 4 新 = 53）

- [ ] **Step 7: 提交**

```bash
git add src/services/__tests__/transcriptionService.test.ts
git commit -m "test: 为 transcriptionService 单组查询行为添加 4 个测试"
```

---

### Task 9: 在 `SubtitleFileItem` 头部加下拉选择器

**Files:**
- Modify: `D:\EggTranslate\src\components\SubtitleFileList\components\SubtitleFileItem.tsx`

- [ ] **Step 1: 读取文件**

读取整个文件理解结构。

- [ ] **Step 2: 加 imports**

在顶部 imports 区域加：

```ts
import { useTranscriptionStore } from '@/stores/transcriptionStore';
import { useFilesStore } from '@/stores/filesStore';
```

- [ ] **Step 3: 加 hooks**

在 `SubtitleFileItem` 函数内，hooks 区域加：

```ts
const keytermsEnabled = useTranscriptionStore((state) => state.keytermsEnabled);
const keytermGroups = useTranscriptionStore((state) => state.keytermGroups);
const setSelectedKeytermGroupId = useFilesStore((state) => state.setSelectedKeytermGroupId);
```

- [ ] **Step 4: 在文件头部信息行加下拉**

找到返回的 JSX 中的 header 部分（约 L102-138），在 status badge 之后插入下拉选择器。

**Before** (header 末尾):
```tsx
        <span className={`px-2.5 py-1 rounded-md text-xs font-medium flex-shrink-0 ${badgeClass}`}>
          {badgeText}
        </span>
      </div>
```

**After**（在 status badge 之后）：
```tsx
        <span className={`px-2.5 py-1 rounded-md text-xs font-medium flex-shrink-0 ${badgeClass}`}>
          {badgeText}
        </span>

        {/* 热词下拉选择器 */}
        <KeytermDropdown
          file={file}
          keytermGroups={keytermGroups}
          keytermsEnabled={keytermsEnabled}
          onChange={(groupId) => setSelectedKeytermGroupId(file.id, groupId)}
        />
      </div>
```

- [ ] **Step 5: 在文件底部加 KeytermDropdown 组件**

在 `SubtitleFileItem` 函数定义之后、export 之前加：

```tsx
interface KeytermDropdownProps {
  file: { selectedKeytermGroupId: string | null };
  keytermGroups: { id: string; name: string }[];
  keytermsEnabled: boolean;
  onChange: (groupId: string | null) => void;
}

const KeytermDropdown: React.FC<KeytermDropdownProps> = ({
  file,
  keytermGroups,
  keytermsEnabled,
  onChange,
}) => {
  const selectedGroup = keytermGroups.find((g) => g.id === file.selectedKeytermGroupId);
  const displayText = selectedGroup ? selectedGroup.name : '不使用';

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    onChange(e.target.value === '' ? null : e.target.value);
  };

  return (
    <div
      className="flex items-center gap-1.5 flex-shrink-0"
      title={!keytermsEnabled ? '请到设置中开启热词功能' : undefined}
    >
      <span className="text-xs text-gray-500">热词:</span>
      <select
        value={file.selectedKeytermGroupId ?? ''}
        onChange={handleChange}
        disabled={!keytermsEnabled}
        className={`text-xs px-2 py-1 rounded-md border border-gray-200 bg-white text-gray-700 focus:outline-none focus:border-blue-500 transition-colors ${
          !keytermsEnabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:border-gray-300'
        }`}
      >
        <option value="">不使用</option>
        {keytermGroups.map((group) => (
          <option key={group.id} value={group.id}>
            {group.name}
          </option>
        ))}
      </select>
    </div>
  );
};
```

- [ ] **Step 6: 验证**

```bash
cd /d/EggTranslate && pnpm run lint 2>&1 | tail -3
cd /d/EggTranslate && pnpm run build 2>&1 | tail -3
```

预期：lint clean, build success

- [ ] **Step 7: 提交**

```bash
git add src/components/SubtitleFileList/components/SubtitleFileItem.tsx
git commit -m "feat(ui): SubtitleFileItem 头部加热词下拉选择器"
```

---

### Task 10: 最终验证

**Files:** None

- [ ] **Step 1: 完整 lint**

```bash
cd /d/EggTranslate && pnpm run lint 2>&1 | tail -5
```

预期：0 errors, 0 warnings

- [ ] **Step 2: 完整 build**

```bash
cd /d/EggTranslate && pnpm run build 2>&1 | tail -10
```

预期：build 成功

- [ ] **Step 3: 完整 test**

```bash
cd /d/EggTranslate && pnpm test
```

预期：所有 53 个测试通过

- [ ] **Step 4: TypeScript check**

```bash
cd /d/EggTranslate && pnpm exec tsc -b
```

预期：0 errors

- [ ] **Step 5: 手动验证清单**

- [ ] 上传一个 SRT 文件，检查下拉显示「不使用」
- [ ] 设置中开启热词 + 选中"通用"分组
- [ ] 上传新文件，下拉应默认显示「通用」
- [ ] 在下拉中选择「不使用」并验证
- [ ] 切换设置中的 keytermsEnabled 为 false，卡片下拉变灰禁用
- [ ] hover 禁用下拉，确认 tooltip「请到设置中开启热词功能」
- [ ] 设置中切换不同分组作为默认
- [ ] 上传新文件，确认新默认生效
- [ ] 现有文件保留自己的选择
- [ ] 浏览器关闭重开，v3 持久化正常

- [ ] **Step 6: 总结**

完成。预期 9 个 commits，4 个新测试。

---

## 验证清单（执行后对照）

- [ ] `SubtitleFileMetadata.selectedKeytermGroupId` 字段存在
- [ ] `useTranscriptionStore.defaultKeytermGroupId` 字段存在
- [ ] `useFilesStore.setSelectedKeytermGroupId` action 存在
- [ ] `KeytermGroupsSettings` 点击分组时调用 onDefaultGroupChange
- [ ] `TranscriptionSettings` 正确接线
- [ ] `filesService.addFile` 新任务设置默认 selectedKeytermGroupId
- [ ] `transcriptionService` 改用单组查询
- [ ] 4 个新测试通过
- [ ] `SubtitleFileItem` 头部有下拉选择器
- [ ] 下拉禁用时显示 tooltip
- [ ] 持久化 v3 migrate 正确
- [ ] 53 个测试全部通过
- [ ] lint 0 errors
- [ ] build 成功

---

## 风险与回滚

每步独立 commit，可单独 revert：

```bash
git revert <commit-hash>
```

或回滚到 phase 3 末尾：

```bash
git reset --hard 25845ae  # StepperProgress fix 之后
```
