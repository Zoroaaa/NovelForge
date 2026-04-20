/**
 * NovelForge · 创作规则路由（v2.0）
 *
 * API 端点：
 * GET    /api/v1/rules/:novelId              - 获取所有规则
 * POST   /api/v1/rules                      - 创建新规则
 * PUT    /api/v1/rules/:id                  - 更新规则
 * DELETE /api/v1/rules/:id                  - 删除规则
 * PATCH  /api/v1/rules/:id/toggle            - 启用/禁用规则
 */

import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { drizzle } from 'drizzle-orm/d1'
import { writingRules } from '../db/schema'
import { eq, and, desc } from 'drizzle-orm'
import type { Env } from '../lib/types'

const router = new Hono<{ Bindings: Env }>()

const CreateRuleSchema = z.object({
  novelId: z.string().min(1),
  category: z.enum(['style', 'pacing', 'character', 'plot', 'world', 'taboo', 'custom']),
  title: z.string().min(1).max(100),
  content: z.string().min(1),
  priority: z.number().min(1).max(5).default(3),
  sortOrder: z.number().default(0),
})

const UpdateRuleSchema = z.object({
  category: z.enum(['style', 'pacing', 'character', 'plot', 'world', 'taboo', 'custom']).optional(),
  title: z.string().min(1).max(100).optional(),
  content: z.string().min(1).optional(),
  priority: z.number().min(1).max(5).optional(),
  sortOrder: z.number().optional(),
  isActive: z.number().min(0).max(1).optional(),
})

/**
 * GET /rules/:novelId
 */
router.get('/:novelId', zValidator('query', z.object({
  category: z.enum(['style', 'pacing', 'character', 'plot', 'world', 'taboo', 'custom']).optional(),
  activeOnly: z.coerce.boolean().optional().default(false),
})), async (c) => {
  const novelId = c.req.param('novelId')
  const { category, activeOnly } = c.req.valid('query')
  const db = drizzle(c.env.DB)

  let query = db.select()
    .from(writingRules)
    .where(and(
      eq(writingRules.novelId, novelId),
      sql`${writingRules.deletedAt} IS NULL`
    ))

  if (category) {
    query = query.where(eq(writingRules.category, category)) as any
  }
  if (activeOnly) {
    query = query.where(eq(writingRules.isActive, 1)) as any
  }

  const rules = await query
    .orderBy(writingRules.priority, writingRules.sortOrder)
    .all()

  return c.json({ rules })
})

/**
 * POST /rules
 */
router.post('/', zValidator('json', CreateRuleSchema), async (c) => {
  const body = c.req.valid('json')
  const db = drizzle(c.env.DB)

  try {
    const newRule = await db.insert(writingRules).values({
      novelId: body.novelId,
      category: body.category,
      title: body.title,
      content: body.content,
      priority: body.priority,
      sortOrder: body.sortOrder,
    }).returning().get()

    return c.json({ ok: true, rule: newRule }, 201)
  } catch (error) {
    console.error('Failed to create rule:', error)
    return c.json({ error: '创建规则失败' }, 500)
  }
})

/**
 * PUT /rules/:id
 */
router.put('/:id', zValidator('json', UpdateRuleSchema), async (c) => {
  const id = c.req.param('id')
  const body = c.req.valid('json')
  const db = drizzle(c.env.DB)

  try {
    const updateData: any = {}
    if (body.category !== undefined) updateData.category = body.category
    if (body.title !== undefined) updateData.title = body.title
    if (body.content !== undefined) updateData.content = body.content
    if (body.priority !== undefined) updateData.priority = body.priority
    if (body.sortOrder !== undefined) updateData.sortOrder = body.sortOrder
    if (body.isActive !== undefined) updateData.isActive = body.isActive

    const updated = await db
      .update(writingRules)
      .set({ ...updateData, updatedAt: sql`(unixepoch())` })
      .where(eq(writingRules.id, id))
      .returning()
      .get()

    return c.json({ ok: true, rule: updated })
  } catch (error) {
    console.error('Failed to update rule:', error)
    return c.json({ error: '更新规则失败' }, 500)
  }
})

/**
 * DELETE /rules/:id
 */
router.delete('/:id', async (c) => {
  const id = c.req.param('id')
  const db = drizzle(c.env.DB)

  await db
    .update(writingRules)
    .set({ deletedAt: Math.floor(Date.now() / 1000) })
    .where(eq(writingRules.id, id))

  return c.json({ ok: true })
})

/**
 * PATCH /rules/:id/toggle
 */
router.patch('/:id/toggle', async (c) => {
  const id = c.req.param('id')
  const db = drizzle(c.env.DB)

  const rule = await db.select({ isActive: writingRules.isActive })
    .from(writingRules)
    .where(eq(writingRules.id, id))
    .get()

  if (!rule) {
    return c.json({ error: '规则不存在' }, 404)
  }

  const newStatus = rule.isActive === 1 ? 0 : 1

  await db
    .update(writingRules)
    .set({ isActive: newStatus, updatedAt: sql`(unixepoch())` })
    .where(eq(writingRules.id, id))

  return c.json({ ok: true, isActive: newStatus })
}

export { router as writingRulesRouter }
