# NovelForge 上下文工程优化方案

> 基于代码审查（v4.1.0）的完整优化建议
> 覆盖范围：模型参数、RAG查询、上下文构建、Agent工具重设计

---

## 一、模型参数修复

**文件：`server/services/llm.ts`**

```ts
// 修改前
const DEFAULT_PARAMS: ModelParams = {
  temperature: 0.85,
  max_tokens: 4096,
  top_p: 0.9,
  frequency_penalty: 0.3,
  presence_penalty: 0.3,
  stop: [],
}

// 修改后
const DEFAULT_PARAMS: ModelParams = {
  temperature: 0.72,       // 降低随机性，保证设定词一致性
  max_tokens: 10000,       // WORD_COUNT_MAX=5000字≈6500 tokens，4096必然截断
  top_p: 0.9,
  frequency_penalty: 0,    // 小说需要高频复用角色名/境界词，惩罚会制造变体
  presence_penalty: 0,     // 同上
  stop: [],
}
```

**为什么：**
- `max_tokens: 4096` 在5000字目标下必然截断正文，导致章节残缺，摘要质量也随之下降
- `frequency/presence_penalty: 0.3` 会让模型回避重复同一个词，400万字长篇中角色名、境界名出现变体，破坏一致性
- `temperature: 0.85` 对需要严格遵从设定卡的场景偏高

---

## 二、章节摘要质量提升

**文件：`server/services/agent/summarizer.ts`**

```ts
// 修改 triggerAutoSummary 中的 callSummaryLLM 调用

const summaryText = await callSummaryLLM({
  db,
  novelId,
  stage: 'summary_gen',
  systemPrompt: SUMMARY_SYSTEM_PROMPT,
  userPrompt: `请为以下小说章节生成350-450字的结构化摘要。

章节标题：《${chapter.title}》

正文内容：
${chapter.content}

【输出格式要求】严格按以下结构输出，每项如无内容则写"无"：
【角色状态变化】本章角色境界突破、能力获得、重要属性变化（精确到具体境界名称）
【关键事件】本章主线剧情，2-3句话
【道具/功法】本章出现、获得或使用的重要道具、功法、丹药（名称+简述）
【人物关系】本章新出现的角色关系变化或重要互动（如有）
【章末状态】主角当前所在位置、处境、下一步明确方向`,
  maxTokens: 1000,   // 从500提升
})
```

**为什么：** 自由格式摘要在压缩比20:1时会优先保留主线，抛弃道具/境界/人物关系等细节。结构化强制保留这些字段，Slot-9的20章摘要链才能承载真正有用的状态信息。

---

## 三、RAG查询向量优化

**文件：`server/services/contextBuilder.ts`，Step 2**

```ts
// 修改前：query向量包含整卷eventLine + 整章正文，可能超过1万字
const queryText = [
  volumeInfo.eventLine,
  prevContent,
  currentChapter.title,
].filter(Boolean).join('\n')

// 修改后：聚焦当前章节语义，控制在800字以内
const queryText = [
  currentChapter.title,
  extractCurrentChapterEvent(volumeInfo.eventLine, currentChapter.sortOrder),
  prevContent?.slice(0, 300),  // 只取上章结尾状态，不取全文
].filter(Boolean).join('\n').slice(0, 800)
```

新增辅助函数（同文件）：

```ts
/**
 * 从整卷eventLine中提取当前章节对应的事件描述
 * 支持两种格式：
 * 1. 按行编号：每行以"第X章"或数字序号开头
 * 2. 整段文本：按当前章在卷内的相对位置截取片段
 */
function extractCurrentChapterEvent(
  eventLine: string,
  currentSortOrder: number,
): string {
  if (!eventLine) return ''

  // 尝试按行匹配章节序号
  const lines = eventLine.split('\n').filter(l => l.trim())
  const numbered = lines.find(l =>
    l.match(new RegExp(`第${currentSortOrder}章|^${currentSortOrder}[.、：:]`))
  )
  if (numbered) return numbered.trim().slice(0, 200)

  // fallback：取前500字（整段eventLine的开头通常是本卷主线）
  return eventLine.slice(0, 500)
}
```

**为什么：** bge-m3最优输入在512 token以内，塞入整章正文（8000 tokens）会严重稀释语义向量，导致角色/设定的RAG召回相关性变差。

---

## 四、角色RAG去除主角重复

**文件：`server/services/contextBuilder.ts`，`buildCharacterSlotFromDB`**

```ts
async function buildCharacterSlotFromDB(
  db: AppDb,
  ragResults: Array<{ score: number; metadata: any }>,
  budgetTokens: number,
  protagonistIds: string[],   // 新增参数：主角ID列表
): Promise<string[]> {
  const SCORE_THRESHOLD = 0.45  // 从0.38提高，配合queryText缩短后精度更高
  const MAX_CHARACTERS = 6

  const candidates = ragResults
    .filter(r => r.score >= SCORE_THRESHOLD)
    .filter(r => !protagonistIds.includes(r.metadata.sourceId))  // 排除主角
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_CHARACTERS)
    .map(r => r.metadata.sourceId)
  // ...其余不变
}
```

调用处传入主角ID：

```ts
// Step 1 已查出 protagonistData，提取ID列表
const protagonistIds = protagonistData.map(p => p.id)

// Step 3 调用时传入
characterCards = await buildCharacterSlotFromDB(db, characterResults, budget.characters, protagonistIds)
```

**为什么：** 主角已在Slot-3单独完整注入，占用Slot-5的名额是浪费，还可能挤掉实际出场的配角。

---

## 五、设定动态槽改为始终开启

**文件：`server/services/contextBuilder.ts`，`buildSettingsSlotV2`**

```ts
// 修改前：geography/factions/artifacts靠关键词推断决定是否开启
const slotBudgets: Record<keyof SlottedSettings, number> = {
  worldRules:  Math.min(2500, totalBudget * 0.21),
  powerSystem: Math.min(2500, totalBudget * 0.21),
  geography:   hasLocation ? Math.min(1500, totalBudget * 0.13) : 0,  // 关键词漏匹配则关闭
  factions:    hasFaction  ? Math.min(1200, totalBudget * 0.10) : 0,
  artifacts:   hasArtifact ? Math.min(800,  totalBudget * 0.07) : 0,
  misc:        800,
}

// 修改后：始终开启，budget略减但不为0
const slotBudgets: Record<keyof SlottedSettings, number> = {
  worldRules:  Math.min(2500, totalBudget * 0.21),
  powerSystem: Math.min(2500, totalBudget * 0.21),
  geography:   Math.min(1200, totalBudget * 0.10),   // 始终开启
  factions:    Math.min(1000, totalBudget * 0.08),   // 始终开启
  artifacts:   Math.min(700,  totalBudget * 0.06),   // 始终开启
  misc:        600,
}
// 同时删除 hasLocation / hasFaction / hasArtifact 三个变量及其判断逻辑
```

**为什么：** 关键词推断基于整卷eventLine，不是当前章，且词表硬编码（"问剑峰"不含"山"就漏掉geography槽）。25000 tokens的设定总预算完全足够始终开启三个槽，没必要靠猜测节省这几百tokens，漏掉相关设定比浪费几百tokens代价大得多。

---

## 六、伏笔兜底加时效排序

**文件：`server/services/contextBuilder.ts`，`buildForeshadowingHybrid` 路径A**

```ts
// 修改前：无排序，先创建的先注入，写到300章还在无条件注入第5章的伏笔
const highPriority = await db.select({...})
  .from(foreshadowing)
  .where(and(
    eq(foreshadowing.novelId, novelId),
    eq(foreshadowing.status, 'open'),
    eq(foreshadowing.importance, 'high'),
    sql`${foreshadowing.deletedAt} IS NULL`
  ))
  .limit(10)
  .all()

// 修改后：优先注入近期埋入且推进次数少的伏笔
const highPriority = await db.select({
  title: foreshadowing.title,
  description: foreshadowing.description,
  importance: foreshadowing.importance,
  createdAt: foreshadowing.createdAt,
})
  .from(foreshadowing)
  .where(and(
    eq(foreshadowing.novelId, novelId),
    eq(foreshadowing.status, 'open'),
    eq(foreshadowing.importance, 'high'),
    sql`${foreshadowing.deletedAt} IS NULL`
  ))
  .orderBy(desc(foreshadowing.createdAt))  // 最近埋入的优先
  .limit(15)   // 多取一些再截断，给budget检查更多选择空间
  .all()
```

**为什么：** 早期埋的high伏笔如果200章都没推进，大概率已经被反复提醒过了，不需要每章必出。近期埋入的新high伏笔反而更需要在接下来几章里出现在AI视野中。

---

## 七、Slot-4/Slot-8去重

**文件：`server/services/contextBuilder.ts`，`fetchChapterTypeRules`**

```ts
// 新增参数：传入已在Slot-4注入的规则ID集合
async function fetchChapterTypeRules(
  db: AppDb,
  novelId: string,
  chapterTypeHint: string,
  existingRuleIds: string[],  // 新增
): Promise<string[]> {
  // ...categories推断不变...

  const rows = await db
    .select({
      id: writingRules.id,
      category: writingRules.category,
      title: writingRules.title,
      content: writingRules.content,
      priority: writingRules.priority
    })
    .from(writingRules)
    .where(and(
      eq(writingRules.novelId, novelId),
      eq(writingRules.isActive, 1),
      inArray(writingRules.category, categories),
      sql`${writingRules.deletedAt} IS NULL`,
      existingRuleIds.length > 0
        ? sql`${writingRules.id} NOT IN (${existingRuleIds.map(() => '?').join(',')})` // 排除已注入
        : sql`1=1`
    ))
    .orderBy(writingRules.priority).limit(8).all()
  // ...
}
```

调用处：

```ts
// Step 1 已取 allActiveRules，提取其中的ID
const activeRuleIds = allActiveRules.map(r => r.id)  // 需要fetchAllActiveRules同时返回id字段
chapterTypeRules = await fetchChapterTypeRules(db, novelId, chapterTypeHint, activeRuleIds)
```

**为什么：** Slot-4注入全部活跃规则，Slot-8是其子集，同一条规则出现两次浪费token，且模型可能误认为重复是强调。

---

## 八、Agent工具完全重设计

### 8.1 设计原则

上下文资料包已覆盖的内容，工具不重复：
- 总纲全文 → Slot-0 已有，**工具不查总纲**
- 当前卷blueprint/eventLine → Slot-1 已有，**工具不查当前卷**
- 主角完整卡片 → Slot-3 已有，**工具不查主角**
- 近20章摘要 → Slot-9 已有，**工具不查近期摘要**
- RAG已召回的角色/设定/伏笔 → Slot-5/6/7 已有

工具的价值域 = **资料包盲区**：历史章节细节、RAG漏召回的角色/设定、所有伏笔列表、指定角色深度查询。

### 8.2 新工具定义

**文件：`server/services/agent/tools.ts`（完整替换）**

```ts
export const AGENT_TOOLS = [

  // ── 工具1：历史章节关键词检索 ────────────────────────────
  {
    type: 'function',
    function: {
      name: 'searchChapterHistory',
      description: `在历史章节摘要中检索包含指定关键词的章节记录。
适用场景：
- 确认某个道具、功法、地点首次出现的章节
- 查找某角色在过去章节中的具体行为或状态
- 确认某件事是否已经在前文发生过
注意：资料包中已有近20章摘要，此工具用于查询更早的历史。`,
      parameters: {
        type: 'object',
        properties: {
          keyword: {
            type: 'string',
            description: '要搜索的关键词，如角色名、道具名、地点名、事件描述'
          },
          limit: {
            type: 'number',
            description: '返回结果数量，默认8，最大15'
          },
        },
        required: ['keyword'],
      },
    },
  },

  // ── 工具2：精确查询指定角色完整卡片 ─────────────────────
  {
    type: 'function',
    function: {
      name: 'queryCharacterByName',
      description: `按角色名精确查询完整角色卡片，包括描述、属性、境界、别名。
适用场景：
- 资料包"本章出场角色"中没有包含某个角色，但该角色需要在本章出场
- 需要确认某个配角的当前境界或具体属性
- 需要查询某个角色的完整背景设定
注意：主角信息已在资料包"主角状态"中，无需调用此工具查主角。`,
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: '角色名称，支持别名查询'
          },
        },
        required: ['name'],
      },
    },
  },

  // ── 工具3：查询所有开放伏笔列表 ──────────────────────────
  {
    type: 'function',
    function: {
      name: 'queryForeshadowing',
      description: `查询当前未收尾的伏笔列表。
适用场景：
- 资料包"待回收伏笔"只包含部分高优先级伏笔，需要查看是否还有其他open状态的伏笔
- 本章情节涉及某个线索，需要确认是否存在对应的已登记伏笔
- 需要了解当前所有悬而未决的伏笔全貌
注意：资料包已注入高重要性伏笔，此工具用于查询资料包未覆盖的普通伏笔。`,
      parameters: {
        type: 'object',
        properties: {
          importance: {
            type: 'string',
            enum: ['high', 'normal', 'low'],
            description: '按重要性过滤，不传则返回全部open伏笔'
          },
          limit: {
            type: 'number',
            description: '返回数量，默认10，最大20'
          },
        },
        required: [],
      },
    },
  },

  // ── 工具4：按名称精确查询世界设定 ────────────────────────
  {
    type: 'function',
    function: {
      name: 'querySettingByName',
      description: `按设定名称精确查询世界设定的完整内容。
适用场景：
- 资料包"相关世界设定"中某条设定只有摘要，需要查看完整规则细节
- 写到某个具体设定（特定功法、地理、势力规则）时需要确认完整描述
- RAG未能召回某个你知道存在的设定，需要点名查询
注意：境界体系、世界法则等高频设定已在资料包中，只在需要更多细节时调用。`,
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: '设定名称，如"玄灵宗门规"、"天地灵气运转法则"'
          },
        },
        required: ['name'],
      },
    },
  },

  // ── 工具5：语义搜索（兜底） ───────────────────────────────
  {
    type: 'function',
    function: {
      name: 'searchSemantic',
      description: `用自然语言描述搜索相关的角色、设定或伏笔信息。
适用场景：
- 不知道确切名称，但知道大概内容，需要语义模糊搜索
- 前四个工具都无法满足需求时的通用兜底搜索
- 跨类型搜索（同时搜角色+设定）
注意：优先使用前四个精确工具，此工具作为最后手段。`,
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: '用自然语言描述要查找的内容，越具体越好'
          },
          sourceTypes: {
            type: 'array',
            items: { type: 'string', enum: ['character', 'setting', 'foreshadowing'] },
            description: '限定搜索范围，不传则搜全部类型'
          },
          topK: {
            type: 'number',
            description: '返回结果数量，默认5，最大10'
          },
        },
        required: ['query'],
      },
    },
  },
]
```

### 8.3 新工具执行器

**文件：`server/services/agent/executor.ts`（完整替换）**

```ts
import { drizzle } from 'drizzle-orm/d1'
import { chapters, characters, novelSettings, foreshadowing } from '../../db/schema'
import { eq, and, desc, like, or, sql, inArray } from 'drizzle-orm'
import type { Env } from '../../lib/types'
import { embedText, searchSimilarMulti, ACTIVE_SOURCE_TYPES } from '../embedding'

export async function executeAgentTool(
  env: Env,
  toolName: string,
  args: Record<string, any>,
  novelId: string
): Promise<string> {
  const db = drizzle(env.DB)

  switch (toolName) {

    // ── 工具1：历史章节关键词检索 ────────────────────────────
    case 'searchChapterHistory': {
      const { keyword, limit = 8 } = args
      if (!keyword) return JSON.stringify({ error: 'keyword参数必填' })

      const rows = await db
        .select({
          sortOrder: chapters.sortOrder,
          title: chapters.title,
          summary: chapters.summary,
        })
        .from(chapters)
        .where(and(
          eq(chapters.novelId, novelId),
          sql`${chapters.summary} IS NOT NULL AND ${chapters.summary} != ''`,
          sql`${chapters.deletedAt} IS NULL`,
          or(
            like(chapters.summary, `%${keyword}%`),
            like(chapters.title, `%${keyword}%`),
          )
        ))
        .orderBy(desc(chapters.sortOrder))
        .limit(Math.min(limit, 15))
        .all()

      if (rows.length === 0) {
        return JSON.stringify({ message: `未在历史章节中找到包含"${keyword}"的记录` })
      }

      return JSON.stringify(
        rows.reverse().map(r => ({
          chapter: `第${r.sortOrder}章 ${r.title}`,
          summary: r.summary,
        })),
        null, 2
      )
    }

    // ── 工具2：精确查询指定角色完整卡片 ─────────────────────
    case 'queryCharacterByName': {
      const { name } = args
      if (!name) return JSON.stringify({ error: 'name参数必填' })

      const rows = await db
        .select({
          name: characters.name,
          aliases: characters.aliases,
          role: characters.role,
          description: characters.description,
          attributes: characters.attributes,
          powerLevel: characters.powerLevel,
        })
        .from(characters)
        .where(and(
          eq(characters.novelId, novelId),
          sql`${characters.deletedAt} IS NULL`,
          or(
            eq(characters.name, name),
            like(characters.aliases, `%${name}%`),
          )
        ))
        .limit(3)
        .all()

      if (rows.length === 0) {
        return JSON.stringify({ message: `未找到角色"${name}"，请确认名称或使用searchSemantic模糊搜索` })
      }

      return JSON.stringify(rows.map(r => {
        let attrs: any = {}
        let power: any = {}
        try { attrs = r.attributes ? JSON.parse(r.attributes) : {} } catch {}
        try { power = r.powerLevel ? JSON.parse(r.powerLevel) : {} } catch {}
        return {
          name: r.name,
          aliases: r.aliases || null,
          role: r.role,
          description: r.description,
          attributes: attrs,
          currentLevel: power.current || null,
          nextMilestone: power.nextMilestone || null,
        }
      }), null, 2)
    }

    // ── 工具3：查询所有开放伏笔列表 ──────────────────────────
    case 'queryForeshadowing': {
      const { importance, limit = 10 } = args

      const conditions: any[] = [
        eq(foreshadowing.novelId, novelId),
        eq(foreshadowing.status, 'open'),
        sql`${foreshadowing.deletedAt} IS NULL`,
      ]
      if (importance) {
        conditions.push(eq(foreshadowing.importance, importance))
      }

      const rows = await db
        .select({
          title: foreshadowing.title,
          description: foreshadowing.description,
          importance: foreshadowing.importance,
          createdAt: foreshadowing.createdAt,
        })
        .from(foreshadowing)
        .where(and(...conditions))
        .orderBy(desc(foreshadowing.createdAt))
        .limit(Math.min(limit, 20))
        .all()

      if (rows.length === 0) {
        return JSON.stringify({ message: '当前没有open状态的伏笔' })
      }

      return JSON.stringify(rows.map(r => ({
        title: r.title,
        importance: r.importance,
        description: r.description,
      })), null, 2)
    }

    // ── 工具4：按名称精确查询世界设定 ────────────────────────
    case 'querySettingByName': {
      const { name } = args
      if (!name) return JSON.stringify({ error: 'name参数必填' })

      const rows = await db
        .select({
          name: novelSettings.name,
          type: novelSettings.type,
          content: novelSettings.content,
          importance: novelSettings.importance,
        })
        .from(novelSettings)
        .where(and(
          eq(novelSettings.novelId, novelId),
          sql`${novelSettings.deletedAt} IS NULL`,
          like(novelSettings.name, `%${name}%`),
        ))
        .limit(3)
        .all()

      if (rows.length === 0) {
        return JSON.stringify({ message: `未找到名称含"${name}"的世界设定，请尝试searchSemantic模糊搜索` })
      }

      return JSON.stringify(rows.map(r => ({
        name: r.name,
        type: r.type,
        importance: r.importance,
        content: r.content,
      })), null, 2)
    }

    // ── 工具5：语义搜索（兜底） ───────────────────────────────
    case 'searchSemantic': {
      if (!env.VECTORIZE) {
        return JSON.stringify({ error: 'Vectorize服务不可用' })
      }
      const { query, topK = 5, sourceTypes } = args
      if (!query) return JSON.stringify({ error: 'query参数必填' })

      const queryVector = await embedText(env.AI, query)
      const { searchSimilarMulti } = await import('../embedding')
      const results = await searchSimilarMulti(env.VECTORIZE, queryVector, {
        topK: Math.min(topK, 10),
        novelId,
        sourceTypes: sourceTypes || [...ACTIVE_SOURCE_TYPES],
      })

      if (results.length === 0) {
        return JSON.stringify({ message: `未找到与"${query}"相关的内容` })
      }

      return JSON.stringify(results.map(r => ({
        type: r.metadata.sourceType,
        title: r.metadata.title,
        content: r.metadata.content?.slice(0, 500),
        score: Math.round(r.score * 1000) / 1000,
      })), null, 2)
    }

    default:
      return JSON.stringify({
        error: `未知工具: ${toolName}`,
        available: ['searchChapterHistory', 'queryCharacterByName', 'queryForeshadowing', 'querySettingByName', 'searchSemantic']
      })
  }
}
```

---

## 九、System Prompt支持小说专属引言

**文件：`server/services/agent/messages.ts`，`buildMessages` 函数**

当前 `systemPromptOverride` 只支持4个preset key（fantasy/urban/mystery/scifi）或完整替换。建议扩展支持在preset基础上追加小说专属引言：

```ts
// 在 SYSTEM_PROMPTS 之后，buildMessages 函数内修改 systemPrompt 组装逻辑

export function buildMessages(
  chapterTitle: string,
  contextBundle: ContextBundle | null,
  options: GenerationOptions = {},
  systemPromptOverride?: string,
  novelSystemNote?: string,   // 新增：小说专属引言，来自 llmConfig.params
) {
  const basePrompt =
    systemPromptOverride && SYSTEM_PROMPTS[systemPromptOverride]
      ? SYSTEM_PROMPTS[systemPromptOverride]
      : (systemPromptOverride || SYSTEM_PROMPTS.fantasy)

  // 如果有小说专属引言，拼在base之后
  const systemPrompt = novelSystemNote
    ? `${basePrompt}\n\n【本小说专属约束】\n${novelSystemNote}`
    : basePrompt
  // ...其余不变
}
```

**`llmConfig.params` 新增字段：**

```ts
// llm.ts LLMConfig interface
params?: {
  temperature?: number
  max_tokens?: number
  // ...已有字段...
  systemPromptOverride?: string
  novelSystemNote?: string   // 新增：小说专属约束，以system message权重注入
}
```

**用途：** 在模型配置页面增加一个"小说专属引言"输入框，让用户填入：
```
本小说世界名：天玄大陆。主角：林岩。最高禁忌：主角不得在无充分铺垫时突破两个大境界。
境界体系唯一权威名称：炼气→筑基→金丹→元婴→化神→合体→大乘→渡劫→仙人。
任何设定词必须与角色卡和世界设定一字不差。
```
以system message身份注入，比user message资料包里的规则卡注意力权重更高。

---

## 十、优化效果预期

| 问题 | 优化前 | 优化后 |
|------|--------|--------|
| 章节截断 | max_tokens=4096，5000字必截 | max_tokens=10000，充足余量 |
| 设定词漂移 | frequency/presence_penalty=0.3 | 改为0，复用词不受惩罚 |
| RAG召回精度 | queryText含整章正文，语义稀释 | 聚焦本章标题+事件行，≤800字 |
| 主角占用角色槽 | 可能召回主角挤掉配角 | 明确排除protagonist |
| 设定槽漏关 | 关键词匹配失败则整槽关闭 | 始终开启，不靠猜测 |
| 摘要信息密度 | 自由格式，细节丢失率高 | 结构化4字段，强制保留状态 |
| 伏笔注入顺序 | 早期伏笔每章必出，新伏笔可能被截 | 按创建时间倒序，新伏笔优先 |
| 工具查已有内容 | queryOutline/queryCharacter与资料包重叠 | 5个新工具完全覆盖资料包盲区 |
| 模型无法点名查角色 | 只能按role批量查，无精确查询 | queryCharacterByName精确查完整卡片 |
| 历史细节无法追溯 | 超过20章的历史完全黑盒 | searchChapterHistory关键词检索 |

---

> 文档版本：v1.0
> 基于代码：NovelForge v4.1.0
> 适用目标：400-500万字长篇小说生成场景
