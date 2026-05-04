/**
 * @file power-level.ts
 * @description 境界/成长体系路由模块，提供境界突破检测和角色成长数据查询API
 * @date 2026-05-04
 */
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { drizzle } from 'drizzle-orm/d1'
import { characters, chapters, generationLogs } from '../db/schema'
import { eq, and, desc, sql, inArray } from 'drizzle-orm'
import type { Env } from '../lib/types'
import { detectPowerLevelBreakthrough } from '../services/powerLevel'

const router = new Hono<{ Bindings: Env }>()

const DetectSchema = z.object({
  chapterId: z.string().min(1),
  novelId: z.string().min(1),
})

const BatchDetectSchema = z.object({
  novelId: z.string().min(1),
  chapterIds: z.array(z.string()).optional(),
})

router.post('/detect', zValidator('json', DetectSchema), async (c) => {
  const { chapterId, novelId } = c.req.valid('json')
  const db = drizzle(c.env.DB)

  const chapter = await db
    .select({ id: chapters.id, title: chapters.title })
    .from(chapters)
    .where(and(eq(chapters.id, chapterId), sql`${chapters.deletedAt} IS NULL`))
    .get()

  if (!chapter) {
    return c.json({ error: '章节不存在' }, 404)
  }

  try {
    const result = await detectPowerLevelBreakthrough(c.env, chapterId, novelId)

    const metrics = result.metrics
    await db.insert(generationLogs).values({
      novelId,
      chapterId,
      stage: 'power_level_detect',
      modelId: metrics?.modelId || 'analysis',
      promptTokens: metrics?.usage.prompt_tokens,
      completionTokens: metrics?.usage.completion_tokens,
      durationMs: metrics?.durationMs || 0,
      status: 'success',
      contextSnapshot: JSON.stringify(result),
    })

    return c.json({
      ok: true,
      hasBreakthrough: result.hasBreakthrough,
      updates: result.updates,
      chapterTitle: chapter.title,
    })
  } catch (error) {
    const errorMsg = (error as Error).message

    await db.insert(generationLogs).values({
      novelId,
      chapterId,
      stage: 'power_level_detect',
      modelId: 'analysis',
      status: 'error',
      errorMsg,
      createdAt: Math.floor(Date.now() / 1000),
    }).catch(() => {})

    return c.json({ error: '境界检测失败', details: errorMsg }, 500)
  }
})

router.post('/batch-detect', zValidator('json', BatchDetectSchema), async (c) => {
  const { novelId, chapterIds } = c.req.valid('json')
  const db = drizzle(c.env.DB)

  let targetChapters

  if (chapterIds && chapterIds.length > 0) {
    targetChapters = await db
      .select({ id: chapters.id, title: chapters.title, sortOrder: chapters.sortOrder })
      .from(chapters)
      .where(
        and(
          eq(chapters.novelId, novelId),
          sql`${chapters.deletedAt} IS NULL`,
          sql`${chapters.content} IS NOT NULL`
        )
      )
      .all()
    targetChapters = targetChapters.filter(ch => chapterIds.includes(ch.id))
  } else {
    targetChapters = await db
      .select({ id: chapters.id, title: chapters.title, sortOrder: chapters.sortOrder })
      .from(chapters)
      .where(
        and(
          eq(chapters.novelId, novelId),
          sql`${chapters.deletedAt} IS NULL`,
          sql`${chapters.content} IS NOT NULL`
        )
      )
      .orderBy(chapters.sortOrder)
      .all()
  }

  if (targetChapters.length === 0) {
    return c.json({ ok: true, message: '没有可检测的章节', results: [] })
  }

  const results: Array<{
    chapterId: string
    chapterTitle: string
    hasBreakthrough: boolean
    updatesCount: number
    error?: string
  }> = []

  for (const chapter of targetChapters) {
    try {
      const result = await detectPowerLevelBreakthrough(c.env, chapter.id, novelId)
      results.push({
        chapterId: chapter.id,
        chapterTitle: chapter.title,
        hasBreakthrough: result.hasBreakthrough,
        updatesCount: result.updates.length,
      })

      const metrics = result.metrics
      await db.insert(generationLogs).values({
        novelId,
        chapterId: chapter.id,
        stage: 'power_level_detect',
        modelId: metrics?.modelId || 'analysis',
        promptTokens: metrics?.usage.prompt_tokens,
        completionTokens: metrics?.usage.completion_tokens,
        durationMs: metrics?.durationMs || 0,
        status: 'success',
        contextSnapshot: JSON.stringify({
          hasBreakthrough: result.hasBreakthrough,
          updatesCount: result.updates.length,
        }),
      }).catch(() => {})
    } catch (error) {
      results.push({
        chapterId: chapter.id,
        chapterTitle: chapter.title,
        hasBreakthrough: false,
        updatesCount: 0,
        error: (error as Error).message,
      })

      await db.insert(generationLogs).values({
        novelId,
        chapterId: chapter.id,
        stage: 'power_level_detect',
        modelId: 'analysis',
        status: 'error',
        errorMsg: (error as Error).message,
        createdAt: Math.floor(Date.now() / 1000),
      }).catch(() => {})
    }
  }

  const totalBreakthroughs = results.reduce((sum, r) => sum + r.updatesCount, 0)
  const errors = results.filter(r => r.error)

  return c.json({
    ok: true,
    totalChapters: targetChapters.length,
    totalBreakthroughs,
    errorCount: errors.length,
    results,
  })
})

router.get('/history/:novelId', async (c) => {
  const novelId = c.req.param('novelId')
  const db = drizzle(c.env.DB)

  const protagonistRows = await db
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
        sql`${characters.deletedAt} IS NULL`,
        sql`${characters.powerLevel} IS NOT NULL`
      )
    )
    .all()

  if (protagonistRows.length === 0) {
    return c.json({ history: [] })
  }

  const allChapterIds = new Set<string>()
  for (const row of protagonistRows) {
    if (!row.powerLevel) continue
    try {
      const pl = JSON.parse(row.powerLevel)
      if (pl.breakthroughs) {
        for (const bt of pl.breakthroughs) {
          if (bt.chapterId) allChapterIds.add(bt.chapterId)
        }
      }
    } catch {}
  }

  const chapterMap = new Map<string, string>()
  if (allChapterIds.size > 0) {
    const chapterRows = await db
      .select({ id: chapters.id, title: chapters.title, sortOrder: chapters.sortOrder })
      .from(chapters)
      .where(inArray(chapters.id, Array.from(allChapterIds)))
      .all()
    for (const ch of chapterRows) {
      chapterMap.set(ch.id, ch.title)
    }
  }

  const history = protagonistRows.map(row => {
    let parsed: Record<string, unknown> = { system: '', current: '', breakthroughs: [] }
    if (row.powerLevel) {
      try {
        parsed = JSON.parse(row.powerLevel)
      } catch {}
    }

    const breakthroughs = Array.isArray(parsed.breakthroughs)
      ? (parsed.breakthroughs as Array<Record<string, unknown>>).map(bt => ({
          chapterId: bt.chapterId as string || '',
          chapterTitle: chapterMap.get(bt.chapterId as string || '') || '未知章节',
          from: bt.from as string || '',
          to: bt.to as string || '',
          note: (bt.note as string | undefined)?.slice(0, 100),
          timestamp: bt.timestamp as number || 0,
        }))
      : []

    breakthroughs.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0))

    return {
      characterId: row.id,
      characterName: row.name,
      system: parsed.system as string || '未知体系',
      currentLevel: parsed.current as string || '未知',
      nextMilestone: parsed.nextMilestone as string | undefined,
      breakthroughs,
      totalBreakthroughs: breakthroughs.length,
    }
  })

  return c.json({ history })
})

router.get('/character/:id', async (c) => {
  const id = c.req.param('id')
  const db = drizzle(c.env.DB)

  const row = await db
    .select({
      id: characters.id,
      name: characters.name,
      role: characters.role,
      powerLevel: characters.powerLevel,
      deletedAt: characters.deletedAt,
    })
    .from(characters)
    .where(eq(characters.id, id))
    .get()

  if (!row || row.deletedAt) {
    return c.json({ error: '角色不存在' }, 404)
  }

  if (!row.powerLevel) {
    return c.json({
      characterId: row.id,
      characterName: row.name,
      hasData: false,
      data: null,
    })
  }

  let data: Record<string, unknown>
  try {
    data = JSON.parse(row.powerLevel)
  } catch {
    return c.json({
      characterId: row.id,
      characterName: row.name,
      hasData: false,
      raw: row.powerLevel,
      error: 'powerLevel JSON 解析失败',
    }, 500)
  }

  return c.json({
    characterId: row.id,
    characterName: row.name,
    hasData: true,
    data: {
      system: data.system as string || '未知体系',
      current: data.current as string || '未知',
      breakthroughs: Array.isArray(data.breakthroughs) ? data.breakthroughs : [],
      nextMilestone: data.nextMilestone as string | undefined,
    },
  })
})

const ValidateSchema = z.object({
  characterId: z.string().min(1),
  novelId: z.string().min(1),
  recentChapterCount: z.coerce.number().int().min(1).max(10).optional().default(3),
})

const ApplySuggestionSchema = z.object({
  characterId: z.string().min(1),
  novelId: z.string().min(1),
  suggestedCurrent: z.string().min(1),
  suggestedSystem: z.string().optional(),
  note: z.string().optional(),
})

router.post('/validate', zValidator('json', ValidateSchema), async (c) => {
  const { characterId, novelId, recentChapterCount } = c.req.valid('json')
  const db = drizzle(c.env.DB)

  const charRow = await db
    .select({
      id: characters.id,
      name: characters.name,
      powerLevel: characters.powerLevel,
    })
    .from(characters)
    .where(and(eq(characters.id, characterId), sql`${characters.deletedAt} IS NULL`))
    .get()

  if (!charRow) {
    return c.json({ error: '角色不存在' }, 404)
  }

  let dbPowerLevel: { system: string; current: string } | null = null
  if (charRow.powerLevel) {
    try {
      const parsed = JSON.parse(charRow.powerLevel)
      dbPowerLevel = {
        system: (parsed.system as string) || '未知体系',
        current: (parsed.current as string) || '未知',
      }
    } catch {}
  }

  const recentChapters = await db
    .select({ id: chapters.id, title: chapters.title, content: chapters.content, sortOrder: chapters.sortOrder })
    .from(chapters)
    .where(
      and(
        eq(chapters.novelId, novelId),
        sql`${chapters.deletedAt} IS NULL`,
        sql`${chapters.content} IS NOT NULL`
      )
    )
    .orderBy(desc(chapters.sortOrder))
    .limit(recentChapterCount)
    .all()

  if (recentChapters.length === 0) {
    return c.json({
      ok: true,
      characterId,
      characterName: charRow.name,
      isConsistent: true,
      dbLevel: dbPowerLevel,
      assessedLevel: null,
      reason: '没有可分析的章节内容',
    })
  }

  let detectionConfig
  try {
    detectionConfig = await (await import('../services/llm')).resolveConfig(db, 'analysis', novelId)
    detectionConfig.apiKey = detectionConfig.apiKey || ''
  } catch {
    return c.json({ error: '未配置"智能分析"模型' }, 400)
  }

  const chapterTexts = recentChapters.reverse().map((ch, i) =>
    `【第${i + 1}章】《${ch.title}》\n${(ch.content || '').slice(0, 2000)}`
  ).join('\n\n---\n\n')

  const validatePrompt = `你是一个小说实力/成长体系分析专家。请根据以下最近 ${recentChapters.length} 章的内容，判断角色"${charRow.name}"的**当前实际实力等级**。

【角色数据库记录的实力】：
${dbPowerLevel ? `体系：${dbPowerLevel.system}，当前：${dbPowerLevel.current}` : '无记录'}

【最近章节内容】：
${chapterTexts}

请以JSON格式输出（只输出JSON，不要其他内容）：
{
  "assessedSystem": "判断出的力量/成长体系名称（使用小说中出现的原始名称）",
  "assessedCurrent": "判断出的当前实际等级（使用小说中出现的原始名称）",
  "isConsistent": true/false,
  "confidence": "high/medium/low",
  "reasoning": "50字以内的判断依据",
  "suggestion": "如果不一致，给出建议更新的等级值（与assessedCurrent相同即可）"
}

判断标准：
- 综合所有章节的描述来判断角色当前实力水平
- 如果最新章节明确提到了新的实力变化，以最新的为准
- 如果数据库记录与你的判断一致，isConsistent 为 true
- confidence 表示判断置信度：高（多次明确提及）/ 中（有暗示但不够明确）/ 低（信息不足）`

  const { generateWithMetrics: genWithMetrics } = await import('../services/llm')

  const validateConfig = {
    ...detectionConfig,
    params: { ...(detectionConfig.params || {}), temperature: 0.2, max_tokens: 1000 },
  }

  let validateMetrics
  let content: string

  try {
    validateMetrics = await genWithMetrics(validateConfig, [
      { role: 'system', content: '你是一个JSON生成助手，只输出JSON，不要其他内容。' },
      { role: 'user', content: validatePrompt },
    ])
    content = validateMetrics.text || '{}'
  } catch (fetchError) {
    await db.insert(generationLogs).values({
      novelId,
      chapterId: null,
      stage: 'power_level_validate',
      modelId: detectionConfig.modelId,
      status: 'error',
      errorMsg: (fetchError as Error).message,
      createdAt: Math.floor(Date.now() / 1000),
    }).catch(() => {})
    throw fetchError
  }

  let validated: Record<string, unknown> = {}
  try {
    validated = JSON.parse(content)
  } catch {
    return c.json({ error: 'LLM 返回格式解析失败', rawContent: content.slice(0, 500) }, 500)
  }

  const assessedLevel = {
    system: (validated.assessedSystem as string) || dbPowerLevel?.system || '未知体系',
    current: (validated.assessedCurrent as string) || '未知',
  }

  const isConsistent = validated.isConsistent === true ||
    (!!dbPowerLevel && dbPowerLevel.current === assessedLevel.current && dbPowerLevel.system === assessedLevel.system)

  if (validateMetrics) {
    await db.insert(generationLogs).values({
      novelId,
      chapterId: null,
      stage: 'power_level_validate',
      modelId: validateMetrics.modelId,
      promptTokens: validateMetrics.usage.prompt_tokens,
      completionTokens: validateMetrics.usage.completion_tokens,
      durationMs: validateMetrics.durationMs,
      status: 'success',
      contextSnapshot: JSON.stringify({
        characterId,
        characterName: charRow.name,
        isConsistent,
        analyzedChapters: recentChapters.length,
      }),
    }).catch(() => {})
  }

  return c.json({
    ok: true,
    characterId,
    characterName: charRow.name,
    isConsistent,
    dbLevel: dbPowerLevel,
    assessedLevel,
    confidence: validated.confidence || 'low',
    reasoning: (validated.reasoning as string) || '',
    suggestion: (validated.suggestion as string) || assessedLevel.current,
    analyzedChapters: recentChapters.length,
  })
})

router.post('/apply-suggestion', zValidator('json', ApplySuggestionSchema), async (c) => {
  const { characterId, novelId, suggestedCurrent, suggestedSystem, note } = c.req.valid('json')
  const db = drizzle(c.env.DB)

  const charRow = await db
    .select({ id: characters.id, name: characters.name, powerLevel: characters.powerLevel })
    .from(characters)
    .where(eq(characters.id, characterId))
    .get()

  if (!charRow) {
    return c.json({ error: '角色不存在' }, 404)
  }

  let existingData: Record<string, unknown> = { system: '', current: '', breakthroughs: [] }
  if (charRow.powerLevel) {
    try { existingData = JSON.parse(charRow.powerLevel) } catch {}
  }

  const previousCurrent = (existingData.current as string) || ''
  const updatedData: Record<string, unknown> = {
    ...existingData,
    system: suggestedSystem || (existingData.system as string) || '未知体系',
    current: suggestedCurrent,
  }

  if (previousCurrent && previousCurrent !== suggestedCurrent) {
    const breakthroughs = Array.isArray(existingData.breakthroughs) ? [...existingData.breakthroughs] : []
    breakthroughs.push({
      chapterId: 'manual-validation',
      from: previousCurrent,
      to: suggestedCurrent,
      note: note || '基于校验结果手动更新',
      timestamp: Date.now(),
    })
    updatedData.breakthroughs = breakthroughs
  }

  await db
    .update(characters)
    .set({ powerLevel: JSON.stringify(updatedData) })
    .where(eq(characters.id, characterId))

  return c.json({
    ok: true,
    characterId,
    characterName: charRow.name,
    previousLevel: previousCurrent || '无',
    newLevel: suggestedCurrent,
  })
})

export { router as powerLevel }
