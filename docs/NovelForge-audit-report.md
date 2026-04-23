# NovelForge 章节创作全流程审查报告

> 审查范围：AI摘要生成 · 向量索引写入/读取 · 实体索引 · 章节生成全链路  
> 审查版本：v1.3.0 / context-v4  
> 审查日期：2026-04-23

---

## 一、总览

| 编号 | 类别 | 严重程度 | 位置 | 一句话描述 |
|------|------|----------|------|-----------|
| B1 | 竞态条件 | 🔴 严重 | `agent.ts` → `generateChapter` | 摘要/伏笔/境界三个后处理步骤在章节内容写入DB之前执行，读到的 `chapter.content` 永远是 NULL |
| B2 | 逻辑错误 | 🔴 严重 | `contextBuilder.ts` → `fetchOpenForeshadowingIds` | `sortOrder = 0` 被 `!sort` 误判为 falsy，第一章埋下的伏笔在生成第一章时就会被注入 |
| B3 | 逻辑错误 | 🔴 严重 | `agent.ts` → `checkContinuityWithPrevChapter` | 用 `currentChapter.id`（章节ID）去过滤 `chapters.novelId` 字段，前章摘要衔接检查永远查不到结果 |
| B4 | 向量一致性 | 🟡 次要 | `services/foreshadowing.ts` → `extractForeshadowingFromChapter` | 自动提取的新伏笔写入DB后未触发向量化，下一章RAG找不到这些伏笔 |
| B5 | 向量一致性 | 🟡 次要 | `services/powerLevel.ts` → `detectPowerLevelBreakthrough` | 境界突破后更新了 `characters.powerLevel`，但未重新向量化角色，下次RAG拿到的角色卡境界信息是旧的 |
| B6 | 向量一致性 | 🟡 次要 | `routes/characters.ts` → `PATCH /:id` | 仅 `description` 变更时触发重新向量化；`name` 或 `role` 单独变更时向量内容变为陈旧 |
| B7 | 向量一致性 | 🟡 次要 | `routes/novel-settings.ts` → `PUT /:id` | 仅 `content` 变更时触发重新向量化；`importance` 单独调整为 `high` 时，向量元数据中的 `importance` 字段不更新，`buildSettingsSlotV2` 的高重要性全文补充路径失效 |
| B8 | 死代码 | 🔵 低 | `lib/queue.ts` + `queue-handler.ts` | `generate_summary` 队列消息类型有定义、有处理器，但代码库中**从未被 enqueue**，是废弃的接口残留 |

---

## 二、严重问题详述

### B1 — 竞态：章节后处理读到 NULL content

**根本原因**

`generateChapter` 的执行顺序是：

```
runReActLoop（流式生成，内容通过SSE发往前端）
  → triggerAutoSummary(await)      ← 读 DB: chapter.content
  → extractForeshadowingFromChapter(await) ← 读 DB: chapter.content
  → detectPowerLevelBreakthrough(await)    ← 读 DB: chapter.content
  → onDone(usage) → 写 SSE [DONE]
```

前端收到 `[DONE]` 后，用户点击"插入"，`ChapterEditor` 通过 debounce 回调调用 `PATCH /chapters/:id` 将内容写入DB。

**后处理三步在 `[DONE]` 发送之前执行，此时 DB 中 `chapter.content` 仍是旧内容或 NULL（新章节）。**

具体影响：

- `triggerAutoSummary`：`if (!chapter?.content) { return }` → 静默退出，不生成摘要。**摘要永远不会自动生成。**（注：这就是你说"chapter不截断生成摘要"的真正原因——根本没机会执行到截断那行）
- `extractForeshadowingFromChapter`：同上，`if (!chapter?.content) { return }` → 静默退出，伏笔永远不会自动提取。
- `detectPowerLevelBreakthrough`：同上，境界突破永远不会自动检测。

对 `rewrite` 模式：章节DB中有旧内容，三步后处理会分析**重写前**的旧内容，产生错误的摘要/伏笔/境界记录。

**修复方案**

生成结束时，通过 SSE 把完整内容一次性回写，或在 `onDone` 前先写DB，再触发后处理：

```typescript
// 在 runReActLoop 结束后、触发后处理之前，先把内容写入DB
const fullContent = collectedContent // 需要在循环中累积
await db.update(chapters)
  .set({ content: fullContent, wordCount: fullContent.length, updatedAt: sql`(unixepoch())` })
  .where(eq(chapters.id, chapterId))

// 之后再触发后处理
await triggerAutoSummary(...)
await extractForeshadowingFromChapter(...)
await detectPowerLevelBreakthrough(...)
```

或者将后处理改为由前端在 `PATCH` 成功后通过独立 API 触发（解耦更彻底）。

---

### B2 — `sortOrder = 0` 被误判为 falsy

**位置**：`server/services/contextBuilder.ts` → `fetchOpenForeshadowingIds`

**问题代码**：

```typescript
const sort = sortMap.get(row.chapterId)
if (!sort || sort < currentSortOrder) openIds.add(row.id)
//   ^^^^
//   sort=0 (第一章) 是 falsy → 条件成立 → 第一章的伏笔总是被加入 openIds
```

`sortOrder` 为整数，第一章通常是 `0`。当 `sort = 0` 时，`!sort` 为 `true`，伏笔被加入 `openIds`，无论当前生成的是哪一章。

**具体后果**：生成第1章时（`currentSortOrder = 0`），正确逻辑应排除所有未来章节的伏笔；但 `sort=0 < 0` 为 false 而 `!sort` 为 true，导致第1章的伏笔在生成第1章时就被注入上下文——它还没被埋下就出现了。

**修复**：

```typescript
// 错误
if (!sort || sort < currentSortOrder) openIds.add(row.id)

// 正确：用 null/undefined 判断代替 falsy 判断
if (sort === undefined || sort === null || sort < currentSortOrder) openIds.add(row.id)

// 或更简洁
if (sort == null || sort < currentSortOrder) openIds.add(row.id)
```

---

### B3 — 前章衔接检查 novelId 字段误用

**位置**：`server/services/agent.ts` → `checkContinuityWithPrevChapter`（第 1114 行）

**问题代码**：

```typescript
const prevChapter = await db
  .select({ summary: chapters.summary, title: chapters.title })
  .from(chapters)
  .where(
    sql`${chapters.novelId} = ${currentChapter.id}`  // 注释自称"简化处理"
  )
  .orderBy(desc(chapters.sortOrder))
  .limit(1)
  .get()
```

`currentChapter` 只 select 了 `id / title / content / sortOrder`，**没有 `novelId`**。这里用的是 `currentChapter.id`（章节的UUID），去过滤 `chapters.novelId` 字段，结果永远是空集。连贯性检查的第一步（前章衔接）从不产生任何 issue。

另一个隐患：即使字段正确，查询也缺少 `sortOrder < currentSortOrder` 的过滤，仅靠 `ORDER BY DESC LIMIT 1` 可能拿到当前章之后的章节。

**修复**：

```typescript
// checkChapterCoherence 中：currentChapter 补充 novelId 字段
const currentChapter = await db
  .select({
    id: chapters.id,
    novelId: chapters.novelId,   // 补上
    title: chapters.title,
    content: chapters.content,
    sortOrder: chapters.sortOrder,
  })
  ...

// checkContinuityWithPrevChapter 签名增加 novelId 参数
async function checkContinuityWithPrevChapter(
  db: any,
  novelId: string,
  currentChapter: { id: string; title: string; content: string | null; sortOrder: number },
  issues: ...
) {
  const prevChapter = await db
    .select({ summary: chapters.summary, title: chapters.title })
    .from(chapters)
    .where(and(
      eq(chapters.novelId, novelId),
      sql`${chapters.sortOrder} < ${currentChapter.sortOrder}`,
      sql`${chapters.deletedAt} IS NULL`
    ))
    .orderBy(desc(chapters.sortOrder))
    .limit(1)
    .get()
```

---

## 三、次要问题详述

### B4 — 自动提取的伏笔不入向量库

**位置**：`server/services/foreshadowing.ts` → `extractForeshadowingFromChapter`

`extractForeshadowingFromChapter` 调用 `db.insert(foreshadowing).values(...)` 写入新伏笔后，没有触发 `enqueue(index_content)`。这些新伏笔在后续章节的 `buildForeshadowingHybrid` 中：

- 路径 A（DB直查高重要性）：`importance='high'` 的新伏笔可以被查到 ✓
- 路径 B（RAG过滤）：这些伏笔没有向量，RAG 永远找不到它们 ✗

如果新提取的伏笔 `importance='normal'`，它既不在路径A（只查high），也不在路径B（没有向量），**彻底消失于上下文**。

**修复**：在 `db.insert(foreshadowing)` 成功后追加入队：

```typescript
const inserted = await db.insert(foreshadowing).values({...}).returning().get()
if (inserted && env.TASK_QUEUE) {
  await enqueue(env, {
    type: 'index_content',
    payload: {
      sourceType: 'foreshadowing',
      sourceId: inserted.id,
      novelId,
      title: inserted.title,
      content: inserted.description || inserted.title,
      extraMetadata: { importance: inserted.importance },
    },
  })
}
```

---

### B5 — 境界突破后角色向量未更新

**位置**：`server/services/powerLevel.ts` → `detectPowerLevelBreakthrough`

境界突破写入 `characters.powerLevel` 后没有重新向量化角色。`contextBuilder` 的 `buildCharacterSlotFromDB` 从 DB 取完整卡片时会读到新境界 ✓，但角色向量的 `metadata.content`（用于语义检索）仍是旧描述文本。

实际影响：RAG 召回角色依赖语义相似度，境界突破只改变 `powerLevel` JSON，不改变描述文本，因此RAG召回结果基本不受影响。严重性较低，但向量元数据与实际数据存在漂移。

**修复**：突破检测成功后触发角色重新向量化：

```typescript
await db.update(characters).set({ powerLevel: JSON.stringify(newPowerLevel) }).where(...)

// 追加重新向量化
if (env.TASK_QUEUE) {
  const indexText = `${targetCharacter.name}${targetCharacter.role ? ` (${targetCharacter.role})` : ''}\n${(targetCharacter.description || '').slice(0, 300)}`
  await enqueue(env, {
    type: 'index_content',
    payload: { sourceType: 'character', sourceId: targetCharacter.id, novelId, title: targetCharacter.name, content: indexText },
  })
}
```

---

### B6 — 角色 name/role 变更不触发向量更新

**位置**：`server/routes/characters.ts` → `PATCH /:id`

触发条件是 `body.description !== undefined`。向量内容是 `${name} (${role})\n${desc.slice(0,300)}`，包含 `name` 和 `role`，但这两个字段变更时不触发重新向量化。

**修复**：

```typescript
// 将触发条件从仅 description 扩展到任意影响索引内容的字段
if ((body.description !== undefined || body.name !== undefined || body.role !== undefined) && row && c.env.VECTORIZE) {
  const indexText = `${row.name}${row.role ? ` (${row.role})` : ''}\n${(row.description || '').slice(0, 300)}`
  await enqueue(c.env, { type: 'index_content', payload: { sourceType: 'character', ... } })
}
```

---

### B7 — 设定 importance 调整不更新向量元数据

**位置**：`server/routes/novel-settings.ts` → `PUT /:id`

重新向量化的触发条件是 `body.content !== undefined`。当用户只把一条 `importance: 'normal'` 的设定改为 `importance: 'high'` 时，向量元数据中的 `importance` 字段不更新。

`buildSettingsSlotV2` 中判断是否追加全文的逻辑依赖 `r.metadata.importance`：

```typescript
if (r.metadata.importance === 'high' && r.score >= 0.45) {
  highImportanceIds.push(r.metadata.sourceId)
}
```

元数据未更新 → 这条设定即使已被标为高重要性，也不会触发全文追加。

**修复**：扩展触发条件覆盖 `importance` 和 `name` 的变更：

```typescript
const needsReindex = body.content !== undefined || body.importance !== undefined || body.name !== undefined
if (c.env.VECTORIZE && needsReindex && updated.content) {
  await enqueue(c.env, {
    type: 'index_content',
    payload: {
      sourceType: 'setting',
      sourceId: updated.id,
      novelId: updated.novelId,
      title: updated.name,
      content: updated.summary || updated.content.slice(0, 400),
      extraMetadata: { settingType: updated.type, importance: updated.importance },
    },
  })
}
```

---

### B8 — `generate_summary` 队列消息类型是死代码

**位置**：`server/lib/queue.ts`（类型定义）+ `server/queue-handler.ts`（`case 'generate_summary'`）

在整个代码库中 `grep` 搜索 `generate_summary`，只出现在类型定义和 handler 中，**没有任何地方调用 `enqueue({ type: 'generate_summary', ... })`**。

该消息类型是早期设计的残留，目前摘要由 `triggerAutoSummary` 直接同步调用，与 B1 的根本原因有关。

建议：统一后要么删除此类型，要么改造为正确的异步摘要触发方式（配合 B1 修复）。

---

## 四、修复优先级建议

```
阶段一（立刻修复，影响核心功能）
  B1 — 竞态：章节内容先写DB，再触发后处理
  B3 — 连贯性检查 novelId 字段错误

阶段二（影响RAG上下文质量）
  B2 — sortOrder=0 falsy 判断
  B4 — 自动提取伏笔入向量库
  B7 — 设定 importance 变更触发重新向量化

阶段三（向量长期一致性）
  B5 — 境界突破后角色向量更新
  B6 — 角色 name/role 变更触发向量更新
  B8 — 清理死代码
```

---

## 五、架构层面观察（无需立即处理）

**后处理链设计**：当前 `triggerAutoSummary → extractForeshadowing → detectPowerLevel` 三步是串行阻塞的，在 `onDone` 回调之前全部完成，导致 SSE 流结束延迟。即使修复 B1（先写内容），这三步调用外部LLM API合计可能耗时5-15秒。建议将三步全部移入 Queue，由前端在 `PATCH` 写入内容后异步触发，主流程只负责内容生成和写入。

**`!sort` vs `sort == null`**：代码中多处用 `!value` 判断"值不存在"，对整数0和空字符串会产生误判，B2 是其典型案例。建议统一使用 `value == null` 或 `value === undefined || value === null`。

