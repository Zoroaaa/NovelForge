/**
 * NovelForge · Agent 上下文组装器（v2.0 重构版）
 *
 * 章节生成时，决定注入哪些内容作为 LLM 上下文。
 * 策略：强制注入（小体积高相关）+ RAG 检索（语义相关设定/大纲片段）
 */

import { drizzle } from 'drizzle-orm/d1'
import { chapters, volumes, characters, modelConfigs, foreshadowing, novelSettings, masterOutline } from '../db/schema'
import { eq, and, sql, desc } from 'drizzle-orm'
import type { Env } from '../lib/types'
import { embedText, searchSimilar } from './embedding'

export interface ContextBundle {
  /** 强制注入部分（每次必带）*/
  mandatory: {
    chapterOutline: string
    prevChapterSummary: string
    recentChainSummaries: string[]
    volumeSummary: string
    protagonistCards: string[]
    openForeshadowing?: string[]  // Phase 1.2: 未收尾伏笔列表
    powerLevelInfo?: string       // Phase 1.3: 主角境界信息
  }
  /** RAG 检索部分（语义最相关的设定/大纲片段，按分数截断）*/
  ragChunks: Array<{
    sourceType: 'setting' | 'character' | 'chapter_summary' | 'master_outline'
    title: string
    content: string
    score: number
  }>
  /** 诊断信息（前端 ContextPreview 组件展示用）*/
  debug: {
    totalTokenEstimate: number
    ragHitsCount: number
    skippedByBudget: number
    buildTimeMs: number
    summaryChainLength: number  // Phase 1.1: 实际使用的摘要链长度
  }
}

/**
 * Token 预算分配（可在 model_configs.params 中覆盖）
 */
export const DEFAULT_BUDGET = {
  total: 12000,
  mandatory: 6000,
  rag: 4000,
  systemPrompt: 2000,
}

export async function buildChapterContext(
  env: Env,
  novelId: string,
  chapterId: string,
  budget = DEFAULT_BUDGET,
  options?: {
    summaryChainLength?: number  // Phase 1.1: 摘要链长度（默认5，最大15）
  }
): Promise<ContextBundle> {
  const startTime = Date.now()
  const db = drizzle(env.DB)

  // Phase 1.1: 获取可配置的摘要链长度
  let summaryChainLength = options?.summaryChainLength || 5
  summaryChainLength = Math.min(Math.max(summaryChainLength, 0), 15) // 限制范围 0-15

  try {
    const configResult = await db
      .select({ params: modelConfigs.params })
      .from(modelConfigs)
      .where(
        and(
          eq(modelConfigs.novelId, novelId),
          eq(modelConfigs.stage, 'chapter_gen'),
          eq(modelConfigs.isActive, 1)
        )
      )
      .limit(1)
      .get()

    if (configResult?.params) {
      const params = JSON.parse(configResult.params)
      if (params.summaryChainLength && typeof params.summaryChainLength === 'number') {
        summaryChainLength = Math.min(Math.max(params.summaryChainLength, 0), 15)
      }
    }
  } catch (error) {
    console.warn('Failed to read summaryChainLength config, using default:', error)
  }

  // 1. 并发拉取强制注入内容（走 D1，精准 ID 查询）
  const [chapterOutline, prevSummary, recentChainSummaries, volumeSummary, protagonists, openForeshadowing, powerLevelInfo] =
    await Promise.all([
      fetchChapterOutline(db, chapterId),
      fetchPrevChapterSummary(db, chapterId),
      fetchRecentChapterSummaries(db, chapterId, summaryChainLength),
      fetchVolumeSummary(db, chapterId),
      fetchProtagonistCards(db, chapterId),
      fetchOpenForeshadowing(db, novelId, chapterId),  // Phase 1.2: 获取未收尾伏笔
      fetchProtagonistPowerLevel(db, novelId, chapterId),  // Phase 1.3: 获取主角境界信息
    ])

  // 2. 用本章大纲作为 query，RAG 检索语义相关片段
  let ragChunks: ContextBundle['ragChunks'] = []
  let skipped = 0

  if (chapterOutline && env.VECTORIZE) {
    try {
      const queryVector = await embedText(env.AI, chapterOutline)
      const ragResults = await searchSimilar(env.VECTORIZE, queryVector, {
        topK: 20,
        filter: { novelId },
      })

      // 3. 按 token 预算截断 RAG 结果
      let usedTokens = 0

      for (const match of ragResults) {
        const content = match.metadata.content || ''
        const estimated = estimateTokens(content)

        if (usedTokens + estimated > budget.rag) {
          skipped++
          continue
        }

        usedTokens += estimated
        ragChunks.push({
          sourceType: match.metadata.sourceType,
          title: match.metadata.title || 'Untitled',
          content,
          score: match.score,
        })
      }
    } catch (error) {
      console.warn('RAG search failed, using fallback:', error)
      // RAG 失败时使用简单的上下文填充
      ragChunks = await fallbackContext(db, novelId, budget.rag)
    }
  }

  const buildTimeMs = Date.now() - startTime

  return {
    mandatory: {
      chapterOutline,
      prevChapterSummary,
      recentChainSummaries,
      volumeSummary,
      protagonistCards: protagonists,
      openForeshadowing: openForeshadowing.length > 0 ? openForeshadowing : undefined,  // Phase 1.2
      powerLevelInfo: powerLevelInfo || undefined,  // Phase 1.3
    },
    ragChunks,
    debug: {
      totalTokenEstimate:
        estimateMandatoryTokens({ chapterOutline, prevChapterSummary: prevSummary, recentChainSummaries, volumeSummary, protagonistCards: protagonists }) +
        ragChunks.reduce((sum, chunk) => sum + estimateTokens(chunk.content), 0) +
        (openForeshadowing.length > 0 ? openForeshadowing.reduce((s, f) => s + estimateTokens(f), 0) : 0) +  // Phase 1.2
        (powerLevelInfo ? estimateTokens(powerLevelInfo) : 0),  // Phase 1.3
      ragHitsCount: ragChunks.length,
      skippedByBudget: skipped,
      buildTimeMs,
      summaryChainLength,  // Phase 1.1: 记录实际使用的摘要链长度
    },
  }
}

// ========== D1 查询函数（v2.0 重构版）==========

async function fetchChapterOutline(db: any, chapterId: string): Promise<string> {
  try {
    // v2.0: 从卷表获取卷大纲（替代原 outlines 表）
    const result = await db
      .select({
        outline: volumes.outline,
      })
      .from(chapters)
      .leftJoin(volumes, eq(chapters.volumeId, volumes.id))
      .where(eq(chapters.id, chapterId))
      .get()

    return result?.outline || ''
  } catch (error) {
    console.warn('Failed to fetch chapter outline:', error)
    return ''
  }
}

async function fetchPrevChapterSummary(db: any, chapterId: string): Promise<string> {
  try {
    // 先获取当前章节的信息
    const currentChapter = await db
      .select({
        novelId: chapters.novelId,
        sortOrder: chapters.sortOrder,
      })
      .from(chapters)
      .where(eq(chapters.id, chapterId))
      .get()

    if (!currentChapter) return ''

    // 查找上一章的摘要（sortOrder < 当前章节，取最大的那个）
    const prevChapter = await db
      .select({
        summary: chapters.summary,
      })
      .from(chapters)
      .where(
        and(
          eq(chapters.novelId, currentChapter.novelId),
          sql`${chapters.sortOrder} < ${currentChapter.sortOrder}`
        )
      )
      .orderBy(desc(chapters.sortOrder))
      .limit(1)
      .get()

    return prevChapter?.summary || ''
  } catch (error) {
    console.warn('Failed to fetch previous chapter summary:', error)
    return ''
  }
}

async function fetchRecentChapterSummaries(
  db: any,
  chapterId: string,
  chainLength: number = 3
): Promise<string[]> {
  if (chainLength <= 0) return []

  try {
    const currentChapter = await db
      .select({
        novelId: chapters.novelId,
        sortOrder: chapters.sortOrder,
      })
      .from(chapters)
      .where(eq(chapters.id, chapterId))
      .get()

    if (!currentChapter) return []

    const recentChapters = await db
      .select({
        id: chapters.id,
        title: chapters.title,
        summary: chapters.summary,
        sortOrder: chapters.sortOrder,
      })
      .from(chapters)
      .where(
        and(
          eq(chapters.novelId, currentChapter.novelId),
          sql`${chapters.sortOrder} < ${currentChapter.sortOrder}`,
          sql`${chapters.summary} IS NOT NULL`,
          sql`${chapters.summary} != ''`
        )
      )
      .orderBy(desc(chapters.sortOrder))
      .limit(chainLength)
      .all()

    return recentChapters
      .reverse()
      .map(ch => `[第${ch.sortOrder}章] ${ch.title}: ${ch.summary}`)
  } catch (error) {
    console.warn('Failed to fetch recent chapter summaries:', error)
    return []
  }
}

async function fetchVolumeSummary(db: any, chapterId: string): Promise<string> {
  try {
    const result = await db
      .select({
        summary: volumes.summary,
      })
      .from(chapters)
      .leftJoin(volumes, eq(chapters.volumeId, volumes.id))
      .where(eq(chapters.id, chapterId))
      .get()

    return result?.summary || ''
  } catch (error) {
    console.warn('Failed to fetch volume summary:', error)
    return ''
  }
}

async function fetchProtagonistCards(db: any, chapterId: string): Promise<string[]> {
  try {
    // 获取当前小说的所有主角角色
    const currentChapter = await db
      .select({
        novelId: chapters.novelId,
      })
      .from(chapters)
      .where(eq(chapters.id, chapterId))
      .get()

    if (!currentChapter) return []

    const protagonistList = await db
      .select({
        name: characters.name,
        role: characters.role,
        description: characters.description,
        attributes: characters.attributes,
      })
      .from(characters)
      .where(
        and(
          eq(characters.novelId, currentChapter.novelId),
          sql`${characters.deletedAt} IS NULL`
        )
      )
      .all()

    // 只返回主角和重要配角
    return protagonistList
      .filter((c) => c.role === 'protagonist' || c.role === 'antagonist')
      .map((c) => {
        let card = `【${c.name}】`
        if (c.description) card += `\n${c.description}`
        if (c.attributes) {
          try {
            const attrs = JSON.parse(c.attributes)
            const attrStr = Object.entries(attrs)
              .map(([k, v]) => `${k}: ${v}`)
              .join(', ')
            card += `\n属性：${attrStr}`
          } catch {}
        }
        return card
      })
  } catch (error) {
    console.warn('Failed to fetch protagonist cards:', error)
    return []
  }
}

// ========== Fallback 策略（当 RAG 不可用时）==========
// v2.0: 使用 novelSettings 和 masterOutline 替代原 outlines

async function fallbackContext(
  db: any,
  novelId: string,
  budget: number
): Promise<ContextBundle['ragChunks']> {
  try {
    // v2.0: 获取最近的小说设定和总纲作为 fallback
    const [recentSettings, latestMasterOutline] = await Promise.all([
      db
        .select({
          name: novelSettings.name,
          content: novelSettings.content,
          type: novelSettings.type,
        })
        .from(novelSettings)
        .where(
          and(
            eq(novelSettings.novelId, novelId),
            sql`${novelSettings.deletedAt} IS NULL`,
            sql`${novelSettings.content} IS NOT NULL`
          )
        )
        .orderBy(desc(novelSettings.updatedAt))
        .limit(5)
        .all(),

      db
        .select({
          title: masterOutline.title,
          content: masterOutline.content,
        })
        .from(masterOutline)
        .where(
          and(
            eq(masterOutline.novelId, novelId),
            sql`${masterOutline.deletedAt} IS NULL`,
            sql`${masterOutline.content} IS NOT NULL`
          )
        )
        .orderBy(desc(masterOutline.version))
        .limit(1)
        .get()
    ])

    let usedTokens = 0
    const chunks: ContextBundle['ragChunks'] = []

    // 先添加总纲（最重要）
    if (latestMasterOutline?.content) {
      const estimated = estimateTokens(latestMasterOutline.content)
      if (usedTokens + estimated <= budget) {
        usedTokens += estimated
        chunks.push({
          sourceType: 'master_outline',
          title: latestMasterOutline.title,
          content: latestMasterOutline.content,
          score: 1.0,
        })
      }
    }

    // 再添加设定
    for (const setting of recentSettings) {
      if (!setting.content) continue

      const estimated = estimateTokens(setting.content)
      if (usedTokens + estimated > budget) break

      usedTokens += estimated
      chunks.push({
        sourceType: 'setting',
        title: setting.name,
        content: setting.content,
        score: 1.0 - chunks.length * 0.1, // 降序分数
      })
    }

    return chunks
  } catch (error) {
    console.warn('Fallback context failed:', error)
    return []
  }
}

// ========== Phase 1.2: 伏笔查询函数 ==========

/**
 * 获取当前章节前所有未收尾的伏笔
 * 按重要性排序（high > normal > low），最多返回 10 条
 */
async function fetchOpenForeshadowing(
  db: any,
  novelId: string,
  chapterId: string
): Promise<string[]> {
  try {
    // 获取当前章节的 sortOrder
    const currentChapter = await db
      .select({
        sortOrder: chapters.sortOrder,
      })
      .from(chapters)
      .where(eq(chapters.id, chapterId))
      .get()

    if (!currentChapter) return []

    // 查询所有未收尾的伏笔（status='open'，且埋入章节的 sortOrder < 当前章节）
    const openForeshadowingList = await db
      .select({
        id: foreshadowing.id,
        title: foreshadowing.title,
        description: foreshadowing.description,
        importance: foreshadowing.importance,
        chapterId: foreshadowing.chapterId,
      })
      .from(foreshadowing)
      .where(
        and(
          eq(foreshadowing.novelId, novelId),
          eq(foreshadowing.status, 'open'),
          sql`${foreshadowing.deletedAt} IS NULL`
        )
      )
      .all()

    // 如果有章节顺序信息，过滤出当前章节之前埋入的伏笔
    let filteredForeshadowing = openForeshadowingList
    if (currentChapter.sortOrder) {
      const foreshadowingChapters = await db
        .select({
          id: chapters.id,
          sortOrder: chapters.sortOrder,
        })
        .from(chapters)
        .where(
          sql`${chapters.id} IN (${openForeshadowingList.map(f => `'${f.chapterId}'`).join(',')})`
        )
        .all()

      const chapterSortMap = new Map(foreshadowingChapters.map(ch => [ch.id, ch.sortOrder]))

      filteredForeshadowing = openForeshadowingList.filter(f => {
        const sort = chapterSortMap.get(f.chapterId)
        return !sort || sort < currentChapter.sortOrder
      })
    }

    // 按重要性排序并格式化
    const importanceOrder = { high: 0, normal: 1, low: 2 }
    filteredForeshadowing.sort((a, b) =>
      (importanceOrder[a.importance as keyof typeof importanceOrder] || 1) -
      (importanceOrder[b.importance as keyof typeof importanceOrder] || 1)
    )

    return filteredForeshadowing.slice(0, 10).map(f => {
      let text = `【伏笔·${f.importance === 'high' ? '重要' : f.importance === 'normal' ? '一般' : '次要'}】${f.title}`
      if (f.description) text += `\n${f.description}`
      return text
    })
  } catch (error) {
    console.warn('Failed to fetch open foreshadowing:', error)
    return []
  }
}

// ========== Phase 1.3: 境界查询函数 ==========

/**
 * 获取主角的当前境界信息
 * 从 characters 表中读取 powerLevel JSON 字段，格式化为可读文本
 */
async function fetchProtagonistPowerLevel(
  db: any,
  novelId: string,
  _chapterId: string
): Promise<string | null> {
  try {
    // 查询所有主角角色
    const protagonists = await db
      .select({
        id: characters.id,
        name: characters.name,
        role: characters.role,
        powerLevel: characters.powerLevel,
      })
      .from(characters)
      .where(
        and(
          eq(characters.novelId, novelId),
          eq(characters.role, 'protagonist'),
          sql`${characters.deletedAt} IS NULL`
        )
      )
      .all()

    if (protagonists.length === 0) return null

    const powerInfoList: string[] = []

    for (const protagonist of protagonists) {
      if (!protagonist.powerLevel) continue

      try {
        const powerData = JSON.parse(protagonist.powerLevel)
        let info = `【${protagonist.name}·当前境界】`

        if (powerData.system) {
          info += `\n体系：${powerData.system}`
        }

        if (powerData.current) {
          info += `\n当前：${powerData.current}`
        }

        if (powerData.breakthroughs && Array.isArray(powerData.breakthroughs) && powerData.breakthroughs.length > 0) {
          const lastBreakthrough = powerData.breakthroughs[powerData.breakthroughs.length - 1]
          info += `\n最近突破：${lastBreakthrough.from} → ${lastBreakthrough.to}`
          if (lastBreakthrough.note) {
            info += `（${lastBreakthrough.note}）`
          }
        }

        if (powerData.nextMilestone) {
          info += `\n下一阶段目标：${powerData.nextMilestone}`
        }

        powerInfoList.push(info)
      } catch (parseError) {
        console.warn(`Failed to parse powerLevel for character ${protagonist.id}:`, parseError)
      }
    }

    return powerInfoList.length > 0 ? powerInfoList.join('\n\n') : null
  } catch (error) {
    console.warn('Failed to fetch protagonist power level:', error)
    return null
  }
}

// ========== 工具函数 ==========

/** 中文 token 粗估：1 汉字 ≈ 1.3 token，英文 1 词 ≈ 1.3 token */
export function estimateTokens(text: string): number {
  if (!text) return 0
  const cjk = (text.match(/[\u4e00-\u9fff]/g) || []).length
  const other = text.length - cjk
  return Math.ceil(cjk * 1.3 + other * 0.3)
}

function estimateMandatoryTokens(m: {
  chapterOutline: string
  prevChapterSummary: string
  recentChainSummaries: string[]
  volumeSummary: string
  protagonistCards: string[]
}): number {
  return (
    estimateTokens(m.chapterOutline) +
    estimateTokens(m.prevChapterSummary) +
    m.recentChainSummaries.reduce((s, summary) => s + estimateTokens(summary), 0) +
    estimateTokens(m.volumeSummary) +
    m.protagonistCards.reduce((s: number, c: string) => s + estimateTokens(c), 0)
  )
}
