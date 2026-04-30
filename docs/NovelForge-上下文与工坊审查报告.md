# NovelForge 上下文管理 & 创作工坊审查报告

> 审查范围：上下文构建（`contextBuilder.ts`、`messages.ts`）全链路；创作工坊（`workshop/` 全目录、`routes/workshop.ts`、`WorkshopPage.tsx`）全链路  
> 关联文件：`server/services/contextBuilder.ts`、`server/services/agent/messages.ts`、`server/services/workshop/{session,commit,extract,prompt,index,helpers}.ts`、`src/pages/WorkshopPage.tsx`、`src/components/workshop/CommitDialog.tsx`

---

## 第一部分：上下文管理

### 一、已确认的功能缺陷（Bug）

---

#### CTX-BUG-1：VECTORIZE 不可用时，角色/伏笔/设定三槽全部为空，生成质量骤降但无任何提示【高危】

**位置**：`contextBuilder.ts` L235

```ts
if (queryText && env.VECTORIZE) {
  // 角色槽、伏笔槽、设定槽 全在此块内
  characterCards = ...
  relevantForeshadowing = ...
  slottedSettings = ...
}
// VECTORIZE 不可用时：三个数组全部保持初始空值
```

**现象**：当 Vectorize 索引未配置或服务故障时，Dynamic 层三大槽位全部返回空数组，章节生成仅有 Core 层（总纲/卷蓝图/上章正文/主角卡）作为上下文，配角缺失、设定缺失、伏笔缺失，生成质量极差，但用户不会收到任何告警。

**根因**：RAG 可用性检查直接跳过整个 Dynamic 层构建，没有 DB 直查兜底路径。

**修复方案**：将 Slot-5（角色）和 Slot-7（伏笔）的 DB 兜底逻辑从 RAG 路径内提取出来，作为无 VECTORIZE 时的独立 fallback——角色按 `role IN ('protagonist','supporting')` 直查前 8 条，伏笔按高 importance 直查，设定按 importance='high' 直查。同时在 `debug.ragQueriesCount = 0` 时，生成侧 SSE 推送一条 `type: 'context_warning'` 事件提醒用户。

---

#### CTX-BUG-2：`inferChapterType` 传入整卷 `eventLine`，章节类型判断污染率高【中危】

**位置**：`contextBuilder.ts` L209

```ts
const chapterTypeHint = inferChapterType(volumeInfo.eventLine, currentChapter.title)
```

**现象**：`inferChapterType` 的第一个参数是整卷事件线全文（可能包含几十章的战斗/修炼/情感标签），导致几乎每章都命中多个类型，`fetchChapterTypeRules` 每次都返回全量规则，Slot-8 完全失去过滤意义。

**根因**：应传入 `currentEvent`（已提取好的本章事件描述），而非整卷 `eventLine`。

**修复方案**：将调用改为 `inferChapterType(currentEvent, currentChapter.title)`。该变量在 Step 2 已计算完毕，只需调整调用位置即可。

---

#### CTX-BUG-3：`fetchRecentSummaries` 无 volumeId 约束，摘要链可能跨卷混入非连续章节【中危】

**位置**：`contextBuilder.ts` L753-773

**现象**：摘要链查询条件为：

```ts
eq(chapters.novelId, novelId) AND sortOrder < currentSortOrder AND summary IS NOT NULL
```

没有 `volumeId` 约束。若第一卷和第二卷的 `sortOrder` 是全局连续的（schema 中 `idx_chapters_novel` 索引包含 `novelId + sortOrder`），则跨卷的章节摘要会混入当前卷的摘要链。典型场景：当前是第二卷第 1 章，摘要链末尾会包含第一卷的最后 20 章摘要，而第一卷的剧情在新卷中未必连贯。

**修复方案**：在 `fetchRecentSummaries` 加入可选的 `volumeId` 参数，优先取同卷摘要；同卷摘要不足 `chainLength` 时再补全前卷摘要（确保时间顺序），并在 `ContextBundle.debug` 中标记跨卷摘要数量。

---

#### CTX-BUG-4：Token 预算子项之和（128k）与 `DEFAULT_BUDGET.total`（128k）相等但无任何总量截断逻辑【低危】

**位置**：`contextBuilder.ts` L113-121

```ts
export const DEFAULT_BUDGET: BudgetTier = {
  core: 40000, summaryChain: 25000, characters: 20000,
  foreshadowing: 10000, settings: 25000, rules: 8000,
  total: 128000,  // 子项之和恰好 = total，没有余量
}
```

**现象**：代码只对 Core 层做了预算超出时的裁剪（while 循环删 rules），Dynamic 层各槽独立按自身预算控制，但无全局 `total` 校验。当各槽都打满时，实际注入 token 数可达 128k，加上 System Prompt（约 2k）和 User Prompt 框架（约 1k），加上 AI 生成的章节（2k-8k），总消耗可能接近 140k，超出预期。

**修复方案**：在 `assemblePromptContext` 函数末尾计算 `totalTokenEstimate` 并与 `budget.total * 0.9` 比较，超出时按优先级截断（先截 `summaryChain` 的旧章节，再截 `settings.misc`，最后截 `characterCards` 末位）。

---

### 二、需优化的功能

---

#### CTX-OPT-1：`buildMessages` 在续写/重写模式下不传 `contextBundle`（或仅传部分槽），配角和伏笔上下文丢失

**位置**：`messages.ts` L155-178（续写）、L183-208（重写）

**现象**：续写模式只注入 `['protagonist', 'characters', 'rules']` 三个槽，重写模式只注入 `['protagonist', 'characters', 'rules', 'worldSettings']`，均未注入 `summaryChain`、`foreshadowing`、`currentEvent`。  
对于续写场景，AI 不知道本章在卷中对应的事件目标，可能续写方向偏离卷蓝图；对于重写，AI 不知道有哪些待回收伏笔，可能在重写时无意中破坏伏笔状态。

**优化方案**：续写模式补充注入 `['currentEvent', 'nextThreeChapters', 'foreshadowing', 'summaryChain']`；重写模式补充注入 `['currentEvent', 'foreshadowing', 'summaryChain']`。

---

#### CTX-OPT-2：`queryText` 仅使用标题和卷事件线构建，不利用上章末尾正文内容

**位置**：`contextBuilder.ts` L197-208

**现象**：RAG 查询向量由 `[章节标题, prevEvent, currentEvent, nextThreeChapters]` 拼接生成。当 `currentEvent` 为空（卷事件线未填写时）才补充 `lastSummary`，但上章正文末尾（已在 Step 1 中取到的 `prevContent`）始终没有参与向量构建。上章末尾场景（地点、角色、法器）往往是本章最强的语义锚，不纳入导致角色和设定的 RAG 召回准确率下降。

**优化方案**：在 `queryTextParts` 中追加 `prevContent.slice(-400)`（上章正文末尾 400 字），这是成本最低的召回准确率提升点。

---

#### CTX-OPT-3：`buildCharacterSlotFromDB` 的 `SCORE_THRESHOLD = 0.45` 在稀疏索引场景下过于保守，导致零结果

**位置**：`contextBuilder.ts` L460-464

**现象**：当小说角色数少（如 5 人以下）或向量索引刚建立时，检索得分普遍在 0.35-0.44 区间，`>= 0.45` 阈值会过滤掉所有候选，导致角色槽为空，但主角已在 Slot-3 单独注入，Slot-5 空则配角完全消失。

**优化方案**：实现动态阈值：先用 `0.45` 过滤，若结果 `< 2`，降低到 `0.35` 重试一次（使用已有的 `ragResults`，不产生额外 RAG 调用）。

---

#### CTX-OPT-4：`extractCurrentChapterEvent` 的章节号匹配依赖 `sortOrder`，但 `sortOrder` 是全局排序而非卷内序号

**位置**：`contextBuilder.ts` L921-944

**现象**：函数查找 `第${currentSortOrder}章` 模式，而卷事件线通常按卷内序号记录（`第1章`、`第2章`...），两者当第二卷起就对不上，导致 `currentEvent` 始终为空字符串，退化为仅使用 `eventLine.slice(0, 500)` 的兜底逻辑。

`chapterIndexInVolume` 变量虽然已在 Step 1 后计算，但 `extractCurrentChapterEvent` 仍然传入的是全局 `sortOrder`。

**优化方案**：将 `extractCurrentChapterEvent` 的第二个参数从 `currentChapter.sortOrder` 改为已计算好的 `chapterIndexInVolume`。

---

## 第二部分：创作工坊

### 一、已确认的功能缺陷（Bug）

---

#### WS-BUG-1：`commitWorkshopSession` 是异步队列，但返回 `novelId: undefined`，前端无法跳转到新小说【高危】

**位置**：`workshop/commit.ts` L29-31

```ts
export async function commitWorkshopSession(env, sessionId) {
  await enqueue(env, { type: 'commit_workshop', payload: { sessionId } })
  return { ok: true, novelId: undefined, createdItems: {} }  // novelId 永远是 undefined
}
```

**现象**：`WorkshopPage.tsx` 的 `onSuccess` 只显示 Toast"创作数据已提交到后台处理"，**无法跳转到新建的小说详情页**，用户不知道小说 ID，只能去小说列表里手动找。

**根因**：commit 改为队列模式后，novelId 在 Worker 里异步生成，但前端期望同步获得 novelId 用于跳转，两种模式没有适配。

**修复方案二选一**：  
- 方案 A（推荐）：改为同步执行 `commitWorkshopSessionCore`，限时 30s，超时降级到队列；同步成功时返回 `novelId`，前端直接跳转。  
- 方案 B：提交后前端轮询 `GET /workshop/session/:id`，待 `session.novelId` 不为 null 时跳转（轮询间隔 2s，最多等 30s）。

---

#### WS-BUG-2：`foreshadowingResolve`（计划回收的伏笔）被写入数据库时 `status = 'open'`，与埋入伏笔语义相同【高危】

**位置**：`workshop/commit.ts` L406-423

```ts
if (vol.foreshadowingResolve?.length) {
  await db.insert(foreshadowing).values({
    status: 'open',  // ← BUG：应为 'planned_resolve' 或带特殊标记
    description: `【回收计划】${desc}\n【所属卷】${vol.title}`,
  })
}
```

**现象**：`foreshadowingSetup`（埋入计划）和 `foreshadowingResolve`（回收计划）写入数据库后 `status` 完全一样，后续章节生成时 `buildForeshadowingHybrid` 查询所有 `status='open'` 伏笔，将"回收计划"和"实际埋入伏笔"混在一起注入上下文，导致 AI 在错误时机尝试回收根本还没埋下的伏笔。

**修复方案**：  
1. `foreshadowingResolve` 写入时增加标记字段（如 `description` 前缀 `【回收计划】` 已有，但 status 需区分），可以新增 `importanceType` 或直接将 `status` 设为 `'resolve_planned'`。  
2. `buildForeshadowingHybrid` 过滤时排除 `status = 'resolve_planned'` 的记录，仅在当前卷的 `foreshadowingResolve` 目标章节范围内才注入。

---

#### WS-BUG-3：`loadNovelContextData` 加载已有小说数据时，`volumes.eventLine` 假定是 JSON 数组格式，但 `contextBuilder` 存储的是纯文本字符串【中危】

**位置**：`workshop/session.ts` L116-140

```ts
if (v.eventLine) {
  const parsed = JSON.parse(v.eventLine)  // 假定 JSON 数组
  eventLine = Array.isArray(parsed) ? parsed : (typeof parsed === 'string' ? [parsed] : [])
}
```

**现象**：`contextBuilder.ts` 和章节生成路径使用的 `volumes.eventLine` 字段是换行分隔的纯文本字符串（如`"第1章：...\n第2章：..."`），而工坊导入/写出时要求 `eventLine` 是字符串数组（JSON 格式）。两种格式在同一字段共存，导致：
- 工坊加载已有小说时，`JSON.parse` 抛出异常并静默吞掉（catch 里只有 `console.warn`），eventLine 显示为空。
- 用户在工坊修改后提交，`JSON.stringify(eventLine)` 会将原文本格式覆盖成 JSON 数组格式，破坏 `contextBuilder` 的 `extractCurrentChapterEvent` 匹配逻辑。

**修复方案**：在 `contextBuilder.ts` 读取 `volumes.eventLine` 时统一支持两种格式（已有容错代码但不彻底）；更根本的是在 schema 层明确该字段的存储格式，工坊 commit 时按统一格式写入。

---

#### WS-BUG-4：`extractStructuredData` 只取 AI 回复中**最后一个** JSON 代码块，前轮对话中的补充修改被丢弃【中危】

**位置**：`workshop/extract.ts` L198-201

```ts
const allJsonMatches = [...aiResponse.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)]
const jsonMatch = allJsonMatches.length > 0 ? allJsonMatches[allJsonMatches.length - 1] : null
```

**现象**：AI 有时在一次回复中先用自然语言解释修改了哪些字段，然后附上完整 JSON，逻辑正确。但当 AI 分两段输出（先给增量 JSON、再做文字补充并附带一个更小的 JSON 片段），只取最后一个 JSON 块会丢失前面更完整的数据。更常见的问题是：多轮对话中，用户多次要求"只改这一个字段"，`re-extract` 时对每条 assistant 消息独立提取后 merge，但 `extractStructuredData` 对相同 stage 每次都会完整覆盖（如 `worldSettings` 数组），merge 只取最后一轮结果，早期轮次的其他设定被清除。

**修复方案**：`extractStructuredData` 对数组类型字段（`worldSettings`、`characters`、`volumes`）改为 upsert 语义（按唯一键合并），而非完整替换。`reExtractSessionData` 的 merge 逻辑对数组字段也改为 upsert，非数组字段才用后覆盖前。

---

#### WS-BUG-5：工坊 session 消息列表存储在单个 TEXT 列中，无消息数量限制，长对话后写入失败【低危】

**位置**：`workshop/session.ts` → `updateSession`（`messages: JSON.stringify(updates.messages)`）

**现象**：每次 AI 回复后将全量消息序列化写回 D1 TEXT 列。卷纲阶段一条 AI 回复可达 8000-15000 字符，10 轮对话后消息 JSON 体积可超过 100KB，D1 对单行 TEXT 的限制为 1MB，但序列化 + JSON 解析的性能影响在 20 轮后会明显。

**修复方案**：对超过 30 轮的历史消息做压缩（将旧轮次的 assistant 消息压缩为摘要，只保留最近 10 轮完整消息），或将消息迁移到独立的 `workshopMessages` 表（sessionId + sequence 索引），避免整行重写。

---

### 二、需优化的功能

---

#### WS-OPT-1：工坊 Commit 对已有小说的阶段门控过于严格，跨阶段修改必须重置 stage

**位置**：`workshop/commit.ts` 各阶段条件判断

```ts
if (data.worldSettings && (isNewNovel || stage === 'worldbuild')) { ... }
if (data.characters && (isNewNovel || stage === 'character_design')) { ... }
```

**现象**：对已有小说，若用户当前 stage 是 `volume_outline`，但临时修改了一个角色属性，commit 时角色变更会被跳过（因为 `stage !== 'character_design'`）。用户必须手动切换 stage、重新 commit，体验割裂。

**优化方案**：将阶段门控从"只允许当前 stage 的数据"改为"允许 `extractedData` 中有变更的任意字段"，通过比对 `currentData`（session 里存的上一次 commit 结果）与 `newExtractedData` 的差异来决定写哪些表，而非通过 `stage` 字段硬过滤。

---

#### WS-OPT-2：工坊 `buildSystemPrompt` 的 `readonlyContext` 不展示世界设定的具体内容，AI 无法修正矛盾

**位置**：`workshop/prompt.ts` → `buildReadonlyContext` worldbuild 分支

**现象**：已有世界设定只展示类型和标题列表（`- 势力：玄灵宗、血煞门`），不展示 content。当用户说"帮我修改玄灵宗的控制区域"时，AI 不知道当前 content 是什么，只能凭空输出，极易与其他已有设定产生矛盾。

**优化方案**：在 `readonlyContext` 中对 `importance='high'` 的设定展示 content 前 200 字；对 `importance='normal'` 的只展示标题；用户可输入"查看 [设定名]"触发单条设定全文展示（复用 AI 对话流回复即可，无需新接口）。

---

#### WS-OPT-3：工坊提交的伏笔没有关联具体章节（`chapterId = null`），无法在生成时做时序过滤

**位置**：`workshop/commit.ts` L393-426

**现象**：工坊提交的伏笔埋入/回收记录的 `chapterId` 字段为空（`foreshadowing` 表的 `chapterId` 是可选外键），`fetchOpenForeshadowingIds` 在判断"是否已埋入"时：

```ts
if (sort == null || sort < currentSortOrder) openIds.add(row.id)
```

`chapterId = null` 导致 `sort = null`，满足 `sort == null`，工坊规划的所有伏笔从第一章起就会注入上下文，即使它们计划在第 30 章才埋入。

**优化方案**：工坊提交伏笔时，根据 `eventLine` 中伏笔埋入的"约第 X 章"信息，反查对应章节的 ID 并写入 `chapterId`；若无法精确匹配，则写入该卷第一章的 ID 作为保守估计。

---

#### WS-OPT-4：卷纲截断检测只有末尾 ` ``` ` 判断，漏检 JSON 数组提前结束的情况

**位置**：`workshop/index.ts` L112-118

```ts
const hasClosingBlock = fullResponse.trimEnd().endsWith('```')
if (!hasClosingBlock) {
  onChunk('\n\n⚠️ **输出可能被截断**...')
}
```

**现象**：当 AI 输出 `...]\n}` 后被截断（JSON 关闭了但 ` ``` ` 还没写），`endsWith('```')` 为 false，会误报截断。反之，若 AI 提前闭合了 JSON 数组但后面还有文字解释加上 ` ``` `，`safeParseJSON` 会解析出一个不完整的 `volumes` 数组（章节数少于 `targetChapterCount`），但截断检测显示"正常"，用户不知道。

**优化方案**：截断检测改为：1）尝试 `safeParseJSON` 解析提取的 JSON 块；2）解析成功后校验 `volumes[i].eventLine.length === volumes[i].targetChapterCount`；3）不一致时推送 `⚠️ 章节数不一致` 提示，比末尾字符检测更可靠。

---

### 三、建议新增的功能

---

#### WS-FEAT-1：工坊支持"导入已有章节摘要链"作为卷纲生成的参考

**现状**：工坊只从 `volumes`、`masterOutline` 等结构化字段加载上下文，不读取已有章节的实际内容。对于已写了部分章节的小说，工坊无法感知"当前写到了哪里、发生了什么"，卷纲建议与实际剧情脱节。  
**建议**：新增 `loadNovelContextData` 的选项，对 `volume_outline` 阶段，额外加载最近 5 章的摘要注入 `readonlyContext`，让 AI 知道"实际写到了哪里"再规划后续卷纲。

---

#### WS-FEAT-2：工坊新增"一键同步到生成上下文"按钮，触发 vectorize reindex

**现状**：工坊 commit 后，角色和设定写入 D1，并入队 `index_content` 做向量化。但向量化是异步的，用户可能在 commit 后立即开始生成，此时 RAG 仍返回旧向量。  
**建议**：commit 完成后，前端展示"正在建立语义索引（约 30 秒）"的进度提示，并在向量化完成（可通过轮询 `vectorIndex` 表的记录数判断）后才启用"开始生成"按钮，避免首章用空 RAG 上下文生成。

---

#### WS-FEAT-3：工坊对话支持"阶段内跳转"——在任意阶段直接修改其他阶段的数据

**现状**：四个阶段（概念→世界观→角色→卷纲）是线性的，用户在卷纲阶段发现世界观有矛盾，必须手动切换到世界观阶段才能修改。  
**建议**：允许在任意阶段的对话中说"修改角色 X 的性格"或"更新玄灵宗的设定"，系统识别意图后自动切换到对应的 stage 处理该条消息（不改变主 stage），完成后恢复原 stage，提交时携带跨阶段修改标记绕过门控。

---

## 优先级汇总

| 编号 | 类型 | 标题 | 优先级 |
|------|------|------|--------|
| WS-BUG-1 | 缺陷 | commit 异步返回 undefined novelId，无法跳转 | P0 |
| WS-BUG-2 | 缺陷 | foreshadowingResolve 写入 status=open，上下文时序混乱 | P0 |
| CTX-BUG-1 | 缺陷 | VECTORIZE 不可用时 Dynamic 层全空，无告警 | P0 |
| CTX-BUG-4-附 | 缺陷（见 OPT-4） | eventLine 格式二义性导致工坊与生成侧不兼容 | P0 |
| CTX-BUG-2 | 缺陷 | inferChapterType 传整卷 eventLine，类型判断失效 | P1 |
| CTX-BUG-4（OPT-4） | 缺陷 | extractCurrentChapterEvent 使用全局 sortOrder，第二卷起匹配失败 | P1 |
| WS-BUG-4 | 缺陷 | extractStructuredData 数组字段覆盖语义导致多轮修改数据丢失 | P1 |
| CTX-BUG-3 | 缺陷 | 摘要链无 volumeId 约束，跨卷摘要混入 | P2 |
| CTX-OPT-1 | 优化 | 续写/重写模式缺少 foreshadowing/currentEvent 上下文 | P1 |
| CTX-OPT-4（同上） | 优化 | 与 CTX-BUG-4 合并修复 | P1 |
| WS-OPT-3 | 优化 | 工坊伏笔无 chapterId，从第一章起即注入上下文 | P1 |
| CTX-OPT-2 | 优化 | queryText 未利用上章末尾正文，RAG 召回准确率低 | P2 |
| CTX-OPT-3 | 优化 | 角色 RAG 阈值固定 0.45，稀疏索引场景零结果 | P2 |
| WS-OPT-1 | 优化 | commit 阶段门控过严，跨阶段修改被跳过 | P2 |
| WS-OPT-4 | 优化 | 卷纲截断检测不可靠 | P2 |
| WS-BUG-5 | 缺陷 | session 消息存单列，长对话后性能/容量风险 | P3 |
| CTX-BUG-4（token）| 缺陷 | 无全局 token 总量截断逻辑 | P3 |
| WS-OPT-2 | 优化 | readonlyContext 不展示设定内容，AI 修改易产生矛盾 | P3 |
| WS-FEAT-2 | 新增 | commit 后等待向量化完成再启用生成入口 | P1 |
| WS-FEAT-1 | 新增 | 工坊加载已有章节摘要作为卷纲参考 | P2 |
| WS-FEAT-3 | 新增 | 工坊支持对话内跨阶段修改 | P3 |
