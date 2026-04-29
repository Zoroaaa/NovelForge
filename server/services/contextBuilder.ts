/**
 * @file contextBuilder.ts
 * @description 精准分槽上下文构建器 v4 —— DB为主+向量为辅
 *
 * 核心改造（从 v3 升级）:
 * - 向量只负责"语义检索找相关ID"，不负责存储完整内容
 * - 角色槽：RAG 返回 sourceId → DB 批量 IN 查完整卡片（name+role+desc+attr+powerLevel）
 * - 设定槽：RAG 返回 summary 字段（novelSettings.summary），不再存全文切块
 * - 伏笔槽：高重要性 DB 直查兜底 + 普通 RAG 过滤（双路合并）
 * - 总纲槽：优先取 content 全文（上限12k字），fallback 到 summary
 * - 规则槽：全部活跃规则（不再限制 priority≤2）
 * - 摘要链：默认 20 章（从 5 章扩展）
 * - 预算：~55k tokens（充分利用 256k 窗口，安全范围 40-50k）
 *
 * Slot-0  总纲全文/长摘要                    DB直查    ~10000 tokens
 * Slot-1  当前卷 blueprint + eventLine        DB直查    ~1500 tokens
 * Slot-2  上一章正文                          DB直查    ~5000 tokens
 * Slot-3  主角完整状态卡                      DB直查    ~3000 tokens
 * Slot-4  全部活跃创作规则                     DB直查    ~5000 tokens
 * Slot-5  出场角色卡（RAG引导→DB补全）         RAG+DB   ~8000 tokens
 * Slot-6  世界设定（RAG查summary）              RAG      ~12000 tokens
 * Slot-7  待回收伏笔（高优DB兜底+普通RAG）     混合     ~4000 tokens
 * Slot-8  本章类型匹配规则                    DB过滤   ~3000 tokens
 * Slot-9  近期剧情摘要链(20章)                 DB直查   ~10000 tokens
 *
 * @version 4.0.0
 */

import { drizzle, type DrizzleD1Database } from 'drizzle-orm/d1'
import {
  chapters, volumes, characters, modelConfigs, foreshadowing,
  novelSettings, masterOutline, writingRules, novels
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
  }
  debug: {
    totalTokenEstimate: number
    slotBreakdown: Record<string, number>
    ragQueriesCount: number
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
  total: number
}

// ============================================================
// 预算配置 v4 — 充分利用 256k 窗口
// ============================================================

export const DEFAULT_BUDGET: BudgetTier = {
  core: 40000,
  summaryChain: 25000,
  characters: 20000,
  foreshadowing: 10000,
  settings: 25000,
  rules: 8000,
  total: 128000,
}

// ============================================================
// 主函数
// ============================================================

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
    protagonistData,
    powerLevelInfo,
    allActiveRules,
    recentSummaries,
    rhythmStats,
    firstChapterInVolume,
  ] = await Promise.all([
    fetchMasterOutlineContent(db, novelId),
    fetchVolumeInfo(db, currentChapter.volumeId),
    fetchPrevChapterContent(db, currentChapter.novelId, currentChapter.sortOrder),
    fetchProtagonistCards(db, novelId),
    fetchProtagonistPowerLevel(db, novelId),
    fetchAllActiveRules(db, novelId),
    fetchRecentSummaries(db, currentChapter.novelId, currentChapter.sortOrder, summaryChainLength),
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

  const protagonistStateCards = mergeProtagonistAndPower(protagonistData, powerLevelInfo)
  const chapterTypeHint = inferChapterType(volumeInfo.eventLine, currentChapter.title)

  // ── Step 2: 组装查询向量（聚焦当前章节语义，≤800字） ──
  const { prevEvent, currentEvent, nextThreeChapters } = extractCurrentChapterEvent(volumeInfo.eventLine, chapterIndexInVolume)
  const queryTextParts = [currentChapter.title, prevEvent, currentEvent, nextThreeChapters]

  if (!currentEvent && recentSummaries.length > 0) {
    const lastSummary = recentSummaries[recentSummaries.length - 1]
    queryTextParts.push(lastSummary.slice(-300))
  }

  const queryText = queryTextParts.filter(Boolean).join('\n').slice(0, 800)

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
    const protagonistIds = protagonistData.map(p => p.id)
    characterCards = await buildCharacterSlotFromDB(db, characterResults, budget.characters, protagonistIds)

    // D3: 伏笔 — 高重要性 DB 兜底 + 普通 RAG
    const openForeshadowingIds = await fetchOpenForeshadowingIds(db, novelId, currentChapter.sortOrder)
    relevantForeshadowing = await buildForeshadowingHybrid(
      db, foreshadowingResults, openForeshadowingIds, novelId, budget.foreshadowing
    )

    // D2: 设定 — RAG 返回 summary，按 type 分槽；high importance 追加 DB 全文
    slottedSettings = await buildSettingsSlotV2(
      db, settingResults, chapterTypeHint, budget.settings
    )

    // D4: 本章类型规则（排除Slot-4已注入的全部活跃规则）
    const activeRuleIds = allActiveRules.length > 0 ? await fetchAllActiveRuleIds(db, novelId) : []
    chapterTypeRules = await fetchChapterTypeRules(db, novelId, chapterTypeHint, activeRuleIds)
  }

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
    },
    debug: {
      totalTokenEstimate,
      slotBreakdown,
      ragQueriesCount: queryText && env.VECTORIZE ? actualRagQueriesCount : 0,
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
  const SCORE_THRESHOLD = 0.45
  const MAX_CHARACTERS = 6

  const candidates = ragResults
    .filter(r => r.score >= SCORE_THRESHOLD)
    .filter(r => !protagonistIds.includes(r.metadata.sourceId))
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_CHARACTERS)
    .map(r => r.metadata.sourceId)

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
  budgetTokens: number
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

  const allItems = [
    ...highPriority.map(h => ({
      text: `【${h.title}】(高重要性)\n${h.description}`,
      priority: 0,
    })),
    ...normalItems.map(n => ({
      text: n.metadata.content || '',
      priority: 1,
      score: n.score,
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

    // 使用 summary 而非 content
    const content = r.metadata.content || ''

    const tokens = estimateTokens(content)
    if (slotUsed[slotKey] + tokens > sbudget) continue

    slotUsed[slotKey] += tokens
    slotCount[slotKey]++
    const insertIndex = output[slotKey].length
    output[slotKey].push(content)

    // 记录 high importance 设定用于后续 DB 全文补充
    if (r.metadata.importance === 'high' && r.score >= 0.38 && r.metadata.sourceId) {
      highImportanceIds.push(r.metadata.sourceId)
      sourceIdSlotMap[r.metadata.sourceId] = { slotKey, index: insertIndex }
    }
  }

  // 对 high importance 设定，追加 DB 全文到对应槽（插入到对应 summary 之后）
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
        const tokens = estimateTokens(fullText)
        if (slotUsed[slotKey] + tokens <= slotBudgets[slotKey] * 1.5) {
          slotUsed[slotKey] += tokens
          const mapping = sourceIdSlotMap[fr.id]
          if (mapping && mapping.slotKey === slotKey) {
            output[slotKey].splice(mapping.index + 1, 0, fullText)
          } else {
            output[slotKey].push(fullText)
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
  db: AppDb, novelId: string, currentSortOrder: number, chainLength: number
): Promise<string[]> {
  if (chainLength <= 0) return []
  try {
    const rows = await db
      .select({ title: chapters.title, summary: chapters.summary, sortOrder: chapters.sortOrder })
      .from(chapters)
      .where(and(
        eq(chapters.novelId, novelId),
        sql`${chapters.sortOrder} < ${currentSortOrder}`,
        sql`${chapters.summary} IS NOT NULL AND ${chapters.summary} != ''`,
        sql`${chapters.deletedAt} IS NULL`
      ))
      .orderBy(desc(chapters.sortOrder)).limit(chainLength).all()

    return rows.reverse().map((r: any) => `[第${r.sortOrder}章 ${r.title}] ${r.summary}`)
  } catch (error) {
    console.error('[contextBuilder] fetchRecentSummaries failed:', error)
    return []
  }
}

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

async function fetchProtagonistPowerLevel(db: AppDb, novelId: string): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  try {
    const rows = await db
      .select({ name: characters.name, powerLevel: characters.powerLevel })
      .from(characters)
      .where(and(eq(characters.novelId, novelId), eq(characters.role, 'protagonist'), sql`${characters.deletedAt} IS NULL`, sql`${characters.powerLevel} IS NOT NULL`))
      .all()

    for (const row of rows) {
      if (!row.powerLevel) continue
      try {
        const p = JSON.parse(row.powerLevel)
        const parts: string[] = []
        if (p.current) parts.push(`当前境界：${p.current}`)
        if (p.nextMilestone) parts.push(`下一目标：${p.nextMilestone}`)
        map.set(row.name, parts.join('，'))
      } catch {}
    }
  } catch (error) {
    console.error('[contextBuilder] fetchProtagonistPowerLevel failed:', error)
  }
  return map
}

function mergeProtagonistAndPower(
  cards: Array<{ name: string; description: string | null; role: string | null; attributes: string | null }>,
  powerMap: Map<string, string>
): string[] {
  return cards.map(c => {
    let card = `【${c.name}（主角）】\n${c.description || ''}`
    const power = powerMap.get(c.name)
    if (power) card += `\n${power}`
    if (c.attributes) {
      try {
        const attrs = JSON.parse(c.attributes)
        card += `\n属性：${Object.entries(attrs).map(([k, v]) => `${k}: ${v}`).join(' | ')}`
      } catch {}
    }
    return card.trim()
  })
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
  currentSortOrder: number,
): { prevEvent: string; currentEvent: string; nextThreeChapters: string } {
  if (!eventLine) return { prevEvent: '', currentEvent: '', nextThreeChapters: '' }

  const lines = eventLine.split('\n').filter(l => l.trim())

  if (lines.length > 1) {
    const findChapterLine = (chapterNum: number): string | null => {
      const line = lines.find(l =>
        l.match(new RegExp(`第${chapterNum}章|^${chapterNum}[.、：:]`))
      )
      return line ? line.trim().slice(0, 200) : null
    }

    const currentEvent = findChapterLine(currentSortOrder)
    if (currentEvent) {
      const prev = findChapterLine(currentSortOrder - 1)
      const nextEvents: string[] = []
      for (let i = 1; i <= 3; i++) {
        const next = findChapterLine(currentSortOrder + i)
        if (next) nextEvents.push(next)
      }
      return {
        prevEvent: prev ? `【上章事件】${prev}` : '',
        currentEvent: `${currentEvent}  ← 核心，必须完成`,
        nextThreeChapters: nextEvents.length > 0 ? nextEvents.join('\n') + '  ← 仅供结尾钩子参考，本章不得提前完成' : '',
      }
    }
  }

  const currentPattern = new RegExp(`第${currentSortOrder}章[：:\\s]`)
  const nextPattern = new RegExp(`第${currentSortOrder + 1}章[：:\\s]`)
  const prevPattern = new RegExp(`第${currentSortOrder - 1}章[：:\\s]`)
  const afterNextPattern = new RegExp(`第${currentSortOrder + 4}章[：:\\s]`)

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

  const currentEvent = `${currentContent}  ← 核心，必须完成`

  const nextMatch = eventLine.match(nextPattern)
  let nextThreeChapters = ''
  if (nextMatch) {
    const afterNextMatch = eventLine.match(afterNextPattern)
    const nextEnd = afterNextMatch ? afterNextMatch.index! : eventLine.length
    const nextContent = eventLine.slice(nextMatch.index!, nextEnd).trim()
    nextThreeChapters = nextContent.slice(0, 200) + '  ← 仅供结尾钩子参考，本章不得提前完成'
  }

  return { prevEvent, currentEvent, nextThreeChapters }
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
  slotFilter?: Array<'masterOutline' | 'volume' | 'prevChapter' | 'currentEvent' | 'nextThreeChapters' | 'protagonist' | 'rules' | 'summaryChain' | 'characters' | 'foreshadowing' | 'worldSettings' | 'chapterTypeRules' | 'rhythmStats'>
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
    if (bundle.core.volumeEventLine) parts.push(`【事件线】\n${bundle.core.volumeEventLine}`)
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
    if (s.powerSystem.length > 0) settingParts.push(`【境界体系】\n${s.powerSystem.join('\n')}`)
    if (s.geography.length > 0) settingParts.push(`【场景地理】\n${s.geography.join('\n')}`)
    if (s.factions.length > 0) settingParts.push(`【相关势力】\n${s.factions.join('\n')}`)
    if (s.artifacts.length > 0) settingParts.push(`【相关法宝】\n${s.artifacts.join('\n')}`)
    if (s.misc.length > 0) settingParts.push(`【其他设定】\n${s.misc.join('\n')}`)
    if (settingParts.length > 0) sections.push(`## 相关世界设定\n${settingParts.join('\n\n')}`)
  }

  if (shouldInclude('chapterTypeRules') && bundle.dynamic.chapterTypeRules.length > 0) sections.push(`## 本章创作指引\n${bundle.dynamic.chapterTypeRules.join('\n\n')}`)

  return sections.join('\n\n---\n\n')
}
