# 蛋蛋字幕翻译 - 剩余最佳实践清理设计

**日期：** 2026-06-01
**前置：** [2026-06-01-project-best-practices-audit.md](./2026-06-01-project-best-practices-audit.md) (2.4/5)
**目标：** 把项目最佳实践评分从 3.4 推到 4.0+
**用户指令：** 全包干，不参与代码级评审

---

## 范围（7 个改进点）

按 ROI 排序：

| 优先级 | 编号 | 改进点 | 预估工作量 | 实施者 |
|--------|------|--------|------------|--------|
| P0 | H3 | SubtitleEditor 虚拟列表 + 搜索 debounce | 1 天 | 主线程 |
| P0 | H2 | entryCount / translatedCount 派生状态缓存 | 半天 | 主线程 |
| P1 | M4 | queueService.processNext 拆 3 函数 | 2 小时 | 主线程 |
| P1 | M6 | onRehydrateStorage 纯函数化 | 1 小时 | 主线程 |
| P2 | L4 | 抽象 logger.ts | 2 小时 | 主线程 |
| P2 | M2 | 死代码 / 未用 import 扫描清理 | 1 小时 | 主线程 |
| P3 | 测试 | TranslationOrchestrator 等纯函数补单元测试 | 2-3 天 | subagent |

**总计：** ~5-6 天工作量

---

## 改进点详细设计

### H3: SubtitleEditor 虚拟列表

**目标：** 1000+ 字幕不卡，输入搜索延迟 < 50ms

**方案：**
- 引入 `@tanstack/react-virtual`
- 替换 `filteredEntries.map` 为 `useVirtualizer`
- 搜索框 `useState` 改为 `useDeferredValue` 或自定义 debounce hook（300ms）
- 编辑行（被点击的）单独渲染，列表视图冻结

**风险：**
- 已有 framer-motion enter/exit 动画会与虚拟化冲突 → 动画只在非虚拟化区域保留
- 选中行定位：需要 `virtualizer.scrollToIndex(idx, { align: 'center' })`

**回退：** 如果虚拟化导致复杂交互无法实现，保留原版但加 debounce

---

### H2: 派生状态缓存

**目标：** 单条 entry 更新不触发整数组重算

**方案：**
- `SingleTask` 类型加 `entryCount: number` 和 `translatedCount: number` 字段
- `addTask` / `removeTask` / `updateEntry` / `deleteEntry` / `batchUpdateEntries` 内部维护这两个计数
- `useFiles` 不再调用 `convertTaskToMetadata` 内的 `filter` 计算
- `migrate: v3 → v4` 一次性为老任务补全这两个字段

**风险：**
- 老任务需要数据迁移 → 已在 zustand/persist 的 `migrate` 流程中
- 持久化文件变大（每任务多 2 个 number）→ 可忽略

---

### M4: processNext 拆分

**目标：** 单函数 52 行 → 3 个 < 25 行的小函数

**方案：** 见上一轮对话中的具体设计（startTask / runTask / finishTask）

**风险：** 极低，纯重构

---

### M6: onRehydrateStorage 纯函数化

**目标：** 不再直接 mutation 传入的 state

**方案：**
```ts
// 之前
for (const task of state.tasks) {
  for (const phase of [...]) {
    if (task.phases[phase]?.status === 'active') {
      task.phases[phase] = { status: 'failed', ... };  // ← mutation
    }
  }
}

// 之后
const recoveredTasks = state.tasks.map(task => {
  if (!task.phases) return task;
  let taskChanged = false;
  const newPhases = { ...task.phases };
  for (const phase of [...]) {
    if (newPhases[phase]?.status === 'active') {
      newPhases[phase] = { status: 'failed', ... };
      taskChanged = true;
    }
  }
  return taskChanged ? { ...task, phases: newPhases } : task;
});
useFilesStore.setState({ tasks: recoveredTasks });
```

**风险：** 极低，纯重构

---

### L4: logger 抽象

**目标：** 生产环境不输出 console.log；统一日志入口

**方案：**
```ts
// src/utils/logger.ts
const isDev = import.meta.env.DEV;
export const logger = {
  debug: (...args: unknown[]) => isDev && console.log('[debug]', ...args),
  info: (...args: unknown[]) => isDev && console.log('[info]', ...args),
  warn: (...args: unknown[]) => console.warn('[warn]', ...args),
  error: (...args: unknown[]) => console.error('[error]', ...args),
};
```

**实施：** 全局 grep `console.log` / `console.error` → 替换为 `logger.{level}`

**风险：** 极低

---

### M2: 死代码清理

**目标：** 移除未使用 import、未引用函数

**方案：**
- 跑 `tsc --noEmit` 找类型错误
- 跑 `eslint` 找未使用变量
- 手动 grep `import.*from` 检查每个 import 是否被使用
- 重点文件：`useErrorHandler.ts`、`SubtitleExporter.ts`（未用导出）

**风险：** 极低

---

### 测试覆盖

**目标：** `src/utils/` 和 `src/services/` 下的纯函数模块覆盖率达 80%+

**目标模块清单：**
- `src/services/TranslationOrchestrator.ts` 的 `createTranslationBatches` / `processBatch` / `saveTranslationHistory`
- `src/services/SubtitleFileManager.ts` 的 `convertTaskToMetadata`
- `src/utils/srtParser.ts`
- `src/utils/splitAlignPrompts.ts`
- `src/utils/termsHelpers.ts`（已有测试，确认覆盖）
- `src/utils/historyHelpers.ts`（已有测试，确认覆盖）

**不在本次范围：** E2E（upload → transcribe → translate → export 全链路）属于另一专项，暂不动

**方案：**
- 沿用 vitest + 现有 `src/test/setup.ts`
- 业务流（startTranslation / startTranscription）用 mock service 测试，不在此范围

---

## 验收标准

- [ ] `pnpm test` 全部通过
- [ ] `pnpm lint` 无 error（warn 可保留）
- [ ] `pnpm build` 成功
- [ ] 项目无 `console.log`（仅 `console.error` 用于关键错误）
- [ ] 1000 字幕时 SubtitleEditor 输入搜索无明显延迟
- [ ] 单条 entry 更新不再触发整文件 metadata 重算
- [ ] 审计报告 7 个剩余项全部清零

---

## 不在本次范围

- 重写为 XState（已确认过度工程）
- 大规模重构 state machine 模式（M4 拆分足够）
- 重新设计 API 层

---

## 实施顺序

1. 先做 M4 + M6（最简单、最快建立信心）
2. 再做 H2（数据结构改动，需要先稳）
3. 再做 H3（虚拟化是最大改动）
4. 再做 L4 + M2（清理类，容易）
5. 最后做测试（用 subagent 并行）
