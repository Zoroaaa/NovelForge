/**
 * NovelForge · 伏笔管理路由（Phase 1.2）
 *
 * API 端点：
 * GET    /api/foreshadowing/:novelId          - 获取小说的所有伏笔
 * POST   /api/foreshadowing                    - 创建新伏笔
 * PUT    /api/foreshadowing/:id                - 更新伏笔
 * DELETE /api/foreshadowing/:id                - 删除伏笔
 * PATCH  /api/foreshadowing/:id/status         - 更新伏笔状态（收尾/放弃）
 */

import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { drizzle } from 'drizzle-orm/d1'
import { foreshadowing } from '../db/schema'
import { eq, and, desc } from 'drizzle-orm'
import type { Env } from '../lib/types'

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
 * GET /api/foreshadowing/:novelId
 *
 * 获取小说的所有伏笔（支持按状态筛选）
 */
router.get('/:novelId', zValidator('query', z.object({
  status: z.enum(['open', 'resolved', 'abandoned']).optional(),
  limit: z.coerce.number().optional().default(50),
})), async (c) => {
  const novelId = c.req.param('novelId')
  const { status, limit } = c.req.valid('query')
  const db = drizzle(c.env.DB)

  let query = db
    .select()
    .from(foreshadowing)
    .where(eq(foreshadowing.novelId, novelId))

  if (status) {
    query = query.where(and(eq(foreshadowing.novelId, novelId), eq(foreshadowing.status, status))) as any
  }

  const list = await query
    .orderBy(desc(foreshadowing.createdAt))
    .limit(limit)
    .all()

  return c.json({ foreshadowing: list })
})

/**
 * POST /api/foreshadowing
 *
 * 创建新伏笔
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

    return c.json({ ok: true, foreshadowing: newForeshadowing }, 201)
  } catch (error) {
    console.error('Failed to create foreshadowing:', error)
    return c.json({ error: '创建伏笔失败', details: (error as Error).message }, 500)
  }
})

/**
 * PUT /api/foreshadowing/:id
 *
 * 更新伏笔信息
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

    const updateData: any = {}
    if (body.title !== undefined) updateData.title = body.title
    if (body.description !== undefined) updateData.description = body.description
    if (body.importance !== undefined) updateData.importance = body.importance
    if (body.status !== undefined) {
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

    return c.json({ ok: true, foreshadowing: updated })
  } catch (error) {
    console.error('Failed to update foreshadowing:', error)
    return c.json({ error: '更新伏笔失败', details: (error as Error).message }, 500)
  }
})

/**
 * DELETE /api/foreshadowing/:id
 *
 * 删除伏笔（软删除）
 */
router.delete('/:id', async (c) => {
  const id = c.req.param('id')
  const db = drizzle(c.env.DB)

  try {
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

export { router as foreshadowing }
