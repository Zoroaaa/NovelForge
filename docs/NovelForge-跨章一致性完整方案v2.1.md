# NovelForge 跨章一致性完整方案

> 基于 contextBuilder v4 / postProcess 9步 / ReAct工具调用 / 角色成长系统 的全架构深度阅读
> 目标：构建一套能支撑500章长篇，细节零漂移的工程级一致性系统
> 版本：v2.0（融合v2原版 + 补充方案 + Phase D内容）
> 更新日期：2026-05-02

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

**盲区五：角色成长性（心理/关系/信息边界）完全未追踪**

现有 `step3 PowerLevel` 只追踪境界数值。角色在几百章里真正会发生的变化：
- 心理/性格弧线：冲动→沉稳、信任→多疑
- 人际关系网络：盟友变敌、师徒决裂
- 已知信息边界：第100章知道了秘密，第300章不能装不知道
- 身体状态/残缺：失去眼睛、某脉被废
- 立场/阵营转变
- 重大经历积累

这些不只影响主角，**重要配角**同样有成长弧，且配角的立场转变往往是剧情关键节点。

**盲区六：章节摘要的结构化信息被浪费**

`summarizer.ts` 生成的摘要已有四段结构（【角色状态变化】【关键事件】【道具/功法】【章末状态】），但以非结构化文本形式存在，从未被解析成结构化数据驱动一致性系统。

**盲区七：主角视角的信息边界管理缺失**

第150章，主角偷听到了反派的真实身份——但他假装不知道。第200章生成时，LLM拿到的主角卡没有记录这个信息，于是LLM让主角对反派毫无防备。这不是实体描述矛盾，是**主角视角的信息边界**问题。

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
║  │  A. 关键词精确匹配层 → 强制召回已知实体           │            ║
║  │  B. 成长态快照层 → 注入实体当前最新状态          │            ║
║  │  C. 角色成长注入层 → 主角/配角成长状态同步       │            ║
║  │  D. 关系网络注入层 → 本章涉及角色的关系矩阵     │            ║
║  │  E. 现有Slot-5/6 RAG → 语义相关实体兜底          │            ║
║  └──────────────────────┬──────────────────────────┘            ║
║                          │ 生成阶段                              ║
║  ┌───────────────────────▼─────────────────────────┐            ║
║  │  【层二】生成中：主动防御约束                     │            ║
║  │  F. HARD_CONSTRAINTS 补充实体约束条款            │            ║
║  │  G. ReAct工具层强化（新增工具6/7/8）             │            ║
║  └──────────────────────┬──────────────────────────┘            ║
║                          │ 生成完成                              ║
║  ┌───────────────────────▼─────────────────────────┐            ║
║  │  【层三】生成后：知识库固化 + 矛盾检测           │            ║
║  │  H. step1b 摘要结构化解析（新）                  │            ║
║  │  I. step7 实体自动提取（新）→ 固化即兴创造       │            ║
║  │  J. step8 角色成长追踪（新）→ 追踪成长变化       │            ║
║  │  K. step9 实体碰撞检测（新）→ 发现历史矛盾       │            ║
║  └─────────────────────────────────────────────────┘            ║
║                                                                  ║
╠══════════════════════════════════════════════════════════════════╣
║  【新增数据层】                                                   ║
║  novel_inline_entities 表 — 章节内提取的临时实体注册中心          ║
║  entity_state_log 表 — 成长性实体的全历史状态链                   ║
║  entity_conflict_log 表 — 检测到的矛盾记录（供作者决策）          ║
║  character_growth_log 表 — 角色成长历史链（7维度）               ║
║  character_relationships 表 — 关系网络当前快照                    ║
║  chapter_structured_data 表 — 摘要结构化缓存                      ║
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

### 3.4 character_growth_log 表（角色成长历史链）

**用途**：追踪角色的7维度成长变化（境界/心理/关系/知识/身体/立场/誓言），构成完整的角色成长历史。

```sql
CREATE TABLE character_growth_log (
  id                TEXT PRIMARY KEY,
  novel_id          TEXT NOT NULL,
  character_id      TEXT NOT NULL,   -- 关联 characters.id
  character_name    TEXT NOT NULL,   -- 冗余存储，方便查询

  chapter_id        TEXT NOT NULL,
  chapter_order     INTEGER NOT NULL,

  -- 变化分类
  growth_dimension  TEXT NOT NULL,
  -- 枚举值：
  -- 'power'          境界/实力变化（与step3联动）
  -- 'psychology'     心理/性格弧线变化
  -- 'relationship'   人际关系变化（关联character_id_target）
  -- 'knowledge'      获得关键认知（知道了某个秘密）
  -- 'physical'       身体状态变化（受伤/残缺/特殊体质激活）
  -- 'stance'         立场/阵营变化
  -- 'oath_debt'      誓言/恩情/仇恨等强绑定事件

  -- 关系变化时的对象（可为NULL）
  character_id_target TEXT,          -- 关系变化的对象角色ID
  character_name_target TEXT,        -- 对象角色名（冗余）

  -- 状态描述
  prev_state        TEXT,            -- 变化前的状态描述（30字）
  curr_state        TEXT NOT NULL,   -- 变化后的状态描述（50字）
  detail            TEXT,            -- 完整细节（100字）

  -- 特殊标记
  is_secret         INTEGER DEFAULT 0,  -- 1=主角知道但对外保密（信息边界）
  is_public         INTEGER DEFAULT 1,  -- 0=只有主角知道，1=公开事件

  created_at        INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX idx_char_growth_character ON character_growth_log(character_id, chapter_order);
CREATE INDEX idx_char_growth_novel ON character_growth_log(novel_id, chapter_order);
CREATE INDEX idx_char_growth_dimension ON character_growth_log(novel_id, growth_dimension);
CREATE INDEX idx_char_growth_knowledge ON character_growth_log(character_id, growth_dimension)
  WHERE growth_dimension = 'knowledge';
```

---

### 3.5 character_relationships 表（关系网络当前快照）

**用途**：存储角色间当前关系的快照，解决关系动态变化无法追踪的问题。

```sql
CREATE TABLE character_relationships (
  id                TEXT PRIMARY KEY,
  novel_id          TEXT NOT NULL,

  -- 关系双方（强制 char_id_a < char_id_b，避免重复）
  character_id_a    TEXT NOT NULL,
  character_name_a  TEXT NOT NULL,
  character_id_b    TEXT NOT NULL,
  character_name_b  TEXT NOT NULL,

  -- 当前关系状态
  relation_type     TEXT NOT NULL,
  -- 枚举值：
  -- 'allied'     盟友/同伴
  -- 'hostile'    敌对
  -- 'mentor'     师徒（a是师）
  -- 'neutral'    中立/陌生
  -- 'romantic'   情感羁绊
  -- 'indebted'   恩情（a欠b）
  -- 'vendetta'   血仇（a恨b）
  -- 'unknown'    互不相识

  relation_desc     TEXT NOT NULL,   -- 关系的具体描述（50字）
  established_chapter_order INTEGER, -- 这段关系建立的章节
  last_updated_chapter_order INTEGER NOT NULL,
  last_updated_chapter_id TEXT NOT NULL,

  created_at        INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at        INTEGER NOT NULL DEFAULT (unixepoch()),
  deleted_at        INTEGER
);

CREATE UNIQUE INDEX idx_relationship_pair ON character_relationships(novel_id, character_id_a, character_id_b)
  WHERE deleted_at IS NULL;
CREATE INDEX idx_relationship_novel ON character_relationships(novel_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_relationship_char ON character_relationships(character_id_a) WHERE deleted_at IS NULL;
```

**设计说明**：`character_relationships` 存当前关系快照，`character_growth_log` 的 `growth_dimension='relationship'` 存历史变化记录。两表配合：快照用于生成前注入，历史用于碰撞检测和时间线展示。

---

### 3.6 chapter_structured_data 表（摘要结构化缓存）

**用途**：将 summarizer 产出的结构化信息解析保存，供各步骤直接使用，避免重复分析。

```sql
CREATE TABLE chapter_structured_data (
  id                TEXT PRIMARY KEY,
  novel_id          TEXT NOT NULL,
  chapter_id        TEXT NOT NULL UNIQUE,
  chapter_order     INTEGER NOT NULL,

  -- 从摘要解析出的结构化数据（JSON）
  character_changes TEXT,   -- [{characterName, changeType, prevState, currState}]
  new_entities      TEXT,   -- [{type, name, description}]  -- 供step7参考，减少重复提取
  chapter_end_state TEXT,   -- {location, situation, direction}  -- 章末状态
  key_events        TEXT,   -- [string]  -- 关键事件列表
  knowledge_reveals TEXT,   -- [{who, what, isSecret}]  -- 信息揭露事件

  created_at        INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at        INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX idx_structured_data_novel ON chapter_structured_data(novel_id, chapter_order);
```

---

## 四、层一：生成前确定性上下文注入

### 4.1 关键词精确匹配层（Slot-10）

**原理**：在 `buildChapterContext` 的 Step 2b（构建queryText）之后，立即执行关键词扫描，对 `novel_inline_entities` 表里所有实体的 `aliases` 做精确匹配，命中的实体强制注入上下文，不经过RAG打分。

**实现位置**：`contextBuilder.ts` Step 2c（新增）

```typescript
async function buildForcedEntitySlot(
  db: AppDb,
  novelId: string,
  queryText: string,
  budget: number,
): Promise<{ forced: string[]; hitNames: string[] }> {

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
    if (keywords.some(kw => kw.length >= 2 && queryText.includes(kw))) {
      hitEntities.push(entity)
    }
  }

  if (hitEntities.length === 0) return { forced: [], hitNames: [] }

  const growableIds = hitEntities.filter(e => e.isGrowable).map(e => e.id)
  const latestStates = new Map<string, string>()

  if (growableIds.length > 0) {
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

---

### 4.2 成长态注入层（升级现有Slot-5/6）

**问题**：现有 `buildSettingsSlotV2` 返回的是 `novel_settings.content`（创建时的描述），对于已发生多次状态演变的实体，给LLM的是"过时的历史状态"。

**改造位置**：`buildSettingsSlotV2` 和 `buildCharacterSlotFromDB` 都需要升级。

```typescript
async function appendLatestStateToSettingCards(
  db: AppDb,
  novelId: string,
  settingIds: string[],
): Promise<Map<string, string>> {
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
      .limit(3)
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

---

### 4.3 主角状态卡升级（Slot-3）

现有 `fetchProtagonistCards` 只读 `characters.description` 和 `powerLevel`。升级后追加成长历史：

```typescript
async function fetchProtagonistFullState(
  db: AppDb,
  novelId: string,
  currentChapterOrder: number,
): Promise<string[]> {
  const protagonists = await db.select()
    .from(characters)
    .where(and(eq(characters.novelId, novelId), eq(characters.role, 'protagonist'), isNull(characters.deletedAt)))
    .all()

  return Promise.all(protagonists.map(async (p) => {
    let card = `【${p.name}（主角）】\n${p.description || ''}`

    if (p.powerLevel) {
      try {
        const pl = JSON.parse(p.powerLevel)
        card += `\n当前境界：${pl.current || '未知'}`
        if (pl.nextMilestone) card += `，目标：${pl.nextMilestone}`
      } catch {}
    }

    let attrs: any = {}
    try { attrs = JSON.parse(p.attributes || '{}') } catch {}
    if (attrs.growthStates?.psychology) {
      card += `\n当前心理状态：${attrs.growthStates.psychology}`
    }
    if (attrs.growthStates?.physical) {
      card += `\n身体状态：${attrs.growthStates.physical}`
    }
    if (attrs.growthStates?.stance) {
      card += `\n当前立场：${attrs.growthStates.stance}`
    }

    const knowledgeItems = await db.select()
      .from(characterGrowthLog)
      .where(and(
        eq(characterGrowthLog.characterId, p.id),
        eq(characterGrowthLog.growthDimension, 'knowledge'),
        sql`${characterGrowthLog.chapterOrder} <= ${currentChapterOrder}`,
      ))
      .orderBy(desc(characterGrowthLog.chapterOrder))
      .limit(8)
      .all()

    if (knowledgeItems.length > 0) {
      card += `\n\n【主角已知的关键信息（不得遗忘）】`
      for (const k of knowledgeItems) {
        const secretTag = k.isSecret ? '（秘密，对外保密）' : ''
        card += `\n• ${k.currState}${secretTag}`
      }
    }

    const oaths = await db.select()
      .from(characterGrowthLog)
      .where(and(
        eq(characterGrowthLog.characterId, p.id),
        eq(characterGrowthLog.growthDimension, 'oath_debt'),
      ))
      .orderBy(desc(characterGrowthLog.chapterOrder))
      .limit(5)
      .all()

    if (oaths.length > 0) {
      card += `\n【誓言/恩情/血仇】`
      for (const o of oaths) {
        card += `\n• 第${o.chapterOrder}章：${o.currState}`
      }
    }

    return card
  }))
}
```

---

### 4.4 配角卡片升级（Slot-5）

在 `buildCharacterSlotFromDB` 的 `formatCharacterCard` 之后，追加配角的关系和状态：

```typescript
async function enrichCharacterCardWithGrowth(
  db: AppDb,
  character: CharacterRow,
  currentChapterOrder: number,
): Promise<string> {
  let card = formatCharacterCard(character)

  let attrs: any = {}
  try { attrs = JSON.parse(character.attributes || '{}') } catch {}
  if (attrs.growthStates?.psychology) card += `\n心理状态：${attrs.growthStates.psychology}`
  if (attrs.growthStates?.physical) card += `\n身体状态：${attrs.growthStates.physical}`
  if (attrs.growthStates?.stance) card += `\n当前立场：${attrs.growthStates.stance}`

  const protagonistIds = await getProtagonistIds(db, character.novelId)
  for (const pid of protagonistIds) {
    const rel = await getRelationship(db, character.novelId, character.id, pid)
    if (rel) {
      card += `\n与主角关系：${rel.relationDesc}（第${rel.lastUpdatedChapterOrder}章更新）`
    }
  }

  return card
}
```

---

### 4.5 关系网络注入（Slot-11）

对于"涉及多角色互动"的章节，将主要角色之间的当前关系矩阵注入上下文：

```typescript
async function buildRelationshipSlot(
  db: AppDb,
  novelId: string,
  involvedCharacterIds: string[],
  budget: number,
): Promise<string[]> {
  if (involvedCharacterIds.length < 2) return []

  const pairs: string[] = []

  for (let i = 0; i < involvedCharacterIds.length; i++) {
    for (let j = i + 1; j < involvedCharacterIds.length; j++) {
      const rel = await getRelationship(db, novelId, involvedCharacterIds[i], involvedCharacterIds[j])
      if (rel && rel.relationType !== 'unknown' && rel.relationType !== 'neutral') {
        pairs.push(`${rel.characterNameA} ↔ ${rel.characterNameB}：${rel.relationDesc}`)
      }
    }
  }

  return pairs
}
```

在 `assemblePromptContext` 中新增区块：

```
## 本章角色关系
（当前已建立的非中立关系，生成时必须体现在角色互动中）
林枫 ↔ 苏雪：暗生情愫但互相隐瞒（第88章建立）
林枫 ↔ 赤炎长老：表面师徒，林枫内心已怀疑其与家族惨案有关（第102章更新）
```

---

### 4.6 Slot合并与预算分配

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

**更新后的完整Slot布局**：

| Slot | 内容 | 来源 | 预算 |
|------|------|------|------|
| Slot-0 | 总纲全文/摘要 | DB直查 | ~10000 |
| Slot-1 | 当前卷蓝图+事件线 | DB直查 | ~1500 |
| Slot-2 | 上一章正文 | DB直查 | ~5000 |
| Slot-3 | 主角完整状态卡（**升级**：+知识边界+誓言+成长状态） | DB直查 | ~4000 |
| Slot-4 | 全部活跃创作规则 | DB直查 | ~5000 |
| Slot-5 | 出场角色卡（**升级**：+growthStates+与主角关系） | RAG+DB | ~7000 |
| Slot-6 | 世界设定（**升级**：成长性设定追加最新stateLog） | RAG+DB | ~10000 |
| Slot-7 | 待回收伏笔 | 混合 | ~4000 |
| Slot-8 | 本章类型规则 | DB过滤 | ~3000 |
| Slot-9 | 近期摘要链（20章） | DB直查 | ~10000 |
| Slot-10 | **★新增**：关键词强制召回的inline实体（含最新stateLog） | 精确匹配 | ~4000 |
| Slot-11 | **★新增**：本章涉及角色的关系网络 | DB直查 | ~2000 |

总计：~65500 tokens，在128k预算内有充足余量供正文生成。

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
I. 信息边界约束：资料包"主角状态"区块中【主角已知的关键信息】列出的所有条目，
   主角在本章的行为和决策中必须体现已知这些信息；
   标注"（秘密，对外保密）"的条目，主角不得在对话中主动透露，
   但其内心决策必须受到这些信息影响
```

---

### 5.2 ReAct工具层强化

现有5个工具已覆盖主动查询场景，补充3个新工具：

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

**工具8：查询角色成长历史**

```typescript
{
  type: 'function',
  function: {
    name: 'queryCharacterGrowth',
    description: `查询某个角色的完整成长历史。
适用场景：
- 写到某个角色，需要确认其当前心理状态和立场变化
- 需要确认角色与其他角色关系的演变历史
- 需要确认角色已知的重要信息（知识边界）
- 确认角色的重要誓言、恩情、血仇等约束`,
    parameters: {
      type: 'object',
      properties: {
        characterName: { type: 'string', description: '角色名称' },
        dimension: {
          type: 'string',
          enum: ['power', 'psychology', 'relationship', 'knowledge', 'physical', 'stance', 'oath_debt'],
          description: '成长维度，不传则查全部'
        },
        limit: { type: 'number', description: '返回最近N条记录，默认10' },
      },
      required: ['characterName'],
    },
  },
},
```

---

## 六、层三：生成后知识库固化与矛盾检测

### 6.1 step1b — 摘要结构化解析（新增）

在 step1（自动摘要）完成后立即执行，解析摘要四段结构存入 `chapter_structured_data`：

```typescript
async function step1bParseStructuredData(
  db: AppDb,
  novelId: string,
  chapterId: string,
  chapterOrder: number,
  summaryText: string,
): Promise<ParsedChapterData> {
  const extractSection = (tag: string): string => {
    const match = summaryText.match(new RegExp(`【${tag}】([\\s\\S]*?)(?=【|$)`))
    return match?.[1]?.trim() || ''
  }

  const charChangesText = extractSection('角色状态变化')
  const entitiesText = extractSection('道具/功法')
  const endStateText = extractSection('章末状态')
  const eventsText = extractSection('关键事件')

  await db.insert(chapterStructuredData).values({
    id: generateId(),
    novelId,
    chapterId,
    chapterOrder,
    characterChanges: charChangesText || null,
    newEntities: entitiesText || null,
    chapterEndState: endStateText || null,
    keyEvents: eventsText || null,
    updatedAt: sql`(unixepoch())`,
  }).onConflictDoUpdate({
    target: chapterStructuredData.chapterId,
    set: { characterChanges: charChangesText, newEntities: entitiesText, chapterEndState: endStateText, keyEvents: eventsText, updatedAt: sql`(unixepoch())` }
  })

  return { charChangesText, entitiesText, endStateText, eventsText }
}
```

---

### 6.2 step7 — 实体自动提取与固化

**执行时机**：在 step1b（摘要结构化解析）完成后立即执行。

**LLM调用策略**：使用 `analysis` 模型（轻量），温度0.1，确保提取稳定。

**提取Prompt核心设计**：

```
你是小说编辑数据库，负责从章节内容中提取"新出现的专有实体"，建立跨章一致性记录。

【已有实体名称清单】（这些已经记录，不需要重复提取）
=== 正式设定 ===
{existingSettingNames}

=== 已有inline记录 ===
{existingInlineNames}

【本章标题】{chapterTitle}
【本章内容】{chapterContent}

【提取规则——宁漏勿滥】
✅ 提取条件（同时满足）：
  1. 有专有名称（专有名词），而非泛称（"一座山"、"某个老人"不提取）
  2. 在本章有实质内容描述（至少2句以上的描写），一笔带过不提取
  3. 不在上方"已有实体名称清单"中

✅ 特殊：信息揭露类
  如果本章首次明确了某个已有实体的关键属性，也作为一条"lore"类型记录输出

❌ 不提取：泛称、重复已有实体、本章一笔带过的路人名字

【输出格式】（JSON，无提取内容时输出 {"entities":[],"stateChanges":[]}）
{
  "entities": [...],
  "stateChanges": [...],
  "characterGrowths": [...],
  "knowledgeReveals": [...]
}
```

**characterGrowths 提取规则**：

```
角色成长变化提取规则：
✅ psychology：心理发生明确转变，不是一时情绪波动
✅ relationship：两个角色之间的关系性质发生改变
✅ knowledge：角色获得了对全局有影响的关键认知
✅ physical：持久的身体状态变化（非本章战斗的轻伤）
✅ stance：明确的立场/阵营转变
✅ oath_debt：具有约束力的誓言、重大恩情、血仇确立
❌ 不提取：临时情绪、普通战斗伤势、已有记录中明确标注的已知状态
```

---

### 6.3 step8 — 角色成长追踪写入

将 step7 提取的 characterGrowths 和 knowledgeReveals 写入 `character_growth_log`，并同步更新关系快照：

```typescript
async function writeCharacterGrowths(
  db: AppDb,
  novelId: string,
  chapterId: string,
  chapterOrder: number,
  growths: CharacterGrowth[],
  knowledgeReveals: KnowledgeReveal[],
): Promise<void> {

  for (const growth of growths) {
    const charId = await resolveCharacterId(db, novelId, growth.character_name)
    if (!charId) continue

    let targetCharId: string | null = null
    if (growth.character_name_target) {
      targetCharId = await resolveCharacterId(db, novelId, growth.character_name_target)
    }

    await db.insert(characterGrowthLog).values({
      id: generateId(),
      novelId,
      characterId: charId,
      characterName: growth.character_name,
      chapterId,
      chapterOrder,
      growthDimension: growth.growth_dimension,
      characterIdTarget: targetCharId,
      characterNameTarget: growth.character_name_target ?? null,
      prevState: growth.prev_state,
      currState: growth.curr_state,
      detail: growth.detail,
      isSecret: growth.is_secret ? 1 : 0,
      isPublic: growth.is_public ? 1 : 0,
    })

    if (growth.growth_dimension === 'relationship' && targetCharId) {
      await upsertRelationship(db, novelId, charId, growth.character_name, targetCharId, growth.character_name_target!, growth, chapterId, chapterOrder)
    }

    if (['psychology', 'physical', 'stance'].includes(growth.growth_dimension)) {
      await updateCharacterCurrentState(db, charId, growth.growth_dimension, growth.curr_state)
    }
  }

  for (const reveal of knowledgeReveals) {
    const charId = await resolveCharacterId(db, novelId, reveal.who_learns)
    if (!charId) continue

    await db.insert(characterGrowthLog).values({
      id: generateId(),
      novelId,
      characterId: charId,
      characterName: reveal.who_learns,
      chapterId,
      chapterOrder,
      growthDimension: 'knowledge',
      currState: reveal.what_learned,
      detail: `来源：${reveal.source}`,
      isSecret: reveal.is_secret ? 1 : 0,
      isPublic: 0,
    })
  }
}
```

---

### 6.4 step9 — 实体碰撞检测

**执行时机**：在 step7（实体提取）完成后执行。

**检测策略**：分两阶段，第一阶段用精确匹配做快速筛查，第二阶段才调用LLM做语义判断。

---

### 6.5 关系快照的 upsert 逻辑

```typescript
async function upsertRelationship(
  db: AppDb,
  novelId: string,
  charIdA: string,
  charNameA: string,
  charIdB: string,
  charNameB: string,
  growth: CharacterGrowth,
  chapterId: string,
  chapterOrder: number,
): Promise<void> {
  const [idA, nameA, idB, nameB] = charIdA < charIdB
    ? [charIdA, charNameA, charIdB, charNameB]
    : [charIdB, charNameB, charIdA, charNameA]

  const existing = await db.select()
    .from(characterRelationships)
    .where(and(
      eq(characterRelationships.novelId, novelId),
      eq(characterRelationships.characterIdA, idA),
      eq(characterRelationships.characterIdB, idB),
      isNull(characterRelationships.deletedAt),
    ))
    .get()

  if (existing) {
    await db.update(characterRelationships)
      .set({
        relationType: inferRelationType(growth.curr_state),
        relationDesc: growth.curr_state,
        lastUpdatedChapterOrder: chapterOrder,
        lastUpdatedChapterId: chapterId,
        updatedAt: sql`(unixepoch())`,
      })
      .where(eq(characterRelationships.id, existing.id))
  } else {
    await db.insert(characterRelationships).values({
      id: generateId(),
      novelId,
      characterIdA: idA,
      characterNameA: nameA,
      characterIdB: idB,
      characterNameB: nameB,
      relationType: inferRelationType(growth.curr_state),
      relationDesc: growth.curr_state,
      establishedChapterOrder: chapterOrder,
      lastUpdatedChapterOrder: chapterOrder,
      lastUpdatedChapterId: chapterId,
    })
  }
}

function inferRelationType(stateDesc: string): string {
  if (/盟友|同伴|并肩|结义/.test(stateDesc)) return 'allied'
  if (/敌对|仇敌|追杀|为敌/.test(stateDesc)) return 'hostile'
  if (/师徒|拜师|传授/.test(stateDesc)) return 'mentor'
  if (/情|喜欢|爱/.test(stateDesc)) return 'romantic'
  if (/欠|恩情|救命/.test(stateDesc)) return 'indebted'
  if (/仇|血债|不共戴天/.test(stateDesc)) return 'vendetta'
  return 'neutral'
}
```

---

### 6.6 向量化时序问题解决

step7提取inline实体后，向量化是异步Queue任务。下一章生成时（可能很快），向量库里没有这些实体。

**解决方案：双轨并行，不依赖向量化完成**

**关键词匹配层**（Slot-10）查的是 `novel_inline_entities` 表，不依赖向量库，所以step7写入DB后立即可用。

**RAG层**（Slot-5/6）依赖向量库，存在时延。但这是兜底层，主力召回已由关键词匹配层承担。

对于那些aliases覆盖不全导致关键词匹配未命中、同时向量化又还没完成的情况，可以在step7写入后同步做一次**强制向量化**：

```typescript
for (const entity of result.entities) {
  try {
    const embedding = await embedText(env.AI, `${entity.name}：${entity.summary}`)
    await env.VECTORIZE.upsert([{
      id: entity.id,
      values: embedding,
      metadata: { novelId, sourceType: 'inline_entity', sourceId: entity.id, name: entity.name }
    }])
    await db.update(novelInlineEntities)
      .set({ vectorId: entity.id, indexedAt: sql`(unixepoch())` })
      .where(eq(novelInlineEntities.id, entity.id))
  } catch (e) {
    console.warn(`[step7] 向量化失败，关键词匹配层仍可兜底：${entity.name}`, e)
  }
}
```

---

## 七、完整的 postProcess 步骤顺序

```typescript
export async function runPostProcess(env, payload): Promise<void> {
  const { chapterId, novelId, enableAutoSummary, usage } = payload

  const summaryResult = await step1AutoSummary(env, chapterId, novelId, enableAutoSummary, usage)

  await step1bParseStructuredData(env, chapterId, novelId)

  await step2Foreshadowing(env, chapterId, novelId)

  await step3PowerLevel(env, chapterId, novelId)

  await step4CharacterConsistency(env, chapterId, novelId)

  await step5Coherence(env, chapterId, novelId)

  await step6VolumeProgress(env, chapterId, novelId)

  const extractResult = await step7EntityExtract(env, chapterId, novelId)

  await step8CharacterGrowth(env, chapterId, novelId, extractResult.characterGrowths, extractResult.knowledgeReveals)

  await step9EntityConflictDetect(env, chapterId, novelId, extractResult.entities)
}
```

---

## 八、前端：实体管理中心（新页面）

### 8.1 实体管理页（InlineEntityPage）

新增路由 `/novels/:id/entities`，分四个Tab：

**Tab 1：实体库**
- 按类型分组展示所有inline实体（人物/地点/功法/宝物/势力/知识）
- 每个实体卡片显示：名称、首次出场章节、最后提及章节、类型、是否成长性
- 点击展开：完整描述 + 状态历史时间线
- 操作：**升格为正式设定**（一键复制到 novel_settings）、**合并**、**删除**

**Tab 2：状态时间线**
- 筛选条件：实体类型/实体名称/章节范围
- 时间线视图：横轴是章节序号，纵轴是实体，每个状态变化点显示为色块
- 颜色编码：created=绿、upgraded=蓝、damaged=橙、destroyed=红

**Tab 3：矛盾告警**
- 待处理矛盾列表（按严重程度排序）
- 三个操作按钮：**以本章为准** / **以历史为准** / **忽略**

**Tab 4：角色成长时间线**
- 选择角色（主角/主要配角）
- 按维度筛选：全部 / 境界 / 心理 / 关系 / 已知信息 / 身体 / 立场 / 誓言
- 时间线展示：每条变化记录显示章节序号、变化类型（色块）、before→after
- 关系网络视图：当前所有已建立关系的图谱
- 知识边界视图：主角当前已知的所有关键信息列表，标注"公开/秘密"

### 8.2 ChapterHealthTab 新增

```
🟡 角色成长提取 (3)
• 林枫：心理状态更新（冲动→开始学会隐忍）
• 林枫 ↔ 苏雪：关系建立（萍水相逢→欠下救命恩情）
• 林枫：获得关键认知（知道赤炎长老是家族灭门幕后黑手）[秘密]
→ [查看角色时间线]

🔴 实体矛盾 (2)
• "落霞谷" 本章描述为废墟，但第102章记录为繁华集市
• "赤焰刀法" 本章写主角施展完整四式，但第66章记录该功法仅有前三式
→ [前往实体管理] 处理告警
```

---

## 九、处理规模问题

### 9.1 关键词扫描的性能策略

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

---

## 十、覆盖范围决策

### 10.1 角色成长追踪范围

| 角色类型 | 境界追踪 | 心理弧线 | 关系网络 | 已知信息 | 身体状态 |
|----------|----------|----------|----------|----------|----------|
| 主角 | ✅ 全追踪 | ✅ 全追踪 | ✅ 全追踪 | ✅ 全追踪 | ✅ 全追踪 |
| 主要配角（role=supporting/antagonist） | ✅ 全追踪 | ✅ 追踪重大变化 | ✅ 全追踪 | ❌ 不追踪 | ✅ 重大伤残追踪 |
| 次要配角（其他role） | ✅ 境界变化 | ❌ | ✅ 关系变化 | ❌ | ❌ |
| inline实体中的character类型 | ❌ | ❌ | ✅ 与主角关系 | ❌ | ❌ |

**理由**：主角是一致性要求最高的，全追踪。主要配角的心理弧线影响剧情走向，追踪重大变化。次要配角和inline角色不做深度追踪，避免系统过载。

### 10.2 明确不做的边界

| 项目 | 不做的原因 |
|------|-----------|
| 路人配角的心理追踪 | ROI极低，路人在剧情中不会反复出现，追踪成本远高于收益 |
| 自动修复矛盾内容 | AI不应自动改写已写内容，决策权必须在作者手里 |
| 实时跨卷一致性检查（全局扫描） | 计算成本极高，作为按需触发功能已规划 |
| 对话风格跨章一致性 | 已由 `characters.attributes.speechPattern` + step4 CharacterConsistency 覆盖 |
| 世界观逻辑自洽性（如魔法体系规则） | 已由 `novel_settings` 的 `worldRules/powerSystem` 槽 + HARD_CONSTRAINTS B条覆盖 |

---

## 十一、改造文件清单与改动量评估

| 文件/目录 | 操作 | 核心改动 | 估时 |
|-----------|------|----------|------|
| `server/db/schema.ts` | 修改 | 新增6张表定义（novel_inline_entities / entity_state_log / entity_conflict_log / character_growth_log / character_relationships / chapter_structured_data） | 2h |
| `server/db/migrations/` | 新建 | migration SQL | 1h |
| `server/services/entityExtract.ts` | **新建** | step7：实体提取+角色成长提取+知识揭露，完整LLM调用+写入逻辑 | 1.5天 |
| `server/services/characterGrowth.ts` | **新建** | step8：角色成长写入、关系upsert、主角知识边界写入 | 1天 |
| `server/services/entityConflict.ts` | **新建** | step9：碰撞检测两阶段实现 | 1天 |
| `server/services/agent/summarizer.ts` | 修改 | 新增step1b结构化解析，写入chapter_structured_data | 3h |
| `server/services/agent/postProcess.ts` | 修改 | 接入step1b/7/8/9，调整顺序 | 2h |
| `server/services/contextBuilder.ts` | 修改 | Slot-3升级/Slot-5升级/Slot-6成长态/Slot-10关键词/Slot-11关系网络 | 1.5天 |
| `server/services/agent/messages.ts` | 修改 | HARD_CONSTRAINTS追加F/G/H/I四条 | 1h |
| `server/services/agent/tools.ts` | 修改 | 新增工具6（queryInlineEntity）/7（queryEntityStateHistory）/8（queryCharacterGrowth） | 3h |
| `server/services/agent/executor.ts` | 修改 | 实现工具6/7/8的执行逻辑 | 3h |
| `server/services/agent/coherence.ts` | 修改 | checkContinuityWithPrevChapter升级使用chapter_structured_data | 2h |
| `server/routes/inline-entities.ts` | **新建** | CRUD API | 1天 |
| `server/routes/entity-conflict.ts` | **新建** | 矛盾告警API | 4h |
| `server/routes/character-growth.ts` | **新建** | 角色成长查询/关系网络API | 4h |
| `src/pages/InlineEntityPage.tsx` | **新建** | 实体管理中心（4 Tab：实体库/状态时间线/矛盾告警/角色成长时间线） | 3天 |
| `src/components/chapter/ChapterHealthTab` | 修改 | 新增实体矛盾+角色成长提取展示 | 4h |

**总估时：约16个工作日**

---

## 十二、执行顺序建议

```
Week 1：
  Day 1-2：数据库新增6张表 + schema + migration
  Day 3-4：entityExtract.ts（step7）实现 + 接入postProcess
  Day 5：在已有章节上跑step7，验证提取质量，调整LLM prompt

Week 2：
  Day 1-2：contextBuilder改造（关键词扫描层 + Slot-10 + 成长态注入）
  Day 3：summarizer.ts step1b结构化解析
  Day 4-5：characterGrowth.ts（step8）实现 + 关系upsert逻辑

Week 3：
  Day 1-2：messages.ts约束补充 + tools.ts工具6/7/8
  Day 3-4：entityConflict.ts（step9）实现
  Day 5：coherence.ts升级使用chapter_structured_data

Week 4：
  Day 1-2：后端路由（inline-entities / entity-conflict / character-growth）
  Day 3-5：前端 InlineEntityPage（四Tab）+ ChapterHealthTab集成
```

**最优先做的两件事**（1天内可见效果）：
1. Step7实体提取接入postProcess → 新生成的章节开始积累实体数据库
2. HARD_CONSTRAINTS补充F/G/H/I → 立即对新生成的章节产生约束效果

**关键词扫描层（contextBuilder）要等step7跑了一段时间后再上线**，否则扫描的是空数据库，意义不大。

---

*NovelForge 跨章一致性完整方案 · v2.0（融合v2 + 补充方案 + Phase D）· 2026-05-02*
