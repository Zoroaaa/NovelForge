# NovelForge 章节生成上下文构建 — 完整执行指南

> 版本: v4.5.0 | 模块: `server/services/contextBuilder.ts` + `server/routes/generate.ts` + `server/services/agent/generation.ts`
> 前端页面: [NovelWorkspacePage.tsx](file:///d:/user/NovelForge/src/pages/NovelWorkspacePage.tsx)（小说工作台）
> 创建日期: 2026-04-25 | 最后更新: 2026-04-30

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
| **VECTORIZE 兜底** | ⭐v4.4 新增：Vectorize 不可用时 DB 直查角色/伏笔/设定/规则 |
| **伏笔时序窗口** | ⭐v4.4 新增：回收计划伏笔按 ±10 章窗口感知注入 |
| **eventLine JSON** | ⭐v4.4 新增：支持 JSON 数组格式，O(1) 索引访问零歧义 |
| **上下文预览** | 支持调试诊断，查看任意章节的完整上下文 |
| **自动修复写库** | ⭐v4.5 新增：连贯性/角色/卷进度修复结果自动写入数据库，不再丢失 |
| **持久弹窗提示** | ⭐v4.5 新增：修复过程显示持久弹窗（不自动关闭），用户可清晰感知修复状态 |
| **草稿预览模式** | ⭐v4.5 新增：支持跳过后处理（摘要/伏笔/评分），快速迭代多版本对比 |
| **SSE 时序优化** | ⭐v4.5 新增：`[DONE]` 事件移至连贯性检查完成后发送，避免前端状态混乱 |
| **超时统一配置** | ⭐v4.5 新增：全局统一 300 秒超时（路由层 + ReAct 循环），消除竞态窗口 |

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
│  │ Slot-6  │ 世界设定       │ RAG(setting)分6槽：普通显示【名称】+summary，high直接替换DB全文 │ │
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
├── Step 2: 组装查询向量（聚焦当前章节语义，≤800字）⭐v4.4 增强
│   └─ embedText(AI, queryText) → queryVector
│      queryText 由以下部分组成：
│      1. currentChapter.title（章节标题）
│      2. extractCurrentChapterEvent() 提取的上章/本章/下章事件
│      3. prevContent?.slice(0, 300)（上一章正文前300字）
│      4. prevContent?.slice(-400)（⭐v4.4 新增：上章末尾400字，最强语义锚）
│      5. lastSummary?.slice(-300)（备用：最近摘要末300字）
│
│      extractCurrentChapterEvent() 支持三种 eventLine 格式 ⭐v4.4 增强：
│      - JSON 数组格式（⭐首选路径）：`["第1章：...","第2章：..."]`，按索引 O(1) 访问
│      - 换行分隔：每行以"第X章"开头（逐行匹配）
│      - 连续文本：以"第N章："开头的段落（整段截取，以下一章开头为终止边界）
│
├── Step 3: Dynamic 层（3 次 RAG 并发 + 多次 DB 补查）⭐v4.4 增强
│   │
│   ├── [VECTORIZE 可用时] 3 次 RAG 并发（原有逻辑不变）
│   │
│   └── [VECTORIZE 不可用时] ⭐v4.4 新增 DB 兜底分支
│       ├── 角色：DB 直查 role IN ('supporting','antagonist') 按 updatedAt 取 8 条
│       ├── 伏笔：buildForeshadowingHybrid(db, [], openIds, ..., sortOrder)
│       │   └─ 走路径A（高优 open 伏笔 DB 直查）+ 路径C（回收计划窗口注入）
│       ├── 设定：buildSettingsSlotV2(db, [], typeHint, budget)
│       │   └─ 走 high importance DB 补充路径
│       └── 类型规则：fetchAllActiveRuleIds + fetchChapterTypeRules（纯 DB 过滤）
│   │
│   ├── RAG #1: searchSimilar(sourceType='character', topK=15)
│   │   └─→ 取 sourceId 列表 → DB IN 查完整卡片 → 组装 name+role+desc+attr+powerLevel
│   │
│   ├── RAG #2: searchSimilar(sourceType='foreshadowing', topK=10)
│   │   ├─→ 路径A: DB 直查 importance='high' AND status='open'（无条件注入）
│   │   └─→ 路径B: RAG score > 0.42 AND status=open（普通伏笔）
│   │
│   └── RAG #3: searchSimilar(sourceType='setting', topK=20)
│       ├─→ 普通设定：RAG summary 增加显示设定名称【名称】\nsummary
│       ├─→ importance='high'：直接替换为 DB content 全文（不再显示RAG摘要）
│       └─→ 每个设定之间空行分隔
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
| 世界设定 (Slot-6) | L2 Dynamic | ≤25000 | RAG(setting)：普通【名称】+summary，high替换DB全文 |
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
| `POST` | `/api/generate/volume-progress-check` | 卷进度检查 |
| `POST` | `/api/generate/repair-chapter` | 手动触发章节修复（连贯性/角色/卷进度） |
| `POST` | `/api/batch/novels/:id/start` | 启动批量生成任务 |
| `GET` | `/api/batch/novels/:id/active` | 获取活跃的批量任务 |
| `GET` | `/api/batch/novels/:id/history` | ⭐v4.5 新增：查询批量任务历史记录 |

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
    "enableAutoSummary": true,
    "draftMode": false
  }
}
```

**options 参数说明**：
| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `enableRAG` | boolean | true | 是否启用 RAG 检索增强（上下文构建） |
| `enableAutoSummary` | boolean | true | 是否自动生成章节摘要 |
| **`draftMode`** | **boolean** | **false** | **⭐v4.5 新增：草稿模式，true 时跳过后处理（摘要/伏笔提取/质量评分），章节状态标记为 draft** |

**响应**：SSE 流式响应 ⭐v4.5 更新时序

```
data: {"content": "AI 生成的第一段文字"}

data: {"content": "AI 生成的第二段文字"}

data: {"type": "tool_call", "name": "tool_name", "args": {...}, "result": "..."}

data: {"type": "coherence_check", "score": 65, "issues": [...]}  ← 连贯性检查结果

data: {"type": "coherence_fix", "repairedContent": "..."}  ← 自动修复内容（score < 70 时）

data: {"type": "done", "wordCount": 3200, "summary": "章节摘要..."}  ← ⭐v4.5: 现在在修复完成后发送

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

## 三、queryText 构建详解 ⭐ v4.3 新增 / v4.4 增强

**文件位置**: [contextBuilder.ts:209-228](file:///d:/user/NovelForge/server/services/contextBuilder.ts#L209-L228)

### 3.1 什么是 queryText

`queryText` 是用于生成 RAG 查询向量的文本，聚焦当前章节的语义信息，提升检索精度。

### 3.2 构建流程 ⭐v4.4 变更

```typescript
// v4.4: 先提取本章事件（用于类型推断和向量构建）
const { prevEvent, currentEvent, nextThreeChapters } = extractCurrentChapterEvent(volumeInfo.eventLine, chapterIndexInVolume)

// v4.4: 类型推断使用精确的本章事件（而非整卷 eventLine）
const chapterTypeHint = inferChapterType(currentEvent || volumeInfo.eventLine, currentChapter.title)

const queryTextParts = [currentChapter.title, prevEvent, currentEvent, nextThreeChapters]

if (!currentEvent && recentSummaries.length > 0) {
  const lastSummary = recentSummaries[recentSummaries.length - 1]
  queryTextParts.push(lastSummary.slice(-300))
}

// ⭐v4.4 新增：无条件追加上章末尾400字（最强语义锚）
if (prevContent) {
  queryTextParts.push(prevContent.slice(-400))
}

const queryText = queryTextParts.filter(Boolean).join('\n').slice(0, 800)
```

### 3.3 组成结构 ⭐v4.4 增强

| 组成部分 | 来源 | 作用 | 字数限制 |
|---------|------|------|---------|
| `currentChapter.title` | 章节标题 | 明确当前章节主题 | - |
| `prevEvent` / `currentEvent` / `nextThreeChapters` | 从 eventLine 提取的三段结构 | 明确本章/上章/下章事件 | - |
| `prevContent.slice(0, 300)` | 上一章正文前300字 | 衔接上文风格和情节 | ≤300字 |
| **`prevContent.slice(-400)`** | **⭐v4.4 新增：上章末尾正文400字** | **最强语义锚——场景/角色/法器** | **≤400字** |
| `lastSummary.slice(-300)` | 备用：最近摘要末300字 | 如果 eventLine 为空则用摘要补充 | ≤300字 |

最终 `queryText` 上限 **800 字**（`slice(0, 800)`）。

### 3.4 extractCurrentChapterEvent 提取逻辑 ⭐v4.4 重写

**文件位置**: [contextBuilder.ts:1121-1160](file:///d:/user/NovelForge/server/services/contextBuilder.ts#L1121-L1160)

该函数支持三种 eventLine 格式：

#### 格式一（⭐首选）：JSON 数组格式

```typescript
// 示例 eventLine：
// ["第42章：林岩离山\n林岩告别师门...", "第43章：血煞谷探秘\n主角前往血煞谷...", "第44章：斩杀血魔\n主角与血煞老魔激战"]

// 处理逻辑：
const parsed = JSON.parse(eventLine.trim())
const arr = Array.isArray(parsed) ? parsed.map(item => typeof item === 'string' ? item : String(item)) : []
const idx = chapterIndexInVolume - 1  // 转为 0-based

// 输出（O(1) 索引访问，零歧义）：
// 【上章事件】arr[idx-1] 的内容
// 【本章任务】arr[idx] + "← 核心，必须完成"
// 【下章预告】arr[idx+1..idx+3] + "← 仅供结尾钩子参考，本章不得提前完成"
```

**优势**：无正则匹配风险，索引精确定位，数组长度即章节数。

#### 格式二：换行分隔（每行以"第X章"开头）

```typescript
// 示例 eventLine：
// 第42章：林岩离山
// 林岩告别师门...
// 第43章：血煞谷探秘
// 主角前往血煞谷...

// 处理逻辑：
const lines = eventLine.split('\n').filter(l => l.trim())
const findChapterLine = (chapterNum) => lines.find(l => l.match(new RegExp(`第${chapterNum}章|^${chapterNum}[.、：:]`)))

// 输出：
// 【上章事件】第42章：林岩离山
// 【本章任务】第43章：血煞谷探秘  ← 核心，必须完成
// 【下章预告】第44章：斩杀血魔  ← 仅供结尾钩子参考，本章不得提前完成
```

#### 格式三：连续文本（以"第N章："开头的段落）

```typescript
// 示例 eventLine（无换行）：
// 第42章：[后山] 苏玄早有准备...第43章：[血煞谷] 王虎仗着筑基期修为...第44章：[血煞谷] 苏玄斩杀王虎...

// 处理逻辑（与 v4.3 相同）
// 1. 以"第43章："开头确定本章起点
// 2. 以"第44章："开头确定本章终点
// 3. 上章内容 = 上章开头到本章开头之间的文本
```

### 3.5 inferChapterType 精准化 ⭐v4.4 变更

**文件位置**: [contextBuilder.ts:215](file:///d:/user/NovelForge/server/services/contextBuilder.ts#L215)

**改前**：传入整卷 `eventLine`（可能包含几十章的战斗/修炼/情感标签），几乎每章都命中多个类型。

**改后**：优先使用 `currentEvent`（精确的本章事件单条），fallback 到整卷 `eventLine`。

效果：战斗章节不再命中"修炼""情感"等无关类型，`fetchChapterTypeRules` 返回规则数量大幅收敛。

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

### 4.7 Slot-9: 近期剧情摘要链 (`fetchRecentSummaries`) ⭐ v4.3 重构 / v4.4 增强

**文件位置**: [contextBuilder.ts:859-909](file:///d:/user/NovelForge/server/services/contextBuilder.ts#L859-L909)

**v4 变更**: 默认从 5 章扩展到 **20 章**，上限 30 章。
**v4.4 增强**: 新增 `volumeId` 约束，优先同卷摘要，不足时从前卷尾部补齐。

**执行步骤**:
1. **有 volumeId 时（⭐v4.4 新增）**：
   - 先查同卷摘要：`WHERE novelId=? AND volumeId=? AND sortOrder < currentSortOrder`
   - 同卷不足 `chainLength` 条时，从前卷尾部补齐
   - 所有结果保持时间正序（旧→新）
2. **无 volumeId 时**：走原有逻辑（向后兼容）
3. 按 sortOrder DESC 取 N 条，反转后输出 → `[第N章 {title}] {summary}`

**无向量** — 摘要链需要严格的时间顺序和完整性，DB ORDER BY 即可。

---

### 4.8 Slot-5: 出场角色卡 (`buildCharacterSlotFromDB`) ⭐ 核心改动 / v4.4 动态阈值

**文件位置**: [contextBuilder.ts:432-456](file:///d:/user/NovelForge/server/services/contextBuilder.ts#L432-L456)

**这是 v4 最大架构变化** — 从"RAG 返回 chunk 碎片"改为"RAG 找 ID → DB 查完整卡片"。
**v4.4 增强**: 固定阈值 0.45 改为动态阈值（0.45 → 0.35），解决小规模角色集零结果问题。

**执行流程**:
```
输入: ragResults (来自 searchSimilar(sourceType='character', topK=15))
  │
  ├─ 1. 首次过滤: score >= 0.45（⭐v4.4: SCORE_THRESHOLD_PRIMARY）
  ├─ 2. 排序: 按 score 降序
  ├─ 3. 截断: 取前 6 个 sourceId
  │
  ├─ ⭐v4.4 动态降阈值:
  │   └─ 若首次过滤结果 < 2 条且原始候选 ≥ 2 条
  │       → 降低到 score >= 0.35（SCORE_THRESHOLD_FALLBACK）重试
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

**文件位置**: [contextBuilder.ts:517-625](file:///d:/开发项目/NovelForge/server/services/contextBuilder.ts#L517-L625)

**v4 变更**: RAG 返回的是 `novelSettings.summary`，且 importance=high 的设定会替换为 DB 全文。
**v4.6 变更**: 普通设定增加显示【设定名称】前缀；high importance 直接替换（不再追加）；每个设定间空行分隔。

**执行流程**:
```
输入: ragResults (来自 searchSimilar(sourceType='setting', topK=20))
  │
  ├─ Phase 1: 按 settingType 分槽处理每个 RAG 结果
  │     │
  │     ├─ typeMapping (setting type → slotKey):
  │     │   worldview/rule/world_rule → worldRules
  │     │   power_system/cultivation → powerSystem
  │     │   geography/location → geography
  │     │   faction/organization → factions
  │     │   item_skill/artifact/item → artifacts
  │     │   其他 → misc
  │     │
  │     ├─ 各槽独立参数:
  │     │   worldRules:  budget=2500  threshold=0.42
  │     │   powerSystem: budget=2500  threshold=0.42
  │     │   geography:   budget=1200 threshold=0.45
  │     │   factions:    budget=1000 threshold=0.45
  │     │   artifacts:   budget=700 threshold=0.45
  │     │   misc:        budget=600 threshold=0.48
  │     │
  │     ├─ 对每个结果 r:
  │     │   ├─ 判断所属 slotKey
  │     │   ├─ score < threshold → 跳过
  │     │   ├─ importance='high' AND score>=0.38 → 跳过 RAG summary，记录到 highImportanceIds
  │     │   └─ 普通设定：显示【设定名称】\n{summary} + 空行
  │     │
  │     └─ 记录 highImportanceIds + sourceIdSlotMap: { sourceId → { slotKey, index } }
  │
  ├─ Phase 2: 高重要性设定替换为 DB 全文（替换对应位置）
  │     ├─ DB 批量查询: SELECT id, name, type, content FROM novelSettings WHERE id IN (...)
  │     ├─ 用 sourceIdSlotMap[fr.id] 精确定位替换位置
  │     └─ 替换为: `【name·完整设定】\n{content全文}` + 空行
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

### 4.10 Slot-7: 待回收伏笔 (`buildForeshadowingHybrid`) ⭐ 双路合并 + v4.4 路径C

**文件位置**: [contextBuilder.ts:514-601](file:///d:/user/NovelForge/server/services/contextBuilder.ts#L514-L601)

**v4 变更**: 增加 DB 兜底路径，防止高重要性伏笔被 RAG score 漏掉。
**v4.4 变更**: 新增路径C — 回收计划伏笔按 ±10 章时序窗口感知注入。

**执行流程**:
```
输入: ragResults + openIds(Set) + novelId + budgetTokens + currentSortOrder?(⭐v4.4新增)
  │
  ├─ 路径A: DB 直查高重要性伏笔（无条件注入）
  │   └─ SELECT * FROM foreshadowing
  │       WHERE novelId=? AND status='open' AND importance='high'
  │       LIMIT 15
  │   → 输出格式: 【title】(高重要性·待回收)\n{description}
  │
  ├─ 路径B: RAG 过滤普通伏笔
  │   └─ ragResults 中过滤:
  │       ├─ isOpen = true（在 openIds 中）
  │       ├─ importance != 'high'（已在路径A处理）
  │       └─ score > 0.42
  │   → 输出格式: metadata.content（原始描述文本）
  │
  ├─ 路径C: ⭐v4.4 新增 — 回收计划时序窗口感知注入
  │   └─ 条件: currentSortOrder 已传入
  │   ├─ 查询 status='resolve_planned' 的伏笔记录
  │   ├─ 将 chapterId 解析为 sortOrder（查 chapters 表）
  │   └─ 窗口过滤: targetSort ∈ [currentSortOrder - 1, currentSortOrder + 10]
  │       → 仅当目标回收章节在 ±10 章范围内才注入
  │   → 输出格式: 【title】(回收计划·第N章)\n{description}\n⚠️ 此伏笔计划在第 N 章回收，本章可提前铺垫但不得终结
  │   → 按 targetChapter 升序排列（最近的排前面）
  │
  └─ 合并排序: 路径A 优先（priority=0），路径C 其次（priority=1.5），路径B 最后（priority=1）
      → 整体受 budgetTokens 截断
```

**伏笔三态生命周期** ⭐v4.4 新增：

| status | 含义 | 注入时机 | 注入条件 |
|--------|------|---------|---------|
| `open` | 已埋入/待回收 | 路径A/B | 始终注入 |
| `resolve_planned` | 回收计划（工坊规划） | **路径C** | 目标章节在 ±10 章窗口内 |
| `resolved` | 已回收 | 未来扩展 | - |

**设计理由**: 高重要性伏笔对剧情连贯性至关重要（路径A）；回收计划伏笔需要提前让 AI 知道即将要回收什么（路径C），但太早注入会剧透（窗口控制）。

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

**文件位置**: [contextBuilder.ts:1210-1265](file:///d:/user/NovelForge/server/services/contextBuilder.ts#L1210-L1265)

最终输出结构:

```markdown
## 总纲
【天玄大陆总纲（总纲）】
{content 全文 或 summary}

## 当前卷规划
【卷蓝图】
{blueprint}

【事件线】
{eventLine}  ⭐v4.4: 若原始值为 JSON 数组格式，自动 join('\n') 展示为换行文本

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
【灵气复苏规则】
{setting summary 1}

【境界划分标准】
{setting summary 2}

【境界体系】
【练气境描述】
{setting summary 1}

【筑基境描述】
{setting summary 2}

【场景地理】
【云隐山脉】
{setting summary}

【相关势力】
【青云门】
{setting summary}

【相关法宝】
【青木剑】
{setting summary}

【其他设定】
【炼丹术基础】
{setting summary}

【灵气复苏·完整设定】(high-importance setting full text)
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

### 9.1 标准章节生成流程（含自动修复）⭐v4.5 更新

```
步骤 1：打开小说工作台
   └─ 进入 NovelWorkspacePage
   └─ 选择目标小说和章节

步骤 2：配置生成选项（可选）
   ├─ 选择生成模式：generate / continue / rewrite
   ├─ 设置目标字数（默认 3000 字）
   └─ ⭐v4.5 新增：勾选"草稿模式"（跳过后处理）

步骤 3：点击生成按钮
   └─ 前端调用 api.streamGenerate(chapterId, novelId, options)
   └─ POST /api/generate/chapter (SSE 流式)

步骤 4：后端构建上下文
   └─ buildChapterContext(env, novelId, chapterId)
   └─ Step 1: 8 个 Core 层 DB 查询（Promise.all 并发）
   └─ Step 2: 生成查询向量 embedText()
   └─ Step 3: 3 次 RAG 查询 + DB 补查
   └─ Step 4: 预算检查与调整
   └─ Step 5: 返回 ContextBundle

步骤 5：AI 流式生成
   └─ assemblePromptContext(bundle) 组装完整 prompt
   └─ AI 模型流式输出章节内容
   └─ 前端实时渲染 SSE 数据

步骤 6：生成完成 + 自动检查与修复 ⭐v4.5 核心
   ├─ 自动保存章节内容到数据库
   ├─ 自动触发连贯性检查（checkChapterCoherence）
   │   ├─ score ≥ 70 → 无问题，直接完成
   │   └─ score < 70 → ⚠️ 自动修复流程启动
   │       ├─ 调用 repairChapterByIssues() 生成修复版本
   │       ├─ ✅ 修复结果自动写入数据库（不再丢失）
   │       ├─ 推送 coherence_fix 事件给前端
   │       └─ 前端显示持久弹窗："正在自动修复..."
   ├─ [DONE] 事件在修复完成后发送（⭐v4.5 时序优化）
   └─ 非草稿模式时：
       ├─ 入队后处理任务（post_process_chapter）
       ├─ 自动生成章节摘要
       ├─ 提取伏笔、质量评分等
       └─ 更新小说/卷字数统计
```

**⭐v4.5 自动修复机制详解**：

| 触发条件 | 修复类型 | 写库行为 | 用户提示 |
|---------|---------|---------|---------|
| 连贯性评分 < 70 | `repairChapterByIssues()` | ✅ 自动写入 `chapters.content` | 持久弹窗："⚠️ 正在自动修复..." |
| 角色一致性失败 | `repairChapterByCharacterIssues()` | ✅ 自动写入 `chapters.content` | 手动触发时显示 |
| 卷进度异常 | `repairChapterByVolumeIssues()` | ✅ 自动写入 `chapters.content` | 手动触发时显示 |

**重要说明**：
- 所有修复函数现在都会 **自动将修复内容写入数据库**
- 用户无需手动"接受修复"，修复结果已持久化
- 前端弹窗提示为 **持久显示**（不自动关闭），用户可清晰感知状态
- 修复完成后显示成功弹窗："✅ 自动修复完成"

### 9.2 草稿模式生成流程 ⭐v4.5 新增

```
步骤 1-4：同标准流程

步骤 5：配置草稿模式
   └─ 勾选"草稿模式"复选框（options.draftMode = true）

步骤 6：AI 生成（跳过后处理）
   ├─ AI 流式输出章节内容
   ├─ 内容写入数据库，status = 'draft'（而非 'generated'）
   ├─ ❌ 不入队 post_process_chapter 任务
   ├─ ❌ 不自动生成摘要
   ├─ ❌ 不提取伏笔
   └─ ❌ 不进行质量评分

步骤 7：用户确认后手动处理后处理
   └─ 用户查看草稿内容
   └─ 确认满意后手动触发后处理
   └─ 或删除草稿重新生成
```

**适用场景**：
- 快速生成多个版本对比
- 测试不同 prompt 效果
- 节省 API token（跳过耗时的后处理 LLM 调用）
- 迭代实验性内容

### 9.3 批量生成流程

```
步骤 1：打开批量生成面板
   └─ 进入 BatchGeneratePanel
   └─ 选择目标小说和卷

步骤 2：配置批量参数
   ├─ 设置目标章节数（如 20 章）
   ├─ 选择起始章节（默认从下一章开始）
   └─ 点击"开始批量生成"

步骤 3：后端创建批量任务
   └─ POST /api/batch/novels/:id/start
   └─ 创建 batchGenerationTasks 记录（status = 'running'）

步骤 4：队列串行执行
   └─ 投递 batch_generate_chapter 消息到 TASK_QUEUE
   └─ 每个 Worker 处理一章：
       ├─ 构建上下文（同单章流程）
       ├─ AI 生成章节内容
       ├─ 写入数据库
       └─ 发送 batch_chapter_done 事件
   └─ 进度实时更新到 batchGenerationTasks

步骤 5：监控进度
   └─ GET /api/batch/novels/:id/active
   └─ 返回当前任务状态：
       ├─ completedCount: 已完成章数
       ├─ failedCount: 失败章数
       ├─ totalCount: 总目标章数
       └─ status: running / paused / done

步骤 6：查询历史记录 ⭐v4.5 新增
   └─ GET /api/batch/novels/:id/history?limit=10
   └─ 返回历史批量任务列表（支持 status 过滤）
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
  ragFallbackUsed: boolean          // ⭐v4.4 新增：是否使用了 VECTORIZE 不可用时的 DB 兜底
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

## 十二、v3 → v4 → v4.1 → v4.2 → v4.3 → v4.3.2 → v4.4 迁移对照

| 维度 | v3 | v4 | v4.1 | v4.2 | v4.3 | v4.3.2 | **v4.4** | 变化原因 |
|------|----|----|------|------|------|---------|---------|---------|
| 总纲 | 可能空的 summary | content 全文（≤12k） | **不变** | **不变** | **不变** | **不变** | **不变** | 256k 够用 |
| 上一章 | context 摘要 | context 摘要 | **正文完整内容（≤8k）** | **不变** | **不变** | **不变** | **不变** | 摘要信息不足 |
| 角色 | RAG 返回 500字碎片 | RAG 返回 ID → DB 完整卡片 | **阈值 0.50→0.38, MAX 8→6** | **阈值 0.38→0.45, 排除主角** | **不变** | **不变** | **⭐动态阈值 0.45→0.35** | 小规模角色集零结果 |
| 设定 | RAG 返回全文切块 | RAG 返回 summary（≤400字） | **阈值全面下调 0.55-0.72→0.42-0.48** | **Slot预算精细化** | **不变** | **优化** | **不变** | 适应更大预算 |
| 伏笔 | 仅 RAG 过滤 | 高优 DB 兜底 + RAG | **阈值 0.55→0.42** | **按创建时间排序，高优限制10→15** | **不变** | **不变** | **⭐路径C：回收计划±10章窗口注入** | 时序感知伏笔调度 |
| 规则 | priority≤2 前5条 | 全部 isActive 规则 | **不变** | **新增fetchAllActiveRuleIds，Slot-8自动排除已注入规则** | **不变** | **不变** | **不变** | 避免重复注入 |
| 摘要链 | 默认 5 章 | 默认 20 章 | **不变** | **不变** | **不变** | **不变** | **⭐volumeId 约束，优先同卷** | 跨卷摘要不连贯 |
| **创作节奏** | 无 | 无 | **新增 Slot-10** | **不变** | **不变** | **不变** | **不变** | 帮助 AI 均衡节奏 |
| 预算 | total=14k | total=55k | **total=128k** | **不变** | **不变** | **不变** | **不变** | 利用窗口 |
| RAG查询 | 整卷eventLine+整章正文 | 整卷eventLine+整章正文 | **不变** | **不变** | **聚焦当前章节语义，≤800字** | **优化查询文本构建** | **⭐+上章末尾400字** | 最强语义锚 |
| RAG 次数 | 3 次 | **3 次** | **不变** | **不变** | **不变** | **不变** | **⭐VECTORIZE不可用时DB兜底(0次)** | 可靠性 |
| 向量类型 | 6 种 | **3 种** | **不变** | **不变** | **不变** | **不变** | **不变** | 聚焦上下文构建 |
| 单任务最大 chunks | 12+（超时） | **≤1** | **不变** | **不变** | **不变** | **不变** | **不变** | 安全 |
| Slot过滤 | 无 | 无 | 无 | **新增slotFilter选项** | **不变** | **不变** | **⭐续写/重写补全上下文槽** | AI 知道更多上下文 |
| eventLine格式 | 纯文本 | 纯文本 | **不变** | **不变** | **纯文本正则匹配** | **不变** | **⭐JSON数组格式首选** | O(1)索引零歧义 |
| inferChapterType | - | - | - | - | **整卷eventLine** | **不变** | **⭐currentEvent精确推断** | 类型判断收敛 |
| **调试信息** | 无 | 无 | 无 | 无 | **新增queryText+ragRawResults** | **增强调试信息** | **⭐+ragFallbackUsed** | VECTORIZE兜底监控 |

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
| [contextBuilder.ts](file:///d:/user/NovelForge/server/services/contextBuilder.ts) | 核心上下文构建逻辑 |
| [generation.ts (service)](file:///d:/user/NovelForge/server/services/agent/generation.ts) | 章节生成服务（含草稿模式） |
| [generate.ts (route)](file:///d:/user/NovelForge/server/routes/generate.ts) | API 路由定义（SSE 流式 + 自动修复） |
| [coherence.ts](file:///d:/user/NovelForge/server/services/agent/coherence.ts) | 连贯性检查与修复（自动写库） |
| [consistency.ts](file:///d:/user/NovelForge/server/services/agent/consistency.ts) | 角色一致性检查与修复（自动写库） |
| [volumeProgress.ts](file:///d:/user/NovelForge/server/services/agent/volumeProgress.ts) | 卷进度检查与修复（自动写库） |
| [constants.ts](file:///d:/user/NovelForge/server/services/agent/constants.ts) | 全局常量配置（超时统一 300s） |
| [batchGenerate.ts](file:///d:/user/NovelForge/server/services/agent/batchGenerate.ts) | 批量生成服务 |
| [batch.ts (route)](file:///d:/user/NovelForge/server/routes/batch.ts) | 批量生成路由（含历史查询 API） |
| [queue-handler.ts](file:///d:/user/NovelForge/server/queue-handler.ts) | 队列处理器（批量任务执行） |
| [embedding.ts](file:///d:/user/NovelForge/server/services/embedding.ts) | 向量嵌入服务 |
| [schema.ts](file:///d:/user/NovelForge/server/db/schema.ts) | 数据库 Schema 定义 |
| [types.ts](file:///d:/user/NovelForge/server/services/agent/types.ts) | 类型定义（GenerationOptions 含 draftMode） |
| [NovelWorkspacePage.tsx](file:///d:/user/NovelForge/src/pages/NovelWorkspacePage.tsx) | 前端小说工作台页面 |
| [GeneratePanel.tsx](file:///d:/user/NovelForge/src/components/generate/GeneratePanel.tsx) | 前端单章生成面板（含草稿模式开关） |
| [BatchGeneratePanel.tsx](file:///d:/user/NovelForge/src/components/generation/BatchGeneratePanel.tsx) | 前端批量生成面板 |
| [useGenerate.ts](file:///d:/user/NovelForge/src/hooks/useGenerate.ts) | 前端生成 Hook（含持久弹窗逻辑） |
| [api.ts](file:///d:/user/NovelForge/src/lib/api.ts) | 前端 API 调用封装 |

---

> 文档版本：v4.5.0
> 最后更新：2026-04-30
> 维护者：NovelForge 开发团队
> ⭐v4.5 主要更新：自动修复写库、持久弹窗提示、草稿模式、SSE 时序优化、批量历史查询
