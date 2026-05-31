# Serial Task Queue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a serial task queue so only one task runs at a time, with queued tasks showing "排队中" status.

**Architecture:** Add `taskQueue` and `activeTaskId` to subtitleStore (memory-only, not persisted). A `processNext()` internal method dequeues and runs tasks sequentially. UI derives queue status from these fields. `FilePhases` type unchanged.

**Tech Stack:** Zustand, React, TypeScript

---

## File Structure

| File | Change |
|------|--------|
| `src/stores/subtitleStore.ts` | Add `taskQueue`, `activeTaskId`, `enqueueTask`, `processNext`, `dequeueTask`, `enqueueAllUncompleted` |
| `src/utils/badgeHelper.ts` | Add `getQueueBadge()` for queued task badge |
| `src/components/SubtitleFileList/components/SubtitleFileItem.tsx` | Pass queue info to FileActionButtons |
| `src/components/SubtitleFileList/components/FileActionButtons.tsx` | Accept `isQueued`/`queuePosition`, disable buttons when queued |
| `src/components/SubtitleFileList/index.tsx` | Replace `handleStartAllTranslation` with `enqueueAllUncompleted`, remove `isTranslatingGloballyState` |

---

### Task 1: Store — Add queue state and actions

**Files:**
- Modify: `src/stores/subtitleStore.ts`

- [ ] **Step 1: Add `taskQueue` and `activeTaskId` to store interface and initial state**

In the `SubtitleStore` interface (line ~39), add:

```typescript
// Queue state (memory-only, not persisted)
taskQueue: string[];
activeTaskId: string | null;

// Queue actions
enqueueTask: (fileId: string) => void;
dequeueTask: (fileId: string) => void;
enqueueAllUncompleted: () => void;
```

In the initial state (line ~107), add:

```typescript
taskQueue: [],
activeTaskId: null,
```

- [ ] **Step 2: Add `enqueueTask` action**

Add after `clearAll` action:

```typescript
enqueueTask: (fileId: string) => {
  const state = get();
  // Already in queue or already active
  if (state.taskQueue.includes(fileId) || state.activeTaskId === fileId) return;
  // Already completed
  const file = state.getFile(fileId);
  if (!file) return;
  const allCompleted = file.phases.translating.status === 'completed'
    && file.phases.splitting.status !== 'failed'
    && (file.fileType === 'srt' || file.phases.transcribing.status === 'completed');
  if (allCompleted && file.phases.splitting.status !== 'failed') return;

  set((s) => ({ taskQueue: [...s.taskQueue, fileId] }));
  if (get().activeTaskId === null) {
    get().processNext();
  }
},
```

- [ ] **Step 3: Add `dequeueTask` action**

```typescript
dequeueTask: (fileId: string) => {
  set((s) => ({
    taskQueue: s.taskQueue.filter(id => id !== fileId),
  }));
  if (get().activeTaskId === fileId) {
    // Abort current translation if running
    const translationStore = useTranslationConfigStore.getState();
    if (translationStore.isTranslating) {
      translationStore.stopTranslation();
    }
    set({ activeTaskId: null });
    get().processNext();
  }
},
```

- [ ] **Step 4: Add `processNext` internal action**

```typescript
processNext: async () => {
  const state = get();
  if (state.taskQueue.length === 0) {
    set({ activeTaskId: null });
    return;
  }

  const fileId = state.taskQueue[0];
  set((s) => ({
    taskQueue: s.taskQueue.slice(1),
    activeTaskId: fileId,
  }));

  const file = get().getFile(fileId);
  if (!file) {
    set({ activeTaskId: null });
    get().processNext();
    return;
  }

  try {
    const isAudioVideo = file.fileType === 'audio' || file.fileType === 'video';
    const needsTranscription = isAudioVideo && file.phases.transcribing.status !== 'completed';

    if (needsTranscription) {
      // Set full workflow
      get().setWorkflow(fileId, 'full');
      await get().startTranscription(fileId);

      // Check if transcription succeeded
      const afterTranscribe = get().getFile(fileId);
      if (!afterTranscribe || afterTranscribe.phases.transcribing.status !== 'completed') {
        // Transcription failed, move to next
        set({ activeTaskId: null });
        get().processNext();
        return;
      }
    }

    // Translate (SRT or already-transcribed audio/video)
    if (file.fileType === 'srt') {
      get().setWorkflow(fileId, 'translate');
    }
    await get().startTranslation(fileId);
  } catch (error) {
    console.error('[processNext] Task failed:', error);
  } finally {
    set({ activeTaskId: null });
    get().processNext();
  }
},
```

- [ ] **Step 5: Add `enqueueAllUncompleted` action**

```typescript
enqueueAllUncompleted: () => {
  const files = get().getAllFiles();
  for (const file of files) {
    const isCompleted = file.phases.translating.status === 'completed'
      && file.phases.splitting.status !== 'failed'
      && (file.fileType === 'srt' || file.phases.transcribing.status === 'completed');
    if (!isCompleted) {
      get().enqueueTask(file.id);
    }
  }
},
```

- [ ] **Step 6: Wire `dequeueTask` into `removeFile`**

In the `removeFile` action, add `dequeueTask` call before the existing logic:

```typescript
removeFile: async (fileId: string) => {
  const file = get().getFile(fileId);
  if (!file) return;

  // Remove from queue first (handles active task abort)
  get().dequeueTask(fileId);

  // ... rest of existing removeFile logic
},
```

- [ ] **Step 7: Exclude `taskQueue` and `activeTaskId` from persistence**

The existing `partialize` already only persists `tasks`, so `taskQueue` and `activeTaskId` are automatically excluded. Verify this is the case.

- [ ] **Step 8: Export `useQueueState` hook**

Add at the bottom of the file with the other hooks:

```typescript
export const useQueueState = () => {
  const taskQueue = useSubtitleStore((state) => state.taskQueue, useShallow);
  const activeTaskId = useSubtitleStore((state) => state.activeTaskId);
  return useMemo(() => ({ taskQueue, activeTaskId }), [taskQueue, activeTaskId]);
};
```

- [ ] **Step 9: Type check**

Run: `npx tsc --noEmit`
Expected: No errors

---

### Task 2: Badge helper — Add queue badge

**Files:**
- Modify: `src/utils/badgeHelper.ts`

- [ ] **Step 1: Add `getQueueBadge` function**

Add after the existing `getCardBadge` function:

```typescript
/**
 * 排队中状态的 badge
 * 排队中不是 phases 的 status，而是从 taskQueue 派生的 UI 状态
 */
export function getQueueBadge(queuePosition: number): BadgeInfo {
  return { text: `排队中 #${queuePosition}`, color: 'gray' };
}
```

- [ ] **Step 2: Type check**

Run: `npx tsc --noEmit`
Expected: No errors

---

### Task 3: SubtitleFileItem — Pass queue info to buttons

**Files:**
- Modify: `src/components/SubtitleFileList/components/SubtitleFileItem.tsx`

- [ ] **Step 1: Add queue props to SubtitleFileItemProps**

```typescript
interface SubtitleFileItemProps {
  // ... existing props
  isQueued: boolean;
  queuePosition: number;
}
```

- [ ] **Step 2: Destructure and pass queue props**

In the component body, add:

```typescript
const { isQueued, queuePosition, /* ...existing props */ } = props;
```

Pass to `FileActionButtons`:

```typescript
<FileActionButtons
  // ... existing props
  isQueued={isQueued}
  queuePosition={queuePosition}
/>
```

- [ ] **Step 3: Update memo comparator**

In `SubtitleFileItemMemo`, add `isQueued` and `queuePosition` to the comparison:

```typescript
if (prevProps.isQueued !== nextProps.isQueued) return false;
if (prevProps.queuePosition !== nextProps.queuePosition) return false;
```

- [ ] **Step 4: Type check**

Run: `npx tsc --noEmit`
Expected: No errors

---

### Task 4: FileActionButtons — Handle queued state

**Files:**
- Modify: `src/components/SubtitleFileList/components/FileActionButtons.tsx`

- [ ] **Step 1: Add `isQueued` and `queuePosition` to props**

```typescript
interface FileActionButtonsProps {
  // ... existing props
  isQueued: boolean;
  queuePosition: number;
}
```

- [ ] **Step 2: Disable buttons when queued**

In the component body, update `isBusy` to include queued state:

```typescript
const isBusy = isTranscribing || isTranslating || currentTranslatingFileId === file.id || isQueued;
```

- [ ] **Step 3: Show queue position in primary button**

Replace the primary button's busy text:

```tsx
{isBusy ? (
  <>
    <div
      className="rounded-full animate-spin"
      style={{
        width: 14, height: 14,
        border: '2px solid rgba(255,255,255,0.3)',
        borderTopColor: 'white',
      }}
    />
    {isQueued ? `排队中 #${queuePosition}` : '处理中...'}
  </>
) : (
  // ... existing idle text
)}
```

- [ ] **Step 4: Type check**

Run: `npx tsc --noEmit`
Expected: No errors

---

### Task 5: SubtitleFileList — Wire queue to UI

**Files:**
- Modify: `src/components/SubtitleFileList/index.tsx`

- [ ] **Step 1: Import and use queue state**

Replace imports:

```typescript
import { useSubtitleStore, useFiles, useQueueState } from '@/stores/subtitleStore';
```

In the component body:

```typescript
const { taskQueue, activeTaskId } = useQueueState();
const enqueueTask = useSubtitleStore((state) => state.enqueueTask);
const enqueueAllUncompleted = useSubtitleStore((state) => state.enqueueAllUncompleted);
```

- [ ] **Step 2: Remove old translation state**

Remove:

```typescript
const [isTranslatingGloballyState, setIsTranslatingGlobally] = useState(false);
const [currentTranslatingFileId, setCurrentTranslatingFileId] = useState<string | null>(null);
```

Remove `handleStartTranslation`, `handleTranscribeAndTranslate`, `handleTranscribe`, `handleStartAllTranslation` callbacks (they're replaced by `enqueueTask`).

- [ ] **Step 3: Replace "全部开始" handler**

```typescript
const handleStartAll = useCallback(() => {
  if (files.length === 0) return;
  enqueueAllUncompleted();
}, [files, enqueueAllUncompleted]);
```

- [ ] **Step 4: Update button to use new handler**

```tsx
<button
  onClick={handleStartAll}
  disabled={files.length === 0}
  className="apple-button px-5 py-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
>
  <span>全部开始</span>
</button>
```

- [ ] **Step 5: Update SubtitleFileItem props**

Pass queue info to each file item:

```tsx
{files.map((file, index) => {
  const isQueued = taskQueue.includes(file.id);
  const queuePosition = taskQueue.indexOf(file.id) + 1;
  const isActive = activeTaskId === file.id;

  return (
    <SubtitleFileItem
      key={file.id}
      file={file}
      index={index}
      onEdit={onEditFile}
      onStartTranslation={() => enqueueTask(file.id)}
      onExport={handleExport}
      onDelete={handleDeleteFile}
      onTranscribeAndTranslate={() => enqueueTask(file.id)}
      onTranscribe={() => enqueueTask(file.id)}
      isQueued={isQueued && !isActive}
      queuePosition={queuePosition}
    />
  );
})}
```

- [ ] **Step 6: Remove unused imports and variables**

Remove `API_CONSTANTS` import (no longer needed for `BATCH_TASK_GAP_MS`).
Remove `currentTranslatingFileId` from `SubtitleFileItem` props if it's now redundant with queue state.

- [ ] **Step 7: Type check**

Run: `npx tsc --noEmit`
Expected: No errors

---

### Task 6: Clean up — Remove redundant state

**Files:**
- Modify: `src/components/SubtitleFileList/components/FileActionButtons.tsx`
- Modify: `src/components/SubtitleFileList/components/SubtitleFileItem.tsx`

- [ ] **Step 1: Remove `isTranslatingGlobally` prop from FileActionButtons**

The `isTranslatingGlobally` prop was used to disable buttons during batch processing. Now the queue handles this — queued tasks have `isQueued = true`. Remove the prop and all references to it.

In `FileActionButtons.tsx`:
- Remove `isTranslatingGlobally` from the interface
- Remove `isTranslatingGlobally` from the destructuring
- Update `canTranscribeAndTranslate` and `canTranslate` to remove `isTranslatingGlobally` checks

- [ ] **Step 2: Remove `currentTranslatingFileId` prop from FileActionButtons**

The `currentTranslatingFileId` prop was used to show "处理中" on the specific file being translated. Now `isActive` (derived from `activeTaskId`) handles this. Remove the prop.

In `FileActionButtons.tsx`:
- Remove `currentTranslatingFileId` from the interface
- Remove `currentTranslatingFileId` from the destructuring
- Update `isBusy` to use `isActive` instead:

```typescript
const isBusy = isTranscribing || isTranslating || isActive || isQueued;
```

Add `isActive` to the props interface:

```typescript
interface FileActionButtonsProps {
  // ... existing props
  isActive: boolean;
  isQueued: boolean;
  queuePosition: number;
}
```

- [ ] **Step 3: Update SubtitleFileItem to pass isActive**

In `SubtitleFileItem.tsx`, add `isActive` to props and pass it through:

```typescript
interface SubtitleFileItemProps {
  // ... existing props
  isActive: boolean;
  isQueued: boolean;
  queuePosition: number;
}
```

Pass to `FileActionButtons`:

```typescript
<FileActionButtons
  // ... existing props
  isActive={isActive}
  isQueued={isQueued}
  queuePosition={queuePosition}
/>
```

- [ ] **Step 4: Update SubtitleFileList to pass isActive**

In `index.tsx`, the map already computes `isActive`:

```tsx
<SubtitleFileItem
  // ... other props
  isActive={isActive}
  isQueued={isQueued && !isActive}
  queuePosition={queuePosition}
/>
```

- [ ] **Step 5: Type check**

Run: `npx tsc --noEmit`
Expected: No errors

---

### Task 7: Verify — End-to-end check

- [ ] **Step 1: Type check**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 2: Manual test — Single task**

1. Upload an SRT file
2. Click "开始翻译" → should immediately start (active, no queue flash)
3. Badge shows "处理中", buttons disabled

- [ ] **Step 3: Manual test — Queue**

1. Upload 3 SRT files
2. Click "全部开始"
3. First file: "处理中", other two: "排队中 #1", "排队中 #2"
4. First completes → second becomes "处理中", third becomes "排队中 #1"
5. All complete → all show "已完成"

- [ ] **Step 4: Manual test — Delete queued task**

1. With 3 files queued, delete the 3rd
2. Queue should only have 2 files remaining

- [ ] **Step 5: Manual test — Delete active task**

1. With a task running, delete it
2. Should abort, next queued task should start

- [ ] **Step 6: Manual test — Page refresh**

1. Start a task, refresh page while running
2. The interrupted task should show "失败"
3. No queue state should persist
