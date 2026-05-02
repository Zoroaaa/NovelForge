# NovelForge 跨章一致性指南

> 版本: v1.0.0 | 模块: `server/services/agent/` + `server/routes/cross-chapter.ts` + `src/pages/CrossChapterPage.tsx`
> 相关文档: [章节上下文构建指南](./CHAPTER-GENERATION-CONTEXT-GUIDE.md) | [章节生成使用指南](./CHAPTER-GENERATION-USAGE-GUIDE.md) | [导入数据指南](./IMPORT-DATA-GUIDE.md)
> 创建日期: 2026-05-02 | 最后更新: 2026-05-02

---

## 目录

- [一、概述](#一概述)
- [二、三层防御体系架构](#二三层防御体系架构)
- [三、数据库设计](#三数据库设计)
- [四、第一层：上下文注入（Slot-10/11）](#四第一层上下文注入slot-1011)
- [五、第二层：生成时硬性约束](#五第二层生成时硬性约束)
- [六、第三层：后处理固化](#六第三层后处理固化)
- [七、API 接口](#七api-接口)
- [八、前端管理页面](#八前端管理页面)
- [九、配置参数](#九配置参数)
- [十、工作流示例](#十工作流示例)
- [十一、FAQ](#十一faq)
- [十二、文件索引](#十二文件索引)
- [十三、版本历史](#十三版本历史)

---

## 一、概述

### 1.1 背景与目标

长篇小说 AI 创作中，跨章节的一致性是最核心的挑战。随着章节累积，AI 容易出现：

- **实体矛盾**：角色在第 3 章断了左臂，第 10 章却双手使剑
- **情感突变**：上一章刚结怨，本章突然无条件信任
- **境界飞升**：一夜顿悟式无铺垫的越级突破
- **关系错乱**：师徒关系、阵营归属在不同章节描述不一致

跨章一致性系统通过 **三层防御体系** 系统性地解决上述问题：

```
┌─────────────────────────────────────────────────────────────┐
│                    跨章一致性三层防御体系                     │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  第一层：上下文注入（生成前）                                │
│  ├─ Slot-10: 关键词精确匹配内联实体                         │
│  └─ Slot-11: 角色关系网络快照                               │
│                                                             │
│  第二层：生成时约束（生成中）                                │
│  └─ HARD_CONSTRAINTS F-I: 情感/动机/境界/单章约束           │
│                                                             │
│  第三层：后处理固化（生成后）                                │
│  ├─ Step 7: LLM 实体自动提取 → novelInlineEntities          │
│  ├─ Step 8: 角色成长追踪 → characterGrowthLog               │
│  └─ Step 9: 实体碰撞检测 → entityConflictLog                │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 1.2 核心能力

| 能力 | 说明 |
|------|------|
| **内联实体管理** | 自动从章节中提取角色/地点/物品/势力/功法/事件，存入内联实体库 |
| **实体状态追踪** | 记录实体的每次状态变化（受伤/获得/摧毁等），支持历史查询 |
| **角色成长日志** | 7 个维度追踪角色成长（能力/社交/知识/情感/战斗/拥有物/境界） |
| **实体碰撞检测** | 精确匹配 + LLM 语义判断，自动发现跨章矛盾 |
| **关系网络快照** | 维护角色间的关系图谱（师徒/敌对/盟友/道侣/亲属等） |
| **上下文精准注入** | Slot-10 关键词匹配 + Slot-11 关系网络，按需注入而非全量灌入 |
| **硬性约束守护** | F-I 四条约束从 Prompt 层面防止情感突变/动机违背/境界飞升 |
| **链式后处理** | 10 步管线拆分为独立队列消息，防止单任务超时 |

### 1.3 技术栈

| 层级 | 技术 |
|------|------|
| 数据库 | Drizzle ORM + D1 (SQLite)，6 张新表 |
| LLM 提取 | Cloudflare Workers AI（实体提取 + 碰撞判断） |
| 向量索引 | Cloudflare Vectorize（baai/bge-m3） |
| 队列 | Cloudflare Queues（10 步链式消息） |
| 前端 | React + React Query + Zustand + Shadcn UI |

---

## 二、三层防御体系架构

### 2.1 完整数据流

```
┌─────────────────────────────────────────────────────────────────┐
│                     跨章一致性完整数据流                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  【章节生成前 - 上下文注入】                                     │
│  contextBuilder.ts                                              │
│  ├─ Step 3b: Slot-10 关键词精确匹配                             │
│  │   └─ DB → novelInlineEntities (name IN 查询)                 │
│  └─ Step 3c: Slot-11 关系网络注入                               │
│      └─ DB → characterRelationships (protagonist 关系)           │
│                                                                 │
│  【章节生成中 - 硬性约束】                                       │
│  messages.ts                                                    │
│  └─ HARD_CONSTRAINTS F-I 注入 system message                   │
│      ├─ F: 情感约束（禁止无铺垫情感突变）                        │
│      ├─ G: 动机约束（行为必须符合当前动机）                      │
│      ├─ H: 境界约束（禁止无铺垫越级突破）                        │
│      └─ I: 单章约束（每场战斗最多 1 次突破）                     │
│                                                                 │
│  【ReAct 循环 - 工具调用】                                       │
│  tools.ts + executor.ts                                         │
│  ├─ tool-6: queryInlineEntity（查内联实体详情）                  │
│  ├─ tool-7: queryEntityStateHistory（查实体状态历史）            │
│  └─ tool-8: queryCharacterGrowth（查角色成长记录）               │
│                                                                 │
│  【章节生成后 - 后处理固化】                                     │
│  postProcess.ts (10 步链式队列)                                  │
│  ├─ Step 1:  自动摘要                                           │
│  ├─ Step 1b: 摘要结构化解析                                     │
│  ├─ Step 2:  伏笔提取                                           │
│  ├─ Step 3:  境界突破检测                                       │
│  ├─ Step 4:  角色一致性检查                                     │
│  ├─ Step 5:  章节连贯性检查                                     │
│  ├─ Step 6:  卷进度检查                                         │
│  ├─ Step 7:  实体自动提取 ⭐ → entityExtract.ts                 │
│  ├─ Step 8:  角色成长追踪 ⭐ → characterGrowth.ts               │
│  └─ Step 9:  实体碰撞检测 ⭐ → entityConflict.ts                │
│                                                                 │
│  【管理面板 - 人工审核】                                         │
│  CrossChapterPage.tsx (4 Tab)                                   │
│  ├─ Tab 1: 内联实体列表                                         │
│  ├─ Tab 2: 实体碰撞记录                                         │
│  ├─ Tab 3: 角色成长轨迹                                         │
│  └─ Tab 4: 关系网络图谱                                         │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 三层协同关系

| 层级 | 时机 | 数据流向 | 核心目的 |
|------|------|---------|---------|
| 第一层：上下文注入 | 生成前 | DB → ContextBundle → Prompt | 让 AI "看到"前文已知实体和关系 |
| 第二层：硬性约束 | 生成中 | messages.ts → system prompt | 让 AI "遵守"跨章一致性规则 |
| 第三层：后处理固化 | 生成后 | LLM 输出 → DB 实体库 | 让系统 "记住"本章新增实体和变化 |

三层形成闭环：**后处理固化**的产出 → 下一次生成时被 **上下文注入** 拉取 → **硬性约束** 确保生成质量。

---

## 三、数据库设计

### 3.1 Schema 总览（6 张表）

```
novelInlineEntities     ← 内联实体主表（角色/地点/物品/势力/功法/事件）
entityStateLog          ← 实体状态变更日志
characterGrowthLog      ← 角色成长记录（7 维度）
entityConflictLog       ← 实体碰撞/矛盾记录
characterRelationships  ← 角色关系网络快照
structuredData          ← 章节结构化数据（step1b 产出）
```

### 3.2 novelInlineEntities（内联实体主表）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | 主键 UUID |
| novelId | TEXT FK | 所属小说 |
| entityType | TEXT | 角色/地点/物品/势力/功法/事件 |
| name | TEXT | 实体名称 |
| aliases | TEXT(JSON) | 别名数组 |
| summary | TEXT | 实体摘要（≤500 字） |
| fullContent | TEXT | 完整描述 |
| firstAppearance | INTEGER | 首次出现章节 sortOrder |
| lastAppearance | INTEGER | 最近出现章节 sortOrder |
| importance | TEXT | high/normal/low |
| status | TEXT | active/destroyed/dead/missing |
| metadata | TEXT(JSON) | 扩展属性 |
| vectorId | TEXT | Vectorize 向量 ID |
| createdAt | INTEGER | 创建时间 |
| updatedAt | INTEGER | 更新时间 |
| deletedAt | INTEGER | 软删除时间 |

**索引**：`idx_inline_entity_novel` (novelId), `idx_inline_entity_type` (entityType), `idx_inline_entity_name` (name)

### 3.3 entityStateLog（实体状态变更日志）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | 主键 UUID |
| entityId | TEXT FK | 关联内联实体 |
| novelId | TEXT FK | 所属小说 |
| chapterSortOrder | INTEGER | 发生变更的章节 |
| changeType | TEXT | injured/healed/obtained/destroyed/upgraded/moved/relationship_change |
| previousState | TEXT | 变更前状态 |
| newState | TEXT | 变更后状态 |
| description | TEXT | 变更描述 |
| createdAt | INTEGER | 创建时间 |

**索引**：`idx_state_log_entity` (entityId), `idx_state_log_chapter` (novelId, chapterSortOrder)

### 3.4 characterGrowthLog（角色成长记录）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | 主键 UUID |
| characterId | TEXT FK | 角色 ID（可为空，跨章角色无 ID） |
| characterName | TEXT | 角色名称 |
| novelId | TEXT FK | 所属小说 |
| chapterSortOrder | INTEGER | 成长发生的章节 |
| growthType | TEXT | ability/social/knowledge/emotion/combat/possession/growth |
| description | TEXT | 成长描述 |
| previousValue | TEXT | 变更前值 |
| newValue | TEXT | 变更后值 |
| createdAt | INTEGER | 创建时间 |

**索引**：`idx_growth_character` (characterId), `idx_growth_chapter` (novelId, chapterSortOrder)

### 3.5 entityConflictLog（实体碰撞记录）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | 主键 UUID |
| entityId | TEXT FK | 涉及的内联实体 |
| novelId | TEXT FK | 所属小说 |
| chapterSortOrder | INTEGER | 矛盾发生的章节 |
| conflictType | TEXT | state_inconsistency/timeline_error/attribute_mismatch/relationship_conflict |
| severity | TEXT | critical/warning/info |
| description | TEXT | 矛盾描述 |
| context | TEXT | 矛盾上下文 |
| resolved | INTEGER | 0=未解决, 1=已解决 |
| resolution | TEXT | 解决方案 |
| createdAt | INTEGER | 创建时间 |

**索引**：`idx_conflict_entity` (entityId), `idx_conflict_novel` (novelId, resolved)

### 3.6 characterRelationships（角色关系网络）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | 主键 UUID |
| novelId | TEXT FK | 所属小说 |
| characterIdA | TEXT FK | 角色 A |
| characterIdB | TEXT FK | 角色 B |
| relationshipType | TEXT | 师徒/敌对/盟友/道侣/亲属/同门/主仆 |
| description | TEXT | 关系描述 |
| intensity | INTEGER | 关系强度 1-10 |
| chapterSortOrder | INTEGER | 最近更新的章节 |
| createdAt | INTEGER | 创建时间 |
| updatedAt | INTEGER | 更新时间 |
| deletedAt | INTEGER | 软删除时间 |

**索引**：`idx_relationship_novel` (novelId), `idx_relationship_char_a` (characterIdA), `idx_relationship_char_b` (characterIdB), `idx_relationship_pair` UNIQUE (novelId, characterIdA, characterIdB) WHERE deletedAt IS NULL

### 3.7 structuredData（章节结构化数据）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | 主键 UUID |
| chapterId | TEXT FK UNIQUE | 关联章节 |
| novelId | TEXT FK | 所属小说 |
| entities | TEXT(JSON) | 提取的实体列表 |
| stateChanges | TEXT(JSON) | 状态变更列表 |
| characterGrowths | TEXT(JSON) | 角色成长列表 |
| knowledgeReveals | TEXT(JSON) | 知识揭示列表 |
| createdAt | INTEGER | 创建时间 |

---

## 四、第一层：上下文注入（Slot-10/11）

### 4.1 Slot-10：关键词精确匹配内联实体

**注入时机**：`contextBuilder.ts` → `buildChapterContext()` → Step 3b

**匹配策略**：
1. 提取上一章正文 + 当前章节标题中的关键词
2. 在 `novelInlineEntities` 表中精确匹配 `name` 字段（`name IN (...)` 查询）
3. 仅查询 `deletedAt IS NULL` 的有效实体
4. 按实体类型分组组装（角色/地点/物品/势力/功法/事件）

**输出格式**：
```
## 已知内联实体
以下实体在前文已出现，本章如需引用请保持一致：
【青云门】(势力) - 正道第一大宗，掌门清虚真人
【玄天剑】(物品) - 林岩的本命飞剑，品阶：中品灵器
【迷雾森林】(地点) - 位于青云门以北，内有二阶妖兽
```

**预算**：≤15000 tokens（`DEFAULT_BUDGET.inlineEntities`）

### 4.2 Slot-11：角色关系网络

**注入时机**：`contextBuilder.ts` → `buildChapterContext()` → Step 3c

**匹配策略**：
1. 查询主角（protagonist）的关系网络快照
2. 双向匹配：`characterIdA IN protagonistIds OR characterIdB IN protagonistIds`
3. 按关系类型组装（师徒/敌对/盟友/道侣/亲属等）

**输出格式**：
```
## 角色关系网络
主角当前社交关系（截至上一章）：
【林岩→苏清婉】道侣 | 关系描述：共同修炼，互相信任
【林岩→王虎】师兄弟 | 关系描述：同门师兄，性格稳重
【林岩→魔尊】敌对 | 关系描述：杀师之仇，不共戴天
```

**预算**：≤8000 tokens（`DEFAULT_BUDGET.relationships`）

### 4.3 ContextBundle 集成

Slot-10/11 的数据通过 `ContextBundle.dynamic` 返回：

```typescript
// ContextBundle.dynamic 新增字段
{
  inlineEntities: string[]         // Slot-10 内联实体卡片
  characterRelationships: string[] // Slot-11 关系网络卡片
}
```

**slotBreakdown 新增 key**：
- `inlineEntities`: Slot-10 实际 token 数
- `characterRelationships`: Slot-11 实际 token 数

### 4.4 上下文预览

前端 `ContextPreview.tsx` 组件展示 Slot-10/11：
- Slot-10 使用 `Database` 图标 + `text-cyan-600` 配色
- Slot-11 使用 `Network` 图标 + `text-emerald-600` 配色

AI 监控中心（`AiMonitorPage.tsx`）的上下文诊断面板也会展示：
- 跨章内联实体数量和内容预览
- 角色关系网络快照
- 各槽位 token 分配明细

---

## 五、第二层：生成时硬性约束

### 5.1 HARD_CONSTRAINTS F-I

在 `messages.ts` 中定义，注入到 AI 的 system prompt：

```
F. 情感约束：角色的情感变化必须有上下文铺垫，不得发生未经剧情支撑的情感突变
   （如上一章刚结怨、本章突然无条件信任）

G. 动机约束：角色的所有行为必须符合其当前动机和立场，不得因剧情需要做出违背人设的不合理行为
   （如反派突然无故帮助主角）

H. 境界约束：禁止"一夜顿悟"式无铺垫的越级突破；境界提升必须有合理的过程描写
   （如长期闭关、吞服丹药、战斗感悟等）

I. 单章约束：每场战斗中同一角色最多1次境界突破，全章不超过1次以上境界突破
   （特殊情况如"渡劫连续突破"需要有明确的剧情支撑和前文铺垫）
```

### 5.2 完整约束列表（A-I）

| 编号 | 约束名称 | 核心内容 | 版本 |
|------|---------|---------|------|
| A | 角色约束 | 角色性格/外貌/能力必须与角色卡一致 | 原有 |
| B | 设定约束 | 世界规则/修炼体系/地理必须与设定一致 | 原有 |
| C | 衔接约束 | 章节首尾必须与上下文衔接 | 原有 |
| D | 伏笔约束 | 不得新增无计划伏笔 | 原有 |
| E | 规则约束 | 遵守全部创作规则 | 原有 |
| **F** | **情感约束** | **禁止无铺垫情感突变** | **⭐v2.1** |
| **G** | **动机约束** | **行为必须符合当前动机** | **⭐v2.1** |
| **H** | **境界约束** | **禁止无铺垫越级突破** | **⭐v2.1** |
| **I** | **单章约束** | **每场战斗最多 1 次突破** | **⭐v2.1** |

### 5.3 ReAct 工具（6/7/8）

AI 在 ReAct 循环中可通过工具主动查询跨章一致性数据：

| 工具 | 名称 | 功能 | 查询表 |
|------|------|------|--------|
| tool-6 | `queryInlineEntity` | 查询内联实体详情 | novelInlineEntities |
| tool-7 | `queryEntityStateHistory` | 查询实体状态变更历史 | entityStateLog |
| tool-8 | `queryCharacterGrowth` | 查询角色成长记录 | characterGrowthLog |

**使用场景**：
- AI 写到某个角色时，可用 tool-6 查询该角色的完整信息
- AI 需要确认某物品当前状态时，可用 tool-7 查询状态变更链
- AI 需要了解角色能力边界时，可用 tool-8 查询成长轨迹

---

## 六、第三层：后处理固化

### 6.1 10 步链式管线

后处理管线采用链式队列设计，每步完成后入队下一步，防止单任务超时：

```
dispatchPostProcess (入口)
  └─ queue: post_process_step_1
       └─ step1AutoSummary → chainNext
            └─ queue: post_process_step_2
                 └─ step2Foreshadowing → chainNext
                      └─ ... (Step 3~6)
                           └─ queue: post_process_step_7
                                └─ step7EntityExtract ⭐ → chainNext
                                     └─ queue: post_process_step_8
                                          └─ step8CharacterGrowth ⭐ → chainNext
                                               └─ queue: post_process_step_9
                                                    └─ step9EntityConflictDetect ⭐ → finishPostProcess
                                                         └─ queue: quality_check + extract_plot_graph
```

### 6.2 Step 7：实体自动提取（entityExtract.ts）

**输入**：章节正文内容

**处理流程**：
1. 构建提取 prompt（`EXTRACT_SYSTEM_PROMPT` + `buildUserPrompt()`）
2. 调用 LLM 提取 4 类数据：
   - `entities`: 新出现的实体（角色/地点/物品/势力/功法/事件）
   - `stateChanges`: 实体状态变更（受伤/获得/摧毁等）
   - `characterGrowths`: 角色成长（7 维度）
   - `knowledgeReveals`: 知识揭示（新发现的世界设定/秘密）
3. 持久化到 DB：
   - 实体 → `novelInlineEntities` 表
   - 状态变更 → `entityStateLog` 表
4. 触发向量化（`triggerEntityVectorize()`）

**产出**：`EntityExtractResult` 对象，传递给 Step 8

### 6.3 Step 8：角色成长追踪（characterGrowth.ts）

**输入**：Step 7 的 `characterGrowths` + `knowledgeReveals`

**成长维度**（7 种）：

| 维度 | growthType | 说明 |
|------|-----------|------|
| 能力成长 | ability | 新学会功法/技能提升 |
| 社交成长 | social | 关系变化/阵营变动 |
| 知识成长 | knowledge | 获得新知识/秘密 |
| 情感成长 | emotion | 情感状态变化 |
| 战斗成长 | combat | 战斗经验/领悟 |
| 拥有物变化 | possession | 获得/失去物品 |
| 境界突破 | growth | 境界等级提升 |

**处理流程**：
1. 解析角色名/别名到 ID（`resolveCharacterId()`）
2. 写入 `characterGrowthLog` 表
3. 同步更新 `characterRelationships` 关系网络快照

### 6.4 Step 9：实体碰撞检测（entityConflict.ts）

**检测策略**（两阶段）：

**阶段 1：精确匹配快速筛查**（`exactMatchDetection()`）
- 检查本章内容中是否出现了已知实体名
- 检查实体最新状态关键词是否与本章描述矛盾
- 仅查询 `deletedAt IS NULL` 的有效实体

**阶段 2：LLM 语义判断**（`llmJudgeConflicts()`）
- 对阶段 1 筛选出的疑似矛盾，调用 LLM 判断真伪
- 返回碰撞类型和严重程度

**碰撞类型**：

| 类型 | conflictType | 说明 |
|------|-------------|------|
| 状态不一致 | state_inconsistency | 实体当前状态与描述矛盾 |
| 时间线错误 | timeline_error | 事件发生时间矛盾 |
| 属性不匹配 | attribute_mismatch | 实体属性描述矛盾 |
| 关系冲突 | relationship_conflict | 角色关系描述矛盾 |

**严重程度**：

| 级别 | severity | 说明 |
|------|---------|------|
| 严重 | critical | 明确矛盾，必须修复 |
| 警告 | warning | 疑似矛盾，建议审核 |
| 信息 | info | 轻微不一致，可忽略 |

---

## 七、API 接口

### 7.1 端点列表

所有端点前缀：`/api/novels/:novelId/cross-chapter`

| 方法 | 路径 | 功能 | 查询参数 |
|------|------|------|---------|
| GET | `/inline-entities` | 内联实体列表 | entityType, page, pageSize |
| GET | `/inline-entities/:id` | 内联实体详情 | - |
| DELETE | `/inline-entities/:id` | 删除内联实体（软删除） | - |
| GET | `/entity-state-log` | 实体状态变更历史 | entityId, chapterSortOrder |
| GET | `/entity-conflicts` | 实体碰撞/矛盾记录 | resolved, severity |
| PUT | `/entity-conflicts/:id/resolve` | 标记矛盾已解决 | - |
| GET | `/character-growth` | 角色成长记录 | characterId, growthType |
| GET | `/relationships` | 角色关系网络 | - |
| GET | `/structured-data` | 结构化数据（step1b 产出） | chapterId |
| GET | `/stats` | 统计概览 | - |

### 7.2 请求/响应格式

**GET /inline-entities**

请求：
```
GET /api/novels/{novelId}/cross-chapter/inline-entities?entityType=角色&page=1&pageSize=20
```

响应：
```json
{
  "items": [
    {
      "id": "uuid",
      "entityType": "角色",
      "name": "林岩",
      "aliases": ["林师兄", "岩儿"],
      "summary": "青云门内门弟子，修炼天赋极高",
      "status": "active",
      "firstAppearance": 1,
      "lastAppearance": 15,
      "importance": "high"
    }
  ],
  "total": 42,
  "page": 1,
  "pageSize": 20
}
```

**GET /entity-conflicts**

请求：
```
GET /api/novels/{novelId}/cross-chapter/entity-conflicts?resolved=0&severity=critical
```

响应：
```json
{
  "items": [
    {
      "id": "uuid",
      "entityId": "entity-uuid",
      "entityName": "玄天剑",
      "conflictType": "state_inconsistency",
      "severity": "critical",
      "description": "玄天剑在第 5 章被毁，但第 12 章描述林岩仍在使用",
      "context": "第 12 章第 3 段：林岩祭出玄天剑...",
      "chapterSortOrder": 12,
      "resolved": 0
    }
  ],
  "total": 3
}
```

**GET /stats**

响应：
```json
{
  "totalEntities": 156,
  "activeEntities": 142,
  "totalConflicts": 8,
  "unresolvedConflicts": 3,
  "totalGrowthRecords": 67,
  "totalRelationships": 24
}
```

---

## 八、前端管理页面

### 8.1 CrossChapterPage（4 Tab）

入口路径：`/novels/:id/cross-chapter`

入口位置：
1. 小说卡片下拉菜单 → "跨章一致性"
2. 工作台侧边栏 → 管理分组 → "跨章一致性"

| Tab | 标签 | 图标 | 功能 |
|-----|------|------|------|
| entities | 内联实体 | Database | 实体列表（筛选/搜索/分页/删除） |
| conflicts | 实体碰撞 | AlertTriangle | 碰撞记录（筛选/标记已解决） |
| growth | 角色成长 | TrendingUp | 成长轨迹（按角色/类型筛选） |
| relationships | 关系网络 | Network | 关系图谱（可视化展示） |

### 8.2 上下文预览集成

`ContextPreview.tsx` 组件中新增两个渲染块：

- **Slot-10 渲染块**：cyan 配色，展示关键词匹配的内联实体列表
- **Slot-11 渲染块**：emerald 配色，展示角色关系网络快照

### 8.3 AI 监控中心集成

`AiMonitorPage.tsx` 的上下文诊断面板新增 3 个展示卡片：

1. **跨章内联实体**：cyan 主题，展示 Slot-10 命中的实体数量和内容预览
2. **角色关系网络**：emerald 主题，展示 Slot-11 的关系快照
3. **Token 分配明细**：grey 主题，展示全部 12 个槽位的 token 使用量

---

## 九、配置参数

### 9.1 Token 预算

```typescript
// contextBuilder.ts DEFAULT_BUDGET
inlineEntities: 15000     // Slot-10 内联实体预算
relationships: 8000       // Slot-11 关系网络预算
// 总预算: 151000 (原 128000 + 新增 23000)
```

### 9.2 后处理队列消息类型

```typescript
// queue.ts QueueMessage 类型
type: 'post_process_step_1'   // 自动摘要
type: 'post_process_step_1b'  // 摘要结构化解析
type: 'post_process_step_2'   // 伏笔提取
type: 'post_process_step_3'   // 境界突破检测
type: 'post_process_step_4'   // 角色一致性检查
type: 'post_process_step_5'   // 章节连贯性检查
type: 'post_process_step_6'   // 卷进度检查
type: 'post_process_step_7'   // 实体自动提取 ⭐
type: 'post_process_step_8'   // 角色成长追踪 ⭐
type: 'post_process_step_9'   // 实体碰撞检测 ⭐
```

### 9.3 实体类型枚举

```
角色 | 地点 | 物品 | 势力 | 功法 | 事件
```

### 9.4 成长维度枚举

```
ability | social | knowledge | emotion | combat | possession | growth
```

### 9.5 碰撞类型枚举

```
state_inconsistency | timeline_error | attribute_mismatch | relationship_conflict
```

---

## 十、工作流示例

### 10.1 完整的单章生成 + 跨章一致性流程

```
1. 用户点击"生成章节"
   │
2. contextBuilder 组装 12 槽位上下文
   ├─ Slot-0~9: 原有数据
   ├─ Slot-10: 关键词匹配 → 命中 5 个内联实体
   └─ Slot-11: 主角关系网络 → 8 条关系
   │
3. messages 注入 HARD_CONSTRAINTS A-I
   │
4. ReAct 循环生成正文
   ├─ AI 可调用 tool-6/7/8 查询跨章数据
   └─ 生成完毕
   │
5. 后处理管线（链式队列）
   ├─ Step 1~6: 原有处理
   ├─ Step 7: 实体提取 → 发现 3 个新实体 + 2 个状态变更
   ├─ Step 8: 成长追踪 → 记录 1 条能力成长 + 1 条境界突破
   └─ Step 9: 碰撞检测 → 发现 1 条 warning 级矛盾
   │
6. 用户查看"跨章一致性"管理页面
   ├─ 确认新提取的实体
   ├─ 处理 1 条碰撞警告（确认/忽略）
   └─ 检查角色成长轨迹
```

### 10.2 碰撞处理流程

```
1. Step 9 检测到碰撞 → 写入 entityConflictLog
   │
2. 用户打开"实体碰撞" Tab
   ├─ 看到 1 条 warning 级碰撞
   └─ 描述："玄天剑在第 5 章被毁，但第 12 章仍在使用"
   │
3. 用户选择处理方式
   ├─ 方案 A：标记已解决（确认是合理剧情，如修复重铸）
   ├─ 方案 B：忽略（误检）
   └─ 方案 C：手动修正章节内容
```

---

## 十一、FAQ

**Q1: 内联实体和已有角色卡有什么区别？**

A: 角色卡是用户手动创建的主要角色完整档案，内联实体是 AI 从章节中自动提取的所有出现过的实体（包括次要角色、地点、物品等）。内联实体是对角色卡的补充，覆盖范围更广。

**Q2: Slot-10 的关键词匹配会不会误匹配？**

A: 使用精确匹配（`name IN (...)`），不会出现模糊匹配的误命中。匹配的关键词来自上一章正文和当前章节标题，确保只注入与当前上下文相关的实体。

**Q3: 碰撞检测的误报率高吗？**

A: 采用两阶段检测：先精确匹配筛查，再 LLM 语义判断。精确匹配阶段可能有误报（如角色名出现在无关上下文中），但 LLM 判断阶段会过滤掉大部分误报。用户也可以在管理面板手动标记已解决。

**Q4: 后处理管线拆分后会不会增加总耗时？**

A: 每步之间有队列调度开销（通常毫秒级），但相比单任务 10 步串行执行的超时风险，链式设计更可靠。总耗时基本不变，但每步的执行时间大幅缩短，避免了 Cloudflare Worker 30 秒超时限制。

**Q5: 角色关系网络如何初始化？**

A: 首次生成时，Step 8 会从章节内容中提取角色关系并写入 `characterRelationships` 表。后续每次生成都会更新关系快照。用户也可以在管理面板手动维护。

**Q6: 三层防御体系是否会影响生成速度？**

A: 第一层（上下文注入）增加约 2 次 DB 查询，耗时可忽略。第二层（硬性约束）只是在 prompt 中增加文本，无额外耗时。第三层（后处理）拆分为独立队列任务，不影响生成主流程的响应时间。

---

## 十二、文件索引

| 文件 | 说明 |
|------|------|
| **后端服务** | |
| [entityExtract.ts](file:///d:/user/NovelForge/server/services/agent/entityExtract.ts) | LLM 实体提取服务（Step 7） |
| [characterGrowth.ts](file:///d:/user/NovelForge/server/services/agent/characterGrowth.ts) | 角色成长追踪服务（Step 8） |
| [entityConflict.ts](file:///d:/user/NovelForge/server/services/agent/entityConflict.ts) | 实体碰撞检测服务（Step 9） |
| [postProcess.ts](file:///d:/user/NovelForge/server/services/agent/postProcess.ts) | 后处理管线（10 步链式队列） |
| [messages.ts](file:///d:/user/NovelForge/server/services/agent/messages.ts) | 硬性约束 A-I（F-I 跨章约束） |
| [tools.ts](file:///d:/user/NovelForge/server/services/agent/tools.ts) | ReAct 工具集（8 个，含 3 个跨章工具） |
| [executor.ts](file:///d:/user/NovelForge/server/services/agent/executor.ts) | ReAct 工具执行器 |
| **上下文构建** | |
| [contextBuilder.ts](file:///d:/user/NovelForge/server/services/contextBuilder.ts) | 上下文构建引擎（12 槽体系，含 Slot-10/11） |
| [ContextPreview.tsx](file:///d:/user/NovelForge/src/components/generate/ContextPreview.tsx) | 上下文预览组件（含 Slot-10/11 展示） |
| [AiMonitorPage.tsx](file:///d:/user/NovelForge/src/pages/AiMonitorPage.tsx) | AI 监控中心（上下文诊断面板） |
| **API 路由** | |
| [cross-chapter.ts (route)](file:///d:/user/NovelForge/server/routes/cross-chapter.ts) | 跨章一致性 API（10 个端点） |
| [generate.ts (route)](file:///d:/user/NovelForge/server/routes/generate.ts) | 生成 API（含上下文预览端点） |
| **前端页面** | |
| [CrossChapterPage.tsx](file:///d:/user/NovelForge/src/pages/CrossChapterPage.tsx) | 跨章一致性管理页（4 Tab） |
| [NovelCard.tsx](file:///d:/user/NovelForge/src/components/novel/NovelCard.tsx) | 小说卡片（含跨章入口） |
| [Sidebar.tsx](file:///d:/user/NovelForge/src/components/layout/Sidebar.tsx) | 侧边栏（含跨章导航） |
| [api.ts](file:///d:/user/NovelForge/src/lib/api.ts) | 前端 API 调用封装（crossChapter 模块） |
| **数据库** | |
| [schema.ts](file:///d:/user/NovelForge/server/db/schema.ts) | 数据库 Schema（含跨章 6 表） |
| [0002_cross_chapter_consistency.sql](file:///d:/user/NovelForge/server/db/migrations/0002_cross_chapter_consistency.sql) | 跨章一致性迁移脚本 |
| **队列** | |
| [queue.ts](file:///d:/user/NovelForge/server/lib/queue.ts) | 队列消息类型定义 |
| [queue-handler.ts](file:///d:/user/NovelForge/server/queue-handler.ts) | 队列处理器（含 10 步后处理） |

---

## 十三、版本历史

| 版本 | 日期 | 主要更新 |
|------|------|---------|
| **v1.0.0** | 2026-05-02 | 初始版本：三层防御体系、6 张数据表、12 槽位上下文、10 步链式后处理管线、4 Tab 管理页面、8 个 ReAct 工具、10 个 API 端点 |

---

> 文档版本：v1.0.0
> 最后更新：2026-05-02
> 维护者：NovelForge 开发团队
> 基于 v2.1 代码库编写
