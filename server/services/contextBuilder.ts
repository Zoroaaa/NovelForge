/**
 * @file contextBuilder.ts
 * @description 精准分槽上下文构建器 v3 —— 解决海量设定噪音问题
 *
 * 核心改造：从"单向量全局混查"升级为"分槽独立检索 + 类型过滤"
 *
 * 架构对比：
 * v2: embed(outline) → searchSimilar(novelId, topK=20) → 按budget截断
 *      ↑ 问题：所有设定混在一起竞争，无关设定靠语义相似度混入
 *
 * v3: 每个数据槽独立检索，各槽有独立预算和过滤条件
 *      Slot-0  总纲摘要字段（非全文）             固定注入  ~200 tokens
 *      Slot-1  当前卷 blueprint + eventLine      固定注入  ~600 tokens
 *      Slot-2  主角状态卡 + 境界                 固定注入  ~800 tokens
 *      Slot-3  出场角色卡                        RAG查询   sourceType=character
 *      Slot-4  相关伏笔                          RAG查询   sourceType=foreshadowing
 *      Slot-5  世界设定（按type分组查）           RAG查询   sourceType=setting, filter by type
 *      Slot-6  写作规则（按chapter类型过滤）      DB过滤    category匹配
 *      Slot-7  摘要链                            固定注入  最近N章
 *
 * @version 3.0.0
 */

import { drizzle, type DrizzleD1Database } from 'drizzle-orm/d1'
import {
  chapters, volumes, characters, modelConfigs, foreshadowing,
  novelSettings, masterOutline, writingRules
} from '../db/schema'
import { eq, and, sql, desc, inArray } from 'drizzle-orm'
import type { Env } from '../lib/types'
import { embedText, searchSimilar } from './embedding'

// 数据库实例类型（基于项目schema）
type AppDb = DrizzleD1Database<typeof import('../db/schema')>

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

export interface ContextBundle {
  /** Layer 0: 固定注入 - 核心必带 */
  core: {
    masterOutlineSummary: string      // 总纲摘要（非全文！）
    volumeBlueprint: string           // 当前卷蓝图
    volumeEventLine: string           // 当前卷事件线
    prevChapterSummary: string        // 上一章摘要
    protagonistStateCards: string[]   // 主角状态+境界
    highPriorityRules: string[]       // 最高优先级创作规则（固定类型）
  }
  /** Layer 1: 动态补充 - 分槽检索 */
  dynamic: {
    summaryChain: string[]            // 最近N章摘要链
    characterCards: string[]          // 出场角色卡（RAG）
    relevantForeshadowing: string[]   // 相关伏笔（RAG过滤）
    relevantSettings: SlottedSettings // 设定按类型分槽
    chapterTypeRules: string[]        // 本章类型匹配规则（DB过滤）
  }
  /** 诊断 */
  debug: {
    totalTokenEstimate: number
    slotBreakdown: Record<string, number>
    ragQueriesCount: number
    buildTimeMs: number
    budgetTier: BudgetTier
    chapterTypeHint: string
  }
}

export interface SlottedSettings {
  worldRules: string[]      // 世界规则/法则 (type=world_rule)
  powerSystem: string[]     // 功法境界体系 (type=power_system)
  geography: string[]       // 地理场景 (type=geography) —— 只在本章涉及地点时注入
  factions: string[]        // 门派势力 (type=faction) —— 只在本章涉及势力时注入
  artifacts: string[]       // 法宝道具 (type=artifact) —— 只在本章涉及法宝时注入
  misc: string[]            // 其他设定
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
// 预算配置
// ============================================================

/**
 * 默认预算：总计 ~14000 tokens
 *
 * 设计原则：
 * - core 固定注入，保证不被挤出
 * - settings 是最大噪音来源，预算最紧（1500）
 * - characters 按出场精准注入，预算适中
 */
export const DEFAULT_BUDGET: BudgetTier = {
  core: 4500,         // 总纲摘要+卷蓝图+主角+高优先级规则
  summaryChain: 2000, // 最近章节摘要链
  characters: 2000,   // 出场角色卡
  foreshadowing: 800, // 相关伏笔（严格过滤后数量应该少）
  settings: 1500,     // 世界设定（分槽后每槽200-400）
  rules: 600,         // 本章类型规则
  total: 14000,
}

// ============================================================
// 主函数
// ============================================================

export async function buildChapterContext(
  env: Env,
  novelId: string,
  chapterId: string,
  budget: BudgetTier = DEFAULT_BUDGET,
  options?: {
    summaryChainLength?: number
  }
): Promise<ContextBundle> {
  const startTime = Date.now()
  const db = drizzle(env.DB) as AppDb

  const summaryChainLength = Math.min(
    Math.max(options?.summaryChainLength ?? 5, 0),
    15
  )

  // ── Step 0: 获取当前章节基础信息（后续所有步骤依赖）──
  const currentChapter = await db
    .select({
      novelId: chapters.novelId,
      volumeId: chapters.volumeId,
      sortOrder: chapters.sortOrder,
      title: chapters.title,
    })
    .from(chapters)
    .where(eq(chapters.id, chapterId))
    .get()

  if (!currentChapter) {
    throw new Error(`Chapter not found: ${chapterId}`)
  }

  // ── Step 1: 并发获取固定注入数据 ──
  const [
    outlineSummary,
    volumeInfo,
    prevSummary,
    protagonistData,
    powerLevelInfo,
    topRules,
    recentSummaries,
  ] = await Promise.all([
    fetchMasterOutlineSummary(db, novelId),                          // 总纲摘要字段
    fetchVolumeInfo(db, currentChapter.volumeId),                    // 卷蓝图+事件线
    fetchPrevChapterSummary(db, currentChapter.novelId, currentChapter.sortOrder),
    fetchProtagonistCards(db, novelId),
    fetchProtagonistPowerLevel(db, novelId),
    fetchTopPriorityRules(db, novelId),                              // priority <= 2 的规则
    fetchRecentSummaries(db, novelId, currentChapter.sortOrder, summaryChainLength),
  ])

  const protagonistStateCards = mergeProtagonistAndPower(protagonistData, powerLevelInfo)

  // 章节类型推断（用于后续过滤规则和设定槽）
  const chapterTypeHint = inferChapterType(volumeInfo.eventLine, currentChapter.title)

  // ── Step 2: 组装查询向量 ──
  // 用卷事件线 + 上一章摘要 + 章节标题 作为查询，比单用大纲更精准
  const queryText = [
    volumeInfo.eventLine,
    prevSummary,
    currentChapter.title,
  ].filter(Boolean).join('\n').slice(0, 1000)

  // ── Step 3: 分槽RAG检索（并发执行） ──
  let characterCards: string[] = []
  let relevantForeshadowing: string[] = []
  let slottedSettings: SlottedSettings = {
    worldRules: [], powerSystem: [], geography: [],
    factions: [], artifacts: [], misc: []
  }
  let chapterTypeRules: string[] = []

  if (queryText && env.VECTORIZE) {
    const queryVector = await embedText(env.AI, queryText)

    const [
      characterResults,
      foreshadowingResults,
      settingResults,
    ] = await Promise.all([
      // Slot-3: 只查 character 类型向量
      searchSimilar(env.VECTORIZE, queryVector, {
        topK: 8,
        filter: { novelId, sourceType: 'character' },
      }).catch(() => []),

      // Slot-4: 只查 foreshadowing 类型向量
      searchSimilar(env.VECTORIZE, queryVector, {
        topK: 10,
        filter: { novelId, sourceType: 'foreshadowing' },
      }).catch(() => []),

      // Slot-5: 只查 setting 类型向量
      searchSimilar(env.VECTORIZE, queryVector, {
        topK: 15,
        filter: { novelId, sourceType: 'setting' },
      }).catch(() => []),
    ])

    // 处理角色卡：score > 0.65 才注入
    characterCards = buildCharacterSlot(characterResults, budget.characters)

    // 处理伏笔：score > 0.60，且与未收尾伏笔列表交叉验证
    const openForeshadowingIds = await fetchOpenForeshadowingIds(db, novelId, currentChapter.sortOrder)
    relevantForeshadowing = buildForeshadowingSlot(
      foreshadowingResults, openForeshadowingIds, budget.foreshadowing
    )

    // 处理设定：按 settingType metadata 分槽，各槽独立截断
    slottedSettings = buildSettingsSlot(settingResults, chapterTypeHint, budget.settings)

    // 规则过滤：按章节类型匹配 category
    chapterTypeRules = await fetchChapterTypeRules(db, novelId, chapterTypeHint)
  }

  // ── Step 4: Core Token 预算检查 ──
  const coreContent = [
    outlineSummary,
    volumeInfo.blueprint,
    volumeInfo.eventLine,
    prevSummary,
    ...protagonistStateCards,
    ...topRules,
  ]
  let coreTokensUsed = coreContent.reduce((s, t) => s + estimateTokens(t), 0)

  // core 超预算时截断规则（规则优先级最低）
  const mutableTopRules = [...topRules]
  while (coreTokensUsed > budget.core && mutableTopRules.length > 0) {
    const removed = mutableTopRules.pop()!
    coreTokensUsed -= estimateTokens(removed)
  }

  // ── Step 5: 汇总诊断信息 ──
  const slotBreakdown = {
    masterOutlineSummary: estimateTokens(outlineSummary),
    volumeBlueprint: estimateTokens(volumeInfo.blueprint),
    volumeEventLine: estimateTokens(volumeInfo.eventLine),
    prevChapterSummary: estimateTokens(prevSummary),
    protagonistCards: protagonistStateCards.reduce((s, t) => s + estimateTokens(t), 0),
    topRules: mutableTopRules.reduce((s, t) => s + estimateTokens(t), 0),
    summaryChain: recentSummaries.reduce((s, t) => s + estimateTokens(t), 0),
    characterCards: characterCards.reduce((s, t) => s + estimateTokens(t), 0),
    foreshadowing: relevantForeshadowing.reduce((s, t) => s + estimateTokens(t), 0),
    settings: [
      ...slottedSettings.worldRules,
      ...slottedSettings.powerSystem,
      ...slottedSettings.geography,
      ...slottedSettings.factions,
      ...slottedSettings.artifacts,
      ...slottedSettings.misc,
    ].reduce((s, t) => s + estimateTokens(t), 0),
    chapterTypeRules: chapterTypeRules.reduce((s, t) => s + estimateTokens(t), 0),
  }
  const totalTokenEstimate = Object.values(slotBreakdown).reduce((a, b) => a + b, 0)

  return {
    core: {
      masterOutlineSummary: outlineSummary,
      volumeBlueprint: volumeInfo.blueprint,
      volumeEventLine: volumeInfo.eventLine,
      prevChapterSummary: prevSummary,
      protagonistStateCards,
      highPriorityRules: mutableTopRules,
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
      ragQueriesCount: queryText && env.VECTORIZE ? 3 : 0,
      buildTimeMs: Date.now() - startTime,
      budgetTier: budget,
      chapterTypeHint,
    },
  }
}

// ============================================================
// 分槽处理函数
// ============================================================

/**
 * Slot-3: 角色卡槽
 * 规则：score > 0.65 才入槽，防止语义相近但无关的角色混入
 */
function buildCharacterSlot(
  results: Array<{ score: number; metadata: any }>,
  budgetTokens: number
): string[] {
  const SCORE_THRESHOLD = 0.65
  let used = 0
  const cards: string[] = []

  for (const r of results) {
    if (r.score < SCORE_THRESHOLD) continue
    const content = r.metadata.content || ''
    const tokens = estimateTokens(content)
    if (used + tokens > budgetTokens) break
    used += tokens
    cards.push(content)
  }
  return cards
}

/**
 * Slot-4: 伏笔槽
 * 规则：
 * 1. 必须在 openForeshadowingIds 中（未收尾）
 * 2. 向量相似度 > 0.60
 * 3. importance=high 的伏笔强制注入（不受score限制，但受budget限制）
 */
function buildForeshadowingSlot(
  results: Array<{ score: number; metadata: any }>,
  openIds: Set<string>,
  budgetTokens: number
): string[] {
  const SCORE_THRESHOLD = 0.60
  let used = 0
  const items: string[] = []

  // 先注入高重要性命中
  for (const r of results) {
    const isOpen = openIds.has(r.metadata.sourceId)
    const isHigh = r.metadata.importance === 'high'
    if (!isOpen) continue
    if (!isHigh && r.score < SCORE_THRESHOLD) continue

    const content = r.metadata.content || ''
    const tokens = estimateTokens(content)
    if (used + tokens > budgetTokens) break
    used += tokens
    items.push(content)
  }
  return items
}

/**
 * Slot-5: 世界设定分槽
 *
 * 关键设计：
 * - worldRules / powerSystem：全局相关，score > 0.55 即注入（这类设定和任何章节都有一定相关性）
 * - geography / factions / artifacts：只在 chapterTypeHint 命中对应关键词时才有配额
 *   否则预算缩减到0，防止无关地理、门派信息占用上下文
 *
 * 各槽最大 tokens（在总budget=1500内分配）:
 *   worldRules:  400
 *   powerSystem: 400
 *   geography:   chapterTypeHint含地点 ? 250 : 0
 *   factions:    chapterTypeHint含势力 ? 200 : 0
 *   artifacts:   chapterTypeHint含法宝 ? 150 : 0
 *   misc:        剩余空间，max 100
 */
function buildSettingsSlot(
  results: Array<{ score: number; metadata: any }>,
  chapterTypeHint: string,
  totalBudget: number
): SlottedSettings {
  const hasLocation = /地点|场景|地图|城市|宗门|山|洞|界|域/.test(chapterTypeHint)
  const hasFaction  = /门派|势力|宗门|家族|王朝|组织/.test(chapterTypeHint)
  const hasArtifact = /法宝|功法|秘法|神通|道具|丹药|宝物/.test(chapterTypeHint)

  const slotBudgets: Record<keyof SlottedSettings, number> = {
    worldRules:  Math.min(400, totalBudget * 0.27),
    powerSystem: Math.min(400, totalBudget * 0.27),
    geography:   hasLocation ? Math.min(250, totalBudget * 0.17) : 0,
    factions:    hasFaction  ? Math.min(200, totalBudget * 0.13) : 0,
    artifacts:   hasArtifact ? Math.min(150, totalBudget * 0.10) : 0,
    misc:        100,
  }

  const typeMapping: Record<string, keyof SlottedSettings> = {
    world_rule:   'worldRules',
    rule:         'worldRules',
    power_system: 'powerSystem',
    cultivation:  'powerSystem',
    geography:    'geography',
    location:     'geography',
    faction:      'factions',
    organization: 'factions',
    artifact:     'artifacts',
    item:         'artifacts',
  }

  const SCORE_THRESHOLDS: Record<keyof SlottedSettings, number> = {
    worldRules:  0.55,  // 世界规则普遍相关，阈值低
    powerSystem: 0.55,  // 境界体系普遍相关，阈值低
    geography:   0.70,  // 地理只在强相关时注入
    factions:    0.68,
    artifacts:   0.68,
    misc:        0.72,
  }

  const slotUsed: Record<keyof SlottedSettings, number> = {
    worldRules: 0, powerSystem: 0, geography: 0,
    factions: 0, artifacts: 0, misc: 0
  }
  const output: SlottedSettings = {
    worldRules: [], powerSystem: [], geography: [],
    factions: [], artifacts: [], misc: []
  }

  for (const r of results) {
    const rawType = (r.metadata.settingType || r.metadata.type || 'misc') as string
    const slotKey = typeMapping[rawType] ?? 'misc'
    const budget = slotBudgets[slotKey]
    const threshold = SCORE_THRESHOLDS[slotKey]

    if (budget === 0) continue  // 本章无需此类设定
    if (r.score < threshold) continue

    const content = r.metadata.content || ''
    const tokens = estimateTokens(content)
    if (slotUsed[slotKey] + tokens > budget) continue  // 各槽独立截断

    slotUsed[slotKey] += tokens
    output[slotKey].push(content)
  }

  return output
}

// ============================================================
// DB查询函数
// ============================================================

/**
 * 关键改造：只取 masterOutline.summary 字段，不取全文
 * 总纲全文可能数万字，summary 是 LLM 生成的精炼摘要
 */
async function fetchMasterOutlineSummary(db: AppDb, novelId: string): Promise<string> {
  try {
    const row = await db
      .select({ summary: masterOutline.summary, title: masterOutline.title })
      .from(masterOutline)
      .where(and(eq(masterOutline.novelId, novelId), sql`${masterOutline.deletedAt} IS NULL`))
      .orderBy(desc(masterOutline.version))
      .limit(1)
      .get()

    if (!row) return ''
    // 如果没有summary，取content前500字作为摘要
    return row.summary || ''
  } catch (error) {
    console.error('[contextBuilder] fetchMasterOutlineSummary failed:', error)
    return ''
  }
}

/**
 * 卷信息：只取 blueprint + eventLine，不取 summary（summary可能冗余）
 */
async function fetchVolumeInfo(db: AppDb, volumeId: string | null): Promise<{
  blueprint: string
  eventLine: string
}> {
  if (!volumeId) return { blueprint: '', eventLine: '' }
  try {
    const row = await db
      .select({ blueprint: volumes.blueprint, eventLine: volumes.eventLine })
      .from(volumes)
      .where(eq(volumes.id, volumeId))
      .get()
    return {
      blueprint: row?.blueprint || '',
      eventLine: row?.eventLine || '',
    }
  } catch (error) {
    console.error('[contextBuilder] fetchVolumeInfo failed:', error)
    return { blueprint: '', eventLine: '' }
  }
}

async function fetchPrevChapterSummary(
  db: AppDb, novelId: string, currentSortOrder: number
): Promise<string> {
  try {
    const row = await db
      .select({ summary: chapters.summary, title: chapters.title, sortOrder: chapters.sortOrder })
      .from(chapters)
      .where(and(
        eq(chapters.novelId, novelId),
        sql`${chapters.sortOrder} < ${currentSortOrder}`,
      ))
      .orderBy(desc(chapters.sortOrder))
      .limit(1)
      .get()
    if (!row?.summary) return ''
    return `[上一章: ${row.title}] ${row.summary}`
  } catch (error) {
    console.error('[contextBuilder] fetchPrevChapterSummary failed:', error)
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
        sql`${chapters.summary} IS NOT NULL AND ${chapters.summary} != ''`
      ))
      .orderBy(desc(chapters.sortOrder))
      .limit(chainLength)
      .all()

    return rows.reverse().map((r: any) => `[第${r.sortOrder}章 ${r.title}] ${r.summary}`)
  } catch (error) {
    console.error('[contextBuilder] fetchRecentSummaries failed:', error)
    return []
  }
}

async function fetchProtagonistCards(db: AppDb, novelId: string): Promise<Array<{
  name: string; description: string | null; role: string | null; attributes: string | null
}>> {
  try {
    return await db
      .select({ name: characters.name, description: characters.description, role: characters.role, attributes: characters.attributes })
      .from(characters)
      .where(and(
        eq(characters.novelId, novelId),
        eq(characters.role, 'protagonist'),
        sql`${characters.deletedAt} IS NULL`
      ))
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
      .where(and(
        eq(characters.novelId, novelId),
        eq(characters.role, 'protagonist'),
        sql`${characters.deletedAt} IS NULL`,
        sql`${characters.powerLevel} IS NOT NULL`
      ))
      .all()

    for (const row of rows) {
      if (!row.powerLevel) continue
      try {
        const p = JSON.parse(row.powerLevel)
        const parts: string[] = []
        if (p.current) parts.push(`当前境界：${p.current}`)
        if (p.nextMilestone) parts.push(`下一目标：${p.nextMilestone}`)
        map.set(row.name, parts.join('，'))
      } catch (parseError) {
        console.error('[contextBuilder] parse powerLevel failed:', parseError)
      }
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
        const attrStr = Object.entries(attrs).map(([k, v]) => `${k}: ${v}`).join(' | ')
        card += `\n属性：${attrStr}`
      } catch (parseError) {
        console.error('[contextBuilder] parse attributes failed:', parseError)
      }
    }
    return card.trim()
  })
}

/**
 * 只取最高优先级规则（priority <= 2 的"全局禁忌"类规则）
 * 其余规则由 fetchChapterTypeRules 按章节类型按需注入
 */
async function fetchTopPriorityRules(db: AppDb, novelId: string): Promise<string[]> {
  try {
    const rows = await db
      .select({ category: writingRules.category, title: writingRules.title, content: writingRules.content })
      .from(writingRules)
      .where(and(
        eq(writingRules.novelId, novelId),
        eq(writingRules.isActive, 1),
        sql`${writingRules.priority} <= 2`,
        sql`${writingRules.deletedAt} IS NULL`
      ))
      .orderBy(writingRules.priority)
      .limit(5)
      .all()

    const catLabel: Record<string, string> = {
      style: '文风', pacing: '节奏', character: '人物', plot: '情节',
      world: '世界观', taboo: '禁忌', custom: '自定义'
    }
    return rows.map((r: any) => `[${catLabel[r.category] || r.category}·核心] ${r.title}\n${r.content}`)
  } catch (error) {
    console.error('[contextBuilder] fetchTopPriorityRules failed:', error)
    return []
  }
}

/**
 * 按章节类型匹配规则分类
 * chapterTypeHint 包含关键词 → 注入对应 category 的规则
 */
async function fetchChapterTypeRules(db: AppDb, novelId: string, chapterTypeHint: string): Promise<string[]> {
  const neededCategories: string[] = []

  if (/战斗|打斗|对决|厮杀|交手/.test(chapterTypeHint)) neededCategories.push('pacing', 'plot')
  if (/情感|感情|人际|相遇/.test(chapterTypeHint)) neededCategories.push('character')
  if (/修炼|突破|感悟|境界/.test(chapterTypeHint)) neededCategories.push('world', 'character')
  if (/文风|叙述|描写/.test(chapterTypeHint)) neededCategories.push('style')

  // 去重
  const categories = [...new Set(neededCategories)]
  if (categories.length === 0) return []

  try {
    const rows = await db
      .select({ category: writingRules.category, title: writingRules.title, content: writingRules.content, priority: writingRules.priority })
      .from(writingRules)
      .where(and(
        eq(writingRules.novelId, novelId),
        eq(writingRules.isActive, 1),
        sql`${writingRules.priority} > 2`,  // 高优先级规则已在 core 层注入，不重复
        inArray(writingRules.category, categories),
        sql`${writingRules.deletedAt} IS NULL`
      ))
      .orderBy(writingRules.priority)
      .limit(6)
      .all()

    const catLabel: Record<string, string> = {
      style: '文风', pacing: '节奏', character: '人物', plot: '情节',
      world: '世界观', taboo: '禁忌', custom: '自定义'
    }
    return rows.map((r: any) => `[${catLabel[r.category] || r.category}] ${r.title}\n${r.content}`)
  } catch (error) {
    console.error('[contextBuilder] fetchChapterTypeRules failed:', error)
    return []
  }
}

/**
 * 获取未收尾伏笔的 ID 集合（用于 foreshadowing 槽的二次过滤）
 */
async function fetchOpenForeshadowingIds(
  db: AppDb, novelId: string, currentSortOrder: number
): Promise<Set<string>> {
  try {
    const rows = await db
      .select({ id: foreshadowing.id, chapterId: foreshadowing.chapterId })
      .from(foreshadowing)
      .where(and(
        eq(foreshadowing.novelId, novelId),
        eq(foreshadowing.status, 'open'),
        sql`${foreshadowing.deletedAt} IS NULL`
      ))
      .all()

    // 进一步过滤：只保留在当前章节之前埋入的伏笔
    if (rows.length === 0) return new Set()

    const chapterIds = [...new Set(rows.map((r: any) => r.chapterId).filter(Boolean))]
    if (chapterIds.length === 0) return new Set(rows.map((r: any) => r.id))

    const chapterRows = await db
      .select({ id: chapters.id, sortOrder: chapters.sortOrder })
      .from(chapters)
      .where(inArray(chapters.id, chapterIds))
      .all()

    const sortMap = new Map(chapterRows.map((c: any) => [c.id, c.sortOrder]))

    const openIds = new Set<string>()
    for (const row of rows) {
      const sort = sortMap.get(row.chapterId)
      if (!sort || sort < currentSortOrder) {
        openIds.add(row.id)
      }
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

/**
 * 从卷事件线和章节标题推断本章类型关键词
 * 用于过滤规则 + 动态开关设定槽
 */
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

export function estimateTokens(text: string): number {
  if (!text) return 0
  const cjk = (text.match(/[\u4e00-\u9fff]/g) || []).length
  const other = text.length - cjk
  return Math.ceil(cjk * 1.3 + other * 0.3)
}

// ============================================================
// assemblePromptContext: 将 ContextBundle 组装为 prompt 字符串
// 供 agent.ts 调用，替代原有的手动拼接
// ============================================================

export function assemblePromptContext(bundle: ContextBundle): string {
  const sections: string[] = []

  // ── Core 层 ──
  if (bundle.core.masterOutlineSummary) {
    sections.push(`## 总纲摘要\n${bundle.core.masterOutlineSummary}`)
  }

  if (bundle.core.volumeBlueprint || bundle.core.volumeEventLine) {
    const parts = []
    if (bundle.core.volumeBlueprint) parts.push(`【卷蓝图】\n${bundle.core.volumeBlueprint}`)
    if (bundle.core.volumeEventLine) parts.push(`【事件线】\n${bundle.core.volumeEventLine}`)
    sections.push(`## 当前卷规划\n${parts.join('\n\n')}`)
  }

  if (bundle.core.prevChapterSummary) {
    sections.push(`## 上一章回顾\n${bundle.core.prevChapterSummary}`)
  }

  if (bundle.core.protagonistStateCards.length > 0) {
    sections.push(`## 主角状态\n${bundle.core.protagonistStateCards.join('\n\n')}`)
  }

  if (bundle.core.highPriorityRules.length > 0) {
    sections.push(`## 核心创作准则（必须遵守）\n${bundle.core.highPriorityRules.join('\n\n')}`)
  }

  // ── Dynamic 层 ──
  if (bundle.dynamic.summaryChain.length > 0) {
    sections.push(`## 近期剧情摘要\n${bundle.dynamic.summaryChain.join('\n')}`)
  }

  if (bundle.dynamic.characterCards.length > 0) {
    sections.push(`## 本章出场角色\n${bundle.dynamic.characterCards.join('\n\n')}`)
  }

  if (bundle.dynamic.relevantForeshadowing.length > 0) {
    sections.push(`## 待回收伏笔（相关）\n${bundle.dynamic.relevantForeshadowing.join('\n\n')}`)
  }

  // 设定：只输出有内容的槽
  const s = bundle.dynamic.relevantSettings
  const settingParts: string[] = []
  if (s.worldRules.length > 0) settingParts.push(`【世界法则】\n${s.worldRules.join('\n')}`)
  if (s.powerSystem.length > 0) settingParts.push(`【境界体系】\n${s.powerSystem.join('\n')}`)
  if (s.geography.length > 0) settingParts.push(`【场景地理】\n${s.geography.join('\n')}`)
  if (s.factions.length > 0) settingParts.push(`【相关势力】\n${s.factions.join('\n')}`)
  if (s.artifacts.length > 0) settingParts.push(`【相关法宝】\n${s.artifacts.join('\n')}`)
  if (s.misc.length > 0) settingParts.push(`【其他设定】\n${s.misc.join('\n')}`)
  if (settingParts.length > 0) {
    sections.push(`## 相关世界设定\n${settingParts.join('\n\n')}`)
  }

  if (bundle.dynamic.chapterTypeRules.length > 0) {
    sections.push(`## 本章创作指引\n${bundle.dynamic.chapterTypeRules.join('\n\n')}`)
  }

  return sections.join('\n\n---\n\n')
}
