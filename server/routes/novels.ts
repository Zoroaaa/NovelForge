/**
 * @file novels.ts
 * @description 小说管理路由模块，提供小说CRUD、封面上传等功能
 * @version 1.0.0
 * @modified 2026-04-21 - 添加规范化注释
 */
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { drizzle } from 'drizzle-orm/d1'
import { novels as t } from '../db/schema'
import { eq, isNull, desc, and, sql } from 'drizzle-orm'
import type { Env } from '../lib/types'

const router = new Hono<{ Bindings: Env }>()

const CreateSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().optional(),
  genre: z.string().optional(),
  status: z.enum(['draft', 'writing', 'completed', 'archived']).optional(),
})

/**
 * GET / - 获取小说列表（支持分页和过滤）
 * @description 获取所有未删除的小说，按更新时间倒序排列
 * @query {number} [page=1] - 页码
 * @query {number} [perPage=20] - 每页数量（1-100）
 * @query {string} [status] - 状态过滤：draft | writing | completed | archived
 * @query {string} [genre] - 类型过滤
 * @returns {Object} { data: Array, total: number, page: number, perPage: number }
 */
router.get('/', zValidator('query', z.object({
  page: z.coerce.number().min(1).default(1),
  perPage: z.coerce.number().min(1).max(100).default(20),
  status: z.enum(['draft', 'writing', 'completed', 'archived']).optional(),
  genre: z.string().optional(),
})), async (c) => {
  const { page, perPage, status, genre } = c.req.valid('query')
  const db = drizzle(c.env.DB)
  const offset = (page - 1) * perPage

  const validConditions = [
    isNull(t.deletedAt),
    status ? eq(t.status, status) : undefined,
    genre ? eq(t.genre, genre) : undefined,
  ].filter((c): c is Exclude<typeof c, undefined> => Boolean(c))

  const rows = await db.select()
    .from(t)
    .where(and(...validConditions))
    .orderBy(desc(t.updatedAt))
    .limit(perPage)
    .offset(offset)

  const countResult = await db.select({ count: sql`count(*)` })
    .from(t)
    .where(isNull(t.deletedAt))
    .get()

  return c.json({
    data: rows,
    total: Number(countResult?.count ?? 0),
    page,
    perPage,
  })
})

/**
 * GET /:id - 获取单个小说详情
 * @param {string} id - 小说ID
 * @returns {Object} 小说对象
 * @throws {404} 小说不存在
 */
router.get('/:id', async (c) => {
  const db = drizzle(c.env.DB)
  const row = await db.select().from(t).where(eq(t.id, c.req.param('id'))).get()
  if (!row || row.deletedAt) return c.json({ error: 'Not found' }, 404)
  return c.json(row)
})

/**
 * POST / - 创建新小说
 * @param {string} title - 小说标题（必填，1-200字符）
 * @param {string} [description] - 小说简介
 * @param {string} [genre] - 小说类型
 * @returns {Object} 创建的小说对象
 */
router.post('/', zValidator('json', CreateSchema), async (c) => {
  const db = drizzle(c.env.DB)
  const [row] = await db.insert(t).values(c.req.valid('json')).returning()
  return c.json(row, 201)
})

/**
 * PATCH /:id - 更新小说信息
 * @param {string} id - 小说ID
 * @param {Object} body - 更新内容
 * @returns {Object} 更新后的小说对象
 */
router.patch('/:id', zValidator('json', CreateSchema.partial()), async (c) => {
  const db = drizzle(c.env.DB)
  const [row] = await db.update(t)
    .set({ ...c.req.valid('json'), updatedAt: sql`(unixepoch())` })
    .where(eq(t.id, c.req.param('id')))
    .returning()
  return c.json(row)
})

/**
 * DELETE /:id - 删除小说（软删除）
 * @param {string} id - 小说ID
 * @returns {Object} { ok: boolean }
 */
router.delete('/:id', async (c) => {
  const db = drizzle(c.env.DB)
  await db.update(t)
    .set({ deletedAt: sql`(unixepoch())` })
    .where(eq(t.id, c.req.param('id')))
  return c.json({ ok: true })
})

/**
 * POST /:id/cover - 上传小说封面
 * @description 上传封面图片到R2存储，自动删除旧封面
 * @param {string} id - 小说ID
 * @param {File} body - 图片文件（Content-Type: image/*）
 * @returns {Object} { ok: boolean, coverUrl: string }
 * @throws {400} 非图片文件
 */
router.post('/:id/cover', async (c) => {
  const id = c.req.param('id')
  const db = drizzle(c.env.DB)

  const contentType = c.req.header('content-type') || ''
  if (!contentType.includes('image/')) {
    return c.json({ error: 'Only image files are allowed' }, 400)
  }

  const body = await c.req.arrayBuffer()
  const key = `covers/${id}/${Date.now()}.jpg`

  await c.env.STORAGE.put(key, body, { httpMetadata: { contentType } })

  const novel = await db.select({ coverR2Key: t.coverR2Key }).from(t).where(eq(t.id, id)).get()

  if (novel?.coverR2Key) {
    try { await c.env.STORAGE.delete(novel.coverR2Key) } catch {}
  }

  await db.update(t).set({ coverR2Key: key, updatedAt: sql`(unixepoch())` }).where(eq(t.id, id))

  return c.json({ ok: true, coverUrl: `/api/novels/${id}/cover` })
})

/**
 * GET /:id/cover - 获取小说封面
 * @description 从R2存储获取封面图片
 * @param {string} id - 小说ID
 * @returns {Blob} 封面图片二进制数据
 * @throws {404} 封面不存在
 */
router.get('/:id/cover', async (c) => {
  const id = c.req.param('id')
  const db = drizzle(c.env.DB)

  const novel = await db.select({ coverR2Key: t.coverR2Key }).from(t).where(eq(t.id, id)).get()
  if (!novel?.coverR2Key) return c.json({ error: 'No cover' }, 404)

  const obj = await c.env.STORAGE.get(novel.coverR2Key)
  if (!obj) return c.json({ error: 'Cover not found' }, 404)

  const blob = await obj.arrayBuffer()
  return c.body(blob, 200, {
    'Content-Type': obj.httpMetadata?.contentType || 'image/jpeg',
    'Cache-Control': 'public, max-age=31536000',
  })
})

export { router as novels }
