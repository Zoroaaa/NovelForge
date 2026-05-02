# NovelForge 跨章节细节一致性系统 · 完整方案

> 基于 contextBuilder v4 / postProcess 6步 / ReAct工具调用 的全架构深度阅读  
> 目标：构建一套能支撑500章长篇，细节零漂移的工程级一致性系统

---

## 一、现有架构的真实边界

先把现有系统能做什么、不能做什么说清楚，是设计新方案的前提。

### 1.1 现有系统实际能覆盖的范围

| 机制 | 覆盖范围 | 工作方式 |
|------|----------|----------|
| Slot-9 摘要链（20章） | 最近20章的剧情连续性 | DB直查，确定性 |
| Slot-2 上一章正文 | 紧接的场景状态 | DB直查，确定性 |
| Slot-5 角色卡RAG | **已在characters表登记的**角色 | RAG语义召回，概率性 |
| Slot-6 设定RAG | **已在novel_settings表登记的**设定 | RAG语义召回，概率性 |
| Slot-7 伏笔 | **已登记的**open状态伏笔 | 高优DB兜底+RAG，混合 |
| step3 PowerLevel | characters表已有角色的境界突破 | 章节后处理，事后更新 |
| ReAct工具1-5 | 历史摘要检索、精确名称查询 | LLM主动调用，依赖LLM判断 |

### 1.2 现有系统的真实盲区（这就是一致性问题的来源）

**盲区一：即兴创造的实体从未被记录**

LLM在第100章创造了"赤焰刀法"、"落霞谷"、"老孙头渔夫"——这三个实体从未进入 `novel_settings`、`characters` 或任何可召回存储。第300章面对同样的实体，LLM从零重新创造，结果不同。

这不是召回问题，是根本没有东西可召回。

**盲区二：已登记的成长性实体只存快照，不存历史**

`characters.powerLevel` 存的是当前境界，会被覆盖。  
`novel_settings.content` 存的是创建时的描述，不会随剧情演进更新。  
一个势力从强盛到覆灭、一个功法从残缺到圆满——这些变化历史在现有架构里完全丢失。  
第500章回到这个势力的废墟，系统给LLM的还是那份"强盛时期的势力介绍"。

**盲区三：RAG的概率性召回在跨章场景下不可靠**

向量相似度依赖query词和存储内容的语义重叠。第500章的事件线写的是"回到故地"，没有地名。这个query和第100章存储的"落霞谷"描述之间的相似度，取决于两段文字的措辞——这是概率，不是确定性。

**盲区四：ReAct工具调用依赖LLM的主动性**

`searchChapterHistory`、`querySettingByName` 等工具只在LLM意识到"我需要查一下"时才被调用。LLM不知道自己不知道什么——它不会因为不记得第100章创造了什么地点而主动去查。

---

## 二、整体架构设计

用一张图描述新系统的全貌：

```
╔══════════════════════════════════════════════════════════════════╗
║                    跨章一致性系统 · 全景图                        ║
╠══════════════════════════════════════════════════════════════════╣
║                                                                  ║
║  ┌─────────────────────────────────────────────────┐            ║
║  │  【层一】生成前：确定性上下文注入                 │            ║
║  │  A. 关键词精确匹配层（新） → 强制召回已知实体     │            ║
║  │  B. 成长态快照层（新） → 注入实体当前最新状态     │            ║
║  │  C. 现有Slot-5/6 RAG → 语义相关实体兜底          │            ║
║  └──────────────────────┬──────────────────────────┘            ║
║                          │ 生成阶段                              ║
║  ┌───────────────────────▼─────────────────────────┐            ║
║  │  【层二】生成中：主动防御约束                     │            ║
║  │  D. HARD_CONSTRAINTS 补充实体约束条款             │            ║
║  │  E. ReAct工具层强化（新增工具6/7）                │            ║
║  └──────────────────────┬──────────────────────────┘            ║
║                          │ 生成完成                              ║
║  ┌───────────────────────▼─────────────────────────┐            ║
║  │  【层三】生成后：知识库固化 + 矛盾检测            │            ║
║  │  F. step7 实体自动提取（新） → 固化即兴创造       │            ║
║  │  G. step8 成长态更新（新） → 追踪实体状态变化     │            ║
║  │  H. step9 实体碰撞检测（新） → 发现历史矛盾       │            ║
║  └─────────────────────────────────────────────────┘            ║
║                                                                  ║
╠══════════════════════════════════════════════════════════════════╣
║  【新增数据层】                                                   ║
║  novel_inline_entities 表 — 章节内提取的临时实体注册中心          ║
║  entity_state_log 表 — 成长性实体的全历史状态链                   ║
║  entity_conflict_log 表 — 检测到的矛盾记录（供作者决策）          ║
╚══════════════════════════════════════════════════════════════════╝
```

---

## 三、新增数据层设计

这是整个系统的地基，先把表设计好。

### 3.1 novel_inline_entities 表（核心新表）

**用途**：存储从章节内容中自动提取的、未在正式设定表中登记的实体。这是解决"即兴创造实体无法跨章召回"的根本数据结构。

```sql
CREATE TABLE novel_inline_entities (
  id               TEXT PRIMARY KEY,
  novel_id         TEXT NOT NULL,
  
  -- 实体基础信息
  entity_type      TEXT NOT NULL,  -- 'character'|'location'|'skill'|'artifact'|'faction'|'lore'
  name             TEXT NOT NULL,  -- 正式名称（主键级别，全书唯一）
  aliases          TEXT,           -- JSON数组：别称/简称/相关词，用于关键词精确匹配
  description      TEXT NOT NULL,  -- 首次出场时的完整描述（100-400字）
  summary          TEXT,           -- 30字精简摘要，用于RAG向量化
  
  -- 首次出场信息
  first_chapter_id     TEXT NOT NULL,
  first_chapter_order  INTEGER NOT NULL,
  
  -- 最后提及信息（每次step7更新）
  last_chapter_id      TEXT,
  last_chapter_order   INTEGER,
  
  -- 成长性标记
  is_growable      INTEGER NOT NULL DEFAULT 0,  -- 0/1，是否有成长弧线
  
  -- 关联到正式设定（如果后来被作者手工录入了正式设定）
  promoted_to_setting_id  TEXT,  -- 关联 novel_settings.id，NULL=仍是inline状态
  
  -- 向量化（复用embedding基础设施）
  vector_id        TEXT,
  indexed_at       INTEGER,
  
  -- 标准字段
  created_at       INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at       INTEGER NOT NULL DEFAULT (unixepoch()),
  deleted_at       INTEGER
);

CREATE INDEX idx_inline_entities_novel ON novel_inline_entities(novel_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_inline_entities_type ON novel_inline_entities(novel_id, entity_type) WHERE deleted_at IS NULL;
CREATE INDEX idx_inline_entities_name ON novel_inline_entities(novel_id, name) WHERE deleted_at IS NULL;
CREATE INDEX idx_inline_entities_growable ON novel_inline_entities(novel_id, is_growable) WHERE deleted_at IS NULL;
```

**关键设计说明**：
- `aliases` 是关键词精确匹配的核心，由提取LLM同时生成
- `promoted_to_setting_id` 允许作者将某个高价值inline实体"升格"为正式设定，升格后inline记录保留但标记关联，避免重复
- 向量化复用现有 `embedding.ts` 基础设施，`sourceType='inline_entity'`

---

### 3.2 entity_state_log 表（成长性实体历史链）

**用途**：记录所有成长性实体（功法/宝物/势力/角色关系网络）在每个关键章节的状态快照，构成完整的历史链。

```sql
CREATE TABLE entity_state_log (
  id               TEXT PRIMARY KEY,
  novel_id         TEXT NOT NULL,
  
  -- 实体来源（两种：正式设定 or inline实体）
  source_type      TEXT NOT NULL,  -- 'setting'|'inline'|'character'
  source_id        TEXT NOT NULL,  -- 对应表的id
  entity_name      TEXT NOT NULL,  -- 冗余存储，方便查询
  entity_type      TEXT NOT NULL,  -- 同上分类
  
  -- 状态快照
  chapter_id       TEXT NOT NULL,
  chapter_order    INTEGER NOT NULL,
  
  state_type       TEXT NOT NULL,  -- 'created'|'upgraded'|'damaged'|'lost'|'expanded'|'weakened'|'revealed'|'destroyed'
  state_summary    TEXT NOT NULL,  -- 这次状态变化的简述（50字以内）
  state_detail     TEXT,           -- 完整细节（200字以内）
  
  -- 变化前后对比（供碰撞检测和上下文注入使用）
  prev_state       TEXT,           -- 变化前的状态描述
  curr_state       TEXT NOT NULL,  -- 变化后的状态描述（这是"当前状态"的主要内容）
  
  created_at       INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX idx_state_log_entity ON entity_state_log(source_type, source_id, chapter_order);
CREATE INDEX idx_state_log_novel ON entity_state_log(novel_id, chapter_order);
CREATE INDEX idx_state_log_chapter ON entity_state_log(chapter_id);
```

**覆盖的实体类型及状态变化枚举**：

| entity_type | 典型 state_type | 例子 |
|-------------|-----------------|------|
| skill（功法） | created/upgraded/revealed/lost | 残缺→补全第四式 |
| artifact（宝物） | created/upgraded/damaged/lost/awakened | 普通玉佩→器灵觉醒 |
| faction（势力） | created/expanded/weakened/destroyed | 三千人→覆灭仅剩残党 |
| character（角色关系/立场） | created/betrayed/allied/hostile/revealed | 盟友→叛徒 |
| location（地点） | created/changed/destroyed | 繁华集市→战后废墟 |

---

### 3.3 entity_conflict_log 表（矛盾检测记录）

**用途**：step9碰撞检测发现的矛盾存入此表，前端展示供作者决策，不自动修改任何内容。

```sql
CREATE TABLE entity_conflict_log (
  id               TEXT PRIMARY KEY,
  novel_id         TEXT NOT NULL,
  
  -- 发现矛盾的章节
  detected_chapter_id     TEXT NOT NULL,
  detected_chapter_order  INTEGER NOT NULL,
  
  -- 冲突实体信息
  entity_name      TEXT NOT NULL,
  entity_type      TEXT NOT NULL,
  source_type      TEXT NOT NULL,  -- 来自哪张表
  source_id        TEXT NOT NULL,
  
  -- 矛盾详情
  conflict_type    TEXT NOT NULL,  -- 'name'|'attribute'|'state'|'timeline'|'logic'
  description      TEXT NOT NULL,  -- 矛盾描述（200字以内）
  current_chapter_excerpt TEXT,    -- 本章相关原文（100字以内）
  historical_record       TEXT,    -- 历史记录中的对应内容
  historical_chapter_order INTEGER, -- 历史记录来自哪章
  
  severity         TEXT NOT NULL,  -- 'error'|'warning'
  
  -- 作者决策
  resolution       TEXT,           -- NULL=待处理 | 'update_record'|'keep_chapter'|'ignored'
  resolved_at      INTEGER,
  
  created_at       INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX idx_conflict_log_novel ON entity_conflict_log(novel_id, created_at DESC);
CREATE INDEX idx_conflict_log_chapter ON entity_conflict_log(detected_chapter_id);
CREATE INDEX idx_conflict_log_pending ON entity_conflict_log(novel_id, resolution) WHERE resolution IS NULL;
```

---

## 四、层一：生成前确定性上下文注入

### 4.1 关键词精确匹配层（新增 Slot-10）

**原理**：在 `buildChapterContext` 的 Step 2b（构建queryText）之后，立即执行关键词扫描，对 `novel_inline_entities` 表里所有实体的 `aliases` 做精确匹配，命中的实体强制注入上下文，不经过RAG打分。

**实现位置**：`contextBuilder.ts` Step 2c（新增）

```typescript
async function buildForcedEntitySlot(
  db: AppDb,
  novelId: string,
  queryText: string,          // 章节标题 + 事件线 + 最近3条摘要尾部
  budget: number,             // ~4000 tokens
): Promise<{ forced: string[]; hitNames: string[] }> {
  
  // 1. 读取所有inline实体的名称和aliases（只读轻量字段）
  const allEntities = await db
    .select({
      id: novelInlineEntities.id,
      name: novelInlineEntities.name,
      aliases: novelInlineEntities.aliases,
      entityType: novelInlineEntities.entityType,
      description: novelInlineEntities.description,
      isGrowable: novelInlineEntities.isGrowable,
      firstChapterOrder: novelInlineEntities.firstChapterOrder,
    })
    .from(novelInlineEntities)
    .where(and(
      eq(novelInlineEntities.novelId, novelId),
      isNull(novelInlineEntities.deletedAt),
    ))
    .all()

  const hitEntities: typeof allEntities = []

  for (const entity of allEntities) {
    const keywords: string[] = [entity.name]
    if (entity.aliases) {
      try { keywords.push(...JSON.parse(entity.aliases)) } catch {}
    }
    // 任一关键词在queryText中精确出现 → 命中
    if (keywords.some(kw => kw.length >= 2 && queryText.includes(kw))) {
      hitEntities.push(entity)
    }
  }

  if (hitEntities.length === 0) return { forced: [], hitNames: [] }

  // 2. 对命中的成长性实体，查询其最新状态
  const growableIds = hitEntities
    .filter(e => e.isGrowable)
    .map(e => e.id)
  
  const latestStates = new Map<string, string>()
  if (growableIds.length > 0) {
    // 取每个实体最新的一条state_log
    for (const entityId of growableIds) {
      const latest = await db
        .select({
          currState: entityStateLog.currState,
          stateType: entityStateLog.stateType,
          chapterOrder: entityStateLog.chapterOrder,
        })
        .from(entityStateLog)
        .where(and(
          eq(entityStateLog.sourceType, 'inline'),
          eq(entityStateLog.sourceId, entityId),
        ))
        .orderBy(desc(entityStateLog.chapterOrder))
        .limit(1)
        .get()
      
      if (latest) {
        latestStates.set(entityId, `[第${latest.chapterOrder}章后·${latest.stateType}] ${latest.currState}`)
      }
    }
  }

  // 3. 构建注入卡片
  const cards: string[] = []
  let usedTokens = 0

  for (const entity of hitEntities) {
    const typeLabel = { character:'人物', location:'地点', skill:'功法', artifact:'宝物', faction:'势力', lore:'知识' }[entity.entityType] || '其他'
    
    let card = `【${entity.name}】(${typeLabel}·第${entity.firstChapterOrder}章首次出场)\n${entity.description}`
    
    const latestState = latestStates.get(entity.id)
    if (latestState) {
      card += `\n⚡ 当前状态：${latestState}`
    }
    
    const tokens = estimateTokens(card)
    if (usedTokens + tokens > budget) break
    
    cards.push(card)
    usedTokens += tokens
  }

  return { forced: cards, hitNames: hitEntities.map(e => e.name) }
}
```

**queryText 扩充**（比现有版本更全面）：

```typescript
// 现有queryText构建（Step 2b）追加以下内容：
const queryTextParts = [
  currentChapter.title,
  prevEvent,
  currentEvent,
  nextThreeChapters,
  // 新增：最近3条摘要的末尾（捕捉"接续上回"类的隐式关联）
  ...recentSummaries.slice(-3).map(s => s.slice(-200)),
  // 新增：卷蓝图（卷级背景词，包含势力/地点名）
  volumeInfo.blueprint?.slice(0, 300) ?? '',
  // 现有
  prevContent?.slice(-400) ?? '',
]
const queryText = queryTextParts.filter(Boolean).join('\n').slice(0, 1200)  // 从800扩展到1200
```

---

### 4.2 成长态注入层（升级现有Slot-5/6）

**问题**：现有 `buildSettingsSlotV2` 返回的是 `novel_settings.content`（创建时的描述），对于已发生多次状态演变的实体，给LLM的是"过时的历史状态"。

**改造位置**：`buildSettingsSlotV2` 和 `buildCharacterSlotFromDB` 都需要升级。

```typescript
// 对 novel_settings 中 importance='high' 且 isGrowable=true 的实体：
// 在拼接content之后，追加其最新 entity_state_log 记录

async function appendLatestStateToSettingCards(
  db: AppDb,
  novelId: string,
  settingIds: string[],  // 当前批次命中的setting ID列表
): Promise<Map<string, string>> {
  // 返回 Map<settingId, latestStateText>
  const result = new Map<string, string>()
  
  for (const sid of settingIds) {
    const logs = await db
      .select()
      .from(entityStateLog)
      .where(and(
        eq(entityStateLog.sourceType, 'setting'),
        eq(entityStateLog.sourceId, sid),
      ))
      .orderBy(desc(entityStateLog.chapterOrder))
      .limit(3)  // 最近3次状态变化
      .all()
    
    if (logs.length > 0) {
      const stateChain = logs.reverse().map(l => 
        `第${l.chapterOrder}章(${l.stateType})：${l.currState}`
      ).join(' → ')
      result.set(sid, `[状态演变] ${stateChain}`)
    }
  }
  
  return result
}
```

同样的逻辑应用于 `buildCharacterSlotFromDB`，给配角卡片追加关系/立场变化历史。

---

### 4.3 Slot合并与预算分配

在 `ContextBundle` 中新增字段，并更新 `assemblePromptContext` 的区块顺序：

```typescript
// ContextBundle.dynamic 新增
forcedEntityCards: string[]   // Slot-10：关键词精确命中的inline实体
hitEntityNames: string[]      // 命中的实体名称列表（供step9碰撞检测使用）

// assemblePromptContext 新增区块（在 ## 本章出场角色 之前）
if (bundle.dynamic.forcedEntityCards.length > 0) {
  sections.push(`## 本章涉及的已有记录\n⚠️ 以下实体在本书中已有明确记录，所有属性必须严格沿用\n\n${bundle.dynamic.forcedEntityCards.join('\n\n')}`)
}
```

**预算调整**：

```typescript
export const DEFAULT_BUDGET: BudgetTier = {
  core: 40000,
  summaryChain: 22000,  // 从25000降低，为新槽让出空间
  characters: 18000,    // 从20000降低
  foreshadowing: 10000,
  settings: 22000,      // 从25000降低
  rules: 8000,
  forcedEntities: 6000, // 新增：关键词强制注入槽
  total: 126000,        // 总计不超过原有128k
}
```

---

## 五、层二：生成中主动防御

### 5.1 HARD_CONSTRAINTS 补充

在 `messages.ts` 的 `HARD_CONSTRAINTS` 末尾追加：

```
F. 已有记录约束：资料包"本章涉及的已有记录"区块中列出的所有实体，其名称、类型、核心属性必须严格沿用；
   如果该实体有"当前状态"或"状态演变"标注，必须以最新状态为准进行描写，不得使用过时状态
G. 信息边界约束：上一章正文中未曾向读者披露的信息（某个秘密的来历、某件宝物的名称、某人的真实身份），
   本章不得让角色凭空知晓，除非本章的情节本身就是揭露该信息的场景
H. 即兴创造约束：本章若需要创造资料包中未出现的新角色/地点/功法/宝物，该实体在本章内的描写必须前后完全一致；
   同一章内对同一实体的描写不得出现矛盾
```

### 5.2 ReAct工具层强化

现有5个工具已覆盖主动查询场景，补充2个新工具解决盲区：

**工具6：查询inline实体**

```typescript
{
  type: 'function',
  function: {
    name: 'queryInlineEntity',
    description: `查询章节即兴创造实体库中的实体记录。
适用场景：
- 想写到某个地点/功法/宝物，不确定之前有没有出现过
- 记得前文提到过某个名字，但资料包里没有，需要查确切描述
- 需要确认某个次要配角的历史出场信息
注意：此工具查询的是"非正式设定"的即兴创造实体，正式设定用querySettingByName。`,
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '实体名称或关键词' },
        entityType: { 
          type: 'string', 
          enum: ['character', 'location', 'skill', 'artifact', 'faction', 'lore'],
          description: '实体类型，不确定时不传'
        },
      },
      required: ['name'],
    },
  },
},
```

**工具7：查询实体状态历史**

```typescript
{
  type: 'function',
  function: {
    name: 'queryEntityStateHistory',
    description: `查询某个具有成长弧线的实体（功法/宝物/势力）的完整状态历史。
适用场景：
- 写到主角的某门功法，需要确认当前修炼程度和已解锁的能力
- 写到某个势力，需要了解其当前状态（是否仍存在、规模如何）
- 写到某件宝物，需要确认当前状态（是否被强化、是否损坏）
- 写到某段关系，需要确认当前的立场和关系演变`,
    parameters: {
      type: 'object',
      properties: {
        entityName: { type: 'string', description: '实体名称' },
        limit: { type: 'number', description: '返回最近N条状态记录，默认5' },
      },
      required: ['entityName'],
    },
  },
},
```

---

## 六、层三：生成后知识库固化与矛盾检测

### 6.1 step7 — 实体自动提取与固化

**执行时机**：在 step1（自动摘要）完成后立即执行，因为step7的结果会被step8/9依赖。

**LLM调用策略**：使用 `analysis` 模型（轻量），温度0.1，确保提取稳定。

**提取Prompt核心设计**：

```
你是小说编辑数据库，负责从章节内容中提取"新出现的专有实体"，建立跨章一致性记录。

【已有实体名称清单】（这些已经记录，不需要重复提取）
=== 正式设定 ===
{existingSettingNames}   // novel_settings.name 的去重列表，只传名称

=== 已有inline记录 ===
{existingInlineNames}    // novel_inline_entities.name 的去重列表

【本章标题】{chapterTitle}
【本章内容】{chapterContent}

【提取规则——宁漏勿滥】
✅ 提取条件（同时满足）：
  1. 有专有名称（专有名词），而非泛称（"一座山"、"某个老人"不提取）
  2. 在本章有实质内容描述（至少2句以上的描写），一笔带过不提取
  3. 不在上方"已有实体名称清单"中

✅ 特殊：信息揭露类
  如果本章首次明确了某个已有实体的关键属性（如揭露了金手指的名称/来历），
  也作为一条"lore"类型记录输出，用于修正已有记录

❌ 不提取：泛称、重复已有实体、本章一笔带过的路人名字

【输出格式】（JSON，无提取内容时输出 {"entities":[],"stateChanges":[]}）
{
  "entities": [
    {
      "entity_type": "character|location|skill|artifact|faction|lore",
      "name": "正式名称",
      "aliases": ["别称1", "简称", "相关词"],
      "description": "本章中关于此实体的完整描述，100-300字",
      "summary": "30字精简摘要",
      "is_growable": true/false,  // 功法/宝物/势力/角色立场 = true；人物外形/地点基本信息 = false
      "initial_state": "如果is_growable=true，描述当前初始状态（50字以内）"
    }
  ],
  "stateChanges": [
    {
      "entity_name": "已有实体的名称（必须在已有清单中存在）",
      "source_type": "setting|inline|character",
      "state_type": "upgraded|damaged|lost|expanded|weakened|destroyed|revealed|betrayed|allied",
      "state_summary": "这次变化的简述（30字以内）",
      "prev_state": "变化前的状态描述（30字以内）",
      "curr_state": "变化后的状态描述（50字以内）",
      "detail": "完整细节（100字以内）"
    }
  ]
}
```

**写入逻辑**：

```typescript
async function step7EntityExtract(env, chapterId, novelId): Promise<void> {
  const db = drizzle(env.DB)
  
  // 1. 获取章节内容
  const chapter = await db.select().from(chapters).where(eq(chapters.id, chapterId)).get()
  if (!chapter?.content) return
  
  // 2. 构建已有实体名称清单（只传名称，不传内容，节省token）
  const [settingNames, inlineNames] = await Promise.all([
    db.select({ name: novelSettings.name }).from(novelSettings)
      .where(and(eq(novelSettings.novelId, novelId), isNull(novelSettings.deletedAt))).all()
      .then(rows => rows.map(r => r.name)),
    db.select({ name: novelInlineEntities.name }).from(novelInlineEntities)
      .where(and(eq(novelInlineEntities.novelId, novelId), isNull(novelInlineEntities.deletedAt))).all()
      .then(rows => rows.map(r => r.name)),
  ])
  
  // 3. 调用LLM提取
  const result = await extractEntities(env, chapter, settingNames, inlineNames, novelId)
  
  // 4. 写入 novel_inline_entities
  for (const entity of result.entities) {
    const entityId = generateId()
    await db.insert(novelInlineEntities).values({
      id: entityId,
      novelId,
      entityType: entity.entity_type,
      name: entity.name,
      aliases: JSON.stringify(entity.aliases || []),
      description: entity.description,
      summary: entity.summary,
      firstChapterId: chapterId,
      firstChapterOrder: chapter.sortOrder,
      lastChapterId: chapterId,
      lastChapterOrder: chapter.sortOrder,
      isGrowable: entity.is_growable ? 1 : 0,
      createdAt: unixepoch(),
      updatedAt: unixepoch(),
    })
    
    // 如果is_growable，写入初始状态到 entity_state_log
    if (entity.is_growable && entity.initial_state) {
      await db.insert(entityStateLog).values({
        id: generateId(),
        novelId,
        sourceType: 'inline',
        sourceId: entityId,
        entityName: entity.name,
        entityType: entity.entity_type,
        chapterId,
        chapterOrder: chapter.sortOrder,
        stateType: 'created',
        stateSummary: '首次出场',
        currState: entity.initial_state,
        createdAt: unixepoch(),
      })
    }
    
    // 异步触发向量化（不阻塞postProcess）
    await enqueue(env, 'vectorize_inline_entity', { entityId, novelId })
  }
  
  // 5. 处理 stateChanges
  for (const change of result.stateChanges) {
    // 查找对应实体的sourceId
    const sourceId = await resolveEntitySourceId(db, novelId, change.entity_name, change.source_type)
    if (!sourceId) continue
    
    await db.insert(entityStateLog).values({
      id: generateId(),
      novelId,
      sourceType: change.source_type,
      sourceId,
      entityName: change.entity_name,
      entityType: change.entity_type || 'unknown',
      chapterId,
      chapterOrder: chapter.sortOrder,
      stateType: change.state_type,
      stateSummary: change.state_summary,
      stateDetail: change.detail,
      prevState: change.prev_state,
      currState: change.curr_state,
      createdAt: unixepoch(),
    })
    
    // 更新 last_mentioned
    if (change.source_type === 'inline') {
      await db.update(novelInlineEntities)
        .set({ lastChapterId: chapterId, lastChapterOrder: chapter.sortOrder, updatedAt: unixepoch() })
        .where(eq(novelInlineEntities.id, sourceId))
    }
  }
  
  console.log(`📦 [step7] 提取 ${result.entities.length} 个新实体, ${result.stateChanges.length} 个状态变化`)
}
```

---

### 6.2 step8 — 成长态实体状态更新（从 step7 分离）

step7只处理"新实体创建"和"已有实体的明确状态变化"。step8专门处理一类更细微的场景：**实体被提及，但没有明显状态变化，只需要更新 `last_mentioned`**。

```typescript
async function step8UpdateLastMentioned(env, chapterId, novelId, hitEntityNames: string[]): Promise<void> {
  if (hitEntityNames.length === 0) return
  const db = drizzle(env.DB)
  const chapter = await db.select({ sortOrder: chapters.sortOrder }).from(chapters).where(eq(chapters.id, chapterId)).get()
  if (!chapter) return
  
  // 批量更新所有在本章被提及的inline实体的 last_mentioned
  for (const name of hitEntityNames) {
    await db.update(novelInlineEntities)
      .set({ lastChapterId: chapterId, lastChapterOrder: chapter.sortOrder, updatedAt: unixepoch() })
      .where(and(
        eq(novelInlineEntities.novelId, novelId),
        eq(novelInlineEntities.name, name),
        isNull(novelInlineEntities.deletedAt),
      ))
  }
}
```

> `hitEntityNames` 从 `buildForcedEntitySlot` 的返回值中取得，在 postProcess 入参中传递。

---

### 6.3 step9 — 实体碰撞检测

**执行时机**：在 step7（实体提取）完成后执行，因为step9需要比对step7的提取结果和历史记录。

**检测策略**：分两阶段，第一阶段用精确匹配做快速筛查，第二阶段才调用LLM做语义判断。

```typescript
async function step9EntityConflictDetect(env, chapterId, novelId, newlyExtracted: ExtractedEntity[]): Promise<void> {
  const db = drizzle(env.DB)
  const chapter = await db.select({ content: chapters.content, sortOrder: chapters.sortOrder })
    .from(chapters).where(eq(chapters.id, chapterId)).get()
  if (!chapter?.content) return
  
  const conflicts: ConflictCandidate[] = []
  
  // 阶段一：精确字段级碰撞检测（不调用LLM）
  for (const entity of newlyExtracted) {
    // 查是否已有同名实体
    const existing = await db.select().from(novelInlineEntities)
      .where(and(
        eq(novelInlineEntities.novelId, novelId),
        eq(novelInlineEntities.name, entity.name),
        isNull(novelInlineEntities.deletedAt),
      ))
      .get()
    
    // 如果没有找到同名inline实体，查正式设定
    if (!existing) {
      const settingExisting = await db.select().from(novelSettings)
        .where(and(
          eq(novelSettings.novelId, novelId),
          eq(novelSettings.name, entity.name),
          isNull(novelSettings.deletedAt),
        ))
        .get()
      
      if (settingExisting) {
        // 有同名正式设定，但step7把它当"新实体"提取了
        // 说明step7的提取出了问题，或者名称冲突
        conflicts.push({
          entityName: entity.name,
          conflictType: 'name',
          description: `本章提取的"${entity.name}"与正式设定中的同名实体可能重复`,
          severity: 'warning',
          currentChapterExcerpt: entity.description.slice(0, 100),
          historicalRecord: settingExisting.content.slice(0, 100),
          historicalChapterOrder: null,
          sourceType: 'setting',
          sourceId: settingExisting.id,
        })
      }
      continue
    }
    
    // 找到同名已有记录：检查实体类型是否一致
    if (existing.entityType !== entity.entity_type) {
      conflicts.push({
        entityName: entity.name,
        conflictType: 'attribute',
        description: `"${entity.name}"在第${existing.firstChapterOrder}章被记录为"${existing.entityType}"，本章描述为"${entity.entity_type}"`,
        severity: 'error',
        currentChapterExcerpt: entity.description.slice(0, 100),
        historicalRecord: existing.description.slice(0, 100),
        historicalChapterOrder: existing.firstChapterOrder,
        sourceType: 'inline',
        sourceId: existing.id,
      })
    }
  }
  
  // 阶段二：对于成长性实体，用LLM检查状态连续性
  // 只对本章 stateChanges 中的实体，且历史有多条状态记录的才做LLM检查（避免过度消耗）
  const growableChanges = newlyExtracted.filter(e => e.is_growable && e.state_type && e.state_type !== 'created')
  
  for (const entity of growableChanges) {
    const stateHistory = await db.select()
      .from(entityStateLog)
      .where(and(
        eq(entityStateLog.novelId, novelId),
        eq(entityStateLog.entityName, entity.name),
      ))
      .orderBy(desc(entityStateLog.chapterOrder))
      .limit(5)
      .all()
    
    if (stateHistory.length < 2) continue  // 历史太少，不做检查
    
    // 构建LLM检查请求（轻量）
    const historyText = stateHistory.reverse().map(s =>
      `第${s.chapterOrder}章(${s.stateType})：${s.currState}`
    ).join('\n')
    
    const conflictCheck = await checkStateConflict(env, entity.name, historyText, entity.description, novelId)
    if (conflictCheck.hasConflict) {
      conflicts.push({
        entityName: entity.name,
        conflictType: 'state',
        description: conflictCheck.description,
        severity: conflictCheck.severity,
        currentChapterExcerpt: entity.description.slice(0, 100),
        historicalRecord: historyText.slice(0, 200),
        historicalChapterOrder: stateHistory[stateHistory.length - 1].chapterOrder,
        sourceType: 'inline',
        sourceId: stateHistory[0].sourceId,
      })
    }
  }
  
  // 写入 entity_conflict_log
  for (const conflict of conflicts) {
    await db.insert(entityConflictLog).values({
      id: generateId(),
      novelId,
      detectedChapterId: chapterId,
      detectedChapterOrder: chapter.sortOrder,
      ...conflict,
      createdAt: unixepoch(),
    })
  }
  
  console.log(`🔍 [step9] 检测到 ${conflicts.length} 个实体矛盾`)
}
```

---

## 七、前端：实体管理中心（新页面）

以上三层是后端工程，但这套系统需要一个完整的前端来让作者：
1. 查看和管理自动提取的inline实体
2. 查看实体的状态历史时间线
3. 处理矛盾告警
4. 将重要的inline实体"升格"为正式设定

### 7.1 实体管理页（InlineEntityPage）

新增路由 `/novels/:id/entities`，分三个Tab：

**Tab 1：实体库**

- 按类型分组展示所有inline实体（人物/地点/功法/宝物/势力/知识）
- 每个实体卡片显示：名称、首次出场章节、最后提及章节、类型、是否成长性
- 点击展开：完整描述 + 状态历史时间线
- 操作：**升格为正式设定**（一键复制到 novel_settings）、**合并**（将两个同实体的不同记录合并）、**删除**

**Tab 2：状态时间线**

- 筛选条件：实体类型/实体名称/章节范围
- 时间线视图：横轴是章节序号，纵轴是实体，每个状态变化点显示为色块
- 颜色编码：created=绿、upgraded=蓝、damaged=橙、destroyed=红
- 点击色块查看详情

**Tab 3：矛盾告警**

- 待处理矛盾列表（按严重程度排序）
- 每条显示：矛盾章节、实体名称、矛盾描述、历史记录 vs 本章描述
- 三个操作按钮：
  - **以本章为准**：更新历史记录的描述（写入新的state_log，标记历史记录为superseded）
  - **以历史为准**：标记本章为已知偏差（写入 `resolution='keep_chapter'`，不修改内容）
  - **忽略**：标记为非矛盾（`resolution='ignored'`）

### 7.2 WorkspacePage 集成

章节健康Tab（已有）新增一项：

```
🔴 实体矛盾 (2)
• "落霞谷" 本章描述为废墟，但第102章记录为繁华集市
• "赤焰刀法" 本章写主角施展完整四式，但第66章记录该功法仅有前三式
→ [前往实体管理] 处理告警
```

---

## 八、处理规模问题

500章长篇后，`novel_inline_entities` 可能有数百条记录，`entity_state_log` 可能有千条记录。需要对关键词扫描做性能保护。

### 8.1 关键词扫描的性能策略

```typescript
// 不是所有inline实体都需要每次扫描，加入两个筛选条件：
// 1. 只扫描"最近300章内曾出现"的实体（last_chapter_order >= currentOrder - 300）
//    + 重要实体（is_growable=true 的始终扫描，不受章节限制）
// 2. D1 层面索引已覆盖，查询本身很快（< 5ms）

const activeEntities = await db.select(...)
  .from(novelInlineEntities)
  .where(and(
    eq(novelInlineEntities.novelId, novelId),
    isNull(novelInlineEntities.deletedAt),
    sql`(${novelInlineEntities.lastChapterOrder} >= ${currentOrder - 300} 
         OR ${novelInlineEntities.isGrowable} = 1)`,
  ))
  .all()
```

### 8.2 step7的"已有名称清单"规模控制

当设定数量超过500条时，全量传入LLM会消耗过多token：

```typescript
// 分层传入：
// - 重要程度high: 全量传入名称
// - 重要程度normal: 全量传入名称
// - inline实体: 只传最近200章内出现的实体名称
const recentInlineNames = inlineNames.filter(n => n.lastChapterOrder >= currentOrder - 200)
```

### 8.3 state_log的查询优化

`entity_state_log` 的索引已设计为 `(source_type, source_id, chapter_order)`，查询最新状态时永远走索引，不做全表扫描。

---

## 九、完整的 postProcess 步骤顺序

```typescript
export async function runPostProcess(env, payload): Promise<void> {
  const { chapterId, novelId, enableAutoSummary, usage } = payload
  
  // 现有步骤
  await step1AutoSummary(env, chapterId, novelId, enableAutoSummary, usage)
  
  // ★ 新增：先做实体提取，因为后续步骤可能依赖其结果
  const extractResult = await step7EntityExtract(env, chapterId, novelId)
  
  // 现有步骤
  await step2Foreshadowing(env, chapterId, novelId)
  await step3PowerLevel(env, chapterId, novelId)
  await step4CharacterConsistency(env, chapterId, novelId)
  await step5Coherence(env, chapterId, novelId)
  await step6VolumeProgress(env, chapterId, novelId)
  
  // ★ 新增：碰撞检测（依赖step7结果）
  await step9EntityConflictDetect(env, chapterId, novelId, extractResult.entities)
}
```

---

## 十、改造文件清单与改动量评估

| 文件/目录 | 操作 | 核心改动 | 估时 |
|-----------|------|----------|------|
| `server/db/schema.ts` | 修改 | 新增3张表定义 | 1h |
| `server/db/migrations/` | 新建 | 对应migration SQL | 30min |
| `server/services/entityExtract.ts` | **新建** | step7全部实现（提取LLM调用+写入逻辑） | 1天 |
| `server/services/entityConflict.ts` | **新建** | step9碰撞检测（精确+LLM两阶段） | 1天 |
| `server/services/agent/postProcess.ts` | 修改 | 接入step7/step9，调整顺序 | 2h |
| `server/services/contextBuilder.ts` | 修改 | 新增Step 2c关键词扫描、Slot-10强制注入、成长态追加 | 1天 |
| `server/services/agent/messages.ts` | 修改 | HARD_CONSTRAINTS追加F/G/H三条 | 30min |
| `server/services/agent/tools.ts` | 修改 | 新增工具6/7（queryInlineEntity/queryEntityStateHistory） | 2h |
| `server/services/agent/executor.ts` | 修改 | 实现工具6/7的执行逻辑 | 2h |
| `server/routes/inline-entities.ts` | **新建** | CRUD API（列表/详情/升格/合并/删除） | 1天 |
| `server/routes/entity-conflict.ts` | **新建** | 矛盾告警API（列表/处理决策） | 4h |
| `src/pages/InlineEntityPage.tsx` | **新建** | 实体管理中心（三Tab） | 2天 |
| `src/components/chapter/ChapterHealthTab` | 修改 | 新增实体矛盾告警展示 | 4h |
| `src/components/layout/` | 修改 | 导航栏新增"实体库"入口 | 1h |

**总估时：约10个工作日**

---

## 十一、执行顺序建议

```
Week 1：
  Day 1-2：数据库新增3张表 + schema + migration
  Day 3-4：entityExtract.ts（step7）实现 + 接入postProcess
  Day 5：在已有章节上跑step7，验证提取质量，调整LLM prompt

Week 2：
  Day 1-2：contextBuilder改造（关键词扫描层 + Slot-10 + 成长态注入）
  Day 3：messages.ts约束补充 + tools.ts工具6/7
  Day 4-5：entityConflict.ts（step9）实现

Week 3：
  Day 1-2：后端路由（inline-entities / entity-conflict）
  Day 3-5：前端 InlineEntityPage（三Tab）+ ChapterHealthTab集成
```

**最优先做的两件事**（1天内可见效果）：
1. Step7实体提取接入postProcess → 新生成的章节开始积累实体数据库
2. HARD_CONSTRAINTS补充F/G/H → 立即对新生成的章节产生约束效果

**关键词扫描层（contextBuilder）要等step7跑了一段时间后再上线**，否则扫描的是空数据库，意义不大。

---

*方案版本 v1.0 · 2026-04-30*
