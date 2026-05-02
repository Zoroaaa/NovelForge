/**
 * @file foreshadowing.ts
 * @description 伏笔追踪服务模块，提供伏笔自动提取、状态检测、推进追踪和CRUD功能
 * @version 2.0.0 - 全环节增强：推进追踪/健康检查/RAG推荐/统计
 */
import { drizzle } from 'drizzle-orm/d1'
import { foreshadowing, foreshadowingProgress, chapters } from '../db/schema'
import { eq, and, isNull, desc, sql, count } from 'drizzle-orm'
import type { Env } from '../lib/types'
import { resolveConfig, generateWithMetrics } from './llm'
import type { LLMCallResult } from './llm'
import { enqueue } from '../lib/queue'
import { embedText, searchSimilarMulti, ACTIVE_SOURCE_TYPES } from './embedding'
import { JSON_OUTPUT_PROMPT } from './agent/constants'

export interface ForeshadowingExtractResult {
  newForeshadowing: Array<{
    title: string
    description: string
    importance: 'high' | 'normal' | 'low'
  }>
  resolvedForeshadowingIds: string[]
  progresses: Array<{
    foreshadowingId: string
    progressType: 'hint' | 'advance' | 'partial_reveal'
    summary: string
  }>
  metrics?: LLMCallResult
}

export interface ForeshadowingHealthReport {
  totalOpen: number
  staleItems: Array<{
    id: string
    title: string
    importance: string
    chaptersSinceLastProgress: number
    lastProgressChapterTitle?: string
    suggestion: string
  }>
  atRiskOfContradiction: Array<{
    id: string
    title: string
    riskReason: string
  }>
  resolutionSuggestions: Array<{
    id: string
    title: string
    suggestedResolution: string
  }>
}

export interface ForeshadowingSuggestion {
  foreshadowing: { id: string; title: string; description: string | null; importance: string }
  relevanceScore: number
  suggestAction: 'weave_in' | 'advance' | 'resolve' | 'hint'
  reason: string
}

export interface ForeshadowingStats {
  overview: {
    total: number
    open: number
    resolved: number
    abandoned: number
    resolutionRate: number
    avgLifespan: number
  }
  byImportance: Record<string, { total: number; open: number; resolved: number }>
  byAge: Array<{ range: string; count: number; ids: string[] }>
  hotChapters: Array<{
    chapterId: string
    chapterTitle: string
    plantedCount: number
    resolvedCount: number
    progressedCount: number
  }>
}

const VALID_PROGRESS_TYPES = ['hint', 'advance', 'partial_reveal'] as const

export async function extractForeshadowingFromChapter(
  env: Env,
  chapterId: string,
  novelId: string
): Promise<ForeshadowingExtractResult> {
  const db = drizzle(env.DB)

  try {
    const chapter = await db
      .select({
        title: chapters.title,
        content: chapters.content,
      })
      .from(chapters)
      .where(eq(chapters.id, chapterId))
      .get()

    if (!chapter?.content) {
      console.log('No content to extract foreshadowing')
      return { newForeshadowing: [], resolvedForeshadowingIds: [], progresses: [] }
    }

    const existingOpen = await db
      .select({
        id: foreshadowing.id,
        title: foreshadowing.title,
        description: foreshadowing.description,
        importance: foreshadowing.importance,
      })
      .from(foreshadowing)
      .where(
        and(
          eq(foreshadowing.novelId, novelId),
          eq(foreshadowing.status, 'open'),
          isNull(foreshadowing.deletedAt)
        )
      )
      .all()

    let extractConfig
    try {
      extractConfig = await resolveConfig(db, 'analysis', novelId)
      extractConfig.apiKey = extractConfig.apiKey || ''
    } catch (error) {
      throw new Error(`❌ 未配置"智能分析"模型！请在全局配置中设置 analysis 阶段的模型（用于伏笔提取、实力检测等分析任务）`)
    }

    const openCount = existingOpen.length
    const existingForeshadowingText = existingOpen.length > 0
      ? `\n\n【当前未收尾的伏笔（共${openCount}个）】\n${existingOpen.map((f, i) => `${i + 1}. [ID:${f.id}] [${f.importance}] ${f.title}: ${f.description || ''}`).join('\n')}`
      : ''

    const extractPrompt = `你是专业的小说伏笔分析助手。请分析章节内容，准确识别伏笔操作。

【章节标题】：《${chapter.title}》

【正文内容】：
${chapter.content}
${existingForeshadowingText}

【判断标准——严格执行】

新伏笔（newForeshadowing）：
- 必须是：明确的悬念、未解释的神秘元素、有意为之的暗示（作者刻意不说明的内容）
- 不算新伏笔：普通的场景描写、角色心理活动、已知信息的重复
- importance 判断（标准要严格，不要轻易标 high）：
  * high：直接影响主线剧情走向，如主角身世之谜、核心反派的真实身份、决定故事终局的秘密
  * normal：影响支线或角色关系发展，如某角色的隐藏目的、道具的特殊来历
  * low：细节装饰性伏笔，如某个奇异现象、NPC的神秘举动
- 当前已有${openCount}个未收尾伏笔，新伏笔应该是真正有价值的新内容，不要重复已有伏笔

已收尾伏笔（resolvedForeshadowingIds）：
- 必须是：伏笔的核心悬念在本章得到了明确的解答或揭示
- 不算收尾："提及了这个伏笔"或"推进了一步"不算收尾，只有"核心谜底揭开"才算
- 如果不确定，宁可放入 progresses 而不是 resolvedForeshadowingIds

推进中（progresses）：
- hint：背景式提及，侧面暗示，不直接推进
- advance：直接增加新线索，情节推进明显
- partial_reveal：揭露部分真相但核心悬念仍在
- 注意：已收尾的伏笔不要同时出现在 progresses 中

请以JSON格式输出（不要其他内容）：
{
  "newForeshadowing": [
    {
      "title": "伏笔标题（简短，5-15字，如：林岩左手黑色印记）",
      "description": "详细说明：这个伏笔是什么？在本章如何出现？为什么算伏笔？（50-100字）",
      "importance": "high|normal|low"
    }
  ],
  "resolvedForeshadowingIds": ["只填已明确收尾的伏笔ID"],
  "progresses": [
    {
      "foreshadowingId": "伏笔ID",
      "progressType": "hint|advance|partial_reveal",
      "summary": "本章对此伏笔做了什么（20-40字）"
    }
  ]
}

如果本章确实没有相关内容，对应数组为空[]。`

    const extractLLMConfig = {
      ...extractConfig,
      params: { ...(extractConfig.params || {}), temperature: extractConfig.params?.temperature ?? 0.3, max_tokens: extractConfig.params?.max_tokens ?? 8000 },
    }

    const extractMetrics = await generateWithMetrics(extractLLMConfig, [
      { role: 'system', content: JSON_OUTPUT_PROMPT },
      { role: 'user', content: extractPrompt },
    ])

    const content = extractMetrics.text || '{}'

    let parsed: any
    try {
      parsed = JSON.parse(content)
    } catch (parseError) {
      console.warn('Failed to parse foreshadowing extraction result:', parseError)
      return { newForeshadowing: [], resolvedForeshadowingIds: [], progresses: [], metrics: extractMetrics }
    }

    parsed.newForeshadowing = (parsed.newForeshadowing || []).filter((f: any) =>
      f.title && typeof f.title === 'string' && f.title.trim().length > 0
    ).map((f: any) => ({
      title: f.title.trim(),
      description: (f.description || '').trim(),
      importance: ['high', 'normal', 'low'].includes(f.importance) ? f.importance : 'normal' as const,
    }))

    parsed.resolvedForeshadowingIds = (parsed.resolvedForeshadowingIds || []).filter((id: any) =>
      typeof id === 'string' && id.trim().length > 0
    )

    parsed.progresses = (parsed.progresses || []).filter((p: any) =>
      p.foreshadowingId &&
      typeof p.foreshadowingId === 'string' &&
      VALID_PROGRESS_TYPES.includes(p.progressType)
    ).map((p: any) => ({
      foreshadowingId: p.foreshadowingId.trim(),
      progressType: p.progressType,
      summary: (p.summary || '').trim(),
    }))

    for (const newF of parsed.newForeshadowing) {
      try {
        const inserted = await db.insert(foreshadowing).values({
          novelId,
          chapterId,
          title: newF.title,
          description: newF.description,
          status: 'open',
          importance: newF.importance,
        }).returning().get()

        if (inserted && env.TASK_QUEUE) {
          await enqueue(env, {
            type: 'index_content',
            payload: {
              sourceType: 'foreshadowing',
              sourceId: inserted.id,
              novelId,
              title: inserted.title,
              content: inserted.description || inserted.title,
              extraMetadata: { importance: inserted.importance },
            },
          })
        }
        console.log(`✅ New foreshadowing created: ${newF.title}`)
      } catch (insertError) {
        console.warn('Failed to insert foreshadowing:', insertError)
      }
    }

    for (const resolvedId of parsed.resolvedForeshadowingIds) {
      try {
        await db
          .update(foreshadowing)
          .set({
            status: 'resolved',
            resolvedChapterId: chapterId,
          })
          .where(eq(foreshadowing.id, resolvedId))
        console.log(`✅ Foreshadowing resolved: ${resolvedId}`)
      } catch (updateError) {
        console.warn('Failed to update foreshadowing status:', updateError)
      }
    }

    for (const prog of parsed.progresses) {
      try {
        await db.insert(foreshadowingProgress).values({
          foreshadowingId: prog.foreshadowingId,
          chapterId,
          progressType: prog.progressType,
          summary: prog.summary || null,
        })
      } catch (progressError) {
        console.warn('Failed to insert foreshadowing progress:', progressError)
      }
    }

    console.log(`📝 Foreshadowing extraction complete: ${parsed.newForeshadowing.length} new, ${parsed.resolvedForeshadowingIds.length} resolved, ${parsed.progresses.length} progressed`)
    return { ...parsed, metrics: extractMetrics }
  } catch (error) {
    console.error('Foreshadowing extraction failed:', error)
    return { newForeshadowing: [], resolvedForeshadowingIds: [], progresses: [] }
  }
}

export async function checkForeshadowingHealth(
  env: Env,
  novelId: string,
  options?: { recentChaptersCount?: number; staleThreshold?: number }
): Promise<ForeshadowingHealthReport> {
  const db = drizzle(env.DB)
  const threshold = options?.staleThreshold ?? 10
  const recentCount = options?.recentChaptersCount ?? 5

  const report: ForeshadowingHealthReport = {
    totalOpen: 0,
    staleItems: [],
    atRiskOfContradiction: [],
    resolutionSuggestions: [],
  }

  try {
    const allOpen = await db
      .select({
        id: foreshadowing.id,
        title: foreshadowing.title,
        description: foreshadowing.description,
        importance: foreshadowing.importance,
        createdAt: foreshadowing.createdAt,
        chapterId: foreshadowing.chapterId,
      })
      .from(foreshadowing)
      .where(
        and(
          eq(foreshadowing.novelId, novelId),
          eq(foreshadowing.status, 'open'),
          isNull(foreshadowing.deletedAt)
        )
      )
      .all()

    report.totalOpen = allOpen.length

    const recentChapters = await db
      .select({
        id: chapters.id,
        title: chapters.title,
        sortOrder: chapters.sortOrder,
        summary: chapters.summary,
      })
      .from(chapters)
      .where(
        and(
          eq(chapters.novelId, novelId),
          isNull(chapters.deletedAt)
        )
      )
      .orderBy(desc(chapters.sortOrder))
      .limit(recentCount)
      .all()

    const recentChapterIds = recentChapters.map(c => c.id)

    const recentContent = recentChapters
      .map(c => `《${c.title}》摘要：${c.summary || '（无摘要）'}`)
      .join('\n\n')

    for (const fs of allOpen) {
      const lastProgress = await db
        .select({
          chapterId: foreshadowingProgress.chapterId,
          createdAt: foreshadowingProgress.createdAt,
        })
        .from(foreshadowingProgress)
        .where(eq(foreshadowingProgress.foreshadowingId, fs.id))
        .orderBy(desc(foreshadowingProgress.createdAt))
        .limit(1)
        .get()

      const lastProgressChapter = lastProgress
        ? recentChapters.find(c => c.id === lastProgress.chapterId)
        : null

      const isStale = !lastProgress || !recentChapterIds.includes(lastProgress.chapterId)

      if (isStale) {
        const chaptersSinceLast = lastProgress
          ? await db
              .select({ count: count() })
              .from(chapters)
              .where(
                and(
                  eq(chapters.novelId, novelId),
                  sql`${chapters.sortOrder} > (
                    SELECT coalesce(sort_order, 0) FROM chapters WHERE id = '${lastProgress.chapterId}'
                  )`,
                  isNull(chapters.deletedAt)
                )
              )
              .get()
          : await db
              .select({ count: count() })
              .from(chapters)
              .where(
                and(
                  eq(chapters.novelId, novelId),
                  sql`${chapters.sortOrder} > (
                    SELECT coalesce(sort_order, 0) FROM chapters WHERE id = '${fs.chapterId || fs.id}'
                  )`,
                  isNull(chapters.deletedAt)
                )
              )
              .get()

      const chaptersSince = chaptersSinceLast?.count ?? 999

        if (chaptersSince >= threshold || fs.importance === 'high') {
          report.staleItems.push({
            id: fs.id,
            title: fs.title,
            importance: fs.importance,
            chaptersSinceLastProgress: chaptersSince,
            lastProgressChapterTitle: lastProgressChapter?.title,
            suggestion: '',
          })
        }
      }
    }

    report.staleItems.sort((a, b) => {
      const importanceOrder = { high: 0, normal: 1, low: 2 }
      return (importanceOrder[a.importance as keyof typeof importanceOrder] ?? 1) -
             (importanceOrder[b.importance as keyof typeof importanceOrder] ?? 1) ||
             b.chaptersSinceLastProgress - a.chaptersSinceLastProgress
    })

    if (report.staleItems.length > 0 || allOpen.length > 0) {
      try {
        let checkConfig
        try {
          checkConfig = await resolveConfig(db, 'analysis', novelId)
          checkConfig.apiKey = checkConfig.apiKey || ''
        } catch {
          return report
        }

        const staleForPrompt = report.staleItems.slice(0, 8).map(item =>
          `- [${item.importance}] ${item.title}（已${item.chaptersSinceLastProgress}章未推进）`
        ).join('\n')

        const highImportanceOpen = allOpen.filter(f => f.importance === 'high').slice(0, 5)

        const healthPrompt = `你是小说伏笔健康审计助手。基于最近章节的摘要，评估伏笔状态并给出建议。

【最近${recentCount}章摘要】：
${recentContent}

【沉寂伏笔（长期未推进）】：
${staleForPrompt || '无'}

【高重要性未收尾伏笔】：
${highImportanceOpen.map(f => `- [ID:${f.id}] [high] ${f.title}: ${f.description || ''}`).join('\n') || '无'}

请以JSON格式输出（不要其他内容）：
{
  "suggestions": [
    {
      "foreshadowingId": "伏笔ID",
      "urgency": "high|normal|low",
      "suggestion": "为什么建议现在处理，以及具体的引入方式建议（40-80字）"
    }
  ],
  "contradictions": [
    {
      "foreshadowingId": "伏笔ID",
      "reason": "最近章节内容与此伏笔存在什么潜在矛盾（40字以内）"
    }
  ],
  "resolutionIdeas": [
    {
      "foreshadowingId": "伏笔ID",
      "idea": "基于当前剧情，建议的收尾方向和方式（40-60字）"
    }
  ]
}

如果没有问题，对应数组为空[]。`

        const base = checkConfig.apiBase || getDefaultBase(checkConfig.provider)
        const resp = await fetch(`${base}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${checkConfig.apiKey}`,
          },
          body: JSON.stringify({
            model: checkConfig.modelId,
            messages: [
              { role: 'system', content: '你是一个JSON生成助手，只输出JSON，不要其他内容。' },
              { role: 'user', content: healthPrompt },
            ],
            stream: false,
            temperature: 0.4,
            max_tokens: checkConfig.params?.max_tokens ?? 6000,
          }),
        })

        if (resp.ok) {
          const result = await resp.json() as any
          const healthContent = result.choices?.[0]?.message?.content || '{}'
          let healthParsed: any
          try {
            healthParsed = JSON.parse(healthContent)
          } catch {
            return report
          }

          const suggestionMap = new Map<string, string>()
          ;(healthParsed.suggestions || []).forEach((s: any) => {
            if (s.foreshadowingId && s.suggestion) suggestionMap.set(s.foreshadowingId, s.suggestion)
          })
          report.staleItems.forEach(item => {
            item.suggestion = suggestionMap.get(item.id) || ''
          })

          ;(healthParsed.contradictions || []).forEach((c: any) => {
            if (c.foreshadowingId && c.reason) {
              const fs = allOpen.find(f => f.id === c.foreshadowingId)
              if (fs) {
                report.atRiskOfContradiction.push({
                  id: fs.id,
                  title: fs.title,
                  riskReason: c.reason,
                })
              }
            }
          })

          ;(healthParsed.resolutionIdeas || []).forEach((r: any) => {
            if (r.foreshadowingId && r.idea) {
              const fs = allOpen.find(f => f.id === r.foreshadowingId)
              if (fs) {
                report.resolutionSuggestions.push({
                  id: fs.id,
                  title: fs.title,
                  suggestedResolution: r.idea,
                })
              }
            }
          })
        }
      } catch (checkError) {
        console.warn('Foreshadowing health LLM analysis failed:', checkError)
      }
    }

    return report
  } catch (error) {
    console.error('Foreshadowing health check failed:', error)
    return report
  }
}

export async function suggestForeshadowingForChapter(
  env: Env,
  novelId: string,
  chapterContext: string
): Promise<ForeshadowingSuggestion[]> {
  if (!env.VECTORIZE || !chapterContext?.trim()) {
    return []
  }

  try {
    const queryVector = await embedText(env.AI, chapterContext)
    const searchResults = await searchSimilarMulti(env.VECTORIZE, queryVector, {
      topK: 10,
      novelId,
      sourceTypes: ['foreshadowing'],
    })

    if (searchResults.length === 0) {
      return []
    }

    const db = drizzle(env.DB)
    const seenIds = new Set<string>()
    const candidates: Array<{ id: string; title: string; description: string | null; importance: string; score: number }> = []

    for (const r of searchResults) {
      if (seenIds.has(r.metadata.sourceId)) continue
      seenIds.add(r.metadata.sourceId)

      const fs = await db
        .select({
          id: foreshadowing.id,
          title: foreshadowing.title,
          description: foreshadowing.description,
          importance: foreshadowing.importance,
        })
        .from(foreshadowing)
        .where(
          and(
            eq(foreshadowing.id, r.metadata.sourceId),
            eq(foreshadowing.novelId, novelId),
            eq(foreshadowing.status, 'open'),
            isNull(foreshadowing.deletedAt)
          )
        )
        .get()

      if (fs) {
        const importanceMultiplier = { high: 1.5, normal: 1.0, low: 0.7 }
        const adjustedScore = r.score * (importanceMultiplier[fs.importance as keyof typeof importanceMultiplier] ?? 1.0)
        candidates.push({ ...fs, score: adjustedScore })
      }
    }

    candidates.sort((a, b) => b.score - a.score)

    const topCandidates = candidates.slice(0, 5)
    if (topCandidates.length === 0) return []

    try {
      let suggestConfig
      try {
        suggestConfig = await resolveConfig(db, 'analysis', novelId)
        suggestConfig.apiKey = suggestConfig.apiKey || ''
      } catch {
        return topCandidates.map(c => ({
          foreshadowing: { id: c.id, title: c.title, description: c.description, importance: c.importance },
          relevanceScore: Math.round(c.score * 1000) / 1000,
          suggestAction: 'weave_in' as const,
          reason: `语义相关度 ${(Math.round(c.score * 100))}%，建议在本章中自然呼应。`,
        }))
      }

      const candidateText = topCandidates.map((c, i) =>
        `${i + 1}. [ID:${c.id}] [${c.importance}] ${c.title}: ${c.description || ''}`
      ).join('\n')

      const suggestPrompt = `你是小说创作顾问。作者正在计划创作一个新章节，需要决定在本章中如何呼应已有的伏笔。

【本章创作意图/场景描述】：
${chapterContext.slice(0, 1000)}

【候选伏笔（按相关度排序）】：
${candidateText}

对每个候选伏笔，判断以下内容：
1. 当前场景下是否适合处理这个伏笔？（不适合则不要输出）
2. 建议的处理方式：
   - weave_in：自然穿插，不作为重点，读者感觉到存在即可
   - hint：侧面暗示，为后续收尾做铺垫，但不直接推进
   - advance：作为本章的支线推进，增加新线索
   - resolve：本章可以完整收尾这个伏笔
3. 具体的操作建议：如何在章节中自然地引入这个伏笔？

请以JSON格式输出（只包含适合在本章处理的伏笔）：
{
  "suggestions": [
    {
      "foreshadowingId": "伏笔ID",
      "action": "weave_in|hint|advance|resolve",
      "reason": "为什么现在适合处理（20字以内）",
      "howTo": "具体如何在章节中引入这个伏笔的操作建议（40-60字，越具体越好）"
    }
  ]
}

如果没有候选伏笔适合在当前场景处理，输出空数组：{"suggestions": []}`

      const base = suggestConfig.apiBase || getDefaultBase(suggestConfig.provider)
      const resp = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${suggestConfig.apiKey}`,
        },
        body: JSON.stringify({
          model: suggestConfig.modelId,
          messages: [
            { role: 'system', content: '你是一个JSON生成助手，只输出JSON，不要其他内容。' },
            { role: 'user', content: suggestPrompt },
          ],
          stream: false,
          temperature: 0.4,
          max_tokens: suggestConfig.params?.max_tokens ?? 4000,
        }),
      })

      if (!resp.ok) {
        throw new Error(`Suggestion API error: ${resp.status}`)
      }

      const result = await resp.json() as any
      const suggestContent = result.choices?.[0]?.message?.content || '{}'
      let suggestParsed: any
      try {
        suggestParsed = JSON.parse(suggestContent)
      } catch {
        return topCandidates.map(c => ({
          foreshadowing: { id: c.id, title: c.title, description: c.description, importance: c.importance },
          relevanceScore: Math.round(c.score * 1000) / 1000,
          suggestAction: 'weave_in' as const,
          reason: `语义相关度 ${(Math.round(c.score * 100))}%，建议在本章中自然呼应。`,
        }))
      }

      const validActions = ['weave_in', 'advance', 'resolve', 'hint']
      const actionMap = new Map<string, { action: string; reason: string }>()
      ;(suggestParsed.suggestions || []).forEach((s: any) => {
        if (s.foreshadowingId && validActions.includes(s.action)) {
          actionMap.set(s.foreshadowingId, { action: s.action, reason: s.reason || '' })
        }
      })

      return topCandidates.map(c => {
        const mapped = actionMap.get(c.id)
        return {
          foreshadowing: { id: c.id, title: c.title, description: c.description, importance: c.importance },
          relevanceScore: Math.round(c.score * 1000) / 1000,
          suggestAction: (mapped?.action || 'weave_in') as ForeshadowingSuggestion['suggestAction'],
          reason: mapped?.reason || `语义相关度 ${(Math.round(c.score * 100))}%，建议在本章中自然呼应。`,
        }
      })
    } catch (llmError) {
      console.warn('Foreshadowing suggestion LLM failed, fallback to ranking:', llmError)
      return topCandidates.map(c => ({
        foreshadowing: { id: c.id, title: c.title, description: c.description, importance: c.importance },
        relevanceScore: Math.round(c.score * 1000) / 1000,
        suggestAction: 'weave_in' as const,
        reason: `语义相关度 ${(Math.round(c.score * 100))}%，建议在本章中自然呼应。`,
      }))
    }
  } catch (error) {
    console.error('Foreshadowing suggestion failed:', error)
    return []
  }
}

function getDefaultBase(provider: string): string {
  switch (provider) {
    case 'volcengine':
      return 'https://ark.cn-beijing.volces.com/api/v3'
    case 'anthropic':
      return 'https://api.anthropic.com/v1'
    case 'openai':
      return 'https://api.openai.com/v1'
    default:
      return 'https://ark.cn-beijing.volces.com/api/v3'
  }
}
