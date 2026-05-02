# NovelForge 跨章一致性系统 · 角色成长性 + 全遗漏点补充方案

> 承接《跨章一致性完整方案v2》，补充所有未覆盖维度  
> 本文档可与v2合并，构成完整的一致性系统实施方案

---

## 一、系统性审查：v2方案的遗漏清单

在动手写角色成长性之前，先把整个系统所有未覆盖的角落列清楚，一次性解决。

### 遗漏一：角色成长性（本文核心）

`step3 PowerLevel` 只追踪境界数值。角色在几百章里真正会发生的变化：

| 维度 | 现有覆盖 | 实际丢失 |
|------|----------|----------|
| 境界/实力 | ✅ step3 更新 characters.powerLevel | 突破历史（从哪章、从哪升到哪） |
| 心理/性格弧线 | ❌ 无 | 冲动→沉稳、信任→多疑、开朗→封闭 |
| 人际关系网络 | ❌ 无 | 盟友变敌、师徒决裂、新羁绊建立 |
| 已知信息边界 | ❌ 无 | 第100章知道了秘密，第300章不能装不知道 |
| 身体状态/残缺 | ❌ 无 | 失去眼睛、某脉被废、旧伤未愈 |
| 立场/阵营 | ❌ 无 | 从中立到加入某势力，从敌对到合作 |
| 重大经历积累 | ❌ 无 | 死过一次、欠下大恩、发过重誓 |

这些不只影响主角，**重要配角**同样有成长弧，且配角的立场转变往往是剧情关键节点。

### 遗漏二：章节摘要的结构化信息被浪费

现有 `summarizer.ts` 生成的摘要结构已经包含：
- `【角色状态变化】` — 有境界、能力、属性变化描述
- `【道具/功法】` — 新出现的实体
- `【章末状态】` — 主角当前位置/处境/方向

这些是黄金信息，**但以非结构化文本形式存在 `chapters.summary` 里，只用于Slot-9的线性摘要链展示，从未被解析成结构化数据驱动一致性系统**。step7提取实体时还要重新分析一遍章节正文，是重复工作。

### 遗漏三：角色关系网络独立性

两个角色之间的关系状态（A信任B、A欠B一命、A正在追杀B）是双向的、动态的，挂在任何一方的角色卡上都不合适。现有架构没有关系建模，LLM每次生成时只能从摘要里隐式感知，极易遗忘。

### 遗漏四："主角已知信息"边界管理

这是一致性问题里最隐蔽的一类：

> 第150章，主角偷听到了反派的真实身份——但他假装不知道。  
> 第200章生成时，LLM拿到的主角卡没有记录这个信息，于是LLM让主角对反派毫无防备，完全忘记那次偷听。

这不是实体描述矛盾，是**主角视角的信息边界**问题。现有任何机制都不处理这个。

### 遗漏五：摘要链的信息密度问题

Slot-9存储近20章摘要，每章摘要300-400字，合计6000-8000字。内容是线性叙述，适合情节连续性，但对于"200章前的某个细节"完全无效。摘要没有做结构化索引，无法被按实体维度检索。

### 遗漏六：inline实体的向量化时序问题

v2方案中step7提取完实体后异步触发向量化，但contextBuilder在下一章生成时会立即用RAG查询inline实体。**如果向量化还没完成，这个实体就不在向量库里**，RAG查不到，只有关键词匹配层能兜底。需要明确这个时序依赖。

---

## 二、新增数据表（补充v2方案）

### 2.1 character_growth_log 表（角色成长历史链）

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

### 2.2 character_relationships 表（关系网络当前快照）

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

### 2.3 chapter_structured_data 表（摘要结构化缓存）

解决遗漏二——将 summarizer 产出的结构化信息解析保存，供各步骤直接使用，避免重复分析。

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

## 三、角色成长性系统完整设计

### 3.1 覆盖范围决策

| 角色类型 | 境界追踪 | 心理弧线 | 关系网络 | 已知信息 | 身体状态 |
|----------|----------|----------|----------|----------|----------|
| 主角 | ✅ 全追踪 | ✅ 全追踪 | ✅ 全追踪 | ✅ 全追踪 | ✅ 全追踪 |
| 主要配角（登记角色中 role=supporting/antagonist） | ✅ 全追踪 | ✅ 追踪重大变化 | ✅ 全追踪 | ❌ 不追踪 | ✅ 重大伤残追踪 |
| 次要配角（登记角色中其他role） | ✅ 境界变化 | ❌ | ✅ 关系变化 | ❌ | ❌ |
| inline实体中的character类型 | ❌ | ❌ | ✅ 与主角关系 | ❌ | ❌ |

**理由**：主角是一致性要求最高的，全追踪。主要配角的心理弧线影响剧情走向，追踪重大变化。次要配角和inline角色不做深度追踪，避免系统过载。

### 3.2 step7 的角色成长提取（重新设计提取Prompt）

在v2方案的step7基础上，将**角色成长维度作为独立的提取类别**，与实体提取并列：

```
【输出格式完整版】
{
  "entities": [...],           // 新实体（同v2）
  "stateChanges": [...],       // 成长性设定状态变化（同v2）
  "characterGrowths": [        // ★ 新增：角色成长变化
    {
      "character_name": "角色名（必须是已登记角色，或inline中的character类型）",
      "growth_dimension": "power|psychology|relationship|knowledge|physical|stance|oath_debt",
      "character_name_target": "（仅relationship类型）关系对象的名称",
      "prev_state": "变化前描述（30字）",
      "curr_state": "变化后描述（50字）",
      "detail": "完整细节（100字）",
      "is_secret": false,       // true=主角知道但剧情上是秘密
      "is_public": true         // false=只有主角视角知道，其他人不知道
    }
  ],
  "knowledgeReveals": [        // ★ 新增：信息揭露事件（独立类别，精确度要求高）
    {
      "who_learns": "谁获得了这个信息（角色名）",
      "what_learned": "获得了什么信息（50字）",
      "is_secret": true,        // 这个认知是否需要对其他人保密
      "source": "从哪里/怎么得知的（20字）"
    }
  ]
}
```

**提取规则中补充角色成长维度说明**：

```
角色成长变化提取规则：
✅ psychology：心理发生明确转变，不是一时情绪波动（"开始不再相信任何人"是转变，"感到愤怒"不是）
✅ relationship：两个角色之间的关系性质发生改变（"从陌生变为师徒"、"决裂"、"立下生死之约"）
✅ knowledge：角色获得了对全局有影响的关键认知（知道了反派身份、发现了家族秘密）
✅ physical：持久的身体状态变化（非本章战斗的轻伤，而是永久性的：失明、废脉、特殊体质）
✅ stance：明确的立场/阵营转变（加入组织、公开与某方为敌、从中立到站队）
✅ oath_debt：具有约束力的誓言、重大恩情、血仇确立
❌ 不提取：临时情绪、普通战斗伤势、已有记录中明确标注的已知状态
```

### 3.3 角色成长数据的写入流程

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
    // 1. 查找角色ID（支持主角/配角/inline角色）
    const charId = await resolveCharacterId(db, novelId, growth.character_name)
    if (!charId) continue
    
    let targetCharId: string | null = null
    if (growth.character_name_target) {
      targetCharId = await resolveCharacterId(db, novelId, growth.character_name_target)
    }
    
    // 2. 写入 character_growth_log
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
    
    // 3. 如果是relationship类型，同步更新 character_relationships 快照
    if (growth.growth_dimension === 'relationship' && targetCharId) {
      await upsertRelationship(db, novelId, charId, growth.character_name, targetCharId, growth.character_name_target!, growth, chapterId, chapterOrder)
    }
    
    // 4. 如果是psychology/physical/stance，更新 characters.attributes 中的对应字段
    // （让现有的Slot-3主角卡和Slot-5配角卡能立即反映最新状态）
    if (['psychology', 'physical', 'stance'].includes(growth.growth_dimension)) {
      await updateCharacterCurrentState(db, charId, growth.growth_dimension, growth.curr_state)
    }
  }
  
  // knowledge类型单独处理
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

async function updateCharacterCurrentState(
  db: AppDb,
  characterId: string,
  dimension: string,
  currState: string,
): Promise<void> {
  const char = await db.select({ attributes: characters.attributes })
    .from(characters).where(eq(characters.id, characterId)).get()
  
  let attrs: Record<string, any> = {}
  try { attrs = JSON.parse(char?.attributes || '{}') } catch {}
  
  // 在attributes中维护 growthStates 对象
  if (!attrs.growthStates) attrs.growthStates = {}
  attrs.growthStates[dimension] = currState
  
  await db.update(characters)
    .set({ attributes: JSON.stringify(attrs), updatedAt: sql`(unixepoch())` })
    .where(eq(characters.id, characterId))
}
```

### 3.4 关系快照的 upsert 逻辑

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
  // 强制 a < b（字典序），避免重复
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

## 四、contextBuilder 的角色成长注入

### 4.1 主角状态卡升级（Slot-3）

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
    
    // 1. 境界（现有）
    if (p.powerLevel) {
      try {
        const pl = JSON.parse(p.powerLevel)
        card += `\n当前境界：${pl.current || '未知'}`
        if (pl.nextMilestone) card += `，目标：${pl.nextMilestone}`
      } catch {}
    }
    
    // 2. 当前心理/性格状态（从growthStates读）
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
    
    // 3. 关键认知（主角已知但可能保密的重要信息）
    const knowledgeItems = await db.select()
      .from(characterGrowthLog)
      .where(and(
        eq(characterGrowthLog.characterId, p.id),
        eq(characterGrowthLog.growthDimension, 'knowledge'),
        sql`${characterGrowthLog.chapterOrder} <= ${currentChapterOrder}`,
      ))
      .orderBy(desc(characterGrowthLog.chapterOrder))
      .limit(8)   // 最近8条关键认知
      .all()
    
    if (knowledgeItems.length > 0) {
      card += `\n\n【主角已知的关键信息（不得遗忘）】`
      for (const k of knowledgeItems) {
        const secretTag = k.isSecret ? '（秘密，对外保密）' : ''
        card += `\n• ${k.currState}${secretTag}`
      }
    }
    
    // 4. 重要誓言/恩情/血仇（oath_debt）
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

### 4.2 配角卡片升级（Slot-5）

在 `buildCharacterSlotFromDB` 的 `formatCharacterCard` 之后，追加配角的关系和状态：

```typescript
async function enrichCharacterCardWithGrowth(
  db: AppDb,
  character: CharacterRow,
  currentChapterOrder: number,
): Promise<string> {
  let card = formatCharacterCard(character)  // 现有逻辑
  
  // 追加当前growthStates（如有）
  let attrs: any = {}
  try { attrs = JSON.parse(character.attributes || '{}') } catch {}
  if (attrs.growthStates?.psychology) card += `\n心理状态：${attrs.growthStates.psychology}`
  if (attrs.growthStates?.physical) card += `\n身体状态：${attrs.growthStates.physical}`
  if (attrs.growthStates?.stance) card += `\n当前立场：${attrs.growthStates.stance}`
  
  // 追加与主角的当前关系（如有记录）
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

### 4.3 关系网络注入（新增 Slot-11）

对于"涉及多角色互动"的章节，将主要角色之间的当前关系矩阵注入上下文：

```typescript
async function buildRelationshipSlot(
  db: AppDb,
  novelId: string,
  involvedCharacterIds: string[],  // 从Slot-5命中的角色ID列表
  budget: number,  // ~2000 tokens
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

## 五、摘要结构化解析（解决遗漏二）

### 5.1 在 step1 完成后立即解析摘要结构

现有 `summarizer.ts` 生成的摘要已有四段结构（【角色状态变化】【关键事件】【道具/功法】【章末状态】），用正则解析后存入 `chapter_structured_data`：

```typescript
async function parseAndStoreStructuredData(
  db: AppDb,
  novelId: string,
  chapterId: string,
  chapterOrder: number,
  summaryText: string,
): Promise<ParsedChapterData> {
  // 解析四段结构（现有格式）
  const extractSection = (tag: string): string => {
    const match = summaryText.match(new RegExp(`【${tag}】([\\s\\S]*?)(?=【|$)`))
    return match?.[1]?.trim() || ''
  }
  
  const charChangesText = extractSection('角色状态变化')
  const entitiesText = extractSection('道具/功法')
  const endStateText = extractSection('章末状态')
  const eventsText = extractSection('关键事件')
  
  // 存入 chapter_structured_data
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

### 5.2 step7 优先复用结构化数据，减少重复分析

```typescript
async function step7EntityExtract(env, chapterId, novelId): Promise<void> {
  // 先查 chapter_structured_data，如果有【道具/功法】段，可以给LLM作为参考
  const structuredData = await db.select()
    .from(chapterStructuredData)
    .where(eq(chapterStructuredData.chapterId, chapterId))
    .get()
  
  // 将摘要结构化数据作为提取hint注入prompt，减少LLM的分析负担
  const entityHint = structuredData?.newEntities 
    ? `\n【摘要已提取的道具/功法线索（仅供参考，仍需从原文验证）】\n${structuredData.newEntities}` 
    : ''
  
  // ... 正常执行提取流程，但prompt中加入hint
}
```

### 5.3 章末状态用于强化章节衔接检查

`coherence.ts` 的 `checkContinuityWithPrevChapter` 现在用的是关键词提取匹配，可以升级为使用上一章的 `chapter_end_state` 做结构化比对：

```typescript
async function checkContinuityWithPrevChapter(...) {
  // 新增：优先使用结构化章末状态
  const prevStructured = await db.select({ chapterEndState: chapterStructuredData.chapterEndState })
    .from(chapterStructuredData)
    .where(eq(chapterStructuredData.chapterId, prevChapter.id))
    .get()
  
  if (prevStructured?.chapterEndState) {
    // 将结构化章末状态传给LLM做连贯性判断，比关键词匹配精准得多
    // 格式：上章末：主角在X地，处于Y状态，下一步要做Z
    // 本章开头是否与此一致？
  }
}
```

---

## 六、主角已知信息边界管理（解决遗漏四）

### 6.1 "主角视角知识库"的核心设计

`character_growth_log` 中 `growth_dimension='knowledge'` 的记录，配合 `is_secret` 和 `is_public` 字段，构成主角的"已知信息边界"。

在上下文注入时，这些信息被注入进Slot-3主角卡，并加上明确的行为约束标签。

### 6.2 HARD_CONSTRAINTS 对信息边界的约束

```
I. 信息边界约束：资料包"主角状态"区块中【主角已知的关键信息】列出的所有条目，
   主角在本章的行为和决策中必须体现已知这些信息；
   标注"（秘密，对外保密）"的条目，主角不得在对话中主动透露，
   但其内心决策必须受到这些信息影响
```

### 6.3 信息揭露的传播追踪

当一个秘密从A传给了B（B原本不知道），step7的 `knowledgeReveals` 需要同时给B写入一条knowledge记录。这样B之后的章节中，LLM能看到B"已知"这个信息。

---

## 七、向量化时序问题解决（解决遗漏六）

### 7.1 问题本质

step7提取inline实体后，向量化是异步Queue任务。下一章生成时（可能很快），向量库里没有这些实体，RAG查不到，只有关键词匹配层兜底。

### 7.2 解决方案：双轨并行，不依赖向量化完成

**关键词匹配层**（v2方案Slot-10）查的是 `novel_inline_entities` 表，不依赖向量库，所以step7写入DB后立即可用。

**RAG层**（Slot-5/6）依赖向量库，存在时延。但这是兜底层，主力召回已由关键词匹配层承担。

所以时序问题的根本解法是：**关键词匹配层是Slot-10的主力，RAG是补充**。不需要等向量化完成，系统已经是可靠的。

对于那些aliases覆盖不全导致关键词匹配未命中、同时向量化又还没完成的情况，这是唯一的盲区。可以在step7写入后同步做一次**强制向量化**（不走Queue，直接调用embedding API写入），对于单个实体的向量化代价很小：

```typescript
// step7写入完成后，对当前批次提取的实体立即同步向量化
// 不走Queue，直接调用
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

## 八、更新后的完整 postProcess 步骤顺序

```typescript
export async function runPostProcess(env, payload): Promise<void> {
  const { chapterId, novelId, enableAutoSummary, usage } = payload

  // Step 1：自动摘要生成（不变）
  const summaryResult = await step1AutoSummary(env, chapterId, novelId, enableAutoSummary, usage)
  
  // Step 1b：解析摘要结构化数据（新增，依赖step1）
  await step1bParseStructuredData(env, chapterId, novelId)
  
  // Step 2：伏笔提取（不变）
  await step2Foreshadowing(env, chapterId, novelId)
  
  // Step 3：境界突破检测（不变）
  await step3PowerLevel(env, chapterId, novelId)
  
  // Step 4：角色一致性检查（不变）
  await step4CharacterConsistency(env, chapterId, novelId)
  
  // Step 5：章节连贯性检查（升级：使用chapter_structured_data）
  await step5Coherence(env, chapterId, novelId)
  
  // Step 6：卷进度检查（不变）
  await step6VolumeProgress(env, chapterId, novelId)
  
  // ★ Step 7：实体自动提取与固化（新增）
  // 依赖step1b的结构化数据作为hint
  const extractResult = await step7EntityExtract(env, chapterId, novelId)
  
  // ★ Step 8：角色成长追踪写入（新增，依赖step7的characterGrowths和knowledgeReveals）
  await step8CharacterGrowth(env, chapterId, novelId, extractResult.characterGrowths, extractResult.knowledgeReveals)
  
  // ★ Step 9：实体碰撞检测（新增，依赖step7）
  await step9EntityConflictDetect(env, chapterId, novelId, extractResult.entities)
}
```

---

## 九、contextBuilder 完整的新Slot布局

更新后的全部Slot分配：

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

## 十、前端补充：角色成长时间线

在v2方案的"实体管理中心"（InlineEntityPage）基础上，**合并**一个新Tab：

**Tab 4：角色成长时间线**

- 选择角色（主角/主要配角）
- 按维度筛选：全部 / 境界 / 心理 / 关系 / 已知信息 / 身体 / 立场 / 誓言
- 时间线展示：每条变化记录显示章节序号、变化类型（色块）、before→after
- 关系网络视图：当前所有已建立关系的图谱（节点=角色，边=关系类型，颜色区分friendly/hostile/neutral）
- 知识边界视图：主角当前已知的所有关键信息列表，标注"公开/秘密"

**ChapterHealthTab 新增**：

```
🟡 角色成长提取 (3)
• 林枫：心理状态更新（冲动→开始学会隐忍）
• 林枫 ↔ 苏雪：关系建立（萍水相逢→欠下救命恩情）
• 林枫：获得关键认知（知道赤炎长老是家族灭门幕后黑手）[秘密]
→ [查看角色时间线]
```

---

## 十一、改造文件清单（完整版，含v2）

| 文件/目录 | 操作 | 核心改动 | 估时 |
|-----------|------|----------|------|
| `server/db/schema.ts` | 修改 | 新增5张表（含v2的3张+本文的2张：character_growth_log / character_relationships / chapter_structured_data） | 2h |
| `server/db/migrations/` | 新建 | migration SQL | 1h |
| `server/services/entityExtract.ts` | **新建** | step7：实体提取+角色成长提取，完整LLM调用+写入逻辑 | 1.5天 |
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

**总估时：约14个工作日**

---

## 十二、没有被覆盖的边界（明确标注不做的事）

以下几项经过评估，**明确不在本方案范围内**，原因一并说明：

| 项目 | 不做的原因 |
|------|-----------|
| 路人配角的心理追踪 | ROI极低，路人在剧情中不会反复出现，追踪成本远高于收益 |
| 自动修复矛盾内容 | AI不应自动改写已写内容，决策权必须在作者手里 |
| 实时跨卷一致性检查（全局扫描） | 计算成本极高，作为Phase D.3的按需触发功能已规划 |
| 对话风格跨章一致性 | 已由 `characters.attributes.speechPattern` + step4 CharacterConsistency 覆盖 |
| 世界观逻辑自洽性（如魔法体系规则） | 已由 `novel_settings` 的 `worldRules/powerSystem` 槽 + HARD_CONSTRAINTS B条覆盖 |

---

*方案版本 v1.0 补充 · 2026-04-30*
