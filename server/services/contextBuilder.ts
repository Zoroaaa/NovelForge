/**
 * @file contextBuilder.ts
 * @description Agent上下文组装器模块，负责章节生成时的上下文构建，包括强制注入和RAG检索
 * @version 2.0.0
 * @modified 2026-04-21 - 添加规范化注释
 */
import { drizzle } from 'drizzle-orm/d1'
import { chapters, volumes, characters, modelConfigs, foreshadowing, novelSettings, masterOutline, writingRules } from '../db/schema'
import { eq, and, sql, desc } from 'drizzle-orm'
import type { Env } from '../lib/types'
import { embedText, searchSimilar } from './embedding'

export interface ContextBundle {
  /** 第一层：核心必带（~4000 tokens）*/
  core: {
    chapterOutline: string
    prevChapterSummary: string
    protagonistStateCards: string[]  // 主角境界+随行人物
    highPriorityRules: string[]     // 高优先级创作规则
  }
  /** 第二层：补充上下文（~4000 tokens，按重要性排序）*/
  supplementary: {
    summaryChain: string[]           // 最近 N 章摘要链
    volumeSummary: string            // 当前卷概要
    characterCards: string[]          // 本章角色设定卡
    openForeshadowing: string[]      // 未收尾伏笔列表（按 importance 排序）
  }
  /** 第三层：RAG 动态检索（~4000 tokens）*/
  ragChunks: Array<{
    sourceType: 'setting' | 'character' | 'chapter_summary' | 'master_outline' | 'writing_rules'
    title: string
    content: string
    score: number
  }>
  /** 诊断信息（前端 ContextPreview 组件展示用）*/
  debug: {
    totalTokenEstimate: number
    coreTokens: number
    supplementaryTokens: number
    ragHitsCount: number
    skippedByBudget: number
    buildTimeMs: number
    summaryChainLength: number
    appliedBudgetTier: { core: number; supplementary: number; rag: number }
  }
}

/**
 * Phase 2.2: 分层 Token 预算配置
 * 总预算 12000 tokens，分为三层
 */
export const DEFAULT_BUDGET = {
  total: 12000,
  core: 4000,
  supplementary: 4000,
  rag: 4000,
  systemPrompt: 2000,
}

/**
 * 构建章节上下文
 * @description 组装章节生成所需的上下文，包括强制注入内容和RAG检索结果
 * @param {Env} env - 环境变量对象
 * @param {string} novelId - 小说ID
 * @param {string} chapterId - 章节ID
 * @param {Object} [budget] - Token预算配置
 * @param {Object} [options] - 可选配置
 * @param {number} [options.summaryChainLength] - 摘要链长度（0-15）
 * @returns {Promise<ContextBundle>} 上下文包
 */
export async function buildChapterContext(
  env: Env,
  novelId: string,
  chapterId: string,
  budget = DEFAULT_BUDGET,
  options?: {
    summaryChainLength?: number
  }
): Promise<ContextBundle> {
  const startTime = Date.now()
  const db = drizzle(env.DB)

  let summaryChainLength = options?.summaryChainLength || 5
  summaryChainLength = Math.min(Math.max(summaryChainLength, 0), 15)

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

  // ========== Phase 2.2: 分层并发获取数据 ==========

  // 第一层：核心必带数据（最高优先级）
  const [chapterOutline, prevChapterSummary, protagonists, powerLevelInfo, allWritingRules] =
    await Promise.all([
      fetchChapterOutline(db, chapterId),
      fetchPrevChapterSummary(db, chapterId),
      fetchProtagonistCards(db, chapterId),
      fetchProtagonistPowerLevel(db, novelId, chapterId),
      fetchWritingRules(db, novelId),
    ])

  // 构建主角状态卡（合并基础信息 + 境界信息）
  const protagonistStateCards = buildProtagonistStateCards(protagonists, powerLevelInfo)

  // 过滤高优先级规则（priority <= 5）
  const highPriorityRules = allWritingRules.slice(0, 8)  // 最多8条高优先级规则

  // 计算第一层 token 使用量
  let coreTokensUsed = estimateTokens(chapterOutline) +
    estimateTokens(prevChapterSummary) +
    protagonistStateCards.reduce((s, c) => s + estimateTokens(c), 0) +
    highPriorityRules.reduce((s, r) => s + estimateTokens(r), 0)

  // 如果第一层超预算，进行截断
  if (coreTokensUsed > budget.core) {
    console.warn(`⚠️ Core context exceeds budget (${coreTokensUsed} > ${budget.core}), truncating...`)
    // 优先保留大纲和上一章摘要，截断角色卡和规则
    while (coreTokensUsed > budget.core && protagonistStateCards.length > 0) {
      const removed = protagonistStateCards.pop()
      if (removed) coreTokensUsed -= estimateTokens(removed)
    }
    while (coreTokensUsed > budget.core && highPriorityRules.length > 0) {
      const removed = highPriorityRules.pop()
      if (removed) coreTokensUsed -= estimateTokens(removed)
    }
  }

  // ========== 第二层：补充上下文 ==========
  const [recentChainSummaries, volumeSummary, openForeshadowing] = await Promise.all([
    fetchRecentChapterSummaries(db, chapterId, summaryChainLength),
    fetchVolumeSummary(db, chapterId),
    fetchOpenForeshadowing(db, novelId, chapterId),
  ])

  // 获取本章相关的角色设定卡（从大纲中提取角色名）
  const characterNamesFromOutline = extractCharacterNames(chapterOutline)
  const characterCards = await fetchCharacterCardsForChapter(db, novelId, characterNamesFromOutline)

  // 按重要性排序并限制数量
  let supplementaryItems = [
    ...recentChainSummaries.map(s => ({ type: 'summary' as const, content: s, priority: 3 })),
    ...characterCards.map(c => ({ type: 'character' as const, content: c, priority: 4 })),
    ...(volumeSummary ? [{ type: 'volume' as const, content: volumeSummary, priority: 2 }] : []),
    ...openForeshadowing.map(f => ({ type: 'foreshadowing' as const, content: f, priority: f.includes('重要') ? 1 : 5 })),
  ]

  // 按优先级排序（数字越小越重要）
  supplementaryItems.sort((a, b) => a.priority - b.priority)

  // 按 budget 截断第二层
  let supplementaryTokensUsed = 0
  const selectedSupplementary: string[] = []

  for (const item of supplementaryItems) {
    const itemTokens = estimateTokens(item.content)
    if (supplementaryTokensUsed + itemTokens > budget.supplementary) break

    supplementaryTokensUsed += itemTokens
    selectedSupplementary.push(item.content)
  }

  // 拆分回结构化格式
  const summaryChain = selectedSupplementary.filter(s => s.startsWith('[第'))
  const volumeSummaryFinal = selectedSupplementary.find(s => !s.startsWith('[第') && !s.startsWith('【伏笔') && !s.startsWith('【')) || ''
  const finalCharacterCards = selectedSupplementary.filter(s => s.startsWith('【') && !s.startsWith('【伏笔') && !s.includes('·当前境界'))
  const finalForeshadowing = selectedSupplementary.filter(s => s.startsWith('【伏笔'))

  // ========== 第三层：RAG 动态检索 ==========
  let ragChunks: ContextBundle['ragChunks'] = []
  let skipped = 0

  if (chapterOutline && env.VECTORIZE) {
    try {
      const queryVector = await embedText(env.AI, chapterOutline)
      const ragResults = await searchSimilar(env.VECTORIZE, queryVector, {
        topK: 20,
        filter: { novelId },
      })

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
          sourceType: match.metadata.sourceType as ContextBundle['ragChunks'][number]['sourceType'],
          title: match.metadata.title || 'Untitled',
          content,
          score: match.score,
        })
      }
    } catch (error) {
      console.warn('RAG search failed, using fallback:', error)
      ragChunks = await fallbackContext(db, novelId, budget.rag)
    }
  }

  const buildTimeMs = Date.now() - startTime
  const totalTokenEstimate = coreTokensUsed + supplementaryTokensUsed +
    ragChunks.reduce((sum, chunk) => sum + estimateTokens(chunk.content), 0)

  return {
    core: {
      chapterOutline,
      prevChapterSummary,
      protagonistStateCards,
      highPriorityRules,
    },
    supplementary: {
      summaryChain,
      volumeSummary: typeof volumeSummaryFinal === 'string' ? volumeSummaryFinal : '',
      characterCards: finalCharacterCards,
      openForeshadowing: finalForeshadowing,
    },
    ragChunks,
    debug: {
      totalTokenEstimate,
      coreTokens: coreTokensUsed,
      supplementaryTokens: supplementaryTokensUsed,
      ragHitsCount: ragChunks.length,
      skippedByBudget: skipped,
      buildTimeMs,
      summaryChainLength,
      appliedBudgetTier: { core: budget.core, supplementary: budget.supplementary, rag: budget.rag },
    },
  }
}

// ========== Phase 2.2: 新增辅助函数 ==========

/**
 * 构建主角状态卡（合并基础信息 + 境界信息）
 */
function buildProtagonistStateCards(
  basicCards: string[],
  powerLevelInfo: string | null
): string[] {
  if (!powerLevelInfo) return basicCards

  // 将境界信息追加到对应的主角卡片中
  return basicCards.map(card => {
    const nameMatch = card.match(/【(.+?)】/)
    if (!nameMatch) return card

    const charName = nameMatch[1]
    // 检查境界信息是否包含该角色名
    if (powerLevelInfo.includes(charName)) {
      return card + '\n' + powerLevelInfo.split('\n\n').find(info => info.includes(charName))?.replace(/【.+?】\n/, '') || ''
    }
    return card
  })
}

/**
 * 从章节大纲中提取角色名（简单启发式）
 */
function extractCharacterNames(outline: string): string[] {
  if (!outline) return []
  const names = new Set<string>()

  // 匹配常见模式：《角色名》、角色名说、"角色名" 等
  const patterns = [
    /《([^》]{2,10})》/g,
    /([^\s，。！？；：""''【】（）]{2,6})说[：:]/g,
    /"([^"]{2,6})"/g,
  ]

  for (const pattern of patterns) {
    let match
    while ((match = pattern.exec(outline)) !== null) {
      const name = match[1].trim()
      if (name && name.length >= 2 && name.length <= 10 && !/^[0-9]/.test(name)) {
        names.add(name)
      }
    }
  }

  return Array.from(names).slice(0, 10)  // 最多提取10个角色
}

/**
 * 获取指定角色的详细设定卡
 */
async function fetchCharacterCardsForChapter(
  db: any,
  novelId: string,
  characterNames: string[]
): Promise<string[]> {
  if (characterNames.length === 0) return []

  try {
    const characterList = await db
      .select({
        name: characters.name,
        description: characters.description,
        role: characters.role,
        attributes: characters.attributes,
      })
      .from(characters)
      .where(
        and(
          eq(characters.novelId, novelId),
          sql`${characters.deletedAt} IS NULL`,
          sql`${characters.name} IN (${characterNames.map(n => `'${n.replace(/'/g, "''")}'`).join(',')})`
        )
      )
      .all()

    return characterList.map((c: { name: string; description?: string; attributes?: string; role?: string }) => {
      let card = `【${c.name}${c.role && c.role !== 'protagonist' ? `(${c.role})` : ''}】`
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
    console.warn('Failed to fetch character cards for chapter:', error)
    return []
  }
}

// ========== D1 查询函数（v2.0 重构版）==========

async function fetchChapterOutline(db: any, chapterId: string): Promise<string> {
  try {
    // v2.0: 从卷表获取卷大纲（替代原 outlines 表）
    const result = await db
      .select({
        eventLine: volumes.eventLine,
      })
      .from(chapters)
      .leftJoin(volumes, eq(chapters.volumeId, volumes.id))
      .where(eq(chapters.id, chapterId))
      .get()

    return result?.eventLine || ''
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
      .map((ch: { sortOrder: number; title: string; summary: string }) => `[第${ch.sortOrder}章] ${ch.title}: ${ch.summary}`)
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
      .filter((c: { role: string }) => c.role === 'protagonist' || c.role === 'antagonist')
      .map((c: { name: string; description?: string; attributes?: string }) => {
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
          sql`${chapters.id} IN (${openForeshadowingList.map((f: { chapterId: string }) => `'${f.chapterId}'`).join(',')})`
        )
        .all()

      const chapterSortMap = new Map(foreshadowingChapters.map((ch: { id: string; sortOrder: number }) => [ch.id, ch.sortOrder]))

      filteredForeshadowing = openForeshadowingList.filter((f: { chapterId: string; importance: string }) => {
        const sort = chapterSortMap.get(f.chapterId)
        return !sort || sort < currentChapter.sortOrder
      })
    }

    // 按重要性排序并格式化
    const importanceOrder = { high: 0, normal: 1, low: 2 }
    filteredForeshadowing.sort((a: { importance: string }, b: { importance: string }) =>
      (importanceOrder[a.importance as keyof typeof importanceOrder] || 1) -
      (importanceOrder[b.importance as keyof typeof importanceOrder] || 1)
    )

    return filteredForeshadowing.slice(0, 10).map((f: { importance: string; title: string; description?: string }) => {
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

// ========== 创作规则查询函数 ==========

/**
 * 获取小说的创作规则
 * 按优先级排序，格式化后返回
 */
async function fetchWritingRules(
  db: any,
  novelId: string
): Promise<string[]> {
  try {
    const rules = await db
      .select({
        category: writingRules.category,
        title: writingRules.title,
        content: writingRules.content,
        priority: writingRules.priority,
      })
      .from(writingRules)
      .where(
        and(
          eq(writingRules.novelId, novelId),
          eq(writingRules.isActive, 1),
          sql`${writingRules.deletedAt} IS NULL`
        )
      )
      .orderBy(writingRules.priority)
      .limit(20)
      .all()

    if (rules.length === 0) return []

    return rules.map((rule: { category: string; title: string; content: string; priority: number }) => {
      const categoryLabel: Record<string, string> = {
        style: '文风',
        pacing: '节奏',
        character: '人物',
        plot: '情节',
        world: '世界观',
        taboo: '禁忌',
        custom: '自定义',
      }
      return `[${categoryLabel[rule.category] || rule.category}] ${rule.title}\n${rule.content}`
    })
  } catch (error) {
    console.warn('Failed to fetch writing rules:', error)
    return []
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
