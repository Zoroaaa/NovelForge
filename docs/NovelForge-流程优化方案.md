# NovelForge 核心流程深度审查与优化方案 v2

> 审查范围（完整版）：
> - `services/workshop/`（index / prompt / extract / commit / helpers / session）
> - `services/agent/generation.ts`
> - `services/contextBuilder.ts`
> - `services/agent/messages.ts`
> - `services/agent/summarizer.ts`
> - `services/foreshadowing.ts` / `powerLevel.ts`
> - `services/agent/coherence.ts` / `consistency.ts` / `volumeProgress.ts` / `qualityCheck.ts`
> - 对应 routes / queue-handler / 前端入口

---

## 一、完整执行路径（真实链路）

```
【创作工坊阶段】
  createWorkshopSession
    └─ 如已有 novelId：loadNovelContextData 预填 extractedData

  processWorkshopMessage（每轮对话）
    ├─ buildSystemPrompt(stage, currentData, isNewNovel)
    │    ├─ concept → 输出 title/genre/description/coreAppeal/writingRules
    │    ├─ worldbuild → 输出 worldSettings[]
    │    ├─ character_design → 输出 characters[]
    │    └─ volume_outline → 输出 volumes[]（含 blueprint/eventLine）
    ├─ extractStructuredData(aiResponse, stage, currentData)
    │    └─ 解析最后一个 ```json 块；volume_outline 失败时走状态机兜底
    └─ updateSession（保存 messages + extractedData）

  commitWorkshopSessionCore（via queue commit_workshop）
    ├─ 写入 novels
    ├─ buildOutlineContentWithAI → 写入 masterOutline
    ├─ 写入 novelSettings + generateSettingSummary + enqueue index_content
    ├─ 写入 writingRules
    ├─ 写入 characters + enqueue index_content
    ├─ 写入 volumes + generateVolumeSummary
    │    └─ 按 foreshadowingSetup/Resolve 写入 foreshadowing 占位记录
    └─ rebuildEntityIndex（写入 entityIndex，使用临时 ID ws_N/char_N/vol_N）

【章节生成阶段】
  generateChapter
    ├─ buildChapterContext（RAG + 10 槽上下文）
    │    ├─ Slot-0：masterOutline 全文（DB直查，~10k tokens）
    │    ├─ Slot-1：volume blueprint + eventLine（DB直查）
    │    ├─ Slot-2：上一章正文（DB直查）
    │    ├─ Slot-3：主角状态卡（DB直查）
    │    ├─ Slot-4：全部活跃 writingRules（DB直查）
    │    ├─ Slot-5：出场角色卡（RAG → DB完整卡片）
    │    ├─ Slot-6：世界设定（RAG → summary字段，按type分槽）
    │    ├─ Slot-7：待回收伏笔（高优DB兜底 + 普通RAG）
    │    ├─ Slot-8：本章类型规则（DB过滤）
    │    └─ Slot-9：近期摘要链（20章，DB直查）
    ├─ buildMessages(chapterTitle, contextBundle, options)
    │    ├─ 解析 systemPrompt：key → 预设(fantasy/urban/mystery/scifi) / 自定义串 / 默认 fantasy
    │    ├─ 拼接 novelSystemNote（小说专属约束）
    │    └─ generate/continue/rewrite 三种 userMessage 模板
    ├─ runReActLoop（章节正文生成 + Tool 调用）
    ├─ 写入 chapters.content
    ├─ [有队列] enqueue post_process_chapter
    │    └─ [无队列同步] 步骤1摘要 → 步骤2伏笔 → 步骤3境界
    │         + setTimeout(0) 步骤4角色一致性 → 步骤5连贯性 → 步骤6卷进度
    └─ generate route onDone：异步 coherenceCheck（score<70 自动修复）

  post_process_chapter（queue handler 实际执行）
    ├─ 步骤1：triggerAutoSummary    ✅
    └─ 步骤2：extractForeshadowing  ✅
    ↑ 步骤3 境界检测                ❌ 缺失
    ↑ 步骤4-6 三项检查              ❌ 缺失

【摘要 Tab / 检查 Tab】
  手动摘要 → POST /generate/summary（独立，不触发其他后处理）
  CombinedCheck → /generate/combined-check（三项并发）
    └─ 单项可触发 /generate/repair-chapter
```

---

## 二、功能缺陷（直接导致流程断裂或结果失真）

### 缺陷 1 ★★★：queue 模式的 post_process_chapter 比同步模式少执行 4 个步骤

**位置**：`queue-handler.ts` case `post_process_chapter` vs `generation.ts` 同步路径

**gap 清单**：

| 步骤 | 同步模式（无队列）| queue handler |
|------|-----------------|--------------|
| 1. 摘要 | ✅ | ✅ |
| 2. 伏笔提取 | ✅ | ✅ |
| 3. 境界检测 | ✅ | ❌ 缺失 |
| 4. 角色一致性检查 | ✅（setTimeout） | ❌ 缺失 |
| 5. 连贯性检查 | ✅（setTimeout） | ❌ 缺失 |
| 6. 卷进度检查 | ✅（setTimeout） | ❌ 缺失 |

**影响**：绝大多数生产环境部署了 TASK_QUEUE，步骤 3-6 全部静默跳过。角色境界不更新，检查日志没有自动预填，用户打开检查 Tab 时无历史缓存，需要手动重新触发。

**根因**：两个执行路径独立维护，没有共用函数。

**修复**：
```typescript
// server/services/agent/postProcess.ts（新文件）
export async function runPostProcess(env: Env, payload: {
  chapterId: string
  novelId: string
  enableAutoSummary: boolean
  usage: { prompt_tokens: number; completion_tokens: number }
}) {
  await step1Summary(env, payload)
  await step2Foreshadowing(env, payload)
  await step3PowerLevel(env, payload)
  await step4CharacterConsistency(env, payload)
  await step5Coherence(env, payload)
  await step6VolumeProgress(env, payload)
}
// generation.ts 和 queue-handler.ts 统一调用 runPostProcess()
```

---

### 缺陷 2 ★★★：角色一致性检查在 combined-check 中永远是空检查

**位置**：`services/agent/consistency.ts` → `checkCharacterConsistency`

**问题**：函数逻辑 `characterIds.length > 0` 才查角色设定，否则 `characterInfo = ''`，用空设定调用 AI，AI 没有对比基准，`conflicts` 数组永远返回空。

`/generate/combined-check` route 中 `characterIds` 默认为空数组，前端 `CombinedCheck.tsx` 调用时不传。

**结果**：用户看到"角色一致性：100分，无冲突"——这是假数据。

**修复**：
```typescript
// consistency.ts：characterIds 为空时自动补全主要角色
if (characterIds.length === 0) {
  const mainChars = await db.select({ id: characters.id })
    .from(characters)
    .where(and(
      eq(characters.novelId, chapter.novelId),
      inArray(characters.role, ['protagonist', 'supporting', 'antagonist']),
      isNull(characters.deletedAt)
    ))
    .limit(10).all()
  characterIds = mainChars.map(c => c.id)
}
// 仍为空（小说无角色）→ 返回特殊标识而非假100分
if (characterIds.length === 0) {
  return { conflicts: [], warnings: ['未设置角色，跳过检查'], score: -1 }
}
```

---

### 缺陷 3 ★★：commit 的 rebuildEntityIndex 写入了无效的临时 ID

**位置**：`commit.ts` → `rebuildEntityIndex`

**问题**：entityIndex 中的 `entityId` 被写为 `ws_0`、`char_1`、`vol_2` 等临时标识，而非数据库中实际创建的真实 ID（`novels.id`、`characters.id`、`volumes.id`）。

导致：
1. entityIndex 与实际数据不对应，搜索/引用功能命中后无法关联到真实记录
2. 后续 `rebuild_entity_index` 队列任务执行时，新记录用真实 ID，旧记录是临时 ID，`onConflictDoNothing` 不命中，产生重复记录

**修复**：在 commit 流程中等各实体写入完成、获得真实 ID 后，传入真实 ID 映射再调用 `rebuildEntityIndex`，彻底弃用 ws_N 这类占位符。

---

### 缺陷 4 ★★：volume_outline 的 eventLine 截断逻辑会破坏章节大纲完整性

**位置**：`extract.ts` → `extractStructuredData` case `volume_outline`

**问题**：
```typescript
// 现有逻辑：AI 输出 25 条但 targetChapterCount=30，直接截断
vol.eventLine = vol.eventLine.slice(0, vol.targetChapterCount)
```
最终存储：30 章目标但只有 25 条 eventLine，第 26-30 章生成时 Slot-1 拿到空字符串。

**修复**：
```typescript
// 不截断，同步修正 targetChapterCount
if (vol.eventLine.length !== vol.targetChapterCount) {
  vol.targetChapterCount = vol.eventLine.length
  if (vol.targetWordCount) {
    vol.targetWordCount = Math.round(vol.eventLine.length * 4000)
  }
}
```
同时在 index.ts 的 `onDone` 中检测此情况并向用户推送警告提示。

---

### 缺陷 5 ★★：连贯性检查的核心依赖（上一章摘要）无兜底

**位置**：`coherence.ts` → `checkContinuityWithPrevChapter`

**问题**：
```typescript
if (!prevChapter?.summary) return  // 直接跳过衔接检查
```
第一章、摘要生成失败、未开启自动摘要时，衔接维度直接返回无问题。

**修复**：降级到上一章正文末尾片段：
```typescript
const prevChapterRef = prevChapter.summary
  ?? (prevChapter.content ? `（摘要未生成，使用章节末尾片段）\n${prevChapter.content.slice(-800)}` : null)
if (!prevChapterRef) return
```

---

### 缺陷 6 ★：WorkshopExtractedData.chapters 字段是死字段

**位置**：`types.ts` 定义了 `chapters` 字段；`prompt.ts` 四个阶段均未输出也未读取该字段

**问题**：类型声明了但从未被使用，造成理解误导（读者会以为 workshop 能管理章节大纲）。

**修复**：从 `WorkshopExtractedData` 类型中删除 `chapters` 字段，或明确增加一个 `chapter_outline` 阶段来使用它（建议前者，保持 workshop 职责边界清晰）。

---

## 三、需优化点（不断裂但影响生成质量）

### 优化 1 ★★★：Slot-1 只注入当前章事件，AI 不知道下一章发生什么，无法预埋钩子

**位置**：`contextBuilder.ts` → `extractCurrentChapterEvent`、Slot-1 组装

**现状**：Slot-1 只注入当前章对应的 eventLine 条目。AI 写章末时没有下一章的方向感，钩子要么是通用悬念，要么与实际剧情走向脱节。

**建议**：Slot-1 同时注入 ±1 章事件（数据已在 `volumeInfo.eventLine`，无需额外查询）：
```
【上章事件】第N-1章：...（已发生，承接用）
【本章任务】第N章：...  ← 核心，必须完成
【下章预告】第N+1章：... ← 仅供结尾钩子参考，本章不得提前完成
```

---

### 优化 2 ★★★：systemPrompt 只有 4 种流派预设，无法覆盖修仙/系统流等细分题材

**位置**：`messages.ts` → `SYSTEM_PROMPTS`

**现状**：`fantasy/urban/mystery/scifi` 四种。修仙、赘婿、系统文、末世文的写法要求差异大，全部 fallback 到通用 fantasy 会导致风格偏差。

**建议**：在 workshop 的 concept 阶段 commit 时，由 AI 基于 `genre + coreAppeal` 生成一段专属 system prompt 并存入 `novels.systemPrompt`（而不是存 key），生成章节时直接使用。成本：一次额外 LLM 调用，换来全程风格精准。

---

### 优化 3 ★★：RAG 查询向量在 eventLine 为空时质量退化

**位置**：`contextBuilder.ts` → `buildQueryText`

**现状**：queryText 由 `chapterTitle + currentChapterEvent + chapterTypeHint` 拼接。当 eventLine 被截断（见缺陷 4）或为空时，queryText 只剩标题，RAG 语义检索精度大幅下降。

**建议**：eventLine 为空时，用 summaryChain 最后一章摘要的章末状态段落作为查询种子兜底。

---

### 优化 4 ★★：workshop commit 时的 generateVolumeSummary 是"规划摘要"，但后续生成时也用它

**位置**：`commit.ts` 调 `generateVolumeSummary`；`contextBuilder.ts` Slot-1 读 `volumeInfo.blueprint`

**问题**：commit 时卷没有任何实际章节，生成的摘要基于蓝图（规划）。随着章节生成，卷的实际走向可能偏离规划，但卷摘要不会自动更新（只有手动触发 `/generate/volume-summary` 才更新）。

**建议**：卷完成时（所有章节生成完毕，触发 `checkAndCompleteVolume`）自动重新生成卷摘要，标记为 `source: 'actual'`。contextBuilder 优先使用 actual 摘要。

---

### 优化 5 ★★：foreshadowing 占位记录的 importance 全部硬编码为 'normal'

**位置**：`commit.ts` → volumes 写入段中的 foreshadowing 占位插入

**问题**：主线伏笔（如主角身世之谜）与装饰性伏笔被同等对待。影响 contextBuilder Slot-7 的高优伏笔筛选，高重要伏笔无法优先注入上下文。

**建议**：在 volume_outline prompt 的 `foreshadowingSetup` 格式中增加重要性前缀，extract 时解析并传递：
```
"【高】身世之谜（第3章埋入，通过神秘长老反应引出）" → importance: 'high'
"【中】神秘令牌（第7章埋入）"                       → importance: 'normal'
```

---

### 优化 6 ★：volume_outline prompt 缺少字数→章节数换算的明确公式，导致 AI 频繁出错

**位置**：`prompt.ts` → volume_outline prompt

**现状**：prompt 说"每章 3000-5000 字"和"eventLine 条数必须等于 targetChapterCount"，但缺少具体换算示例，AI 经常搞混总字数和卷字数，产生 eventLine/targetChapterCount 不对齐（即缺陷 4 的上游原因）。

**建议**：在 prompt 中增加强制公式块：
```
【换算公式（硬性执行）】
该卷 targetChapterCount = round(该卷 targetWordCount ÷ 4000)
eventLine 条数 = targetChapterCount（一条不多，一条不少）
示例：单卷 20 万字 → targetChapterCount=50 → eventLine 必须有 50 条
```

---

## 四、冗余功能

### 冗余 1：`triggerAutoSummary` 与 `triggerChapterSummary` 完全重复

两函数 prompt 完全相同，唯一区别是 `summaryModel` 字段写 `'auto'` vs `'manual'`，以及返回值结构。合并为一个函数：
```typescript
async function generateChapterSummary(env, chapterId, novelId, opts: {
  source: 'auto' | 'manual'
  usage?: { prompt_tokens: number; completion_tokens: number }
}): Promise<{ ok: boolean; summary?: string; error?: string }>
```

---

### 冗余 2：`/generate/coherence-check` 与 `combined-check` 的连贯性分支重复

两个入口都调用 `checkChapterCoherence`，都写 `checkLogs`。UI 中两个入口并存（检查 Tab 的单项卡片 + 综合检查），对用户形成混淆。

**建议**：UI 层移除 `ChapterCoherenceCheck.tsx` 的独立检查按钮，统一收归到 `CombinedCheck`。单独 endpoint 保留供 API 调试使用。

---

### 冗余 3：`buildOutlineContent`（纯拼接）不应对外暴露

`buildOutlineContentWithAI` 内部已有 fallback 调用，`buildOutlineContent` 是纯内部实现细节，不应从 `helpers.ts` 导出。隐藏为私有函数即可。

---

## 五、补足功能

### 补足 1 ★★★：workshop 对已有小说的 loadNovelContextData 缺乏格式归一化

**位置**：`session.ts` → `loadNovelContextData`

**问题**：加载已有小说数据时，`characters[].attributes` 可能是旧格式，`volumes[].eventLine` 可能是 JSON 字符串而非数组。AI 看到格式错误的 currentData 后，增量输出时可能覆盖正确的原有数据。

**建议**：加载后做一次格式归一化，确保输出符合 `WorkshopExtractedData` schema，特别是 eventLine 要 `JSON.parse` 成数组。

---

### 补足 2 ★★：缺少"本章 eventLine 已消费"标记，章节顺序调整后生成内容漂移

**问题**：contextBuilder 用 `chapterIndexInVolume`（实时计算的位置序号）取 eventLine。用户删除/重建章节或调整顺序后，位置序号变化，同一 chapter 拿到的 eventLine 条目可能不同。

**建议**：`chapters` 表增加 `eventLineIndex` 字段，创建章节时写入，contextBuilder 优先用此字段而非实时计算。

---

### 补足 3 ★★：批量生成缺少质量门控

**问题**：批量生成每章完成即开始下一章，无任何质量门控。某章严重断裂时继续生成只会叠加错误。

**建议**：`batch_generate_chapter` handler 中，`post_process_chapter` 完成后检查 qualityScore：
```typescript
if (qScore.totalScore < BATCH_QUALITY_GATE) {  // 默认 45
  await markTaskFailed(env, taskId, `章节质量过低（${qScore.totalScore}分），请人工介入`)
  return  // 不触发下一章
}
```

---

### 补足 4 ★：workshop 历史草稿入口缺失（接口已就绪，UI 未实现）

`GET /api/workshop/sessions` 完整，但 `WorkshopPage.tsx` 未使用，用户关闭页面后无法恢复未 commit 的草稿。前端新增历史列表即可，改动成本极低。

---

### 补足 5 ★：摘要结构验证缺失

`triggerAutoSummary` 生成后直接写库，不验证四个结构标签是否齐全。格式缺失时，`checkContinuityWithPrevChapter` 拿到的摘要参考价值极低。

```typescript
function validateSummaryStructure(text: string): boolean {
  return ['【角色状态变化】', '【关键事件】', '【道具/功法】', '【章末状态】']
    .every(tag => text.includes(tag))
}
// 验证失败：重试一次，仍失败则标记 summaryModel = 'malformed'
```

---

## 六、执行优先级

| 优先级 | 问题 | 改动成本 | 影响 |
|--------|------|----------|------|
| **P0** | 缺陷1：queue 模式缺步骤3-6 | 中（提取公共函数） | 批量生成全程无境界更新/无检查缓存 |
| **P0** | 缺陷2：角色一致性是假数据 | 低（service层加自动查询） | 所有检查结果失真 |
| **P1** | 缺陷4：eventLine 截断破坏大纲 | 低（改判断逻辑） | 卷后段章节生成无事件参考 |
| **P1** | 优化1：Slot-1 补入下章预告 | 低（contextBuilder 调整） | 章末钩子质量显著提升 |
| **P1** | 优化6：volume_outline 换算公式 | 低（prompt 文本修改） | 减少 eventLine 不对齐的发生率 |
| **P1** | 补足4：workshop 草稿恢复 | 低（纯前端） | 用户体验 |
| **P2** | 缺陷3：entityIndex 临时 ID | 中（commit 流程调整） | 搜索/引用功能异常 |
| **P2** | 缺陷5：连贯性检查无兜底 | 低（加降级逻辑） | 第一批章节连贯性误判 |
| **P2** | 优化2：genre 专属 systemPrompt | 中（workshop 增加生成步骤） | 题材风格匹配度大幅提升 |
| **P2** | 补足3：批量生成质量门控 | 中（queue handler 加判断） | 防止错误叠加扩散 |
| **P3** | 缺陷6：删除死字段 chapters | 低（类型文件修改） | 代码清晰度 |
| **P3** | 优化5：伏笔优先级传递 | 低（prompt + commit 调整） | RAG 召回质量 |
| **P3** | 冗余1：合并两个摘要函数 | 低 | 代码维护 |
| **P3** | 补足2：eventLineIndex 字段 | 中（schema + 逻辑改动） | 章节顺序调整后的稳定性 |
| **P3** | 补足5：摘要结构验证 | 低 | 连贯性检查输入质量 |
