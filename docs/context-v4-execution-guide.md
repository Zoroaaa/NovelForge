# NovelForge v4 章节生成上下文构建 — 完整执行逻辑说明

> 版本: v4.0.0 | 文件: `server/services/contextBuilder.ts`
> 设计原则: **DB 为主（完整数据）+ 向量为辅（语义检索 ID）**

---

## 一、架构总览

### 1.1 调用入口

```
agent.ts generateChapter()
  └─→ buildChapterContext(env, novelId, chapterId)
       └─→ assemblePromptContext(bundle)
            └─→ 返回完整 prompt 字符串（~40-50k tokens）
```

入口文件: [agent.ts:150](file:///d:/user/NovelForge/server/services/agent.ts#L150), [agent.ts:600](file:///d:/user/NovelForge/server/services/agent.ts#L600)

### 1.2 数据流全景

```
buildChapterContext(env, novelId, chapterId)
│
├── Step 0: DB 查当前章节基础信息（volumeId, sortOrder, title）
│
├── Step 1: Core 层（8 个 DB 查询，Promise.all 并发）
│   ├── [DB] 总纲 content 全文（≤12k 字）或 summary
│   ├── [DB] 当前卷 blueprint + eventLine
│   ├── [DB] 上一章 summary
│   ├── [DB] 主角完整状态卡（name+desc+attr+powerLevel）
│   ├── [DB] 全部活跃创作规则（isActive=1，不限 priority）
│   └── [DB] 最近 20 章 summaries（摘要链）
│
├── Step 2: 组装查询向量
│   └─ embedText(AI, eventLine + prevSummary + chapterTitle) → queryVector
│
├── Step 3: Dynamic 层（2 次 RAG 并发 + 多次 DB 补查）
│   │
│   ├── RAG #1: searchSimilar(sourceType='character', topK=15)
│   │   └─→ 取 sourceId 列表 → DB IN 查完整卡片 → 组装 name+role+desc+attr+powerLevel
│   │
│   ├── RAG #2: searchSimilar(sourceType='foreshadowing', topK=10)
│   │   ├─→ 路径A: DB 直查 importance='high' AND status='open'（无条件注入）
│   │   └─→ 路径B: RAG score > 0.55 AND status=open（普通伏笔）
│   │
│   └── RAG #3: searchSimilar(sourceType='setting', topK=20)
│       ├─→ 用 metadata.summary 作为上下文（每条 ≤400 字）
│       ├─→ 按 settingType 分 6 槽独立预算
│       └─→ importance='high' 的额外追加了 DB content 全文
│
├── Step 4: Core Token 预算检查
│   └─ 超预算时从尾部弹出规则项（规则优先级最低）
│
└── Step 5: 返回 ContextBundle（含诊断信息）
    └─→ assemblePromptContext() → 最终 prompt 字符串
```

### 1.3 预算分配

| 槽位 | 层级 | 预算 (tokens) | 数据来源 |
|------|------|-------------|---------|
| 总纲 | L0 Core | ≤10000 | DB masterOutline.content |
| 卷规划 | L0 Core | ≤1500 | DB volumes.{blueprint,eventLine} |
| 上一章 | L0 Core | ≤500 | DB chapters.summary |
| 主角卡 | L0 Core | ≤3000 | DB characters(protagonist) |
| 创作规则 | L0 Core | ≤5000 | DB writingRules(isActive=1) |
| **Core 小计** | | **≤18000** | |
| 摘要链 | L1 Dynamic | ≤10000 | DB chapters.summary × 20 |
| 出场角色 | L2 Dynamic | ≤8000 | RAG(character) → DB 完整卡片 |
| 世界设定 | L2 Dynamic | ≤12000 | RAG(setting).summary + high优全文 |
| 待回收伏笔 | L2 Dynamic | ≤4000 | DB高优兜底 + RAG(foreshadowing) |
| 本章规则 | L2 Dynamic | ≤3000 | DB writingRules(category匹配) |
| **总计** | | ****≤55000** (~40k 中文字)** | |

---

## 二、各槽位详细执行逻辑

### 2.1 Slot-0: 总纲 (`fetchMasterOutlineContent`)

**文件位置**: [contextBuilder.ts:529-551](file:///d:/user/NovelForge/server/services/contextBuilder.ts#L529-L551)

**执行步骤**:
1. DB 查询 `masterOutline` 表，按 version DESC 取最新一条
2. 判断返回策略:
   - 有 `content` 且 ≤12000字 → 返回 `【标题（总纲）】\n{content全文}`
   - content > 12000字但有 `summary` → 返回 `【标题（总纲摘要）】\n{summary}`
   - 都没有但 content 存在 → 截取前 8000 字，标记为"节选"
   - 都没有 → 返回空字符串

**为什么用全文**: 256k 窗口足够承载；总纲是全局世界观指引，AI 需要完整信息。

**不使用向量的原因**: 总纲只有 1 条，无需语义检索。DB 直接查询即可。

---

### 2.2 Slot-1: 当前卷规划 (`fetchVolumeInfo`)

**文件位置**: [contextBuilder.ts:553-566](file:///d:/user/NovelForge/server/services/contextBuilder.ts#L553-L566)

**执行步骤**:
1. 用 `volumeId` 查 `volumes` 表
2. 返回 `{ blueprint, eventLine }` 两个字段

**无向量** — 结构化数据，固定 1 条。

---

### 2.3 Slot-2: 上一章回顾 (`fetchPrevChapterSummary`)

**文件位置**: [contextBuilder.ts:568-583](file:///d:/user/NovelForge/server/services/contextBuilder.ts#L568-L583)

**执行步骤**:
1. 查 `chapters` 表：`sortOrder < currentSortOrder`，取最近 1 条
2. 返回 `[上一章: {title}] {summary}`

---

### 2.4 Slot-3: 主角状态卡 (`fetchProtagonistCards` + `fetchProtagonistPowerLevel`)

**文件位置**: [contextBuilder.ts:607-663](file:///d:/user/NovelForge/server/services/contextBuilder.ts#L607-L663)

**执行步骤**:
1. `fetchProtagonistCards`: DB 查 `characters WHERE role='protagonist'`
2. `fetchProtagonistPowerLevel`: DB 查主角的 `powerLevel` JSON 字段
3. `mergeProtagonistAndPower`: 合并为完整卡片:

```
【林岩（主角）】
{description}
属性：年龄: 16 | 性格: 坚毅隐忍
当前境界：炼气境三层，下一目标：筑基期
```

**无向量** — 主角是固定的少数几人，DB 直接查。

---

### 2.5 Slot-4: 创作规则 (`fetchAllActiveRules`)

**文件位置**: [contextBuilder.ts:668-686](file:///d:/user/NovelForge/server/services/contextBuilder.ts#L668-L686)

**v4 变更**: 不再限制 `priority <= 2`，取全部 `isActive=1` 的规则。

**执行步骤**:
1. DB 查 `writingRules WHERE isActive=1 AND deletedAt IS NULL`
2. 按 `priority ASC` 排序
3. 格式化为 `[分类] 标题\n内容`

**原因**: 256k 窗口放得下全部 20-50 条规则（每条约 200 字 ≈ 13k tokens）。

---

### 2.6 Slot-5: 出场角色卡 (`buildCharacterSlotFromDB`) ⭐ 核心改动

**文件位置**: [contextBuilder.ts:292-336](file:///d:/user/NovelForge/server/services/contextBuilder.ts#L292-L336)

**这是 v4 最大架构变化** — 从"RAG 返回 chunk 碎片"改为"RAG 找 ID → DB 查完整卡片"。

**执行流程**:
```
输入: ragResults (来自 searchSimilar(sourceType='character', topK=15))
  │
  ├─ 1. 过滤: score >= 0.50（阈值较低，因为后续要取完整数据）
  ├─ 2. 排序: 按 score 降序
  ├─ 3. 截断: 取前 15 个 sourceId
  │
  ├─ 4. DB 批量查询（一次 IN 查询）:
  │     SELECT id, name, role, description, attributes, powerLevel, aliases
  │     FROM characters WHERE id IN (candidateIds)
  │
  ├─ 5. 按 RAG score 重排序（保持相关性顺序）
  │
  └─ 6. 组装完整卡片 + 预算截断（最多 8 个角色）:
        【{name}】({role})
        别名: {aliases}
        {description}
        属性: k1: v1 | k2: v2
        当前境界: {current}，下一目标: {nextMilestone}
```

**性能保证**: 即使小说有 200 个角色：
- RAG 先筛到 top 15（语义相关）
- DB 只查这 15 条
- 最终只组装 6-8 个

**向量存什么**: 仅 `name + role + description前300字`（约 350 字 ≤ 1 chunk），用于 RAG 识别"谁可能出场"。

---

### 2.7 Slot-6: 世界设定 (`buildSettingsSlotV2`) ⭐ 配合新 summary 字段

**文件位置**: [contextBuilder.ts:423-520](file:///d:/user/NovelForge/server/services/contextBuilder.ts#L423-L520)

**v4 变更**: RAG 返回的是 `novelSettings.summary`（而非全文切块），且 importance=high 的设定会追加 DB 全文。

**执行流程**:
```
输入: ragResults (来自 searchSimilar(sourceType='setting', topK=20))
  │
  ├─ Phase 1: 按 settingType 分槽处理每个 RAG 结果
  │     │
  │     ├─ typeMapping: world_rule→worldRules, power_system→powerSystem,
  │     │               geography→geography, faction→factions,
  │     │               artifact→artifacts, 其他→misc
  │     │
  │     ├─ 各槽独立参数:
  │     │   worldRules:  budget=2500  threshold=0.55
  │     │   powerSystem: budget=2500  threshold=0.55
  │     │   geography:   budget=1500  threshold=0.70 (需章节含地点关键词)
  │     │   factions:    budget=1200  threshold=0.68 (需章节含势力关键词)
  │     │   artifacts:   budget=800   threshold=0.68 (需章节含法宝关键词)
  │     │   misc:        budget=800   threshold=0.72
  │     │
  │     └─ 对每个结果 r:
  │         ├─ 判断所属 slotKey
  │         ├─ score < threshold → 跳过
  │         ├─ 使用 r.metadata.content（即 summary 字段值）
  │         └─ 超出 slotBudget → 跳过
  │
  ├─ Phase 2: 高重要性设定追加全文
  │     ├─ 收集 importance='high' AND score>=0.45 的 sourceId 列表
  │     ├─ DB 批量查询: SELECT id, name, type, content FROM novelSettings WHERE id IN (...)
  │     └─ 追加到对应槽: `【name·完整设定】\n{content全文}`
  │        （允许超出原 budget 的 1.5 倍作为缓冲）
  │
  └─ 返回 SlottedSettings (6 个子槽的字符串数组)
```

**章节类型动态开关**:
- `hasLocation`: eventLine/chapterTitle 含"地点/场景/地图/城市..." → geography 槽开启
- `hasFaction`: 含"门派/势力/宗门..." → factions 槽开启
- `hasArtifact`: 含"法宝/功法/秘法..." → artifacts 槽开启

**向量存什么**: `novelSettings.summary` 字段（≤400 字，自动生成或用户填写）。不再存储全文。

---

### 2.8 Slot-7: 待回收伏笔 (`buildForeshadowingHybrid`) ⭐ 双路合并

**文件位置**: [contextBuilder.ts:365-416](file:///d:/user/NovelForge/server/services/contextBuilder.ts#L365-L416)

**v4 变更**: 增加 DB 兜底路径，防止高重要性伏笔被 RAG score 漏掉。

**执行流程**:
```
输入: ragResults + openIds(Set) + novelId
  │
  ├─ 路径A: DB 直查高重要性伏笔（无条件注入）
  │   └─ SELECT * FROM foreshadowing
  │       WHERE novelId=? AND status='open' AND importance='high'
  │       LIMIT 10
  │   → 输出格式: 【title】(高重要性)\n{description}
  │
  ├─ 路径B: RAG 过滤普通伏笔
  │   └─ ragResults 中过滤:
  │       ├─ isOpen = true（在 openIds 中）
  │       ├─ importance != 'high'（已在路径A处理）
  │       └─ score > 0.55
  │   → 输出格式: metadata.content（原始描述文本）
  │
  └─ 合并排序: 路径A 优先（priority=0），路径B 按 score 排（priority=1）
      → 整体受 budgetTokens 截断
```

**设计理由**: 高重要性伏笔对剧情连贯性至关重要，不能因为 AI embed 的 score 波动而漏掉。DB 兜底确保零遗漏。

---

### 2.9 Slot-8: 本章类型规则 (`fetchChapterTypeRules`)

**文件位置**: [contextBuilder.ts:688-720](file:///d:/user/NovelForge/server/services/contextBuilder.ts#L688-L720)

**执行步骤**:
1. 从 `chapterTypeHint`（eventLine + chapterTitle 推断）提取关键词
2. 关键词 → 映射到 rule category:
   - "战斗/对决/厮杀" → pacing, plot
   - "情感/相遇/离别" → character
   - "修炼/突破/感悟" → world, character
   - "文风/叙述/描写" → style
3. DB 查询: `writingRules WHERE category IN (...) AND priority 无限制`（v4 移除了 priority>2 限制）
4. 按 priority 排序，limit 8

**注意**: 此槽与 Slot-4（全部规则）的区别:
- Slot-4: 注入**所有**核心规则（全局准则）
- Slot-8: 注入与**本章类型特别相关**的补充规则

---

### 2.10 Slot-9: 近期剧情摘要链 (`fetchRecentSummaries`)

**文件位置**: [contextBuilder.ts:585-605](file:///d:/user/NovelForge/server/services/contextBuilder.ts#L585-L605)

**v4 变更**: 默认从 5 章扩展到 **20 章**，上限 30 章。

**执行步骤**:
1. DB 查询: `chapters WHERE sortOrder < currentSortOrder AND summary IS NOT NULL AND summary != ''`
2. 按 sortOrder DESC 取 N 条
3. 反转（时间正序）→ `[第N章 {title}] {summary}`

**无向量** — 摘要链需要严格的时间顺序和完整性，DB ORDER BY 即可。

---

## 三、assemblePromptContext 输出格式

**文件位置**: [contextBuilder.ts:787-824](file:///d:/user/NovelForge/server/services/contextBuilder.ts#L787-L824)

最终输出结构:

```markdown
## 总纲
【天玄大陆总纲（总纲）】
{content 全文 或 summary}

## 当前卷规划
【卷蓝图】
{blueprint}

【事件线】
{eventLine}

## 上一章回顾
[上一章: 第42章 林岩离山] {summary}

## 主角状态
【林岩（主角）】
{完整状态卡}

## 创作准则
[文风] 古典仙侠风
{rule content}

[禁忌] 主角不得轻易认输
{rule content}
...（全部活跃规则）

## 近期剧情摘要
[第22章 ...] {summary}
[第23章 ...] {summary}
...（20 章）

## 本章出场角色
【苏清婉】(女主角/道侣)
{完整角色卡}

【王胖子】(配角/挚友)
{完整角色卡}
...（6-8 个）

## 待回收伏笔
【天雷珠之谜】(高重要性)
{description}

【林家族暗流】
{description}
...

## 相关世界设定
【世界法则】
{setting summary 1}
{setting summary 2}

【境界体系】
{setting summary 1}
{setting summary 2}

【相关势力】
{setting summary}

【完整设定】
{high-importance setting full text}
...

## 本章创作指引
[节奏] 战斗章节需紧凑
{rule content}
...
```

---

## 四、向量索引精确定义（仅 3 种）

### 4.1 向量索引范围（清理后）

v4 清理后，**只有以下 3 种类型的向量索引用于章节生成上下文**:

| sourceType | 索引内容 | 大小 | 触发时机 | 上下文中用途 |
|-----------|---------|------|---------|------------|
| **character** | `name + role + description前300字` | ~350 字 (≤1 chunk) | 创建/更新角色时 | RAG 找出场角色 ID → DB 查完整卡片 |
| **setting** | `novelSettings.summary` (≤400字) | ~400 字 (≤1 chunk) | 创建/更新设定时 | RAG 返回 summary 直接当上下文 |
| **foreshadowing** | `title + description` 原样 | ~200-500 字 (≤1 chunk) | 创建/更新伏笔时 | RAG 过滤 + 高优 DB 兜底 |

### 4.2 已移除的索引类型（不再触发）

| sourceType | 之前索引内容 | 为什么移除 | 替代方案 |
|-----------|------------|-----------|---------|
| ~~outline~~ | content 前 2000 字 / summary | contextBuilder 用 DB 直查 content 全文 | `fetchMasterOutlineContent()` |
| ~~chapter~~ | 正文全文 | contextBuilder 用 DB 摘要链 | `fetchRecentSummaries()` |
| ~~summary~~ | AI 生成的章节摘要 | 同上 | 同上 |

### 4.3 写入端清单（清理后）

| 文件 | 操作 | 类型 |
|------|------|------|
| [novel-settings.ts](file:///d:/user/NovelForge/server/routes/novel-settings.ts) | POST / PUT | **setting** ✅ |
| [characters.ts](file:///d:/user/NovelForge/server/routes/characters.ts) | POST / PATCH | **character** ✅ |
| [foreshadowing.ts](file:///d:/user/NovelForge/server/routes/foreshadowing.ts) | POST / PUT / DELETE(deindex) | **foreshadowing** ✅ |
| [queue-handler.ts](file:///d:/user/NovelForge/server/queue-handler.ts) | reindex_all | **setting + character + foreshadowing** ✅ |
| [mcp/index.ts](file:///d:/user/NovelForge/server/mcp/index.ts) | bulkIndexNovels | **setting + character + foreshadowing** ✅ |
| [vectorize.ts](file:///d:/user/NovelForge/server/routes/vectorize.ts) | 手动 API | 全部类型保留（管理员手动操作） |

### 4.4 读取端清单

| 读取者 | sourceTypes | 用途 |
|--------|-----------|------|
| **contextBuilder.ts v4** | character, foreshadowing, **setting** | **章节生成上下文（核心消费者）** |
| agent.ts searchSemantic | 全部类型（无过滤） | Agent 自主决策辅助 |
| vectorize.ts search API | 全部类型（无过滤） | AiMonitor 手动搜索/调试 |
| mcp/index.ts searchSemantic | 全部类型（无过滤） | 外部 AI 工具调用 |

---

## 五、超时根治机制

### 5.1 单次 index_content 任务的最大 chunks

| sourceType | 索引文本大小 | chunkText(maxChunkLength=500) | 最大 chunks | MAX_INDEX_CHUNKS 硬顶 | 实际 chunks |
|-----------|------------|--------------------------|------------|---------------------|------------|
| setting | ≤400 字 (summary) | 1 | 1 | 8 | **1** |
| character | ≤350 字 | 1 | 1 | 8 | **1** |
| foreshadowing | ≤500 字 | 1 | 1 | 8 | **1** |

**最坏情况只有 1 个 chunk → 1 次 AI embed API 调用 → 绝不会超时。**

对比改造前的"天玄大陆总图":
- 改造前: 5000+ 字全文 → 12 chunks → 12 次 embed → **CPU 超时**
- 改造后: ~400 字 summary → **1 chunk → 1 次 embed → 安全完成**

### 5.2 双层防护

```
L1 源头截断（路由入队前）:
  setting:  content → autoSummary (≤400字符)
  character: desc → name+role+desc前300 (≤350字符)
  foreshadowing: description 原样 (本身<500字符)

L2 硬顶兜底（embedding.ts 内部）:
  MAX_INDEX_CHUNKS = 8
  超过时截断并 console.warn
```

---

## 六、Schema 变更

### 6.1 novelSettings 新增字段

```sql
-- server/db/schema.ts
summary: text('summary'),          -- 设定摘要（200~500字，用于 RAG 索引）

-- server/db/migrations/0008_setting_summary.sql
ALTER TABLE novel_settings ADD COLUMN summary TEXT;
CREATE INDEX idx_novel_settings_importance 
  ON novel_settings(novel_id, importance) WHERE deleted_at IS NULL;
```

### 6.2 自动生成 summary 时机

在 `novel-settings` 路由的 POST / PUT handler 中:
- 用户提供了 `body.summary` → 直接使用
- 未提供且 `content.length > 400` → 自动截取 `content.slice(0, 400)` 作为 summary
- 未来可升级为 LLM 异步生成

---

## 七、调试与监控

### 7.1 ContextBundle.debug 信息

每次调用 `buildChapterContext` 返回的 debug 对象包含:

```typescript
debug: {
  totalTokenEstimate: number      // 总 token 估算
  slotBreakdown: Record<string, number>  // 各槽 token 消耗明细
  ragQueriesCount: number          // RAG 查询次数（v4 固定为 2）
  buildTimeMs: number             // 构建耗时
  budgetTier: BudgetTier          // 使用的预算配置
  chapterTypeHint: string         // 推断的章节类型关键词
}
```

### 7.2 slotBreakdown 包含的 key

```
masterOutlineContent, volumeBlueprint, volumeEventLine,
prevChapterSummary, protagonistCards, activeRules,
summaryChain, characterCards, foreshadowing,
settings, chapterTypeRules
```

前端 AiMonitorPage 可直接展示这些数据用于调优。

---

## 八、v3 → v4 迁移对照

| 维度 | v3 | v4 | 变化原因 |
|------|----|----|---------|
| 总纲 | 可能空的 summary | content 全文（≤12k） | 256k 够用 |
| 角色 | RAG 返回 500字碎片 | RAG 返回 ID → DB 完整卡片 | 100+ 角色需要完整性 |
| 设定 | RAG 返回全文切块 | RAG 返回 summary（≤400字） | 根治超时 |
| 伏笔 | 仅 RAG 过滤 | 高优 DB 兜底 + RAG | 零遗漏 |
| 规则 | priority≤2 前5条 | 全部 isActive 规则 | 256k 够用 |
| 摘要链 | 默认 5 章 | 默认 20 章 | 连贯性 |
| 预算 | total=14k | total=55k | 利用窗口 |
| RAG 次数 | 3 次 | **2 次** | 去掉 character content 读 |
| 向量类型 | 6 种 | **3 种** | 聚焦上下文构建 |
| 单任务最大 chunks | 12+（超时） | **≤1** | 安全 |
