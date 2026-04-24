/**
 * @file foreshadowing.ts
 * @description 伏笔管理路由模块，提供伏笔的CRUD操作、状态管理、推进追踪、健康检查和RAG推荐
 * @version 2.0.0 - 全环节增强：progress/stale/check/suggest/stats
 */
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { drizzle } from 'drizzle-orm/d1'
import { foreshadowing, foreshadowingProgress, chapters } from '../db/schema'
import { eq, and, desc, sql, count, isNull, inArray } from 'drizzle-orm'
import type { Env } from '../lib/types'
import { enqueue } from '../lib/queue'
import { deindexContent } from '../services/embedding'
import {
  checkForeshadowingHealth,
  suggestForeshadowingForChapter,
} from '../services/foreshadowing'

const router = new Hono<{ Bindings: Env }>()

const CreateForeshadowingSchema = z.object({
  novelId: z.string().min(1),
  chapterId: z.string().optional(),
  title: z.string().min(1).max(100),
  description: z.string().max(1000).optional(),
  importance: z.enum(['high', 'normal', 'low']).default('normal'),
})

const UpdateForeshadowingSchema = z.object({
  title: z.string().min(1).max(100).optional(),
  description: z.string().max(1000).optional(),
  importance: z.enum(['high', 'normal', 'low']).optional(),
  status: z.enum(['open', 'resolved', 'abandoned']).optional(),
  resolvedChapterId: z.string().optional(),
})

/**
 * POST / - 创建新伏笔
 */
router.post('/', zValidator('json', CreateForeshadowingSchema), async (c) => {
  const body = c.req.valid('json')
  const db = drizzle(c.env.DB)

  try {
    const newForeshadowing = await db.insert(foreshadowing).values({
      novelId: body.novelId,
      chapterId: body.chapterId,
      title: body.title,
      description: body.description,
      importance: body.importance,
      status: 'open',
    }).returning().get()

    if (c.env.VECTORIZE && newForeshadowing.description) {
      await enqueue(c.env, {
        type: 'index_content',
        payload: {
          sourceType: 'foreshadowing',
          sourceId: newForeshadowing.id,
          novelId: newForeshadowing.novelId,
          title: newForeshadowing.title,
          content: newForeshadowing.description,
          extraMetadata: { importance: newForeshadowing.importance },
        },
      })
    }

    return c.json({ ok: true, foreshadowing: newForeshadowing }, 201)
  } catch (error) {
    console.error('Failed to create foreshadowing:', error)
    return c.json({ error: '创建伏笔失败', details: (error as Error).message }, 500)
  }
})

/**
 * PUT /:id - 更新伏笔信息
 */
router.put('/:id', zValidator('json', UpdateForeshadowingSchema), async (c) => {
  const id = c.req.param('id')
  const body = c.req.valid('json')
  const db = drizzle(c.env.DB)

  try {
    const existing = await db.select().from(foreshadowing).where(eq(foreshadowing.id, id)).get()
    if (!existing) {
      return c.json({ error: '伏笔不存在' }, 404)
    }

    const updateData: Record<string, unknown> = {}
    if (body.title !== undefined) updateData.title = body.title
    if (body.description !== undefined) updateData.description = body.description
    if (body.importance !== undefined) updateData.importance = body.importance
    if (body.status !== undefined) {
      if (body.status === 'resolved' && !body.resolvedChapterId) {
        return c.json({ error: '解决伏笔时必须提供收尾章节ID' }, 400)
      }
      updateData.status = body.status
      if (body.status === 'resolved' && body.resolvedChapterId) {
        updateData.resolvedChapterId = body.resolvedChapterId
      }
    }

    const updated = await db
      .update(foreshadowing)
      .set(updateData)
      .where(eq(foreshadowing.id, id))
      .returning()
      .get()

    if (c.env.VECTORIZE && body.description !== undefined && updated.description) {
      await enqueue(c.env, {
        type: 'index_content',
        payload: {
          sourceType: 'foreshadowing',
          sourceId: updated.id,
          novelId: updated.novelId,
          title: updated.title,
          content: updated.description,
          extraMetadata: { importance: updated.importance },
        },
      })
    }

    return c.json({ ok: true, foreshadowing: updated })
  } catch (error) {
    console.error('Failed to update foreshadowing:', error)
    return c.json({ error: '更新伏笔失败', details: (error as Error).message }, 500)
  }
})

/**
 * DELETE /:id - 删除伏笔（软删除）
 */
router.delete('/:id', async (c) => {
  const id = c.req.param('id')
  const db = drizzle(c.env.DB)

  try {
    if (c.env.VECTORIZE) {
      deindexContent(c.env, 'foreshadowing', id).then(() => {}).catch(e => console.warn('Foreshadowing deindex failed:', e))
    }

    await db
      .update(foreshadowing)
      .set({ deletedAt: Math.floor(Date.now() / 1000) })
      .where(eq(foreshadowing.id, id))

    return c.json({ ok: true })
  } catch (error) {
    console.error('Failed to delete foreshadowing:', error)
    return c.json({ error: '删除伏笔失败', details: (error as Error).message }, 500)
  }
})

/**
 * GET /:id/progress - 获取某伏笔的全部推进时间线
 */
router.get('/:id/progress', async (c) => {
  const id = c.req.param('id')
  const db = drizzle(c.env.DB)

  try {
    const exists = await db.select({ id: foreshadowing.id }).from(foreshadowing).where(eq(foreshadowing.id, id)).get()
    if (!exists) {
      return c.json({ error: '伏笔不存在' }, 404)
    }

    const progresses = await db
      .select({
        id: foreshadowingProgress.id,
        chapterId: foreshadowingProgress.chapterId,
        progressType: foreshadowingProgress.progressType,
        summary: foreshadowingProgress.summary,
        createdAt: foreshadowingProgress.createdAt,
      })
      .from(foreshadowingProgress)
      .where(eq(foreshadowingProgress.foreshadowingId, id))
      .orderBy(asc(foreshadowingProgress.createdAt))
      .all()

    const chapterIds = [...new Set(progresses.map(p => p.chapterId))]
    const chapterMap = new Map<string, string>()
    if (chapterIds.length > 0) {
      const chapterRows = await db
        .select({ id: chapters.id, title: chapters.title })
        .from(chapters)
        .where(inArray(chapters.id, chapterIds))
        .all()
      chapterRows.forEach(ch => chapterMap.set(ch.id, ch.title))
    }

    return c.json({
      progresses: progresses.map(p => ({
        ...p,
        chapterTitle: chapterMap.get(p.chapterId) || '未知章节',
      })),
    })
  } catch (error) {
    console.error('Failed to get foreshadowing progress:', error)
    return c.json({ error: '获取推进记录失败', details: (error as Error).message }, 500)
  }
})

function asc(col: any) {
  return { asc: col } as any
}

/**
 * GET /:novelId/stale - 获取可能遗忘的伏笔（N章无推进）
 */
router.get('/:novelId/stale', zValidator('query', z.object({
  threshold: z.coerce.number().optional().default(10),
})), async (c) => {
  const novelId = c.req.param('novelId')
  const { threshold } = c.req.valid('query')
  const db = drizzle(c.env.DB)

  try {
    const recentChapters = await db
      .select({ id: chapters.id, sortOrder: chapters.sortOrder })
      .from(chapters)
      .where(and(eq(chapters.novelId, novelId), isNull(chapters.deletedAt)))
      .orderBy(desc(chapters.sortOrder))
      .limit(threshold)
      .all()

    const recentChapterIds = recentChapters.map(c => c.id)

    const allOpen = await db
      .select({
        id: foreshadowing.id,
        title: foreshadowing.title,
        description: foreshadowing.description,
        importance: foreshadowing.importance,
        status: foreshadowing.status,
        chapterId: foreshadowing.chapterId,
        createdAt: foreshadowing.createdAt,
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

    const staleItems = []

    for (const fs of allOpen) {
      let hasRecentProgress: { count: number } | null = null
      if (recentChapterIds.length > 0) {
        const placeholders = recentChapterIds.map(() => '?').join(',')
        const result = await c.env.DB
          .prepare(`SELECT COUNT(*) as count FROM foreshadowing_progress WHERE foreshadowing_id = ? AND chapter_id IN (${placeholders})`)
          .bind(fs.id, ...recentChapterIds)
          .first<{ count: number }>()
        hasRecentProgress = result
      } else {
        const result = await c.env.DB
          .prepare(`SELECT COUNT(*) as count FROM foreshadowing_progress WHERE foreshadowing_id = ?`)
          .bind(fs.id)
          .first<{ count: number }>()
        hasRecentProgress = result
      }

      if ((hasRecentProgress?.count ?? 0) === 0) {
        staleItems.push(fs)
      }
    }

    staleItems.sort((a, b) => {
      const order = { high: 0, normal: 1, low: 2 }
      return (order[a.importance as keyof typeof order] ?? 1) - (order[b.importance as keyof typeof order] ?? 1)
    })

    return c.json({ foreshadowing: staleItems, threshold })
  } catch (error) {
    console.error('Failed to get stale foreshadowing:', error)
    return c.json({ error: '获取沉寂伏笔失败', details: (error as Error).message }, 500)
  }
})

/**
 * POST /:novelId/check - 伏笔健康检查
 */
router.post('/:novelId/check', zValidator('json', z.object({
  recentChaptersCount: z.coerce.number().optional(),
  staleThreshold: z.coerce.number().optional(),
}).optional().default({})), async (c) => {
  const novelId = c.req.param('novelId')
  const options = c.req.valid('json')

  try {
    const report = await checkForeshadowingHealth(c.env, novelId, {
      recentChaptersCount: options.recentChaptersCount,
      staleThreshold: options.staleThreshold,
    })
    return c.json(report)
  } catch (error) {
    console.error('Foreshadowing health check failed:', error)
    return c.json({ error: '健康检查失败', details: (error as Error).message }, 500)
  }
})

/**
 * POST /:novelId/suggest - 基于场景推荐应处理的伏笔
 */
router.post('/:novelId/suggest', zValidator('json', z.object({
  chapterContext: z.string().min(5),
  topK: z.coerce.number().optional().default(5),
})), async (c) => {
  const novelId = c.req.param('novelId')
  const { chapterContext, topK } = c.req.valid('json')

  try {
    const suggestions = await suggestForeshadowingForChapter(c.env, novelId, chapterContext)
    return c.json({ suggestions: suggestions.slice(0, topK), query: chapterContext.slice(0, 200) })
  } catch (error) {
    console.error('Foreshadowing suggestion failed:', error)
    return c.json({ error: '推荐失败', details: (error as Error).message }, 500)
  }
})

/**
 * GET /:novelId/stats - 伏笔统计数据
 */
router.get('/:novelId/stats', async (c) => {
  const novelId = c.req.param('novelId')
  const db = drizzle(c.env.DB)

  try {
    const totalResult = await db
      .select({
        status: foreshadowing.status,
        count: count(),
      })
      .from(foreshadowing)
      .where(and(eq(foreshadowing.novelId, novelId), isNull(foreshadowing.deletedAt)))
      .groupBy(foreshadowing.status)
      .all()

    const statusMap = new Map<string, number>()
    totalResult.forEach(r => statusMap.set(r.status!, r.count))
    const total = Array.from(statusMap.values()).reduce((a, b) => a + b, 0)
    const resolved = statusMap.get('resolved') || 0
    const abandoned = statusMap.get('abandoned') || 0

    const byImportanceRaw = await db
      .select({
        importance: foreshadowing.importance,
        status: foreshadowing.status,
        count: count(),
      })
      .from(foreshadowing)
      .where(and(eq(foreshadowing.novelId, novelId), isNull(foreshadowing.deletedAt)))
      .groupBy(foreshadowing.importance, foreshadowing.status)
      .all()

    const byImportance: Record<string, { total: number; open: number; resolved: number }> = {}
    for (const row of byImportanceRaw) {
      const imp = row.importance || 'unknown'
      if (!byImportance[imp]) byImportance[imp] = { total: 0, open: 0, resolved: 0 }
      byImportance[imp].total += row.count
      if (row.status === 'open') byImportance[imp].open += row.count
      if (row.status === 'resolved') byImportance[imp].resolved += row.count
    }

    const allOpenWithAge = await db
      .select({
        id: foreshadowing.id,
        createdAt: foreshadowing.createdAt,
        resolvedAt: sql<number>`coalesce(
          (SELECT ${foreshadowing.updatedAt} FROM ${foreshadowing} AS f_res
           WHERE f_res.id = ${foreshadowing.id} AND f_res.status = 'resolved'),
          0
        )`.as('resolved_at'),
      })
      .from(foreshadowing)
      .where(and(eq(foreshadowing.novelId, novelId), isNull(foreshadowing.deletedAt)))
      .all()

    const now = Math.floor(Date.now() / 1000)
    const ageBuckets: Record<string, { count: number; ids: string[] }> = {
      '1-3章': { count: 0, ids: [] },
      '4-10章': { count: 0, ids: [] },
      '11-20章': { count: 0, ids: [] },
      '20章+': { count: 0, ids: [] },
    }

    let totalLifespanSum = 0
    let resolvedCountForAvg = 0

    for (const item of allOpenWithAge) {
      const lifespan = item.resolvedAt > 0 ? item.resolvedAt - item.createdAt : now - item.createdAt
      const approxChapters = Math.max(1, Math.floor(lifespan / 864000))

      if (item.resolvedAt > 0) {
        totalLifespanSum += approxChapters
        resolvedCountForAvg++
      }

      if (approxChapters <= 3) {
        ageBuckets['1-3章'].count++
        ageBuckets['1-3章'].ids.push(item.id)
      } else if (approxChapters <= 10) {
        ageBuckets['4-10章'].count++
        ageBuckets['4-10章'].ids.push(item.id)
      } else if (approxChapters <= 20) {
        ageBuckets['11-20章'].count++
        ageBuckets['11-20章'].ids.push(item.id)
      } else {
        ageBuckets['20章+'].count++
        ageBuckets['20章+'].ids.push(item.id)
      }
    }

    const hotChaptersRaw = await db
      .select({
        chapterId: foreshadowing.chapterId,
        planted: count(sql`CASE WHEN ${foreshadowing.status} != 'abandoned' THEN 1 END`),
        resolved: count(sql`CASE WHEN ${foreshadowing.status} = 'resolved' THEN 1 END`),
      })
      .from(foreshadowing)
      .where(and(
        eq(foreshadowing.novelId, novelId),
        isNull(foreshadowing.deletedAt),
        sql`${foreshadowing.chapterId} IS NOT NULL`
      ))
      .groupBy(foreshadowing.chapterId)
      .orderBy(desc(count(sql`CASE WHEN ${foreshadowing.status} != 'abandoned' THEN 1 END`)), desc(count(sql`CASE WHEN ${foreshadowing.status} = 'resolved' THEN 1 END`)))
      .limit(5)
      .all()

    const hotChapterIds = hotChaptersRaw.map(h => h.chapterId).filter((id): id is string => id !== null)
    const chapterTitles = new Map<string, string>()
    if (hotChapterIds.length > 0) {
      const chRows = await db
        .select({ id: chapters.id, title: chapters.title })
        .from(chapters)
        .where(inArray(chapters.id, hotChapterIds))
        .all()
      chRows.forEach(ch => chapterTitles.set(ch.id, ch.title))
    }

    const progressedCounts = new Map<string, number>()
    if (hotChapterIds.length > 0) {
      const progCounts = await db
        .select({
          chapterId: foreshadowingProgress.chapterId,
          cnt: count(),
        })
        .from(foreshadowingProgress)
        .where(inArray(foreshadowingProgress.chapterId, hotChapterIds))
        .groupBy(foreshadowingProgress.chapterId)
        .all()
      progCounts.forEach(p => progressedCounts.set(p.chapterId, p.cnt))
    }

    const hotChapters = hotChaptersRaw.map(h => ({
      chapterId: h.chapterId!,
      chapterTitle: chapterTitles.get(h.chapterId!) || '未知章节',
      plantedCount: Number(h.planted),
      resolvedCount: Number(h.resolved),
      progressedCount: progressedCounts.get(h.chapterId!) || 0,
    }))

    return c.json({
      overview: {
        total,
        open: statusMap.get('open') || 0,
        resolved,
        abandoned,
        resolutionRate: (resolved + abandoned) > 0 ? Math.round((resolved / (resolved + abandoned)) * 100) : 0,
        avgLifespan: resolvedCountForAvg > 0 ? Math.round(totalLifespanSum / resolvedCountForAvg) : 0,
      },
      byImportance,
      byAge: Object.entries(ageBuckets).map(([range, data]) => ({ range, ...data })),
      hotChapters,
    })
  } catch (error) {
    console.error('Failed to get foreshadowing stats:', error)
    return c.json({ error: '获取统计数据失败', details: (error as Error).message }, 500)
  }
})

/**
 * GET /:novelId - 获取小说的所有伏笔
 */
router.get('/:novelId', zValidator('query', z.object({
  status: z.enum(['open', 'resolved', 'abandoned']).optional(),
  limit: z.coerce.number().optional().default(50),
})), async (c) => {
  const novelId = c.req.param('novelId')
  const { status, limit } = c.req.valid('query')
  const db = drizzle(c.env.DB)

  const conditions = [
    eq(foreshadowing.novelId, novelId),
    sql`${foreshadowing.deletedAt} IS NULL`
  ]

  if (status) {
    conditions.push(eq(foreshadowing.status, status))
  }

  const list = await db
    .select()
    .from(foreshadowing)
    .where(and(...conditions))
    .orderBy(desc(foreshadowing.createdAt))
    .limit(limit)
    .all()

  return c.json({ foreshadowing: list })
})

export { router as foreshadowing }
