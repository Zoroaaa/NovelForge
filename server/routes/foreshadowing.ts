/**
 * @file foreshadowing.ts
 * @description 伏笔管理路由模块，提供伏笔的CRUD操作和状态管理
 * @version 1.0.0
 * @modified 2026-04-21 - 添加规范化注释
 */
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { drizzle } from 'drizzle-orm/d1'
import { foreshadowing } from '../db/schema'
import { eq, and, desc, sql } from 'drizzle-orm'
import type { Env } from '../lib/types'
import { enqueue } from '../lib/queue'
import { deindexContent } from '../services/embedding'

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
 * GET /:novelId - 获取小说的所有伏笔
 * @description 获取指定小说的伏笔列表，支持按状态筛选
 * @param {string} novelId - 小说ID
 * @param {string} [status] - 状态过滤：open | resolved | abandoned
 * @param {number} [limit=50] - 返回数量限制
 * @returns {Object} { foreshadowing: Array }
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

/**
 * POST / - 创建新伏笔
 * @param {string} novelId - 小说ID
 * @param {string} [chapterId] - 章节ID
 * @param {string} title - 伏笔标题（1-100字符）
 * @param {string} [description] - 伏笔描述
 * @param {string} [importance='normal'] - 重要程度：high | normal | low
 * @returns {Object} { ok: boolean, foreshadowing: Object }
 * @throws {500} 创建失败
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
      await enqueue(c.env, c, {
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
 * @param {string} id - 伏笔ID
 * @param {string} [title] - 伏笔标题
 * @param {string} [description] - 伏笔描述
 * @param {string} [importance] - 重要程度
 * @param {string} [status] - 状态：open | resolved | abandoned
 * @param {string} [resolvedChapterId] - 收尾章节ID
 * @returns {Object} { ok: boolean, foreshadowing: Object }
 * @throws {404} 伏笔不存在
 * @throws {500} 更新失败
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
      await enqueue(c.env, c, {
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
 * @param {string} id - 伏笔ID
 * @returns {Object} { ok: boolean }
 * @throws {500} 删除失败
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

export { router as foreshadowing }
