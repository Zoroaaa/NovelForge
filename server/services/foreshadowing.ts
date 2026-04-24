/**
 * @file foreshadowing.ts
 * @description 伏笔追踪服务模块，提供伏笔自动提取、状态检测、推进追踪和CRUD功能
 * @version 2.0.0 - 全环节增强：推进追踪/健康检查/RAG推荐/统计
 */
import { drizzle } from 'drizzle-orm/d1'
import { foreshadowing, foreshadowingProgress, chapters } from '../db/schema'
import { eq, and, isNull, desc, sql, count } from 'drizzle-orm'
import type { Env } from '../lib/types'
import { resolveConfig } from './llm'
import { enqueue } from '../lib/queue'
import { embedText, searchSimilarMulti, ACTIVE_SOURCE_TYPES } from './embedding'

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
      throw new Error(`❌ 未配置"智能分析"模型！请在全局配置中设置 analysis 阶段的模型（用于伏笔提取、境界检测等分析任务）`)
    }

    const existingForeshadowingText = existingOpen.length > 0
      ? `\n\n【当前未收尾的伏笔列表】\n${existingOpen.map((f, i) => `${i + 1}. [ID:${f.id}] ${f.title}: ${f.description || ''}`).join('\n')}`
      : ''

    const extractPrompt = `你是一个专业的小说伏笔分析助手。请分析以下小说章节内容，提取其中的伏笔信息。

【章节标题】：《${chapter.title}》

【正文内容】：
${chapter.content}
${existingForeshadowingText}

请以JSON格式输出分析结果（不要输出其他内容）：
{
  "newForeshadowing": [
    {
      "title": "伏笔标题（简短描述）",
      "description": "详细说明",
      "importance": "high|normal|low"
    }
  ],
  "resolvedForeshadowingIds": ["已收尾的伏笔ID列表"],
  "progresses": [
    {
      "foreshadowingId": "被推进的伏笔ID",
      "progressType": "hint|advance|partial_reveal",
      "summary": "本轮推进的简要描述"
    }
  ]
}

判断标准：
1. 新伏笔：本章中出现的、尚未解决的悬念、暗示、隐藏线索、神秘人物/物品等
2. 收尾伏笔：之前埋下的伏笔在本章得到了解答或明确进展（status变为resolved）
3. 推进中的伏笔（既不是全新埋设，也不是完全收尾）：
   - hint: 间接提及、侧面描写、氛围暗示、背景板出现
   - advance: 直接推进情节、增加新线索、角色主动触及
   - partial_reveal: 揭露部分真相但核心悬念仍在
   注意：如果一个伏笔在本章被收尾了（resolved），不要同时出现在progresses中
4. 重要性判断：high=影响主线剧情/核心秘密；normal=影响支线/角色发展；low=细节装饰

如果本章没有新伏笔、没有收尾伏笔、也没有推进中的伏笔，对应数组为空数组[]。`

    const base = extractConfig.apiBase || getDefaultBase(extractConfig.provider)
    const resp = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${extractConfig.apiKey}`,
      },
      body: JSON.stringify({
        model: extractConfig.modelId,
        messages: [
          { role: 'system', content: '你是一个JSON生成助手，只输出JSON，不要其他内容。' },
          { role: 'user', content: extractPrompt },
        ],
        stream: false,
        temperature: extractConfig.params?.temperature ?? 0.3,
        max_tokens: extractConfig.params?.max_tokens ?? 8000,
      }),
    })

    if (!resp.ok) {
      throw new Error(`Foreshadowing extraction API error: ${resp.status}`)
    }

    const result = await resp.json() as any
    const content = result.choices?.[0]?.message?.content || '{}'

    let parsed: any
    try {
      parsed = JSON.parse(content)
    } catch (parseError) {
      console.warn('Failed to parse foreshadowing extraction result:', parseError)
      return { newForeshadowing: [], resolvedForeshadowingIds: [], progresses: [] }
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
    return parsed
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
        content: chapters.content,
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

        const recentContent = recentChapters
          .map(c => `【${c.title}】\n${c.content || ''}`)
          .join('\n\n---\n\n')

        const staleForPrompt = report.staleItems.slice(0, 8).map(item =>
          `- [${item.importance}] ${item.title}（已${item.chaptersSinceLastProgress}章未推进）`
        ).join('\n')

        const highImportanceOpen = allOpen.filter(f => f.importance === 'high').slice(0, 5)

        const healthPrompt = `你是小说伏笔健康审计助手。基于以下信息生成审计建议。

【最近${recentCount}章内容摘要】：
${recentContent.slice(0, 8000)}

【沉寂伏笔（可能遗忘）】：
${staleForPrompt || '无'}

【高重要性未收尾伏笔】：
${highImportanceOpen.map(f => `- [ID:${f.id}] ${f.title}: ${f.description || ''}`).join('\n') || '无'}

请以JSON格式输出（不要其他内容）：
{
  "suggestions": [
    {
      "foreshadowingId": "伏笔ID",
      "suggestion": "为什么可能遗忘了，以及如何自然地重新引入这个伏笔的建议（50字内）"
    }
  ],
  "contradictions": [
    {
      "foreshadowingId": "伏笔ID",
      "reason": "最近章节内容与此伏笔存在潜在矛盾的原因（50字内）"
    }
  ],
  "resolutionIdeas": [
    {
      "foreshadowingId": "伏笔ID",
      "idea": "基于当前剧情走向，建议的收尾方向（50字内）"
    }
  ]
}

如果没有相关问题，对应数组为空[]。`

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

      const suggestPrompt = `你是小说创作助手。作者正在写一个新章节，需要知道应该呼应哪些已有的伏笔。

【当前创作场景/意图】：
${chapterContext.slice(0, 1000)}

【可呼应的候选伏笔（按相关度排序）】：
${candidateText}

请以JSON格式输出（不要其他内容）：
{
  "suggestions": [
    {
      "foreshadowingId": "伏笔ID",
      "action": "weave_in|advance|resolve|hint",
      "reason": "为什么现在适合处理这个伏笔，以及具体如何处理的简要建议（50字内）"
    }
  ]
}

判断标准：
- weave_in: 自然穿插提及，不作为重点
- advance: 推进情节，增加新线索或转折
- hint: 侧面暗示，为后续收尾做铺垫
- resolve: 本章适合直接收尾该伏笔

如果某个伏笔不适合在当前场景中处理，不要包含在结果中。`

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
