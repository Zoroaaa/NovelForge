/**
 * @file writing-rules.ts
 * @description 创作规则路由模块，提供写作风格、禁忌等规则的CRUD操作
 * @version 2.0.0
 * @modified 2026-04-21 - 添加规范化注释
 */
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { drizzle } from 'drizzle-orm/d1'
import { writingRules } from '../db/schema'
import { eq, and, desc, sql } from 'drizzle-orm'
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
 * GET /:novelId - 获取所有创作规则
 * @description 获取指定小说的创作规则列表，支持分类和状态筛选
 * @param {string} novelId - 小说ID
 * @param {string} [category] - 规则分类：style | pacing | character | plot | world | taboo | custom
 * @param {boolean} [activeOnly=false] - 仅返回启用的规则
 * @returns {Object} { rules: Array }
 */
router.get('/:novelId', zValidator('query', z.object({
  category: z.enum(['style', 'pacing', 'character', 'plot', 'world', 'taboo', 'custom']).optional(),
  activeOnly: z.coerce.boolean().optional().default(false),
})), async (c) => {
  const novelId = c.req.param('novelId')
  const { category, activeOnly } = c.req.valid('query')
  const db = drizzle(c.env.DB)

  const conditions = [
    eq(writingRules.novelId, novelId),
    sql`${writingRules.deletedAt} IS NULL`
  ]

  if (category) {
    conditions.push(eq(writingRules.category, category))
  }
  if (activeOnly) {
    conditions.push(eq(writingRules.isActive, 1))
  }

  const rules = await db.select()
    .from(writingRules)
    .where(and(...conditions))
    .orderBy(writingRules.priority, writingRules.sortOrder)
    .all()

  return c.json({ rules })
})

/**
 * POST / - 创建新规则
 * @param {string} novelId - 小说ID
 * @param {string} category - 规则分类
 * @param {string} title - 规则标题（1-100字符）
 * @param {string} content - 规则内容
 * @param {number} [priority=3] - 优先级（1-5）
 * @param {number} [sortOrder=0] - 排序顺序
 * @returns {Object} { ok: boolean, rule: Object }
 * @throws {500} 创建失败
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
 * PUT /:id - 更新规则
 * @param {string} id - 规则ID
 * @param {Object} body - 更新内容
 * @returns {Object} { ok: boolean, rule: Object }
 * @throws {500} 更新失败
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
 * DELETE /:id - 删除规则（软删除）
 * @param {string} id - 规则ID
 * @returns {Object} { ok: boolean }
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
 * PATCH /:id/toggle - 启用/禁用规则
 * @description 切换规则的启用状态
 * @param {string} id - 规则ID
 * @returns {Object} { ok: boolean, isActive: number }
 * @throws {404} 规则不存在
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
})

export { router as writingRulesRouter }
