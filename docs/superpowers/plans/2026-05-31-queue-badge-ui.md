# Queue Badge UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show "排队中 #N" badge in top-right corner for queued files, and change the button from a spinner to a "取消排队" action button.

**Architecture:** Pass `isQueued` and `queuePosition` into `getCardBadge` so it returns the queue badge before checking phases. Add `onDequeue` callback through the component chain so the queued button triggers `dequeueTask`.

**Tech Stack:** React, TypeScript, Zustand, Tailwind CSS

---

## File Map

| File | Change |
|------|--------|
| `src/utils/badgeHelper.ts:17` | Add `isQueued?` and `queuePosition?` params to `getCardBadge`, early-return queue badge |
| `src/components/SubtitleFileList/index.tsx:140-154` | Pass `dequeueTask` as `onDequeue` prop to `SubtitleFileItem` |
| `src/components/SubtitleFileList/components/SubtitleFileItem.tsx:11-23,57,123-140` | Add `onDequeue` to interface, pass to `getCardBadge` and `FileActionButtons` |
| `src/components/SubtitleFileList/components/FileActionButtons.tsx:6-21,122-158` | Add `onDequeue` prop, change queued button to "取消排队" without spinner |

---

### Task 1: Update `getCardBadge` to accept queue state

**Files:**
- Modify: `src/utils/badgeHelper.ts:17`

- [ ] **Step 1: Add parameters and early-return logic**

Change the `getCardBadge` function signature and add queue check at the top:

```typescript
export function getCardBadge(
  phases: FilePhases,
  displayPhases: ProgressPhase[],
  isQueued?: boolean,
  queuePosition?: number
): BadgeInfo {
  // 排队中优先级最高（在 phase 判断之前）
  if (isQueued && queuePosition != null) {
    return getQueueBadge(queuePosition);
  }

  const statuses = displayPhases.map(p => phases[p].status);
  // ... rest unchanged
```

The existing `getQueueBadge` function (line 60) already returns `{ text: '排队中 #N', color: 'gray' }` — no changes needed there.

- [ ] **Step 2: Run type check**

Run: `npx tsc --noEmit`
Expected: No errors (params are optional, existing callers unaffected)

---

### Task 2: Wire `onDequeue` through SubtitleFileList → SubtitleFileItem

**Files:**
- Modify: `src/components/SubtitleFileList/index.tsx:27,140-154`
- Modify: `src/components/SubtitleFileList/components/SubtitleFileItem.tsx:11-23,57,123-140`

- [ ] **Step 1: Add `dequeueTask` selector in SubtitleFileList**

At line 27, after the existing `enqueueTask` selector, add:

```typescript
const dequeueTask = useSubtitleStore((state) => state.dequeueTask);
```

- [ ] **Step 2: Pass `onDequeue` to SubtitleFileItem**

In the `files.map` callback (line 140-154), add the `onDequeue` prop:

```typescript
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
  isActive={isActive}
  onDequeue={() => dequeueTask(file.id)}
/>
```

- [ ] **Step 3: Add `onDequeue` to SubtitleFileItem interface and pass it through**

In `SubtitleFileItem.tsx`, add to the interface (after line 19):

```typescript
onDequeue: (fileId: string) => void;
```

Add to the destructured props (after line 36):

```typescript
onDequeue,
```

Pass queue state to `getCardBadge` (line 57):

```typescript
const badgeInfo = getCardBadge(file.phases, displayPhases, isQueued, queuePosition);
```

Pass `onDequeue` to `FileActionButtons` (after line 139):

```typescript
onDequeue={() => onDequeue(file.id)}
```

- [ ] **Step 4: Run type check**

Run: `npx tsc --noEmit`
Expected: No errors

---

### Task 3: Change queued button to "取消排队" in FileActionButtons

**Files:**
- Modify: `src/components/SubtitleFileList/components/FileActionButtons.tsx:6-21,122-158`

- [ ] **Step 1: Add `onDequeue` to the props interface**

Add after line 20 (`onDelete`):

```typescript
onDequeue?: () => void;
```

Add to destructured props after line 35 (`onDelete`):

```typescript
onDequeue,
```

- [ ] **Step 2: Replace the busy button logic**

Replace the primary button content (lines 140-157) with:

```typescript
{isQueued ? (
  <>
    取消排队
  </>
) : isBusy ? (
  <>
    <div
      className="rounded-full animate-spin"
      style={{
        width: 14, height: 14,
        border: '2px solid rgba(255,255,255,0.3)',
        borderTopColor: 'white',
      }}
    />
    处理中...
  </>
) : (
  <>
    <Wand2 className="w-4 h-4" />
    {isAudioVideo && !isTranscriptionDone ? '一键转译' : '开始翻译'}
  </>
)}
```

- [ ] **Step 3: Change click handler for queued state**

Replace the button's `onClick` handler (lines 124-131) with:

```typescript
onClick={(e) => {
  e.stopPropagation();
  if (isQueued) {
    onDequeue?.();
  } else if (isAudioVideo && !isTranscriptionDone) {
    onTranscribeAndTranslate();
  } else {
    onStartTranslation();
  }
}}
```

- [ ] **Step 4: Change button style for queued state**

Update the button's `style` prop to use gray when queued (lines 134-136):

```typescript
style={{
  background: isQueued ? '#8E8E93' : (canTranscribeAndTranslate || canTranslate) ? '#0066FF' : '#C4C4C4',
}}
```

And update the hover handlers (lines 137-138):

```typescript
onMouseEnter={(e) => { if (!isQueued && (canTranscribeAndTranslate || canTranslate)) (e.currentTarget.style.background = '#005ce6'); }}
onMouseLeave={(e) => { if (!isQueued && (canTranscribeAndTranslate || canTranslate)) (e.currentTarget.style.background = '#0066FF'); }}
```

- [ ] **Step 5: Run type check**

Run: `npx tsc --noEmit`
Expected: No errors

---

### Task 4: Verify end-to-end behavior

- [ ] **Step 1: Run type check**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 2: Start dev server and test manually**

Run: `npm run dev`

Test cases:
1. Upload a file, don't click anything → badge shows "未开始" (gray), button shows "开始翻译"
2. Click "开始翻译" → badge changes to "排队中 #1" (gray), button changes to "取消排队" (gray, no spinner)
3. Add another file and start it → second file badge shows "排队中 #2"
4. Click "取消排队" on the queued file → badge returns to "未开始", button returns to "开始翻译"
5. Active file still shows spinner + "处理中..."
