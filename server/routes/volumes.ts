/**
 * @file volumes.ts
 * @description 卷管理路由模块，提供卷的CRUD操作
 * @version 1.0.0
 * @modified 2026-04-21 - 添加规范化注释
 */
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { drizzle } from 'drizzle-orm/d1'
import { volumes as t } from '../db/schema'
import { eq } from 'drizzle-orm'
import type { Env } from '../lib/types'

/**
 * 异步执行任务（不阻塞主流程）
 * @param {any} c - Hono上下文对象
 * @param {Promise<void> | void} fn - 要异步执行的函数
 */
async function safeWaitUntil(c: any, fn: Promise<void> | void) {
  const ctx = (c as any).executionContext
  if (ctx?.waitUntil) {
    ctx.waitUntil(Promise.resolve(fn).catch((e) => console.warn('Async task failed:', e)))
  } else {
    Promise.resolve(fn).catch((e) => console.warn('Async task failed:', e))
  }
}

const router = new Hono<{ Bindings: Env }>()

const CreateSchema = z.object({
  novelId: z.string(),
  title: z.string(),
  sortOrder: z.number().optional(),
  outline: z.string().optional().nullable(),
  blueprint: z.string().optional().nullable(),
  summary: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  status: z.string().optional(),
  targetWordCount: z.number().optional().nullable(),
})

/**
 * GET / - 获取卷列表
 * @description 获取指定小说的所有卷，按排序顺序返回
 * @param {string} novelId - 小说ID（查询参数）
 * @returns {Array} 卷数组
 * @throws {400} 缺少novelId参数
 */
router.get('/', async (c) => {
  const novelId = c.req.query('novelId')
  if (!novelId) return c.json({ error: 'novelId required' }, 400)
  const db = drizzle(c.env.DB)
  const rows = await db.select().from(t)
    .where(eq(t.novelId, novelId))
    .orderBy(t.sortOrder)
  return c.json(rows)
})

/**
 * GET /:id - 获取单个卷详情
 * @param {string} id - 卷ID
 * @returns {Object} 卷对象
 * @throws {404} 卷不存在
 */
router.get('/:id', async (c) => {
  const db = drizzle(c.env.DB)
  const row = await db.select().from(t).where(eq(t.id, c.req.param('id'))).get()
  if (!row) return c.json({ error: 'Not found' }, 404)
  return c.json(row)
})

/**
 * POST / - 创建新卷
 * @param {string} novelId - 所属小说ID
 * @param {string} title - 卷标题
 * @param {number} [sortOrder] - 排序顺序
 * @returns {Object} 创建的卷对象
 */
router.post('/', zValidator('json', CreateSchema), async (c) => {
  const db = drizzle(c.env.DB)
  const [row] = await db.insert(t).values(c.req.valid('json')).returning()
  return c.json(row, 201)
})

/**
 * PATCH /:id - 更新卷信息
 * @param {string} id - 卷ID
 * @param {Object} body - 更新内容
 * @returns {Object} 更新后的卷对象
 */
router.patch('/:id', zValidator('json', CreateSchema.partial()), async (c) => {
  const db = drizzle(c.env.DB)
  const [row] = await db.update(t)
    .set(c.req.valid('json'))
    .where(eq(t.id, c.req.param('id')))
    .returning()
  return c.json(row)
})

/**
 * DELETE /:id - 删除卷
 * @param {string} id - 卷ID
 * @returns {Object} { ok: boolean }
 */
router.delete('/:id', async (c) => {
  const db = drizzle(c.env.DB)
  await db.delete(t).where(eq(t.id, c.req.param('id')))
  return c.json({ ok: true })
})

export { router as volumes }
