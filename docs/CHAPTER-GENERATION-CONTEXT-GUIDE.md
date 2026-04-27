# NovelForge 章节生成上下文构建 — 完整执行指南

> 版本: v4.3.0 | 模块: `server/services/contextBuilder.ts` + `server/routes/generate.ts`
> 前端页面: [NovelWorkspacePage.tsx](file:///d:/开发项目/NovelForge/src/pages/NovelWorkspacePage.tsx)（小说工作台）
> 创建日期: 2026-04-25 | 最后更新: 2026-04-27

---

## 一、功能概述

### 1.1 什么是章节生成上下文

章节生成上下文是 NovelForge 的**精准分槽上下文构建引擎**，在 AI 生成小说章节前，将小说相关的所有结构化数据（总纲、卷规划、角色、设定、伏笔等）组装为完整的 prompt 上下文，供 AI 模型参考。

**设计原则**: **DB 为主（完整数据）+ 向量为辅（语义检索 ID）**

### 1.2 核心能力

| 能力 | 说明 |
|------|------|
| **精准分槽** | 10 个独立槽位（Slot），每个槽位独立预算控制 |
| **智能 RAG** | 向量检索只负责"找相关 ID"，DB 提供完整数据 |
| **动态适配** | 根据章节类型（战斗/修炼/情感）动态匹配世界设定 |
| **高优兜底** | 高重要性伏笔 DB 直查，不依赖 RAG score |
| **节奏把控** | v4.1 新增创作进度统计，帮助 AI 均衡节奏 |
| **上下文预览** | 支持调试诊断，查看任意章节的完整上下文 |

### 1.3 上下文构建十槽体系

```
┌─────────────────────────────────────────────────────────────────┐
│                 章节生成上下文构建十槽体系                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  【Core 层 - 固定数据（DB 直查）】                               │
│  ┌─────────┬───────────────┬────────────────────────────────┐ │
│  │ Slot-0  │ 总纲           │ DB masterOutline.content 全文  │ │
│  │ Slot-1  │ 当前卷规划     │ DB volumes.blueprint+eventLine │ │
│  │ Slot-2  │ 上一章正文     │ DB chapters.content 完整内容    │ │
│  │ Slot-3  │ 主角状态卡     │ DB characters (protagonist)     │ │
│  │ Slot-4  │ 全部创作规则   │ DB writingRules (isActive=1)    │ │
│  │ Slot-10 │ 创作节奏把控   │ DB novels/volumes.wordCount     │ │
│  └─────────┴───────────────┴────────────────────────────────┘ │
│                                                                 │
│  【Dynamic 层 - 动态数据（RAG+DB）】                            │
│  ┌─────────┬───────────────┬────────────────────────────────┐ │
│  │ Slot-5  │ 出场角色卡     │ RAG(character)→DB完整卡片      │ │
│  │ Slot-6  │ 世界设定       │ RAG(setting).summary 分6槽     │ │
│  │ Slot-7  │ 待回收伏笔     │ DB高优兜底 + RAG普通伏笔        │ │
│  │ Slot-8  │ 本章类型规则   │ DB category匹配                │ │
│  │ Slot-9  │ 近期剧情摘要链 │ DB chapters.summary × 20章     │ │
│  └─────────┴───────────────┴────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

---

## 二、架构总览

### 2.1 调用入口

```
生成章节流程入口：
  NovelWorkspacePage.tsx → api.streamGenerate()
    └─→ POST /api/generate/chapter (SSE 流式)
         └─→ generation.ts generateChapter()
              └─→ buildChapterContext(env, novelId, chapterId)
                   └─→ assemblePromptContext(bundle)
                        └→ 返回完整 prompt 字符串（~100-120k tokens）

诊断预览入口：
  POST /api/generate/preview-context
    └─→ buildChapterContext(env, novelId, chapterId)
         └─→ 返回 ContextBundle（含 debug 信息）
```

**核心文件**: [generation.ts](file:///d:/开发项目/NovelForge/server/services/agent/generation.ts)（实际入口）
> 注: [agent.ts](file:///d:/开发项目/NovelForge/server/services/agent.ts)仅为向后兼容的重新导出

### 2.2 数据流全景

```
buildChapterContext(env, novelId, chapterId)
│
├── Step 0: DB 查当前章节基础信息（volumeId, sortOrder, title）
│
├── Step 1: Core 层（8 个 DB 查询，Promise.all 并发）
│   ├── [DB] 总纲 content 全文（≤12k 字）或 summary
│   ├── [DB] 当前卷 blueprint + eventLine
│   ├── [DB] 上一章正文（完整内容，非摘要）
│   ├── [DB] 主角完整状态卡（name+desc+attr+powerLevel）
│   ├── [DB] 全部活跃创作规则（isActive=1，不限 priority）
│   ├── [DB] 最近 20 章 summaries（摘要链）
│   └── [DB] 创作节奏把控（novels.wordCount + volumes.wordCount）⭐v4.1新增
│
├── Step 2: 组装查询向量
│   └─ embedText(AI, eventLine + prevContent + chapterTitle) → queryVector
│      （注：prevContent 为上一章完整正文内容，非摘要）
│
├── Step 3: Dynamic 层（3 次 RAG 并发 + 多次 DB 补查）
│   │
│   ├── RAG #1: searchSimilar(sourceType='character', topK=15)
│   │   └─→ 取 sourceId 列表 → DB IN 查完整卡片 → 组装 name+role+desc+attr+powerLevel
│   │
│   ├── RAG #2: searchSimilar(sourceType='foreshadowing', topK=10)
│   │   ├─→ 路径A: DB 直查 importance='high' AND status='open'（无条件注入）
│   │   └─→ 路径B: RAG score > 0.42 AND status=open（普通伏笔）
│   │
│   └── RAG #3: searchSimilar(sourceType='setting', topK=20)
│       ├─→ 用 metadata.content（即 summary 字段）作为上下文
│       ├─→ 按 settingType 分 6 槽独立预算
│       └─→ importance='high' 的额外追加了 DB content 全文
│
├── Step 4: Core Token 预算检查
│   └─ 超预算时从尾部弹出规则项（规则优先级最低）
│
└── Step 5: 返回 ContextBundle（含诊断信息）
    └─→ assemblePromptContext() → 最终 prompt 字符串
```

### 2.3 预算分配 v4.1

| 槽位 | 层级 | 预算 (tokens) | 数据来源 |
|------|------|--------------|---------|
| 总纲 (Slot-0) | L0 Core | ≤12000 | DB masterOutline.content |
| 卷规划 (Slot-1) | L0 Core | ≤2000 | DB volumes.{blueprint,eventLine} |
| **创作节奏把控 (Slot-10)** | L0 Core | ≤500 | **DB novels.wordCount + volumes.wordCount** ⭐v4.1新增 |
| 上一章正文 (Slot-2) | L0 Core | ≤8000 | DB chapters.content（完整内容） |
| 主角卡 (Slot-3) | L0 Core | ≤3000 | DB characters(protagonist) |
| 创作规则 (Slot-4) | L0 Core | ≤8000 | DB writingRules(isActive=1) |
| **Core 小计** | | **≤42500** | |
| 摘要链 (Slot-9) | L1 Dynamic | ≤25000 | DB chapters.summary × 20 |
| 出场角色 (Slot-5) | L2 Dynamic | ≤20000 | RAG(character) → DB 完整卡片 |
| 世界设定 (Slot-6) | L2 Dynamic | ≤25000 | RAG(setting).summary + high优全文 |
| 待回收伏笔 (Slot-7) | L2 Dynamic | ≤10000 | DB高优兜底 + RAG(foreshadowing) |
| 本章规则 (Slot-8) | L2 Dynamic | ≤8000 | DB writingRules(category匹配) |
| **总计** | | **≤128000** (~90k 中文字) | |

---

## 三、API 接口详解

### 3.1 接口列表

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/generate/chapter` | 生成章节内容（SSE 流式） |
| `POST` | `/api/generate/preview-context` | 预览章节上下文（诊断调试） |
| `POST` | `/api/generate/master-outline-summary` | 生成总纲摘要 |
| `POST` | `/api/generate/volume-summary` | 生成卷摘要 |
| `POST` | `/api/generate/next-chapter` | 生成下一章标题和摘要 |
| `POST` | `/api/generate/coherence-check` | 章节连贯性检查 |
| `POST` | `/api/generate/consistency-check` | 角色一致性检查 |

### 3.2 生成章节

**请求**
```json
POST /api/generate/chapter
{
  "chapterId": "章节ID",
  "novelId": "小说ID",
  "mode": "generate | continue | rewrite",
  "targetWords": 3000,
  "options": {
    "enableRAG": true,
    "enableAutoSummary": true
  }
}
```

**响应**：SSE 流式响应

```
data: {"content": "AI 生成的第一段文字"}

data: {"content": "AI 生成的第二段文字"}

data: {"type": "tool_call", "name": "tool_name", "args": {...}, "result": "..."}

data: {"type": "done", "wordCount": 3200, "summary": "章节摘要..."}

data: [DONE]
```

**mode 参数说明**：
| 模式 | 说明 |
|------|------|
| `generate` | 全新生成（默认） |
| `continue` | 续写（在现有内容后继续） |
| `rewrite` | 重写（替换现有内容） |

### 3.3 预览上下文

**请求**
```json
POST /api/generate/preview-context
{
  "novelId": "小说ID",
  "chapterId": "章节ID"
}
```

**响应**
```json
{
  "ok": true,
  "contextBundle": {
    "core": {
      "masterOutlineContent": "总纲内容...",
      "volumeBlueprint": "卷蓝图...",
      "volumeEventLine": "事件线...",
      "prevChapterContent": "上一章正文...",
      "protagonistStateCards": ["主角状态卡..."],
      "allActiveRules": ["[文风] ...", "[节奏] ..."],
      "rhythmStats": {
        "novelWordCount": 500000,
        "novelTargetWordCount": 1000000,
        "volumeWordCount": 80000,
        "volumeTargetWordCount": 150000,
        "volumeChapterCount": 25,
        "volumeTargetChapterCount": 30,
        "currentChapterInVolume": 12
      }
    },
    "dynamic": {
      "summaryChain": ["[第1章 ...] 摘要...", "..."],
      "characterCards": ["【角色名】(role) ...", "..."],
      "relevantForeshadowing": ["【伏笔名】(高重要性) ...", "..."],
      "relevantSettings": {
        "worldRules": ["..."],
        "powerSystem": ["..."],
        "geography": ["..."],
        "factions": ["..."],
        "artifacts": ["..."],
        "misc": ["..."]
      },
      "chapterTypeRules": ["[节奏] ...", "..."]
    },
    "debug": {
      "totalTokenEstimate": 85000,
      "slotBreakdown": {
        "masterOutlineContent": 8000,
        "volumeBlueprint": 500,
        "volumeEventLine": 800,
        "prevChapterContent": 6000,
        "protagonistCards": 1200,
        "activeRules": 3500,
        "summaryChain": 15000,
        "characterCards": 8000,
        "foreshadowing": 3000,
        "settings": 12000,
        "chapterTypeRules": 1000
      },
      "ragQueriesCount": 3,
      "buildTimeMs": 450,
      "budgetTier": {...},
      "chapterTypeHint": "战斗,修炼",
      "queryText": "第42章 突破\n从炼气境三层突破至四层，丹田真气充盈...\n林岩",
      "ragRawResults": {
        "characters": [
          {"sourceType": "character", "sourceId": "xxx", "score": 0.89, "content": "林岩...", "metadata": {...}}
        ],
        "foreshadowing": [...],
        "settings": [...]
      }
    }
  },
  "buildTimeMs": 450,
  "summary": {
    "totalLayers": 11,
    "coreLayerCount": 7,
    "dynamicLayerCount": 4,
    "ragResultCount": 3
  }
}
```

### 3.4 ContextBundle 类型定义

**文件位置**: [contextBuilder.ts:53-107](file:///d:/开发项目/NovelForge/server/services/contextBuilder.ts#L53-L107)

```typescript
export interface ContextBundle {
  core: {
    masterOutlineContent: string      // 总纲内容
    volumeBlueprint: string           // 卷蓝图
    volumeEventLine: string            // 事件线
    prevChapterContent: string        // 上一章正文
    protagonistStateCards: string[]   // 主角状态卡
    allActiveRules: string[]          // 全部活跃规则
    rhythmStats: RhythmStats | null   // 创作节奏统计
  }
  dynamic: {
    summaryChain: string[]            // 近期剧情摘要链
    characterCards: string[]          // 本章出场角色
    relevantForeshadowing: string[]   // 待回收伏笔
    relevantSettings: SlottedSettings // 分槽世界设定
    chapterTypeRules: string[]       // 本章类型规则
  }
  debug: {
    totalTokenEstimate: number         // 总 token 估算
    slotBreakdown: Record<string, number>  // 各槽消耗明细
    ragQueriesCount: number           // RAG 查询次数
    buildTimeMs: number               // 构建耗时
    budgetTier: BudgetTier            // 使用的预算配置
    chapterTypeHint: string           // 推断的章节类型
    queryText: string                 // RAG 查询文本 (v4.3 新增)
    ragRawResults: {                  // RAG 原始结果 (v4.3 新增)
      characters: RagRawResult[]
      foreshadowing: RagRawResult[]
      settings: RagRawResult[]
    }
  }
}

export interface RagRawResult {
  sourceType: string
  sourceId: string
  score: number
  content: string
  metadata: Record<string, any>
}

export interface SlottedSettings {
  worldRules: string[]   // 世界法则
  powerSystem: string[]  // 境界体系
  geography: string[]     // 地理环境
  factions: string[]      // 势力组织
  artifacts: string[]     // 宝物功法
  misc: string[]          // 其他设定
}

export interface RhythmStats {
  novelWordCount: number
  novelTargetWordCount: number | null
  volumeWordCount: number
  volumeTargetWordCount: number | null
  volumeChapterCount: number
  volumeTargetChapterCount: number | null
  currentChapterInVolume: number
}

export interface BudgetTier {
  core: number
  summaryChain: number
  characters: number
  foreshadowing: number
  settings: number
  rules: number
  total: number
}
```

---

## 四、各槽位详细执行逻辑

### 4.1 Slot-0: 总纲 (`fetchMasterOutlineContent`)

**文件位置**: [contextBuilder.ts:558-580](file:///d:/开发项目/NovelForge/server/services/contextBuilder.ts#L558-L580)

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

### 4.2 Slot-1: 当前卷规划 (`fetchVolumeInfo`)

**文件位置**: [contextBuilder.ts:582-595](file:///d:/开发项目/NovelForge/server/services/contextBuilder.ts#L582-L595)

**执行步骤**:
1. 用 `volumeId` 查 `volumes` 表
2. 返回 `{ blueprint, eventLine }` 两个字段

**无向量** — 结构化数据，固定 1 条。

---

### 4.3 Slot-10: 创作节奏把控 (`fetchRhythmStats`) ⭐ v4.1 新增

**文件位置**: [contextBuilder.ts:597-643](file:///d:/开发项目/NovelForge/server/services/contextBuilder.ts#L597-L643)

**v4.1 新增**: 向 AI 注入小说和卷的字数统计信息，帮助 AI 把控创作节奏。

**执行步骤**:
1. DB 查询小说表: `wordCount`, `targetWordCount`
2. DB 查询卷表: `wordCount`, `targetWordCount`, `chapterCount`, `targetChapterCount`
3. DB 统计本章在卷中的序号: `COUNT(*) WHERE sortOrder <= currentSortOrder`

**输出内容**:
```
## 创作节奏把控
- 小说进度：已写 {novelWordCount} / {novelTargetWordCount} 字
- 本卷进度：第 {currentChapterInVolume} / {volumeTargetChapterCount} 章（已写 {volumeWordCount} / {volumeTargetWordCount} 字）
- 字数进度：{wordPct}%
- 章节进度：{chapterPct}%
- 注意：保持节奏均衡，避免前期过于拖沓或后期赶工
```

---

### 4.4 Slot-2: 上一章正文 (`fetchPrevChapterContent`) ⭐ v4.1 变更

**文件位置**: [contextBuilder.ts:645-664](file:///d:/开发项目/NovelForge/server/services/contextBuilder.ts#L645-L664)

**v4.1 变更**: 从"上一章摘要"改为"上一章正文完整内容"，预算从 500 提升到 8000 tokens。

**执行步骤**:
1. 查 `chapters` 表：`sortOrder < currentSortOrder`，取最近 1 条
2. 返回 `[上一章: {title}]\n{content}`（完整正文内容）

**原因**: AI 生成新章节时需要参考上一章的文风、叙事节奏、具体情节走向，摘要信息不足。

---

### 4.5 Slot-3: 主角状态卡 (`fetchProtagonistCards` + `fetchProtagonistPowerLevel`)

**文件位置**:
- [fetchProtagonistCards: 689-702](file:///d:/开发项目/NovelForge/server/services/contextBuilder.ts#L689-L702)
- [fetchProtagonistPowerLevel: 704-727](file:///d:/开发项目/NovelForge/server/services/contextBuilder.ts#L704-L727)
- [mergeProtagonistAndPower: 729-745](file:///d:/开发项目/NovelForge/server/services/contextBuilder.ts#L729-L745)

**执行步骤**:
1. `fetchProtagonistCards`: DB 查 `characters WHERE role='protagonist'`
2. `fetchProtagonistPowerLevel`: DB 查主角的 `powerLevel` JSON 字段
3. `mergeProtagonistAndPower`: 合并为完整卡片

**输出格式**:
```
【林岩（主角）】
{description}
属性：年龄: 16 | 性格: 坚毅隐忍
当前境界：炼气境三层，下一目标：筑基期
```

**无向量** — 主角是固定的少数几人，DB 直接查。

---

### 4.6 Slot-4: 创作规则 (`fetchAllActiveRules`)

**文件位置**: [contextBuilder.ts:750-768](file:///d:/开发项目/NovelForge/server/services/contextBuilder.ts#L750-L768)

**v4 变更**: 不再限制 `priority <= 2`，取全部 `isActive=1` 的规则。

**执行步骤**:
1. DB 查 `writingRules WHERE isActive=1 AND deletedAt IS NULL`
2. 按 `priority ASC` 排序
3. 格式化为 `[分类] 标题\n内容`

**分类标签映射**:
| category | 标签 |
|----------|------|
| `style` | 文风 |
| `pacing` | 节奏 |
| `character` | 人物 |
| `plot` | 情节 |
| `world` | 世界观 |
| `taboo` | 禁忌 |
| `custom` | 自定义 |

**原因**: 256k 窗口放得下全部 20-50 条规则（每条约 200 字 ≈ 13k tokens）。

---

### 4.7 Slot-9: 近期剧情摘要链 (`fetchRecentSummaries`)

**文件位置**: [contextBuilder.ts:666-687](file:///d:/开发项目/NovelForge/server/services/contextBuilder.ts#L666-L687)

**v4 变更**: 默认从 5 章扩展到 **20 章**，上限 30 章。

**执行步骤**:
1. DB 查询: `chapters WHERE sortOrder < currentSortOrder AND summary IS NOT NULL AND summary != ''`
2. 按 sortOrder DESC 取 N 条
3. 反转（时间正序）→ `[第N章 {title}] {summary}`

**无向量** — 摘要链需要严格的时间顺序和完整性，DB ORDER BY 即可。

---

### 4.8 Slot-5: 出场角色卡 (`buildCharacterSlotFromDB`) ⭐ 核心改动

**文件位置**: [contextBuilder.ts:314-376](file:///d:/开发项目/NovelForge/server/services/contextBuilder.ts#L314-L376)

**这是 v4 最大架构变化** — 从"RAG 返回 chunk 碎片"改为"RAG 找 ID → DB 查完整卡片"。

**执行流程**:
```
输入: ragResults (来自 searchSimilar(sourceType='character', topK=15))
  │
  ├─ 1. 过滤: score >= 0.38（阈值较低，因为后续要取完整数据）
  ├─ 2. 排序: 按 score 降序
  ├─ 3. 截断: 取前 6 个 sourceId
  │
  ├─ 4. DB 批量查询（一次 IN 查询）:
  │     SELECT id, name, role, description, attributes, powerLevel, aliases
  │     FROM characters WHERE id IN (candidateIds)
  │
  ├─ 5. 按 RAG score 重排序（保持相关性顺序）
  │
  └─ 6. 组装完整卡片:
        【{name}】({role})
        别名: {aliases}
        {description}
        属性: k1: v1 | k2: v2
        当前境界: {current}，下一目标: {nextMilestone}
```

**v4.1 变更**: MAX_CHARACTERS 从 8 调整为 6，score 阈值从 0.50 调整为 0.38。

**性能保证**: 即使小说有 200 个角色：
- RAG 先筛到 top 15（语义相关）
- DB 只查这 15 条
- 最终只组装 6 个

**向量存什么**: 仅 `name + role + description前300字`（约 350 字 ≤ 1 chunk），用于 RAG 识别"谁可能出场"。

---

### 4.9 Slot-6: 世界设定 (`buildSettingsSlotV2`) ⭐ 配合新 summary 字段

**文件位置**: [contextBuilder.ts:442-549](file:///d:/开发项目/NovelForge/server/services/contextBuilder.ts#L442-L549)

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
  │     │   worldRules:  budget=2500  threshold=0.42
  │     │   powerSystem: budget=2500  threshold=0.42
  │     │   geography:   hasLocation? budget=1500 threshold=0.45
  │     │   factions:    hasFaction? budget=1200 threshold=0.45
  │     │   artifacts:   hasArtifact? budget=800 threshold=0.45
  │     │   misc:        budget=800 threshold=0.48
  │     │
  │     └─ 对每个结果 r:
  │         ├─ 判断所属 slotKey
  │         ├─ score < threshold → 跳过
  │         ├─ 使用 r.metadata.content（即 summary 字段值）
  │         └─ 超出 slotBudget → 跳过
  │
  ├─ Phase 2: 高重要性设定追加全文
  │     ├─ 收集 importance='high' AND score>=0.38 的 sourceId 列表
  │     ├─ DB 批量查询: SELECT id, name, type, content FROM novelSettings WHERE id IN (...)
  │     └─ 追加到对应槽: `【name·完整设定】\n{content全文}`
  │        （允许超出原 budget 的 1.5 倍作为缓冲）
  │
  └─ 返回 SlottedSettings (6 个子槽的字符串数组)
```

**章节类型动态开关**:
- `hasLocation`: eventLine/chapterTitle 含"地点/场景/地图/城市/宗门/山/洞/界/域..." → geography 槽开启
- `hasFaction`: 含"门派/势力/宗门/家族/王朝/组织..." → factions 槽开启
- `hasArtifact`: 含"法宝/功法/秘法/神通/道具/丹药/宝物..." → artifacts 槽开启

**v4.1 变更**: 阈值全面下调（从 0.55/0.70/0.68/0.72 调整为 0.42-0.48），适应更大预算窗口。

---

### 4.10 Slot-7: 待回收伏笔 (`buildForeshadowingHybrid`) ⭐ 双路合并

**文件位置**: [contextBuilder.ts:383-435](file:///d:/开发项目/NovelForge/server/services/contextBuilder.ts#L383-L435)

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
  │       └─ score > 0.42
  │   → 输出格式: metadata.content（原始描述文本）
  │
  └─ 合并排序: 路径A 优先（priority=0），路径B 按 score 排（priority=1）
      → 整体受 budgetTokens 截断
```

**设计理由**: 高重要性伏笔对剧情连贯性至关重要，不能因为 AI embed 的 score 波动而漏掉。DB 兜底确保零遗漏。

**v4.1 变更**: 普通伏笔阈值从 0.55 调整为 0.42。

---

### 4.11 Slot-8: 本章类型规则 (`fetchChapterTypeRules`)

**文件位置**: [contextBuilder.ts:770-802](file:///d:/开发项目/NovelForge/server/services/contextBuilder.ts#L770-L802)

**执行步骤**:
1. 从 `chapterTypeHint`（eventLine + chapterTitle 推断）提取关键词
2. 关键词 → 映射到 rule category
3. DB 查询: `writingRules WHERE category IN (...)`
4. 按 priority 排序，limit 8

**章节类型推断关键词 v4.1**:
| 类型 | 关键词 |
|------|--------|
| 战斗 | 战斗, 对决, 厮杀, 激战, 争锋, 大战, 交手, 击败, 击杀 |
| 修炼 | 修炼, 突破, 感悟, 闭关, 突破境界, 升阶, 晋升 |
| 门派/势力 | 宗门, 门派, 家族, 势力, 王朝, 组织, 帮派 |
| 法宝 | 法宝, 功法, 秘法, 神通, 丹药, 灵丹, 宝物, 炼丹 |
| 地点/场景 | 进入, 来到, 抵达, 山峰, 洞府, 城市, 大陆, 界域 |
| 情感/人际 | 情感, 相遇, 离别, 重逢, 感情, 师徒, 师兄 |

**注意**: 此槽与 Slot-4（全部规则）的区别:
- Slot-4: 注入**所有**核心规则（全局准则）
- Slot-8: 注入与**本章类型特别相关**的补充规则

---

## 五、assemblePromptContext 输出格式

**文件位置**: [contextBuilder.ts:871-933](file:///d:/开发项目/NovelForge/server/services/contextBuilder.ts#L871-L933)

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

## 创作节奏把控 ⭐ v4.1 新增
- 小说进度：已写 {novelWordCount} / {novelTargetWordCount} 字
- 本卷进度：第 {currentChapterInVolume} / {volumeTargetChapterCount} 章（已写 {volumeWordCount} / {volumeTargetWordCount} 字）
- 字数进度：{wordPct}%
- 章节进度：{chapterPct}%
- 注意：保持节奏均衡，避免前期过于拖沓或后期赶工

## 上一章正文
[上一章: 第42章 林岩离山]
{content 完整正文}

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
别名: {aliases}
{完整角色卡}
属性: k1: v1 | k2: v2
当前境界: {current}，下一目标: {nextMilestone}

【王胖子】(配角/挚友)
...
（6 个）

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

【场景地理】
{setting summary}

【相关势力】
{setting summary}

【相关法宝】
{setting summary}

【其他设定】
{setting summary}

【完整设定】(high-importance setting full text)
{setting full content}
...

## 本章创作指引
[节奏] 战斗章节需紧凑
{rule content}
...
```

---

## 六、向量索引精确定义（仅 3 种）

### 6.1 向量索引范围（清理后）

v4 清理后，**只有以下 3 种类型的向量索引用于章节生成上下文**:

| sourceType | 索引内容 | 大小 | 触发时机 | 上下文中用途 |
|-----------|---------|------|---------|------------|
| **character** | `name + role + description前300字` | ~350 字 (≤1 chunk) | 创建/更新角色时 | RAG 找出场角色 ID → DB 查完整卡片 |
| **setting** | `novelSettings.summary` (≤400字) | ~400 字 (≤1 chunk) | 创建/更新设定时 | RAG 返回 summary 直接当上下文 |
| **foreshadowing** | `title + description` 原样 | ~200-500 字 (≤1 chunk) | 创建/更新伏笔时 | RAG 过滤 + 高优 DB 兜底 |

### 6.2 已移除的索引类型（不再触发）

| sourceType | 之前索引内容 | 为什么移除 | 替代方案 |
|-----------|------------|-----------|--------|
| ~~outline~~ | content 前 2000 字 / summary | contextBuilder 用 DB 直查 content 全文 | `fetchMasterOutlineContent()` |
| ~~chapter~~ | 正文全文 | contextBuilder 用 DB 摘要链 | `fetchRecentSummaries()` |
| ~~summary~~ | AI 生成的章节摘要 | 同上 | 同上 |

### 6.3 写入端清单（清理后）

| 文件 | 操作 | 类型 |
|------|------|------|
| [novel-settings.ts](file:///d:/开发项目/NovelForge/server/routes/novel-settings.ts) | POST / PUT | **setting** ✅ |
| [characters.ts](file:///d:/开发项目/NovelForge/server/routes/characters.ts) | POST / PATCH | **character** ✅ |
| [foreshadowing.ts](file:///d:/开发项目/NovelForge/server/routes/foreshadowing.ts) | POST / PUT / DELETE(deindex) | **foreshadowing** ✅ |
| [queue-handler.ts](file:///d:/开发项目/NovelForge/server/queue-handler.ts) | reindex_all | **setting + character + foreshadowing** ✅ |
| [mcp/index.ts](file:///d:/开发项目/NovelForge/server/mcp/index.ts) | bulkIndexNovels | **setting + character + foreshadowing** ✅ |
| [vectorize.ts](file:///d:/开发项目/NovelForge/server/routes/vectorize.ts) | 手动 API | 全部类型保留（管理员手动操作） |

### 6.4 读取端清单

| 读取者 | sourceTypes | 用途 |
|--------|-----------|------|
| **contextBuilder.ts v4** | character, foreshadowing, **setting** | **章节生成上下文（核心消费者）** |
| agent.ts searchSemantic | 全部类型（无过滤） | Agent 自主决策辅助 |
| vectorize.ts search API | 全部类型（无过滤） | AiMonitor 手动搜索/调试 |
| mcp/index.ts searchSemantic | 全部类型（无过滤） | 外部 AI 工具调用 |

---

## 七、超时根治机制

### 7.1 单次 index_content 任务的最大 chunks

| sourceType | 索引文本大小 | chunkText(maxChunkLength=500) | 最大 chunks | MAX_INDEX_CHUNKS 硬顶 | 实际 chunks |
|-----------|------------|--------------------------|------------|---------------------|------------|
| setting | ≤400 字 (summary) | 1 | 1 | 8 | **1** |
| character | ≤350 字 | 1 | 1 | 8 | **1** |
| foreshadowing | ≤500 字 | 1 | 1 | 8 | **1** |

**最坏情况只有 1 个 chunk → 1 次 AI embed API 调用 → 绝不会超时。**

对比改造前的"天玄大陆总图":
- 改造前: 5000+ 字全文 → 12 chunks → 12 次 embed → **CPU 超时**
- 改造后: ~400 字 summary → **1 chunk → 1 次 embed → 安全完成**

### 7.2 双层防护

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

## 八、模型配置要求

### 8.1 必须配置

章节生成依赖 AI 模型进行内容生成。需要配置以下用途的模型：

| 优先级 | 用途标识 | 说明 |
|--------|----------|------|
| 必须 | `chapter_gen` | 章节内容生成（核心） |

### 8.2 配置位置

在全局模型配置页面（`/model-config`）添加配置。

### 8.3 配置内容

- **提供商**（如 OpenAI / Claude / 自定义）
- **模型 ID**（如 `gpt-4o`、`claude-sonnet-4-20250514`）
- **API Key**
- **用途**选择 `chapter_gen`

### 8.4 错误处理

如果未配置模型，API 会返回详细错误信息：
```
❌ 未配置"章节生成"模型！

请在全局模型配置页面（/model-config）添加配置：
- 用途选择"章节生成"(chapter_gen)
```

---

## 九、工作流程示例

### 9.1 标准章节生成流程

```
步骤 1：打开小说工作台
   └─ 进入 NovelWorkspacePage
   └─ 选择目标小说和章节

步骤 2：点击生成按钮
   └─ 前端调用 api.streamGenerate(chapterId, novelId, options)
   └─ POST /api/generate/chapter (SSE 流式)

步骤 3：后端构建上下文
   └─ buildChapterContext(env, novelId, chapterId)
   └─ Step 1: 8 个 Core 层 DB 查询（Promise.all 并发）
   └─ Step 2: 生成查询向量 embedText()
   └─ Step 3: 3 次 RAG 查询 + DB 补查
   └─ Step 4: 预算检查与调整
   └─ Step 5: 返回 ContextBundle

步骤 4：AI 流式生成
   └─ assemblePromptContext(bundle) 组装完整 prompt
   └─ AI 模型流式输出章节内容
   └─ 前端实时渲染 SSE 数据

步骤 5：生成完成
   └─ 自动保存章节内容到数据库
   └─ 自动生成章节摘要（enableAutoSummary=true）
   └─ 更新小说/卷字数统计
```

### 9.2 上下文诊断流程

```
步骤 1：进入上下文诊断
   └─ 打开小说工作台的"上下文诊断"面板
   └─ 选择目标章节

步骤 2：预览上下文
   └─ POST /api/generate/preview-context
   └─ 返回完整 ContextBundle

步骤 3：查看诊断信息
   └─ totalTokenEstimate: 总 token 估算
   └─ slotBreakdown: 各槽消耗明细
   └─ ragQueriesCount: RAG 查询次数
   └─ buildTimeMs: 构建耗时
   └─ chapterTypeHint: 推断的章节类型

步骤 4：调整优化
   └─ 根据诊断信息调整创作规则
   └─ 优化世界设定 summary
   └─ 重新生成上下文预览验证
```

---

## 十、调试与监控

### 10.1 ContextBundle.debug 信息

每次调用 `buildChapterContext` 返回的 debug 对象包含:

```typescript
debug: {
  totalTokenEstimate: number      // 总 token 估算
  slotBreakdown: Record<string, number>  // 各槽 token 消耗明细
  ragQueriesCount: number          // RAG 查询次数（实际执行 3 次：character/foreshadowing/setting）
  buildTimeMs: number             // 构建耗时
  budgetTier: BudgetTier          // 使用的预算配置
  chapterTypeHint: string         // 推断的章节类型关键词
  queryText: string               // RAG 查询文本 (v4.3 新增)
  ragRawResults: RagRawResult[]   // RAG 原始结果，包含 score/metadata (v4.3 新增)
}
```

### 10.2 slotBreakdown 包含的 key

```
masterOutlineContent, volumeBlueprint, volumeEventLine,
prevChapterContent, protagonistCards, activeRules,
summaryChain, characterCards, foreshadowing,
settings, chapterTypeRules
```

前端 AiMonitorPage 可直接展示这些数据用于调优。

---

## 十一、Schema 变更

### 11.1 novelSettings 新增字段

```sql
-- server/db/schema.ts
summary: text('summary'),          -- 设定摘要（200~500字，用于 RAG 索引）

-- server/db/migrations/0008_setting_summary.sql
ALTER TABLE novel_settings ADD COLUMN summary TEXT;
CREATE INDEX idx_novel_settings_importance
  ON novel_settings(novel_id, importance) WHERE deleted_at IS NULL;
```

### 11.2 自动生成 summary 时机

在 `novel-settings` 路由的 POST / PUT handler 中:
- 用户提供了 `body.summary` → 直接使用
- 未提供且 `content.length > 400` → 自动截取 `content.slice(0, 400)` 作为 summary
- 未来可升级为 LLM 异步生成

---

## 十二、v3 → v4 → v4.1 → v4.2 → v4.3 迁移对照

| 维度 | v3 | v4 | v4.1 | v4.2 | v4.3 | 变化原因 |
|------|----|----|------|------|------|---------|
| 总纲 | 可能空的 summary | content 全文（≤12k） | **不变** | **不变** | **不变** | 256k 够用 |
| 上一章 | context 摘要 | context 摘要 | **正文完整内容（≤8k）** | **不变** | **不变** | 摘要信息不足 |
| 角色 | RAG 返回 500字碎片 | RAG 返回 ID → DB 完整卡片 | **阈值 0.50→0.38, MAX 8→6** | **阈值 0.38→0.45, 排除主角** | **不变** | 优化检索+避免重复 |
| 设定 | RAG 返回全文切块 | RAG 返回 summary（≤400字） | **阈值全面下调 0.55-0.72→0.42-0.48** | **Slot预算精细化** | **不变** | 适应更大预算 |
| 伏笔 | 仅 RAG 过滤 | 高优 DB 兜底 + RAG | **阈值 0.55→0.42** | **按创建时间排序，高优限制10→15** | **不变** | 优先召回近期插入 |
| 规则 | priority≤2 前5条 | 全部 isActive 规则 | **不变** | **新增fetchAllActiveRuleIds，Slot-8自动排除已注入规则** | **不变** | 避免重复注入 |
| 摘要链 | 默认 5 章 | 默认 20 章 | **不变** | **不变** | **不变** | 连贯性 |
| **创作节奏** | 无 | 无 | **新增 Slot-10** | **不变** | **不变** | 帮助 AI 均衡节奏 |
| 预算 | total=14k | total=55k | **total=128k** | **不变** | **不变** | 利用窗口 |
| RAG查询 | 整卷eventLine+整章正文 | 整卷eventLine+整章正文 | **不变** | **不变** | **聚焦当前章节语义，≤800字** | 提升检索精度 |
| RAG 次数 | 3 次 | **3 次** | **不变** | **不变** | **不变** | character/setting/foreshadowing 均保留 |
| 向量类型 | 6 种 | **3 种** | **不变** | **不变** | **不变** | 聚焦上下文构建 |
| 单任务最大 chunks | 12+（超时） | **≤1** | **不变** | **不变** | **不变** | 安全 |
| Slot过滤 | 无 | 无 | 无 | **新增slotFilter选项** | **不变** | 按需组合不同Slot |
| **调试信息** | 无 | 无 | 无 | 无 | **新增queryText+ragRawResults** | 诊断RAG召回质量 |

---

## 十三、DEFAULT_BUDGET v4.1 完整配置

```typescript
// 文件位置: contextBuilder.ts:113-121
export const DEFAULT_BUDGET: BudgetTier = {
  core: 40000,          // Core 层总预算
  summaryChain: 25000,  // 摘要链预算
  characters: 20000,    // 出场角色预算
  foreshadowing: 10000, // 伏笔预算
  settings: 25000,      // 世界设定预算
  rules: 8000,         // 本章类型规则预算
  total: 128000,        // 全部预算上限
}
```

**使用方式**: 调用 `buildChapterContext(env, novelId, chapterId)` 时不传 budget 参数则使用 DEFAULT_BUDGET，也可传入自定义 BudgetTier 覆盖特定槽预算。

---

## 十四、常见问题

### Q1: 生成的章节内容与前文不连贯怎么办？
**A**: 检查以下几项：
1. 确认上一章正文是否已保存（Slot-2 需要上一章 content）
2. 查看摘要链是否完整（Slot-9 默认 20 章）
3. 使用 `/api/generate/preview-context` 诊断上下文构建情况
4. 调整创作规则中的"连贯性"要求

### Q2: 角色出场混乱或忘记之前设定怎么办？
**A**: 检查以下几项：
1. 确认主角状态卡（Slot-3）信息正确
2. 查看出场角色卡（Slot-5）是否包含正确角色
3. 检查角色创作规则是否设置了"人物一致性"要求
4. 使用角色一致性检查 API 验证

### Q3: 世界设定没有正确关联到章节怎么办？
**A**: 检查以下几项：
1. 确认世界设定已填写 `summary` 字段（用于 RAG 索引）
2. 查看章节的事件线和标题是否包含设定类型关键词
3. 检查 `importance` 是否为 `high`（高重要性会强制注入全文）
4. 调整 RAG score 阈值（当前默认为 0.42-0.48）

### Q4: 伏笔没有回收怎么办？
**A**: 检查以下几项：
1. 确认伏笔 `status` 为 `open`（未关闭）
2. 检查伏笔 `importance` 是否为 `high`（高重要性有 DB 兜底）
3. 查看待回收伏笔槽（Slot-7）是否包含目标伏笔
4. 确保伏笔关联的章节 sortOrder 小于当前章节

### Q5: token 预算超限导致内容被截断怎么办？
**A**: 可以采取以下措施：
1. 减少摘要链长度（默认 20 章，可减少到 10-15 章）
2. 精简创作规则，移除低优先级规则
3. 缩短世界设定的 summary 字段
4. 使用自定义 BudgetTier 调整各槽预算

### Q6: 如何调试上下文构建问题？
**A**: 使用诊断端点：
```bash
POST /api/generate/preview-context
{
  "novelId": "小说ID",
  "chapterId": "章节ID"
}
```
返回的 `debug` 对象包含详细的槽位消耗和 RAG 查询信息。

### Q7: 章节类型推断不准确怎么办？
**A**: 章节类型根据 eventLine 和 chapterTitle 推断。可以：
1. 优化卷的事件线，包含明确的类型关键词
2. 优化章节标题，包含明确的类型关键词
3. 手动在 Slot-8（本章类型规则）中添加相关规则

### Q8: 创作节奏把控显示的信息不准确怎么办？
**A**: 检查以下数据：
1. `novels.wordCount` - 小说已写字数
2. `novels.targetWordCount` - 小说目标字数
3. `volumes.wordCount` - 卷已写字数
4. `volumes.targetWordCount` - 卷目标字数
5. `volumes.chapterCount` / `volumes.targetChapterCount` - 章节数

---

## 十五、文件索引

| 文件 | 说明 |
|------|------|
| [contextBuilder.ts](file:///d:/开发项目/NovelForge/server/services/contextBuilder.ts) | 核心上下文构建逻辑 |
| [generation.ts](file:///d:/开发项目/NovelForge/server/services/agent/generation.ts) | 章节生成服务 |
| [generate.ts](file:///d:/开发项目/NovelForge/server/routes/generate.ts) | API 路由定义 |
| [embedding.ts](file:///d:/开发项目/NovelForge/server/services/embedding.ts) | 向量嵌入服务 |
| [schema.ts](file:///d:/开发项目/NovelForge/server/db/schema.ts) | 数据库 Schema 定义 |
| [NovelWorkspacePage.tsx](file:///d:/开发项目/NovelForge/src/pages/NovelWorkspacePage.tsx) | 前端小说工作台页面 |
| [api.ts](file:///d:/开发项目/NovelForge/src/lib/api.ts) | 前端 API 调用封装 |

---

> 文档版本：v4.3.0
> 最后更新：2026-04-27
> 维护者：NovelForge 开发团队
