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

    await db.insert(generationLogs).values({
      novelId,
      chapterId,
      stage: 'power_level_detect',
      modelId: 'analysis',
      status: result.hasBreakthrough ? 'success' : 'success',
      contextSnapshot: JSON.stringify(result),
      durationMs: 0,
      createdAt: Math.floor(Date.now() / 1000),
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

      await db.insert(generationLogs).values({
        novelId,
        chapterId: chapter.id,
        stage: 'power_level_detect',
        modelId: 'analysis',
        status: 'success',
        contextSnapshot: JSON.stringify({
          hasBreakthrough: result.hasBreakthrough,
          updatesCount: result.updates.length,
        }),
        durationMs: 0,
        createdAt: Math.floor(Date.now() / 1000),
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

export { router as powerLevel }
