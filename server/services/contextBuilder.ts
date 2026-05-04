/**
 * @file contextBuilder.ts
 * @description 精准分槽上下文构建器 v5 —— DB为主+向量为辅+跨章一致性增强
 *
 * 核心改造（从 v4 升级）:
 * - 向量只负责"语义检索找相关ID"，不负责存储完整内容
 * - 角色槽：RAG 返回 sourceId → DB 批量 IN 查完整卡片（name+role+desc+attr+powerLevel）
 * - 设定槽：RAG 返回 summary 字段（novelSettings.summary），不再存全文切块
 * - 伏笔槽：高重要性 DB 直查兜底 + 普通 RAG 过滤（双路合并）
 * - 总纲槽：优先取 content 全文（上限12k字），fallback 到 summary
 * - 规则槽：全部活跃规则（不再限制 priority≤2）
 * - 摘要链：默认 20 章（从 5 章扩展）
 * - 预算：~55k tokens（充分利用 256k 窗口，安全范围 40-50k）
 *
 * v5 新增（跨章一致性系统）:
 * - Slot-3 升级：主角卡注入 knowledge 已知信息边界 + oath_debt 誓言血仇
 * - Slot-10：关键词精确匹配层，从 novel_inline_entities 确定性召回即兴创造实体，
 *            成长性实体自动追加 entity_state_log 最新状态
 * - Slot-11：角色关系网络，从 character_relationships 注入主角当前关系图谱
 * - queryText 扩充至 1200 字，补入近期摘要尾部 + 卷蓝图片段，提升关键词命中率
 *
 * ReAct 工具层（tools.ts / executor.ts）:
 * - 工具6 queryInlineEntity：LLM 主动查询 novel_inline_entities，适用于"记得前文出现过
 *   某个名字但资料包里没有"的场景，返回实体描述 + 最新状态
 * - 工具7 queryEntityStateHistory：查询成长性实体（功法/宝物/势力）的完整状态历史链，
 *   适用于"需要确认当前修炼程度/势力规模/宝物状态"的场景
 * - 工具8 queryCharacterGrowth：查询角色在 character_growth_log 中的成长记录，
 *   适用于"需要确认角色当前心理状态/已知信息/人际关系"的场景
 *
 * Slot-0  总纲全文/长摘要                         DB直查         ~10000 tokens
 * Slot-1  当前卷 blueprint + eventLine             DB直查         ~1500  tokens
 * Slot-2  上一章正文                               DB直查         ~5000  tokens
 * Slot-3  主角完整状态卡（含知识边界+誓言）★升级   DB直查         ~4000  tokens
 * Slot-4  全部活跃创作规则                          DB直查         ~5000  tokens
 * Slot-5  出场角色卡（RAG引导→DB补全）              RAG+DB         ~8000  tokens
 * Slot-6  世界设定（RAG查summary）                  RAG            ~12000 tokens
 * Slot-7  待回收伏笔（高优DB兜底+普通RAG）          混合           ~4000  tokens
 * Slot-8  本章类型匹配规则                          DB过滤         ~3000  tokens
 * Slot-9  近期剧情摘要链(20章)                      DB直查         ~10000 tokens
 * Slot-10 关键词精确匹配的内联实体（含成长态）★新增  精确匹配+DB   ~6000  tokens
 * Slot-11 主角关系网络快照                          ★新增 DB直查   ~2000  tokens
 *
 * @version 5.0.0
 */

import { drizzle, type DrizzleD1Database } from 'drizzle-orm/d1'
import {
  chapters, volumes, characters, modelConfigs, foreshadowing,
  novelSettings, masterOutline, writingRules, novels,
  novelInlineEntities, entityStateLog, characterGrowthLog, characterRelationships, chapterStructuredData,
} from '../db/schema'
import { eq, and, sql, desc, inArray, notInArray, asc } from 'drizzle-orm'
import type { Env } from '../lib/types'
import { embedText, searchSimilar } from './embedding'

export type AppDb = DrizzleD1Database<typeof import('../db/schema')>

// ============================================================
// 类型定义
// ============================================================

export interface SlotResult {
  slotName: string
  content: string[]
  tokensUsed: number
  source: 'fixed' | 'rag' | 'db_filter'
  hitCount: number
  skippedCount: number
}

export interface RagRawResult {
  sourceType: string
  sourceId: string
  score: number
  content: string
  metadata: Record<string, any>
}

export interface ContextBundle {
  core: {
    masterOutlineContent: string
    volumeBlueprint: string
    volumeEventLine: string
    volumeNotes: string
    prevChapterContent: string
    currentEvent: string
    nextThreeChapters: string
    protagonistStateCards: string[]
    allActiveRules: string[]
    rhythmStats: RhythmStats | null
  }
  dynamic: {
    summaryChain: string[]
    characterCards: string[]
    relevantForeshadowing: string[]
    relevantSettings: SlottedSettings
    chapterTypeRules: string[]
    inlineEntities: string[]
    characterRelationships: string[]
  }
  debug: {
    totalTokenEstimate: number
    slotBreakdown: Record<string, number>
    ragQueriesCount: number
    ragFallbackUsed: boolean
    buildTimeMs: number
    budgetTier: BudgetTier
    chapterTypeHint: string
    queryText: string
    ragRawResults: {
      characters: RagRawResult[]
      foreshadowing: RagRawResult[]
      settings: RagRawResult[]
    }
  }
}

export interface SlottedSettings {
  worldRules: string[]
  powerSystem: string[]
  geography: string[]
  factions: string[]
  artifacts: string[]
  misc: string[]
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
  inlineEntities: number
  relationships: number
  total: number
}

// ============================================================
// 预算配置 v5 — 跨章一致性增强版
// ============================================================

export const DEFAULT_BUDGET: BudgetTier = {
  core: 40000,
  summaryChain: 25000,
  characters: 20000,
  foreshadowing: 10000,
  settings: 25000,
  rules: 8000,
  inlineEntities: 15000,
  relationships: 8000,
  total: 151000,
}

// ============================================================
// 主函数
// ============================================================

/**
 * 构建单章生成的完整上下文（分槽组装）
 *
 * 为什么采用分槽（Slot）架构而非单一Prompt：
 * - LLM的上下文窗口有限（128k-256k），必须精细控制每个信息源的token预算
 * - 不同信息源的重要性和时效性不同：总纲和近期章节优先级高，历史设定优先级低
 * - 分槽便于独立优化每个数据源的检索策略（DB直查/RAG/混合）
 *
 * 为什么使用 Promise.all 并发获取 Core 层：
 * - Step 1 中的 7 个数据源之间无依赖关系，串行查询会浪费 6 轮 RTT
 * - Cloud Workers 的 D1 数据库支持并发连接，并行查询可减少总延迟 60%+
 * - 即使某个查询失败，其他槽位仍可正常工作（降级容错）
 */
export async function buildChapterContext(
  env: Env,
  novelId: string,
  chapterId: string,
  budget: BudgetTier = DEFAULT_BUDGET,
  options?: { summaryChainLength?: number }
): Promise<ContextBundle> {
  const startTime = Date.now()
  const db = drizzle(env.DB) as AppDb

  const summaryChainLength = Math.min(
    Math.max(options?.summaryChainLength ?? 20, 0),
    30
  )

  // ── Step 0: 当前章节基础信息 ──
  const currentChapter = await db
    .select({
      novelId: chapters.novelId,
      volumeId: chapters.volumeId,
      sortOrder: chapters.sortOrder,
      title: chapters.title,
    })
    .from(chapters)
    .where(and(eq(chapters.id, chapterId), sql`${chapters.deletedAt} IS NULL`))
    .get()

  if (!currentChapter) throw new Error(`Chapter not found: ${chapterId}`)

  // ── Step 1: 并发获取 Core 层固定数据 ──
  const [
    outlineContent,
    volumeInfo,
    prevContent,
    allActiveRules,
    recentSummaries,
    rhythmStats,
    firstChapterInVolume,
  ] = await Promise.all([
    fetchMasterOutlineContent(db, novelId),
    fetchVolumeInfo(db, currentChapter.volumeId),
    fetchPrevChapterContent(db, currentChapter.novelId, currentChapter.sortOrder),
    fetchAllActiveRules(db, novelId),
    fetchRecentSummaries(db, currentChapter.novelId, currentChapter.sortOrder, summaryChainLength, currentChapter.volumeId ?? undefined),
    fetchRhythmStats(db, novelId, currentChapter.volumeId, currentChapter.sortOrder),
    currentChapter.volumeId
      ? db
          .select({ sortOrder: chapters.sortOrder })
          .from(chapters)
          .where(and(eq(chapters.volumeId, currentChapter.volumeId), sql`${chapters.deletedAt} IS NULL`))
          .orderBy(asc(chapters.sortOrder))
          .limit(1)
          .get()
      : Promise.resolve(null),
  ])

  const chapterIndexInVolume = firstChapterInVolume
    ? currentChapter.sortOrder - firstChapterInVolume.sortOrder + 1
    : 1

  // Slot-3 升级：主角完整状态卡（含 knowledge 已知信息边界 + oath_debt 誓言血仇）
  const protagonistStateCards = await fetchProtagonistFullState(db, novelId)

  // 获取主角ID数组（用于排除主角角色）
  const protagonistRows = await db
    .select({ id: characters.id })
    .from(characters)
    .where(and(
      eq(characters.novelId, novelId),
      eq(characters.role, 'protagonist'),
      sql`${characters.deletedAt} IS NULL`,
    ))
    .all()
  const protagonistIds = protagonistRows.map(p => p.id)

  // ── Step 2: 先提取本章事件（用于类型推断和向量构建） ──
  const { prevEvent, currentEvent, nextThreeChapters } = extractCurrentChapterEvent(volumeInfo.eventLine, chapterIndexInVolume)
  const typeHintSource: string = currentEvent || volumeInfo.eventLine
  const chapterTypeHint = inferChapterType(typeHintSource, currentChapter.title)

  // ── Step 2b: 组装查询向量（聚焦当前章节语义，≤1200字）──
  // v5：扩充 queryText，补入近期摘要尾部 + 卷蓝图片段，提升 Slot-10 关键词命中率
  const queryTextParts = [currentChapter.title, prevEvent, currentEvent, nextThreeChapters]

  // 近期3条摘要尾部（捕捉"接续上回"类的隐式地名/实体名）
  const summariesForQuery = recentSummaries.slice(-3)
  for (const s of summariesForQuery) {
    queryTextParts.push(s.slice(-200))
  }

  // 卷蓝图前段（卷级背景词，包含势力/地点名）
  if (volumeInfo.blueprint) {
    queryTextParts.push(volumeInfo.blueprint.slice(0, 300))
  }

  if (!currentEvent && recentSummaries.length > 0) {
    const lastSummary = recentSummaries[recentSummaries.length - 1]
    queryTextParts.push(lastSummary.slice(-300))
  }

  if (prevContent) {
    queryTextParts.push(prevContent.slice(-400))
  }

  const queryText = queryTextParts.filter(Boolean).join('\n').slice(0, 1200)

  // ── Step 3: Dynamic 层分槽检索 ──
  let characterCards: string[] = []
  let relevantForeshadowing: string[] = []
  let slottedSettings: SlottedSettings = {
    worldRules: [], powerSystem: [], geography: [],
    factions: [], artifacts: [], misc: []
  }
  let chapterTypeRules: string[] = []
  let actualRagQueriesCount = 0
  let characterResults: Array<{ score: number; metadata: any }> = []
  let foreshadowingResults: Array<{ score: number; metadata: any }> = []
  let settingResults: Array<{ score: number; metadata: any }> = []

  if (queryText && env.VECTORIZE) {
    const queryVector = await embedText(env.AI, queryText)

    const ragResults = await Promise.all([
      searchSimilar(env.VECTORIZE, queryVector, {
        topK: 15,
        filter: { novelId, sourceType: 'character' },
      }).catch(() => []),

      searchSimilar(env.VECTORIZE, queryVector, {
        topK: 10,
        filter: { novelId, sourceType: 'foreshadowing' },
      }).catch(() => []),

      searchSimilar(env.VECTORIZE, queryVector, {
        topK: 20,
        filter: { novelId, sourceType: 'setting' },
      }).catch(() => []),
    ])
    characterResults = ragResults[0]
    foreshadowingResults = ragResults[1]
    settingResults = ragResults[2]

    actualRagQueriesCount = 3

    // D1: 角色 — RAG 取 ID → DB 批量查完整卡片（排除主角）
    characterCards = await buildCharacterSlotFromDB(db, characterResults, budget.characters, protagonistIds)

    // D3: 伏笔 — 高重要性 DB 兜底 + 普通 RAG
    const openForeshadowingIds = await fetchOpenForeshadowingIds(db, novelId, currentChapter.sortOrder)
    relevantForeshadowing = await buildForeshadowingHybrid(
      db, foreshadowingResults, openForeshadowingIds, novelId, budget.foreshadowing, currentChapter.sortOrder
    )

    // D2: 设定 — RAG 返回 summary，按 type 分槽；high importance 追加 DB 全文
    slottedSettings = await buildSettingsSlotV2(
      db, settingResults, chapterTypeHint, budget.settings
    )

    // D4: 本章类型规则（排除Slot-4已注入的全部活跃规则）
    const activeRuleIds = allActiveRules.length > 0 ? await fetchAllActiveRuleIds(db, novelId) : []
    chapterTypeRules = await fetchChapterTypeRules(db, novelId, chapterTypeHint, activeRuleIds)
  } else {
    console.warn('[contextBuilder] VECTORIZE unavailable, using DB fallback for dynamic slots')

    characterCards = await db.select({
      id: characters.id,
      name: characters.name,
      role: characters.role,
      aliases: characters.aliases,
      description: characters.description,
      attributes: characters.attributes,
      powerLevel: characters.powerLevel,
    })
    .from(characters)
    .where(and(
      eq(characters.novelId, novelId),
      inArray(characters.role, ['supporting', 'antagonist']),
      sql`${characters.deletedAt} IS NULL`
    ))
    .orderBy(desc(characters.updatedAt))
    .limit(8)
    .all()
    .then(rows => rows.map(r => formatCharacterCard(r)))

    const openForeshadowingIds = await fetchOpenForeshadowingIds(db, novelId, currentChapter.sortOrder)
    relevantForeshadowing = await buildForeshadowingHybrid(
      db, [], openForeshadowingIds, novelId, budget.foreshadowing, currentChapter.sortOrder
    )

    slottedSettings = await buildSettingsSlotV2(
      db, [], chapterTypeHint, budget.settings
    )

    const activeRuleIds = allActiveRules.length > 0 ? await fetchAllActiveRuleIds(db, novelId) : []
    chapterTypeRules = await fetchChapterTypeRules(db, novelId, chapterTypeHint, activeRuleIds)
  }

  // ── Step 3b: Slot-10 关键词精确匹配（内联实体）──
  const inlineEntities = await fetchInlineEntities(db, novelId, queryText, budget.inlineEntities)

  // ── Step 3c: Slot-11 关系网络注入 ──
  const relationshipCards = await fetchCharacterRelationships(db, novelId, budget.relationships)

  // ── Step 4: Core Token 预算检查 ──
  const coreContent = [
    outlineContent,
    volumeInfo.blueprint,
    volumeInfo.eventLine,
    volumeInfo.notes,
    prevContent,
    ...protagonistStateCards,
    ...allActiveRules,
  ]
  let coreTokensUsed = coreContent.reduce((s, t) => s + estimateTokens(t), 0)

  const mutableRules = [...allActiveRules]
  while (coreTokensUsed > budget.core && mutableRules.length > 0) {
    const removed = mutableRules.pop()!
    coreTokensUsed -= estimateTokens(removed)
  }

  const BUDGET_WARNING_THRESHOLD = 0.90
  if (coreTokensUsed / budget.core > BUDGET_WARNING_THRESHOLD) {
    console.warn(`[contextBuilder] Core layer usage at ${(coreTokensUsed / budget.core * 100).toFixed(1)}% (${coreTokensUsed}/${budget.core} tokens)`)
  }

  // ── Step 5: 诊断信息 ──
  const slotBreakdown = {
    masterOutlineContent: estimateTokens(outlineContent),
    volumeBlueprint: estimateTokens(volumeInfo.blueprint),
    volumeEventLine: estimateTokens(volumeInfo.eventLine),
    volumeNotes: estimateTokens(volumeInfo.notes),
    prevChapterContent: estimateTokens(prevContent),
    protagonistCards: protagonistStateCards.reduce((s, t) => s + estimateTokens(t), 0),
    activeRules: mutableRules.reduce((s, t) => s + estimateTokens(t), 0),
    summaryChain: recentSummaries.reduce((s, t) => s + estimateTokens(t), 0),
    characterCards: characterCards.reduce((s, t) => s + estimateTokens(t), 0),
    foreshadowing: relevantForeshadowing.reduce((s, t) => s + estimateTokens(t), 0),
    settings: [
      ...slottedSettings.worldRules, ...slottedSettings.powerSystem,
      ...slottedSettings.geography, ...slottedSettings.factions,
      ...slottedSettings.artifacts, ...slottedSettings.misc,
    ].reduce((s, t) => s + estimateTokens(t), 0),
    chapterTypeRules: chapterTypeRules.reduce((s, t) => s + estimateTokens(t), 0),
    inlineEntities: inlineEntities.reduce((s, t) => s + estimateTokens(t), 0),
    characterRelationships: relationshipCards.reduce((s, t) => s + estimateTokens(t), 0),
  }
  const totalTokenEstimate = Object.values(slotBreakdown).reduce((a, b) => a + b, 0)

  const ragRawResults = {
    characters: characterResults.map((r: any) => ({
      sourceType: 'character',
      sourceId: r.metadata?.sourceId || '',
      score: r.score,
      content: r.metadata?.content || '',
      metadata: r.metadata || {},
    })),
    foreshadowing: foreshadowingResults.map((r: any) => ({
      sourceType: 'foreshadowing',
      sourceId: r.metadata?.sourceId || '',
      score: r.score,
      content: r.metadata?.content || '',
      metadata: r.metadata || {},
    })),
    settings: settingResults.map((r: any) => ({
      sourceType: 'setting',
      sourceId: r.metadata?.sourceId || '',
      score: r.score,
      content: r.metadata?.content || '',
      metadata: r.metadata || {},
    })),
  }

  return {
    core: {
      masterOutlineContent: outlineContent,
      volumeBlueprint: volumeInfo.blueprint,
      volumeEventLine: volumeInfo.eventLine,
      volumeNotes: volumeInfo.notes,
      prevChapterContent: prevContent,
      currentEvent,
      nextThreeChapters,
      protagonistStateCards,
      allActiveRules: mutableRules,
      rhythmStats,
    },
    dynamic: {
      summaryChain: recentSummaries,
      characterCards,
      relevantForeshadowing,
      relevantSettings: slottedSettings,
      chapterTypeRules,
      inlineEntities,
      characterRelationships: relationshipCards,
    },
    debug: {
      totalTokenEstimate,
      slotBreakdown,
      ragQueriesCount: queryText && env.VECTORIZE ? actualRagQueriesCount : 0,
      ragFallbackUsed: !(queryText && env.VECTORIZE),
      buildTimeMs: Date.now() - startTime,
      budgetTier: budget,
      chapterTypeHint,
      queryText,
      ragRawResults,
    },
  }
}

// ============================================================
// 分槽处理函数 v4
// ============================================================

/**
 * D1: 出场角色槽 — RAG 返回 sourceId 列表 → DB 批量 IN 查完整卡片
 * 排除主角（主角已在Slot-3单独完整注入）
 */
async function buildCharacterSlotFromDB(
  db: AppDb,
  ragResults: Array<{ score: number; metadata: any }>,
  budgetTokens: number,
  protagonistIds: string[] = [],
): Promise<string[]> {
  const SCORE_THRESHOLD_PRIMARY = 0.45
  const SCORE_THRESHOLD_FALLBACK = 0.35
  const MAX_CHARACTERS = 6

  let candidates = ragResults
    .filter(r => r.score >= SCORE_THRESHOLD_PRIMARY)
    .filter(r => !protagonistIds.includes(r.metadata.sourceId))
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_CHARACTERS)
    .map(r => r.metadata.sourceId)

  if (candidates.length < 2 && ragResults.length >= 2) {
    candidates = ragResults
      .filter(r => r.score >= SCORE_THRESHOLD_FALLBACK)
      .filter(r => !protagonistIds.includes(r.metadata.sourceId))
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_CHARACTERS)
      .map(r => r.metadata.sourceId)
  }

  if (candidates.length === 0) return []

  const rows = await db.select({
    id: characters.id,
    name: characters.name,
    role: characters.role,
    description: characters.description,
    attributes: characters.attributes,
    powerLevel: characters.powerLevel,
    aliases: characters.aliases,
  })
  .from(characters)
  .where(and(inArray(characters.id, candidates), sql`${characters.deletedAt} IS NULL`))
  .all()

  const scoreMap = new Map(ragResults.map(r => [r.metadata.sourceId, r.score]))
  const sorted = rows.sort((a, b) =>
    (scoreMap.get(b.id) || 0) - (scoreMap.get(a.id) || 0)
  )

  const cards: string[] = []
  for (const row of sorted) {
    const card = formatCharacterCard(row)
    cards.push(card)
  }
  return cards
}

function formatCharacterCard(row: any): string {
  let card = `【${row.name}】(${row.role || '未知'})`
  if (row.aliases) card += `\n别名: ${row.aliases}`
  if (row.description) card += `\n${row.description}`
  if (row.attributes) {
    try {
      const attrs = JSON.parse(row.attributes)
      card += `\n属性: ${Object.entries(attrs).map(([k, v]) => `${k}: ${v}`).join(' | ')}`
    } catch {}
  }
  if (row.powerLevel) {
    try {
      const p = JSON.parse(row.powerLevel)
      const parts: string[] = []
      if (p.current) parts.push(`当前境界: ${p.current}`)
      if (p.nextMilestone) parts.push(`下一目标: ${p.nextMilestone}`)
      if (parts.length) card += `\n${parts.join('，')}`
    } catch {}
  }
  return card
}

/**
 * D3: 伏笔槽 — 双路合并
 * 路径A: 高重要性 open 伏笔 → DB 全量取（不受 RAG score 限制）
 * 路径B: 普通 importance → RAG score 过滤
 */
async function buildForeshadowingHybrid(
  db: AppDb,
  ragResults: Array<{ score: number; metadata: any }>,
  openIds: Set<string>,
  novelId: string,
  budgetTokens: number,
  currentSortOrder?: number
): Promise<string[]> {
  // 路径A: 高重要性未收尾伏笔（按创建时间倒序，近期埋入的优先）
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
  .orderBy(desc(foreshadowing.createdAt))
  .limit(15)
  .all()

  // 路径B: 普通 importance → RAG score 过滤
  const MAX_NORMAL_FORESHADOWING = 5
  const normalItems = ragResults.filter(r => {
    const isOpen = openIds.has(r.metadata.sourceId)
    const isHigh = r.metadata.importance === 'high'
    return isOpen && !isHigh && r.score > 0.42
  }).slice(0, MAX_NORMAL_FORESHADOWING)

  // 路径C（新增）: 回收计划 — 时序感知注入
  // 当提供了 currentSortOrder 时，查询"即将到达回收章节"的 resolve_planned 伏笔
  const RESOLVE_WINDOW = 10
  const resolvePlannedItems: Array<{ title: string; description: string; targetChapter: number }> = []

  if (currentSortOrder != null) {
    try {
      const plannedRows = await db.select({
        title: foreshadowing.title,
        description: foreshadowing.description,
        chapterId: foreshadowing.chapterId,
      })
      .from(foreshadowing)
      .where(and(
        eq(foreshadowing.novelId, novelId),
        eq(foreshadowing.status, 'resolve_planned'),
        sql`${foreshadowing.deletedAt} IS NULL`
      ))
      .all()

      if (plannedRows.length > 0) {
        const plannedChapterIds = [...new Set(plannedRows.map(r => r.chapterId).filter((id): id is string => id != null))]
        let chapterSortMap: Map<string, number> = new Map()

        if (plannedChapterIds.length > 0) {
          const sortRows = await db.select({ id: chapters.id, sortOrder: chapters.sortOrder })
            .from(chapters)
            .where(inArray(chapters.id, plannedChapterIds))
            .all()
          chapterSortMap = new Map(sortRows.map(r => [r.id, r.sortOrder]))
        }

        for (const row of plannedRows) {
          const targetSort = row.chapterId ? chapterSortMap.get(row.chapterId) : undefined
          if (targetSort !== undefined && targetSort >= currentSortOrder - 1 && targetSort <= currentSortOrder + RESOLVE_WINDOW) {
            resolvePlannedItems.push({
              title: row.title,
              description: row.description || '',
              targetChapter: targetSort,
            })
          }
        }

        resolvePlannedItems.sort((a, b) => a.targetChapter - b.targetChapter)
      }
    } catch (e) {
      console.warn('[contextBuilder] 路径C 查询 resolve_planned 失败:', e)
    }
  }

  const allItems = [
    ...highPriority.map(h => ({
      text: `【${h.title}】(高重要性·待回收)\n${h.description}`,
      priority: 0,
    })),
    ...normalItems.map(n => ({
      text: n.metadata.content || '',
      priority: 1,
      score: n.score,
    })),
    ...resolvePlannedItems.map(r => ({
      text: `【${r.title}】(回收计划·第${r.targetChapter}章)\n${r.description}\n⚠️ 此伏笔计划在第 ${r.targetChapter} 章回收，本章可提前铺垫但不得终结`,
      priority: 1.5,
      isResolvePlanned: true,
    })),
  ]

  let used = 0
  const output: string[] = []
  for (const item of allItems) {
    const tokens = estimateTokens(item.text)
    if (used + tokens > budgetTokens) break
    used += tokens
    output.push(item.text)
  }
  return output
}

/**
 * D2: 世界设定槽 v2 — 使用 RAG 返回的 summary 字段
 * 按 settingType 分槽，各槽独立预算和阈值
 * importance=high 的额外追加了 DB content 全文
 */
async function buildSettingsSlotV2(
  db: AppDb,
  results: Array<{ score: number; metadata: any }>,
  chapterTypeHint: string,
  totalBudget: number
): Promise<SlottedSettings> {
  const slotBudgets: Record<keyof SlottedSettings, number> = {
    worldRules:  Math.min(2500, totalBudget * 0.21),
    powerSystem: Math.min(2500, totalBudget * 0.21),
    geography:   Math.min(1200, totalBudget * 0.10),
    factions:    Math.min(1000, totalBudget * 0.08),
    artifacts:   Math.min(700,  totalBudget * 0.06),
    misc:        600,
  }

  const typeMapping: Record<string, keyof SlottedSettings> = {
    worldview: 'worldRules', world_rule: 'worldRules', rule: 'worldRules',
    power_system: 'powerSystem', cultivation: 'powerSystem',
    geography: 'geography', location: 'geography',
    faction: 'factions', organization: 'factions',
    item_skill: 'artifacts', artifact: 'artifacts', item: 'artifacts',
  }

  const SCORE_THRESHOLDS: Record<keyof SlottedSettings, number> = {
    worldRules: 0.42, powerSystem: 0.42,
    geography: 0.45, factions: 0.45, artifacts: 0.45, misc: 0.48,
  }
  const SLOT_MAX_ITEMS: Record<keyof SlottedSettings, number> = {
    worldRules: 5, powerSystem: 5,
    geography: 4, factions: 4, artifacts: 4, misc: 3,
  }
  const slotCount: Record<keyof SlottedSettings, number> = {
    worldRules: 0, powerSystem: 0, geography: 0,
    factions: 0, artifacts: 0, misc: 0,
  }

  const slotUsed: Record<keyof SlottedSettings, number> = {
    worldRules: 0, powerSystem: 0, geography: 0,
    factions: 0, artifacts: 0, misc: 0,
  }
  const output: SlottedSettings = {
    worldRules: [], powerSystem: [], geography: [],
    factions: [], artifacts: [], misc: [],
  }

  // 收集 high importance 设定 ID 及对应的 slotKey 和插入位置
  const highImportanceIds: string[] = []
  const sourceIdSlotMap: Record<string, { slotKey: keyof SlottedSettings; index: number }> = {}

  for (const r of results) {
    const rawType = (r.metadata.settingType || r.metadata.type || 'misc') as string
    const slotKey = typeMapping[rawType] ?? 'misc'
    const sbudget = slotBudgets[slotKey]
    const threshold = SCORE_THRESHOLDS[slotKey]

    if (sbudget === 0) continue
    if (r.score < threshold) continue
    if (slotCount[slotKey] >= SLOT_MAX_ITEMS[slotKey]) continue

    const settingName = r.metadata.title || ''
    const isHighImportance = r.metadata.importance === 'high' && r.score >= 0.38 && r.metadata.sourceId

    if (isHighImportance) {
      highImportanceIds.push(r.metadata.sourceId)
      sourceIdSlotMap[r.metadata.sourceId] = { slotKey, index: output[slotKey].length }
      continue
    }

    const content = r.metadata.content || ''
    const labeledContent = settingName ? `【${settingName}】\n${content}` : content
    const tokens = estimateTokens(labeledContent) + 1
    if (slotUsed[slotKey] + tokens > sbudget) continue

    slotUsed[slotKey] += tokens
    slotCount[slotKey]++
    output[slotKey].push(labeledContent + '\n')
  }

  if (highImportanceIds.length > 0) {
    try {
      const fullRows = await db.select({
        id: novelSettings.id,
        name: novelSettings.name,
        type: novelSettings.type,
        content: novelSettings.content,
        importance: novelSettings.importance,
      })
      .from(novelSettings)
      .where(and(inArray(novelSettings.id, highImportanceIds), sql`${novelSettings.deletedAt} IS NULL`))
      .all()

      for (const fr of fullRows) {
        const slotKey = typeMapping[fr.type] ?? 'misc'
        const fullText = `【${fr.name}·完整设定】\n${fr.content}`
        const tokens = estimateTokens(fullText) + 1
        if (slotUsed[slotKey] + tokens <= slotBudgets[slotKey] * 1.5) {
          slotUsed[slotKey] += tokens
          slotCount[slotKey]++
          const mapping = sourceIdSlotMap[fr.id]
          if (mapping && mapping.slotKey === slotKey) {
            output[slotKey].splice(mapping.index, 0, fullText + '\n')
          } else {
            output[slotKey].push(fullText + '\n')
          }
        }
      }
    } catch (e) {
      console.warn('[contextBuilder] failed to fetch high-importance setting full text:', e)
    }
  }

  return output
}

// ============================================================
// DB查询函数 v4
// ============================================================

/**
 * 总纲：优先取 content 全文（上限12000字），fallback 到 summary
 */
async function fetchMasterOutlineContent(db: AppDb, novelId: string): Promise<string> {
  try {
    const row = await db.select({
      content: masterOutline.content,
      summary: masterOutline.summary,
      title: masterOutline.title,
    })
    .from(masterOutline)
    .where(and(eq(masterOutline.novelId, novelId), sql`${masterOutline.deletedAt} IS NULL`))
    .orderBy(desc(masterOutline.version))
    .limit(1)
    .get()

    if (!row) return ''
    if (row.content && row.content.length <= 12000) return `【${row.title}（总纲）】\n${row.content}`
    if (row.summary) return `【${row.title}（总纲摘要）】\n${row.summary}`
    if (row.content) return `【${row.title}（总纲·节选）】\n${row.content.slice(0, 8000)}`
    return ''
  } catch (error) {
    console.error('[contextBuilder] fetchMasterOutlineContent failed:', error)
    return ''
  }
}

async function fetchVolumeInfo(db: AppDb, volumeId: string | null): Promise<{
  blueprint: string; eventLine: string; notes: string
}> {
  if (!volumeId) return { blueprint: '', eventLine: '', notes: '' }
  try {
    const row = await db
      .select({ blueprint: volumes.blueprint, eventLine: volumes.eventLine, notes: volumes.notes })
      .from(volumes).where(eq(volumes.id, volumeId)).get()
    return { blueprint: row?.blueprint || '', eventLine: row?.eventLine || '', notes: row?.notes || '' }
  } catch (error) {
    console.error('[contextBuilder] fetchVolumeInfo failed:', error)
    return { blueprint: '', eventLine: '', notes: '' }
  }
}

async function fetchRhythmStats(
  db: AppDb,
  novelId: string,
  volumeId: string | null,
  currentSortOrder: number
): Promise<RhythmStats | null> {
  try {
    const [novelData, volumeData, currentChapterInVolumeResult] = await Promise.all([
      db.select({
        wordCount: novels.wordCount,
        targetWordCount: novels.targetWordCount,
      }).from(novels).where(eq(novels.id, novelId)).get(),
      volumeId
        ? db.select({
            wordCount: volumes.wordCount,
            targetWordCount: volumes.targetWordCount,
            chapterCount: volumes.chapterCount,
            targetChapterCount: volumes.targetChapterCount,
          }).from(volumes).where(eq(volumes.id, volumeId)).get()
        : Promise.resolve(null),
      volumeId
        ? db.select({ count: sql`count(*)` })
            .from(chapters)
            .where(and(
              eq(chapters.volumeId, volumeId),
              sql`${chapters.sortOrder} <= ${currentSortOrder}`
            ))
            .get()
        : Promise.resolve(null),
    ])

    if (!novelData) return null

    return {
      novelWordCount: novelData.wordCount || 0,
      novelTargetWordCount: novelData.targetWordCount || null,
      volumeWordCount: volumeData?.wordCount || 0,
      volumeTargetWordCount: volumeData?.targetWordCount || null,
      volumeChapterCount: volumeData?.chapterCount || 0,
      volumeTargetChapterCount: volumeData?.targetChapterCount || null,
      currentChapterInVolume: Math.max(0, Number(currentChapterInVolumeResult?.count ?? 0) - 1),
    }
  } catch (error) {
    console.error('[contextBuilder] fetchRhythmStats failed:', error)
    return null
  }
}

async function fetchPrevChapterContent(
  db: AppDb, novelId: string, currentSortOrder: number
): Promise<string> {
  try {
    const row = await db
      .select({ content: chapters.content, title: chapters.title, sortOrder: chapters.sortOrder })
      .from(chapters)
      .where(and(
        eq(chapters.novelId, novelId),
        sql`${chapters.sortOrder} < ${currentSortOrder}`,
        sql`${chapters.deletedAt} IS NULL`
      ))
      .orderBy(desc(chapters.sortOrder)).limit(1).get()
    if (!row?.content) return ''
    return `[上一章: ${row.title}]\n${row.content}`
  } catch (error) {
    console.error('[contextBuilder] fetchPrevChapterContent failed:', error)
    return ''
  }
}

async function fetchRecentSummaries(
  db: AppDb, novelId: string, currentSortOrder: number, chainLength: number, volumeId?: string
): Promise<string[]> {
  if (chainLength <= 0) return []
  try {
    let rows: Array<{ title: string; summary: string | null; sortOrder: number }>

    if (volumeId) {
      const sameVolRows = await db
        .select({ title: chapters.title, summary: chapters.summary, sortOrder: chapters.sortOrder })
        .from(chapters)
        .where(and(
          eq(chapters.novelId, novelId),
          eq(chapters.volumeId, volumeId),
          sql`${chapters.sortOrder} < ${currentSortOrder}`,
          sql`${chapters.summary} IS NOT NULL AND ${chapters.summary} != ''`,
          sql`${chapters.deletedAt} IS NULL`
        ))
        .orderBy(desc(chapters.sortOrder)).limit(chainLength).all()

      if (sameVolRows.length >= chainLength) {
        rows = [...sameVolRows].reverse()
      } else {
        const remaining = chainLength - sameVolRows.length
        const prevVolRows = await db
          .select({ title: chapters.title, summary: chapters.summary, sortOrder: chapters.sortOrder })
          .from(chapters)
          .where(and(
            eq(chapters.novelId, novelId),
            sql`${chapters.volumeId} != ${volumeId}`,
            sql`${chapters.sortOrder} < ${currentSortOrder}`,
            sql`${chapters.summary} IS NOT NULL AND ${chapters.summary} != ''`,
            sql`${chapters.deletedAt} IS NULL`
          ))
          .orderBy(desc(chapters.sortOrder)).limit(remaining).all()
        rows = [...prevVolRows.reverse(), ...sameVolRows.reverse()]
      }
    } else {
      rows = await db
        .select({ title: chapters.title, summary: chapters.summary, sortOrder: chapters.sortOrder })
        .from(chapters)
        .where(and(
          eq(chapters.novelId, novelId),
          sql`${chapters.sortOrder} < ${currentSortOrder}`,
          sql`${chapters.summary} IS NOT NULL AND ${chapters.summary} != ''`,
          sql`${chapters.deletedAt} IS NULL`
        ))
        .orderBy(desc(chapters.sortOrder)).limit(chainLength).all()
      rows = rows.reverse()
    }

    return rows.map((r: any) => `[${r.title}] ${r.summary}`)
  } catch (error) {
    console.error('[contextBuilder] fetchRecentSummaries failed:', error)
    return []
  }
}

/**
 * Slot-3 升级版：主角完整状态卡
 *
 * 在原有 description + powerLevel 基础上，额外注入：
 * 1. characters.attributes.growthStates — 心理/身体/立场当前状态（由 step8 维护）
 * 2. character_growth_log (dimension='knowledge') — 主角已知的关键信息边界（最近8条）
 * 3. character_growth_log (dimension='oath_debt')  — 誓言/恩情/血仇（最近5条）
 *
 * 这些数据由 postProcess step8（characterGrowth）写入，此处消费，形成"写→读"闭环。
 */
async function fetchProtagonistFullState(db: AppDb, novelId: string): Promise<string[]> {
  try {
    const protagonists = await db
      .select({
        id: characters.id,
        name: characters.name,
        description: characters.description,
        role: characters.role,
        attributes: characters.attributes,
        powerLevel: characters.powerLevel,
      })
      .from(characters)
      .where(and(
        eq(characters.novelId, novelId),
        eq(characters.role, 'protagonist'),
        sql`${characters.deletedAt} IS NULL`,
      ))
      .all()

    if (protagonists.length === 0) return []

    const cards = await Promise.all(protagonists.map(async p => {
      let card = `【${p.name}（主角）】\n${p.description || ''}`

      // ── 境界/实力 ──
      if (p.powerLevel) {
        try {
          const pl = JSON.parse(p.powerLevel)
          const parts: string[] = []
          if (pl.current) parts.push(`当前境界：${pl.current}`)
          if (pl.nextMilestone) parts.push(`下一目标：${pl.nextMilestone}`)
          if (parts.length > 0) card += `\n${parts.join('，')}`
        } catch {}
      }

      // ── growthStates（心理/身体/立场，由 step8 写入 attributes.growthStates） ──
      if (p.attributes) {
        try {
          const attrs = JSON.parse(p.attributes)
          if (attrs.growthStates) {
            const gs = attrs.growthStates
            if (gs.psychology) card += `\n心理状态：${gs.psychology}`
            if (gs.physical)   card += `\n身体状态：${gs.physical}`
            if (gs.stance)     card += `\n当前立场：${gs.stance}`
          } else {
            // 兼容旧格式：把 attributes 所有字段展示出来
            const entries = Object.entries(attrs)
            if (entries.length > 0) {
              card += `\n属性：${entries.map(([k, v]) => `${k}: ${v}`).join(' | ')}`
            }
          }
        } catch {}
      }

      // ── 已知关键信息边界（knowledge） ──
      try {
        const knowledgeItems = await db
          .select({
            currState: characterGrowthLog.currState,
            isSecret: characterGrowthLog.isSecret,
            chapterOrder: characterGrowthLog.chapterOrder,
          })
          .from(characterGrowthLog)
          .where(and(
            eq(characterGrowthLog.characterId, p.id),
            eq(characterGrowthLog.growthDimension, 'knowledge'),
          ))
          .orderBy(desc(characterGrowthLog.chapterOrder))
          .limit(8)
          .all()

        if (knowledgeItems.length > 0) {
          card += `\n\n【主角已知的关键信息——不得遗忘】`
          for (const k of knowledgeItems) {
            const secretTag = k.isSecret ? '（秘密·对外保密）' : ''
            card += `\n• ${k.currState}${secretTag}`
          }
        }
      } catch {}

      // ── 誓言/恩情/血仇（oath_debt） ──
      try {
        const oaths = await db
          .select({
            currState: characterGrowthLog.currState,
            chapterOrder: characterGrowthLog.chapterOrder,
          })
          .from(characterGrowthLog)
          .where(and(
            eq(characterGrowthLog.characterId, p.id),
            eq(characterGrowthLog.growthDimension, 'oath_debt'),
          ))
          .orderBy(desc(characterGrowthLog.chapterOrder))
          .limit(5)
          .all()

        if (oaths.length > 0) {
          card += `\n\n【誓言/恩情/血仇】`
          for (const o of oaths) {
            card += `\n• 第${o.chapterOrder}章：${o.currState}`
          }
        }
      } catch {}

      return card.trim()
    }))

    return cards
  } catch (error) {
    console.error('[contextBuilder] fetchProtagonistFullState failed:', error)
    return []
  }
}

// 保留旧函数（供外部可能的直接调用，内部不再使用）
async function fetchProtagonistCards(db: AppDb, novelId: string): Promise<Array<{
  id: string; name: string; description: string | null; role: string | null; attributes: string | null
}>> {
  try {
    return await db
      .select({ id: characters.id, name: characters.name, description: characters.description, role: characters.role, attributes: characters.attributes })
      .from(characters)
      .where(and(eq(characters.novelId, novelId), eq(characters.role, 'protagonist'), sql`${characters.deletedAt} IS NULL`))
      .all()
  } catch (error) {
    console.error('[contextBuilder] fetchProtagonistCards failed:', error)
    return []
  }
}

/**
 * Slot-10：关键词精确匹配层 — 从 novelInlineEntities 中检索与 queryText 关键词匹配的实体。
 *
 * 【匹配策略】精确子串匹配（不分词、不模糊）：
 *   检查实体的 name 和 aliases 字段，只要 queryText 中包含任一关键词（≥2字）即命中。
 *   不检查 description 全文，避免高频汉字（"谷"、"山"等）导致大量误匹配。
 *
 * 【成长态注入】对 is_growable=1 的命中实体，查询 entity_state_log 最新记录追加到卡片尾部，
 *   确保 LLM 看到的是"当前状态"而非首次出场时的初始描述。
 *
 * 返回格式化的实体卡片列表，限制在 tokenBudget 内。
 */
async function fetchInlineEntities(
  db: AppDb,
  novelId: string,
  queryText: string,
  tokenBudget: number,
): Promise<string[]> {
  try {
    if (!queryText || queryText.trim().length === 0) return []

    // 读取所有 inline 实体（只取 name/aliases/isGrowable 等轻量字段用于匹配）
    const rows = await db
      .select({
        id: novelInlineEntities.id,
        name: novelInlineEntities.name,
        entityType: novelInlineEntities.entityType,
        description: novelInlineEntities.description,
        aliases: novelInlineEntities.aliases,
        isGrowable: novelInlineEntities.isGrowable,
        lastChapterOrder: novelInlineEntities.lastChapterOrder,
      })
      .from(novelInlineEntities)
      .where(and(
        eq(novelInlineEntities.novelId, novelId),
        sql`${novelInlineEntities.deletedAt} IS NULL`,
      ))
      .orderBy(desc(novelInlineEntities.lastChapterOrder))
      .limit(200)  // 最多扫描200条，500章后的规模保护
      .all()

    // 精确子串匹配：只匹配 name + aliases，不匹配 description
    const matched = rows.filter(r => {
      const candidateKeywords: string[] = [r.name]
      if (r.aliases) {
        try {
          const parsed = JSON.parse(r.aliases)
          if (Array.isArray(parsed)) candidateKeywords.push(...parsed)
          else if (typeof parsed === 'string') candidateKeywords.push(parsed)
        } catch {
          // aliases 存的是纯字符串时直接用
          candidateKeywords.push(r.aliases)
        }
      }
      // queryText 中精确包含该实体的任一关键词（≥1字，允许单字别名如"默"）
      return candidateKeywords.some(kw => kw.length >= 1 && queryText.includes(kw))
    })

    const typeLabel: Record<string, string> = {
      character: '角色', artifact: '法宝', technique: '功法',
      location: '地点', item: '道具', faction: '势力',
    }

    const result: string[] = []
    let usedTokens = 0

    for (const entity of matched.slice(0, 15)) {
      const label = typeLabel[entity.entityType] || entity.entityType
      let card = `【${entity.name}】(${label})${entity.aliases ? ` 别名：${entity.aliases}` : ''}\n${entity.description}`

      // 成长态注入：对 is_growable 实体查询最新 state_log
      if (entity.isGrowable) {
        try {
          const latest = await db
            .select({
              currState: entityStateLog.currState,
              stateType: entityStateLog.stateType,
              chapterOrder: entityStateLog.chapterOrder,
            })
            .from(entityStateLog)
            .where(and(
              eq(entityStateLog.novelId, novelId),
              eq(entityStateLog.entityName, entity.name),
            ))
            .orderBy(desc(entityStateLog.chapterOrder))
            .limit(1)
            .get()

          if (latest) {
            card += `\n⚡ 当前状态（第${latest.chapterOrder}章·${latest.stateType}）：${latest.currState}`
          }
        } catch {
          // 查询失败不影响主流程
        }
      }

      const tokens = estimateTokens(card)
      if (usedTokens + tokens > tokenBudget) break
      result.push(card)
      usedTokens += tokens
    }

    return result
  } catch (error) {
    console.error('[contextBuilder] fetchInlineEntities failed:', error)
    return []
  }
}

/**
 * Slot-11：关系网络注入 — 从 characterRelationships 中获取主角的关系网络快照。
 * 返回格式化的关系描述列表。
 */
async function fetchCharacterRelationships(
  db: AppDb,
  novelId: string,
  tokenBudget: number,
): Promise<string[]> {
  try {
    const protagonistRows = await db
      .select({ id: characters.id, name: characters.name })
      .from(characters)
      .where(and(
        eq(characters.novelId, novelId),
        eq(characters.role, 'protagonist'),
        sql`${characters.deletedAt} IS NULL`,
      ))
      .all()

    if (protagonistRows.length === 0) return []

    const protagonistIds = protagonistRows.map(p => p.id)

    const relations = await db
      .select({
        characterIdA: characterRelationships.characterIdA,
        characterNameA: characterRelationships.characterNameA,
        characterIdB: characterRelationships.characterIdB,
        characterNameB: characterRelationships.characterNameB,
        relationType: characterRelationships.relationType,
        relationDesc: characterRelationships.relationDesc,
        lastUpdatedChapterOrder: characterRelationships.lastUpdatedChapterOrder,
      })
      .from(characterRelationships)
      .where(and(
        eq(characterRelationships.novelId, novelId),
        sql`(${characterRelationships.characterIdA} IN (${sql.join(protagonistIds, sql`, `)}) OR ${characterRelationships.characterIdB} IN (${sql.join(protagonistIds, sql`, `)}))`,
        sql`${characterRelationships.deletedAt} IS NULL`,
      ))
      .orderBy(desc(characterRelationships.lastUpdatedChapterOrder))
      .limit(20)
      .all()

    if (relations.length === 0) return []

    const result: string[] = []
    let usedTokens = 0

    const header = '【主角关系网络】'
    result.push(header)
    usedTokens += estimateTokens(header)

    for (const rel of relations.slice(0, 10)) {
      const entry = `${rel.characterNameA} → ${rel.characterNameB}：${rel.relationType}（${rel.relationDesc}）`
      const tokens = estimateTokens(entry)
      if (usedTokens + tokens > tokenBudget) break
      result.push(entry)
      usedTokens += tokens
    }

    return result
  } catch (error) {
    console.error('[contextBuilder] fetchCharacterRelationships failed:', error)
    return []
  }
}

/**
 * 全部活跃规则（v4: 不再限制 priority≤2，256k 窗口放得下）
 */
async function fetchAllActiveRules(db: AppDb, novelId: string): Promise<string[]> {
  try {
    const rows = await db
      .select({ category: writingRules.category, title: writingRules.title, content: writingRules.content, priority: writingRules.priority })
      .from(writingRules)
      .where(and(eq(writingRules.novelId, novelId), eq(writingRules.isActive, 1), sql`${writingRules.deletedAt} IS NULL`))
      .orderBy(writingRules.priority)
      .all()

    const catLabel: Record<string, string> = {
      style: '文风', pacing: '节奏', character: '人物', plot: '情节',
      world: '世界观', taboo: '禁忌', custom: '自定义',
    }
    return rows.map((r: any) => `[${catLabel[r.category] || r.category}] ${r.title}\n${r.content}`)
  } catch (error) {
    console.error('[contextBuilder] fetchAllActiveRules failed:', error)
    return []
  }
}

/**
 * 获取所有活跃规则的ID列表（用于Slot-8去重）
 */
async function fetchAllActiveRuleIds(db: AppDb, novelId: string): Promise<string[]> {
  try {
    const rows = await db
      .select({ id: writingRules.id })
      .from(writingRules)
      .where(and(eq(writingRules.novelId, novelId), eq(writingRules.isActive, 1), sql`${writingRules.deletedAt} IS NULL`))
      .all()
    return rows.map((r: any) => r.id)
  } catch (error) {
    console.error('[contextBuilder] fetchAllActiveRuleIds failed:', error)
    return []
  }
}

async function fetchChapterTypeRules(
  db: AppDb,
  novelId: string,
  chapterTypeHint: string,
  existingRuleIds: string[] = [],
): Promise<string[]> {
  const neededCategories: string[] = []

  if (/战斗|打斗|对决|厮杀|交手/.test(chapterTypeHint)) neededCategories.push('pacing', 'plot')
  if (/情感|感情|人际|相遇/.test(chapterTypeHint)) neededCategories.push('character')
  if (/修炼|突破|感悟|境界/.test(chapterTypeHint)) neededCategories.push('world', 'character')
  if (/文风|叙述|描写/.test(chapterTypeHint)) neededCategories.push('style')

  const categories = [...new Set(neededCategories)]
  if (categories.length === 0) return []

  try {
    const whereConditions = [
      eq(writingRules.novelId, novelId),
      eq(writingRules.isActive, 1),
      inArray(writingRules.category, categories),
      sql`${writingRules.deletedAt} IS NULL`,
    ]
    if (existingRuleIds.length > 0) {
      whereConditions.push(notInArray(writingRules.id, existingRuleIds))
    }

    const rows = await db
      .select({ id: writingRules.id, category: writingRules.category, title: writingRules.title, content: writingRules.content, priority: writingRules.priority })
      .from(writingRules)
      .where(and(...whereConditions))
      .orderBy(writingRules.priority).limit(8).all()

    const catLabel: Record<string, string> = {
      style: '文风', pacing: '节奏', character: '人物', plot: '情节',
      world: '世界观', taboo: '禁忌', custom: '自定义',
    }
    return rows.map((r: any) => `[${catLabel[r.category] || r.category}] ${r.title}\n${r.content}`)
  } catch (error) {
    console.error('[contextBuilder] fetchChapterTypeRules failed:', error)
    return []
  }
}

async function fetchOpenForeshadowingIds(
  db: AppDb, novelId: string, currentSortOrder: number
): Promise<Set<string>> {
  try {
    const rows = await db
      .select({ id: foreshadowing.id, chapterId: foreshadowing.chapterId })
      .from(foreshadowing)
      .where(and(eq(foreshadowing.novelId, novelId), eq(foreshadowing.status, 'open'), sql`${foreshadowing.deletedAt} IS NULL`))
      .all()

    if (rows.length === 0) return new Set()

    const chapterIds = [...new Set(rows.map((r: any) => r.chapterId).filter(Boolean))]
    if (chapterIds.length === 0) return new Set(rows.map((r: any) => r.id))

    const chapterRows = await db
      .select({ id: chapters.id, sortOrder: chapters.sortOrder }).from(chapters)
      .where(and(inArray(chapters.id, chapterIds), sql`${chapters.deletedAt} IS NULL`)).all()

    const sortMap = new Map(chapterRows.map((c: any) => [c.id, c.sortOrder]))
    const openIds = new Set<string>()
    for (const row of rows) {
      const sort = sortMap.get(row.chapterId)
      // B2修复: 使用 == null 判断"值不存在"，避免 sortOrder=0(第一章)被 !sort 误判为falsy
      // 原bug：sort=0时 !sort=true，导致第一章埋下的伏笔在生成第一章时就被注入上下文
      if (sort == null || sort < currentSortOrder) openIds.add(row.id)
    }
    return openIds
  } catch (error) {
    console.error('[contextBuilder] fetchOpenForeshadowingIds failed:', error)
    return new Set()
  }
}

// ============================================================
// 章节类型推断
// ============================================================

function inferChapterType(eventLine: string, chapterTitle: string): string {
  const text = `${eventLine} ${chapterTitle}`
  const hints: string[] = []

  if (/战斗|对决|厮杀|激战|争锋|大战|交手|击败|击杀/.test(text)) hints.push('战斗')
  if (/修炼|突破|感悟|闭关|突破境界|升阶|晋升/.test(text)) hints.push('修炼', '境界')
  if (/宗门|门派|家族|势力|王朝|组织|帮派/.test(text)) hints.push('门派', '势力')
  if (/法宝|功法|秘法|神通|丹药|灵丹|宝物|炼丹/.test(text)) hints.push('法宝')
  if (/进入|来到|抵达|山峰|洞府|城市|大陆|界域/.test(text)) hints.push('地点', '场景')
  if (/情感|相遇|离别|重逢|感情|师徒|师兄/.test(text)) hints.push('情感', '人际')

  return hints.join('，') || '常规叙述'
}

// ============================================================
// 工具函数
// ============================================================

/**
 * 从整卷eventLine中提取当前章节及上下章事件描述
 * 返回对象包含：prevEvent（上章事件）、currentEvent（本章任务）、nextThreeChapters（下3章预告）
 * 支持两种格式：
 * 1. 换行分隔：每行以"第X章"开头（逐行匹配）
 * 2. 连续文本：以"第N章："开头的段落（整段截取）
 */
function extractCurrentChapterEvent(
  eventLine: string,
  chapterIndexInVolume: number,
): { prevEvent: string; currentEvent: string; nextThreeChapters: string } {
  if (!eventLine) return { prevEvent: '', currentEvent: '', nextThreeChapters: '' }

  const trimmed = eventLine.trim()
  if (trimmed.startsWith('[') || trimmed.startsWith('"')) {
    try {
      const parsed = JSON.parse(trimmed)
      const arr: string[] = Array.isArray(parsed)
        ? parsed.map(item => typeof item === 'string' ? item : String(item))
        : (typeof parsed === 'string' ? [parsed] : [])

      if (arr.length > 0) {
        const idx = chapterIndexInVolume - 1

        const currentEvent = idx >= 0 && idx < arr.length
          ? `${arr[idx].trim().slice(0, 200)}  ← 核心，必须完成`
          : ''

        const prevEvent = idx > 0 && arr[idx - 1]
          ? `【上章事件】${arr[idx - 1].trim().slice(0, 200)}`
          : ''

        const nextParts: string[] = []
        for (let i = 1; i <= 3; i++) {
          if (idx + i < arr.length) {
            nextParts.push(arr[idx + i].trim())
          }
        }
        const nextThreeChapters = nextParts.length > 0
          ? nextParts.join('\n') + '  ← 仅供结尾钩子参考，本章不得提前完成'
          : ''

        const finalCurrentEvent = currentEvent || (arr.length > 0
          ? `${arr[arr.length - 1].trim().slice(0, 200)}  ⚠️ 已超出 eventLine 范围，以上一卷末尾事件作参考`
          : ''
        )

        return { prevEvent, currentEvent: finalCurrentEvent, nextThreeChapters }
      }
    } catch {
    }
  }

  const lines = eventLine.split('\n').filter(l => l.trim())

  if (lines.length > 1) {
    const findChapterLine = (chapterNum: number): string | null => {
      const line = lines.find(l =>
        l.match(new RegExp(`第${chapterNum}章|^${chapterNum}[.、：:]`))
      )
      return line ? line.trim().slice(0, 200) : null
    }

    const currentEvent = findChapterLine(chapterIndexInVolume)
    if (currentEvent) {
      const prev = findChapterLine(chapterIndexInVolume - 1)
      const nextEvents: string[] = []
      for (let i = 1; i <= 3; i++) {
        const next = findChapterLine(chapterIndexInVolume + i)
        if (next) nextEvents.push(next)
      }
      return {
        prevEvent: prev ? `【上章事件】${prev}` : '',
        currentEvent: `${currentEvent}  ← 核心，必须完成`,
        nextThreeChapters: nextEvents.length > 0 ? nextEvents.join('\n') + '  ← 仅供结尾钩子参考，本章不得提前完成' : '',
      }
    }
  }

  const currentPattern = new RegExp(`第${chapterIndexInVolume}章[：:\\s]`)
  const nextPattern = new RegExp(`第${chapterIndexInVolume + 1}章[：:\\s]`)
  const prevPattern = new RegExp(`第${chapterIndexInVolume - 1}章[：:\\s]`)
  const afterNextPattern = new RegExp(`第${chapterIndexInVolume + 4}章[：:\\s]`)

  const currentStart = eventLine.search(currentPattern)
  if (currentStart === -1) return { prevEvent: '', currentEvent: eventLine.slice(0, 500), nextThreeChapters: '' }

  const currentEnd = eventLine.search(nextPattern) !== -1 ? eventLine.search(nextPattern) : eventLine.length
  const currentContent = eventLine.slice(currentStart, currentEnd).trim().slice(0, 200)

  const prevMatch = eventLine.match(prevPattern)
  let prevEvent = ''
  if (prevMatch) {
    const prevStart = prevMatch.index!
    const prevContent = eventLine.slice(prevStart, currentStart).trim()
    if (prevContent) prevEvent = `【上章事件】${prevContent.slice(0, 200)}`
  }

  const currentEventFinal = `${currentContent}  ← 核心，必须完成`

  const nextMatch = eventLine.match(nextPattern)
  let nextThreeChapters = ''
  if (nextMatch) {
    const afterNextMatch = eventLine.match(afterNextPattern)
    const nextEnd = afterNextMatch ? afterNextMatch.index! : eventLine.length
    const nextContent = eventLine.slice(nextMatch.index!, nextEnd).trim()
    nextThreeChapters = nextContent.slice(0, 200) + '  ← 仅供结尾钩子参考，本章不得提前完成'
  }

  return { prevEvent, currentEvent: currentEventFinal, nextThreeChapters }
}

export function estimateTokens(text: string): number {
  if (!text) return 0
  const cjk = (text.match(/[\u4e00-\u9fff]/g) || []).length
  const other = text.length - cjk
  return Math.ceil(cjk * 1.3 + other * 0.3)
}

// ============================================================
// assemblePromptContext v4
// ============================================================

export interface AssembleOptions {
  slotFilter?: Array<'masterOutline' | 'volume' | 'prevChapter' | 'currentEvent' | 'nextThreeChapters' | 'protagonist' | 'rules' | 'summaryChain' | 'characters' | 'foreshadowing' | 'worldSettings' | 'chapterTypeRules' | 'rhythmStats' | 'inlineEntities' | 'characterRelationships'>
}

export function assemblePromptContext(bundle: ContextBundle, options?: AssembleOptions): string {
  const { slotFilter } = options || {}
  const sections: string[] = []

  const shouldInclude = (slotName: string): boolean => {
    if (!slotFilter || slotFilter.length === 0) return true
    return slotFilter.includes(slotName as any)
  }

  if (shouldInclude('masterOutline') && bundle.core.masterOutlineContent) sections.push(`## 总纲\n${bundle.core.masterOutlineContent}`)

  if (shouldInclude('volume') && (bundle.core.volumeBlueprint || bundle.core.volumeEventLine || bundle.core.volumeNotes)) {
    const parts = []
    if (bundle.core.volumeBlueprint) parts.push(`【卷蓝图】\n${bundle.core.volumeBlueprint}`)
    if (bundle.core.volumeEventLine) {
      let displayEventLine = bundle.core.volumeEventLine
      try {
        const parsed = JSON.parse(displayEventLine)
        if (Array.isArray(parsed)) {
          displayEventLine = parsed.join('\n')
        }
      } catch {}
      parts.push(`【事件线】\n${displayEventLine}`)
    }
    if (bundle.core.volumeNotes) parts.push(`【卷备注】\n${bundle.core.volumeNotes}`)
    sections.push(`## 当前卷规划\n${parts.join('\n\n')}`)
  }

  if (shouldInclude('rhythmStats') && bundle.core.rhythmStats) {
    const r = bundle.core.rhythmStats
    const volumeProgress = r.volumeTargetWordCount
      ? `（已写 ${r.volumeWordCount} / ${r.volumeTargetWordCount} 字）`
      : `（已写 ${r.volumeWordCount} 字）`
    const novelProgress = r.novelTargetWordCount
      ? `已写 ${r.novelWordCount} / ${r.novelTargetWordCount} 字`
      : `已写 ${r.novelWordCount} 字`

    const rhythmParts: string[] = []
    rhythmParts.push(`- 小说进度：${novelProgress}`)
    rhythmParts.push(`- 本卷进度：第 ${r.currentChapterInVolume} / ${r.volumeTargetChapterCount || r.volumeChapterCount} 章 ${volumeProgress}`)
    if (r.volumeTargetWordCount) {
      const wordPct = Math.round((r.volumeWordCount / r.volumeTargetWordCount) * 100)
      rhythmParts.push(`- 字数进度：${wordPct}%`)
    }
    if (r.volumeTargetChapterCount && r.volumeTargetChapterCount > 0) {
      const chapterPct = Math.round((r.currentChapterInVolume / r.volumeTargetChapterCount) * 100)
      rhythmParts.push(`- 章节进度：${chapterPct}%`)
    }
    rhythmParts.push(`- 注意：保持节奏均衡，避免前期过于拖沓或后期赶工`)

    sections.push(`## 创作节奏把控\n${rhythmParts.join('\n')}`)
  }

  if (shouldInclude('prevChapter') && bundle.core.prevChapterContent) sections.push(`## 上一章正文\n${bundle.core.prevChapterContent}`)

  if (shouldInclude('currentEvent') && bundle.core.currentEvent) sections.push(`## 本章任务\n${bundle.core.currentEvent}`)

  if (shouldInclude('nextThreeChapters') && bundle.core.nextThreeChapters) sections.push(`## 下3章预告\n${bundle.core.nextThreeChapters}`)

  if (shouldInclude('protagonist') && bundle.core.protagonistStateCards.length > 0) sections.push(`## 主角状态\n${bundle.core.protagonistStateCards.join('\n\n')}`)

  if (shouldInclude('rules') && bundle.core.allActiveRules.length > 0) sections.push(`## 创作准则\n${bundle.core.allActiveRules.join('\n\n')}`)

  if (shouldInclude('summaryChain') && bundle.dynamic.summaryChain.length > 0) sections.push(`## 近期剧情摘要\n${bundle.dynamic.summaryChain.join('\n')}`)

  if (shouldInclude('characters') && bundle.dynamic.characterCards.length > 0) sections.push(`## 本章出场角色\n${bundle.dynamic.characterCards.join('\n\n')}`)

  if (shouldInclude('foreshadowing') && bundle.dynamic.relevantForeshadowing.length > 0) sections.push(`## 待回收伏笔\n${bundle.dynamic.relevantForeshadowing.join('\n\n')}`)

  const s = bundle.dynamic.relevantSettings
  if (shouldInclude('worldSettings')) {
    const settingParts: string[] = []
    if (s.worldRules.length > 0) settingParts.push(`【世界法则】\n${s.worldRules.join('\n')}`)
    if (s.powerSystem.length > 0) settingParts.push(`【力量/成长体系】\n${s.powerSystem.join('\n')}`)
    if (s.geography.length > 0) settingParts.push(`【场景地理】\n${s.geography.join('\n')}`)
    if (s.factions.length > 0) settingParts.push(`【相关势力】\n${s.factions.join('\n')}`)
    if (s.artifacts.length > 0) settingParts.push(`【相关法宝】\n${s.artifacts.join('\n')}`)
    if (s.misc.length > 0) settingParts.push(`【其他设定】\n${s.misc.join('\n')}`)
    if (settingParts.length > 0) sections.push(`## 相关世界设定\n${settingParts.join('\n\n')}`)
  }

  if (shouldInclude('chapterTypeRules') && bundle.dynamic.chapterTypeRules.length > 0) sections.push(`## 本章创作指引\n${bundle.dynamic.chapterTypeRules.join('\n\n')}`)

  if (shouldInclude('inlineEntities') && bundle.dynamic.inlineEntities.length > 0) sections.push(`## 关键词匹配的已知实体（内联实体）\n本节包含与本章关键词精确匹配的、前文中已提及但未纳入"出场角色"或"世界设定"的实体信息。请在本章创作中参考，保持一致性。\n\n${bundle.dynamic.inlineEntities.join('\n\n')}`)

  if (shouldInclude('characterRelationships') && bundle.dynamic.characterRelationships.length > 0) sections.push(`## 角色关系网络\n本节展示主角的最新社交关系图谱。请在创作中参考这些关系状态，保持角色互动的一致性。\n\n${bundle.dynamic.characterRelationships.join('\n')}`)

  return sections.join('\n\n---\n\n')
}
