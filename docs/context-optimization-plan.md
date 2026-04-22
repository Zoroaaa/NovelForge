# NovelForge AI模块 - 上下文精准查询优化方案

## 根本问题诊断

### v2 的架构缺陷

```
embed(chapterOutline)
  └─→ searchSimilar(novelId, topK=20)  ← 所有类型混在一起竞争
        ├─ character × 3
        ├─ foreshadowing × 5          ← 含已收尾的伏笔
        ├─ setting × 8                ← 货币体系、地图、100个门派全进来
        ├─ master_outline × 2         ← 全文而非摘要
        └─ writing_rules × 2
  └─→ 按 budget 从高分截断           ← 高分无关设定挤掉低分关键信息
```

**核心病因**：单一查询向量 + 无类型隔离 = 相关性高的无关设定污染上下文

fallback 更严重：RAG 失败时直接拉最新5条 novelSettings + masterOutline **全文**。

---

## v3 改造：分槽独立检索

### 架构对比

| 层级 | v2 | v3 |
|------|-----|-----|
| 总纲 | masterOutline.content（全文）| masterOutline.**summary**（摘要字段） |
| 卷信息 | volumes.eventLine 一个字段 | blueprint + eventLine 两字段分开 |
| 角色卡 | 正则从大纲提取名字 → DB查 | RAG独立查 sourceType=character，score>0.65 |
| 伏笔 | fetchAll(open, limit=10) | RAG查 + 与DB未收尾列表**交叉验证** |
| 设定 | 混入全局RAG竞争 | **按type分7个子槽**，各槽独立预算和阈值 |
| 规则 | 全量按priority截前8条 | priority≤2固定注入 + **章节类型匹配**剩余规则 |

### 设定分槽详解

```
Setting RAG (topK=15, sourceType=setting)
  ↓
  ├─ worldRules  (type=world_rule)   预算400t  阈值0.55  ← 普遍相关，低阈值
  ├─ powerSystem (type=power_system) 预算400t  阈值0.55  ← 普遍相关，低阈值
  ├─ geography   (type=geography)    预算250t  阈值0.70  ← 仅章节含地点关键词时开启
  ├─ factions    (type=faction)      预算200t  阈值0.68  ← 仅章节含势力关键词时开启
  ├─ artifacts   (type=artifact)     预算150t  阈值0.68  ← 仅章节含法宝关键词时开启
  └─ misc                            预算100t  阈值0.72  ← 其他，高阈值严格过滤
```

章节类型推断：从 `volumes.eventLine + chapters.title` 提取关键词，动态开关各槽。

### 伏笔双重过滤

```
RAG查询 (topK=10, sourceType=foreshadowing)
  ↓
  二次过滤：
  ├─ 必须在 DB 的 status='open' 列表中（已收尾的绝不注入）
  ├─ importance='high' → 强制注入（忽略score）
  └─ importance 非 high → score > 0.60 才注入
```

---

## Token 预算对比

| 槽 | v2 实际消耗 | v3 上限 | 节省原因 |
|----|------------|---------|---------|
| 总纲 | ~3000t（全文） | ~200t（摘要） | 只注入summary字段 |
| 设定 | ~4000t（无限制混入） | 1500t（分槽截断） | 无关槽预算=0 |
| 伏笔 | ~800t（10条全部） | ~400t（相关过滤） | 双重过滤 |
| 角色 | ~800t（正则命中率低） | ~2000t | 反而增加（更精准） |
| **总计** | **~12000t（噪音多）** | **~8000t（精准）** | **节省4000t** |

节省的空间用于：增加摘要链长度（从5章→10章）或提高生成 max_tokens。

---

## 需要配合修改的 Embedding 索引

### 索引时需要写入 metadata.settingType

现在 `indexContent` 调用时，`novelSettings` 的 `type` 字段没有写入 metadata，
导致 v3 的分槽过滤无法工作。

**修改 `server/routes/vectorize.ts` 或 `server/services/entity-index.ts`**：

```typescript
// 索引 novelSettings 时
await upsertVector(env.VECTORIZE, vectorId, values, {
  novelId,
  sourceType: 'setting',
  sourceId: setting.id,
  title: setting.name,
  content: chunk,
  settingType: setting.type,      // ← 新增：写入设定类型
  importance: setting.importance, // ← 新增：写入重要性
})
```

同理 foreshadowing 索引时写入 `importance`：

```typescript
await upsertVector(env.VECTORIZE, vectorId, values, {
  novelId,
  sourceType: 'foreshadowing',
  sourceId: item.id,
  title: item.title,
  content: chunk,
  importance: item.importance,  // ← 新增
})
```

### masterOutline 需要 summary 字段

v3 依赖 `masterOutline.summary` 字段。该字段在 schema 中已存在。
确保总纲创建/更新时有生成摘要的流程（可以调用 LLM 生成，也可以手动填写）。

如果 summary 为空，v3 会返回空字符串，不会降级为全文注入。
建议在 `master-outline` 路由的 create/update handler 中自动生成摘要。

---

## 集成步骤

1. **替换文件**：将 `contextBuilder.v3.ts` 重命名为 `contextBuilder.ts`，替换原文件。

2. **更新 agent.ts 导入**：
   ```typescript
   // 新增导入
   import { buildChapterContext, assemblePromptContext, type ContextBundle } from './contextBuilder'
   
   // 在生成前调用
   const bundle = await buildChapterContext(env, novelId, chapterId)
   const contextText = assemblePromptContext(bundle)
   ```

3. **更新 Vectorize 索引 metadata**（重要，否则分槽过滤无效）：
   - 修改 novelSettings 索引写入 `settingType`
   - 修改 foreshadowing 索引写入 `importance`
   - 已有索引需要重建（触发重新 index）

4. **前端 ContextPreview 更新**：
   `debug.slotBreakdown` 替代了原来的 `debug.coreTokens/supplementaryTokens`，
   前端展示各槽 token 消耗时需要对应更新。

---

## 预期效果

- 400万字小说的设定库（假设500条设定），每次生成实际注入：
  - v2：~8条混合设定（高分但可能无关）
  - v3：worldRules 2-3条 + powerSystem 2-3条 + 按需1-2条（最多7条但类型精准）
- 伏笔注入：从"最多10条open伏笔全部注入"→"与当前章节语义相关的open伏笔"
- 规则注入：从"按priority截前8条"→"2条核心禁忌 + 当前章节类型匹配规则"
