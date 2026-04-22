/**
 * @file chapters.ts
 * @description 章节管理路由模块，提供章节CRUD、快照保存与恢复、自动向量化等功能
 * @version 1.0.0
 * @modified 2026-04-21 - 添加规范化注释
 */
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { drizzle } from 'drizzle-orm/d1'
import { chapters as t } from '../db/schema'
import { eq, and, isNull, sql } from 'drizzle-orm'
import type { Env } from '../lib/types'
import { enqueue } from '../lib/queue'
import { indexContent, deindexContent } from '../services/embedding'

const router = new Hono<{ Bindings: Env }>()

const MAX_SNAPSHOTS = 10

const CreateSchema = z.object({
  novelId: z.string(),
  volumeId: z.string().optional().nullable(),
  title: z.string(),
  sortOrder: z.number().optional(),
  content: z.string().optional().nullable(),
})

/**
 * GET / - 获取章节列表
 * @description 获取指定小说的所有章节，按排序顺序返回
 * @param {string} novelId - 小说ID（查询参数）
 * @returns {Array} 章节数组
 * @throws {400} 缺少novelId参数
 */
router.get('/', async (c) => {
  const novelId = c.req.query('novelId')
  if (!novelId) return c.json({ error: 'novelId required' }, 400)
  const db = drizzle(c.env.DB)
  const rows = await db.select().from(t)
    .where(and(eq(t.novelId, novelId), isNull(t.deletedAt)))
    .orderBy(t.sortOrder)
  return c.json(rows)
})

/**
 * GET /:id - 获取单个章节详情
 * @param {string} id - 章节ID
 * @returns {Object} 章节对象
 * @throws {404} 章节不存在
 */
router.get('/:id', async (c) => {
  const db = drizzle(c.env.DB)
  const row = await db.select().from(t).where(eq(t.id, c.req.param('id'))).get()
  if (!row || row.deletedAt) return c.json({ error: 'Not found' }, 404)
  return c.json(row)
})

/**
 * POST / - 创建新章节
 * @description 创建新章节并自动触发向量化索引
 * @param {string} novelId - 所属小说ID
 * @param {string} [volumeId] - 所属卷ID
 * @param {string} title - 章节标题
 * @param {number} [sortOrder] - 排序顺序
 * @param {string} [content] - 章节内容
 * @returns {Object} 创建的章节对象
 */
router.post('/', zValidator('json', CreateSchema), async (c) => {
  const db = drizzle(c.env.DB)
  const body = c.req.valid('json')
  const [row] = await db.insert(t).values(body).returning()

  if (c.env.VECTORIZE && row.content) {
    await enqueue(c.env, {
      type: 'index_content',
      payload: {
        sourceType: 'chapter',
        sourceId: row.id,
        novelId: row.novelId,
        title: row.title,
        content: row.content,
      },
    })
  }

  return c.json(row, 201)
})

/**
 * PATCH /:id - 更新章节
 * @description 更新章节内容，自动保存快照、更新字数统计、重新向量化
 * @param {string} id - 章节ID
 * @param {Object} body - 更新内容
 * @returns {Object} 更新后的章节对象
 */
router.patch(
  '/:id',
  zValidator(
    'json',
    CreateSchema.partial().extend({
      status: z.string().optional(),
      summary: z.string().optional(),
    })
  ),
  async (c) => {
    const db = drizzle(c.env.DB)
    const id = c.req.param('id')
    const body = c.req.valid('json')

    if (body.content) {
      (body as any).wordCount = body.content.length
    }

    const [row] = await db
      .update(t)
      .set({ ...body, updatedAt: sql`(unixepoch())` })
      .where(eq(t.id, id))
      .returning()

    if (body.content !== undefined && row) {
      if (c.env.VECTORIZE && body.content) {
        await enqueue(c.env, {
          type: 'index_content',
          payload: {
            sourceType: 'chapter',
            sourceId: row.id,
            novelId: row.novelId,
            title: row.title,
            content: body.content,
          },
        })
      }

      saveSnapshot(c.env, row.novelId, row.id, body.content ?? '').then(() => {}).catch(e => console.warn('Snapshot save failed:', e))
    }

    if (body.summary !== undefined && row && c.env.VECTORIZE && body.summary) {
      await enqueue(c.env, {
        type: 'index_content',
        payload: {
          sourceType: 'summary',
          sourceId: row.id,
          novelId: row.novelId,
          title: `${row.title} 摘要`,
          content: body.summary,
        },
      })
    }

    return c.json(row)
  }
)

/**
 * DELETE /:id - 删除章节（软删除）
 * @description 软删除章节，同时删除相关的向量索引
 * @param {string} id - 章节ID
 * @returns {Object} { ok: boolean }
 */
router.delete('/:id', async (c) => {
  const db = drizzle(c.env.DB)
  const id = c.req.param('id')

  // 删除向量索引（章节+摘要）
  if (c.env.VECTORIZE) {
    Promise.all([
      deindexContent(c.env, 'chapter', id),
      deindexContent(c.env, 'summary', id),
    ]).then(() => {}).catch(e => console.warn('Deindex failed:', e))
  }

  await db
    .update(t)
    .set({ deletedAt: Math.floor(Date.now() / 1000) })
    .where(eq(t.id, id))

  return c.json({ ok: true })
})

/**
 * GET /:id/snapshots - 获取章节快照列表
 * @description 获取章节的历史快照列表，用于版本恢复
 * @param {string} id - 章节ID
 * @returns {Object} { snapshots: Array<{ key, timestamp, preview }> }
 * @throws {404} 章节不存在
 */
router.get('/:id/snapshots', async (c) => {
  const id = c.req.param('id')
  const db = drizzle(c.env.DB)

  const chapter = await db.select({ snapshotKeys: t.snapshotKeys }).from(t).where(eq(t.id, id)).get()
  if (!chapter) return c.json({ error: 'Chapter not found' }, 404)

  const keys: string[] = chapter.snapshotKeys ? JSON.parse(chapter.snapshotKeys) : []
  const snapshots = await Promise.all(
    keys.map(async (key) => {
      try {
        const obj = await c.env.STORAGE.get(key)
        if (!obj) return null
        const content = await obj.text()
        const match = key.match(/(\d+)\.txt$/)
        const timestamp = match ? parseInt(match[1]) : 0
        return { key, timestamp, preview: content.slice(0, 200) }
      } catch { return null }
    })
  )
  return c.json({ snapshots: snapshots.filter(Boolean) })
})

/**
 * POST /:id/restore - 恢复章节快照
 * @description 从历史快照恢复章节内容
 * @param {string} id - 章节ID
 * @param {string} key - 快照存储键
 * @returns {Object} { ok: boolean, content: string }
 * @throws {404} 章节或快照不存在
 */
router.post('/:id/restore', zValidator('json', z.object({ key: z.string() })), async (c) => {
  const id = c.req.param('id')
  const { key } = c.req.valid('json')
  const db = drizzle(c.env.DB)

  const chapter = await db.select().from(t).where(eq(t.id, id)).get()
  if (!chapter) return c.json({ error: 'Chapter not found' }, 404)

  const obj = await c.env.STORAGE.get(key)
  if (!obj) return c.json({ error: 'Snapshot not found' }, 404)

  const content = await obj.text()
  await db.update(t).set({ content, updatedAt: Math.floor(Date.now() / 1e3) }).where(eq(t.id, id))

  return c.json({ ok: true, content })
})

/**
 * 保存章节快照到R2存储
 * @param {Env} env - 环境变量对象
 * @param {string} novelId - 小说ID
 * @param {string} chapterId - 章节ID
 * @param {string} content - 章节内容
 * @returns {Promise<string | null>} 快照存储键，失败返回null
 */
async function saveSnapshot(env: Env, novelId: string, chapterId: string, content: string): Promise<string | null> {
  if (!content || !env.STORAGE) return null

  const db = drizzle(env.DB)
  const chapter = await db.select({ snapshotKeys: t.snapshotKeys }).from(t).where(eq(t.id, chapterId)).get()
  const existingKeys: string[] = chapter?.snapshotKeys ? JSON.parse(chapter.snapshotKeys) : []

  const timestamp = Date.now()
  const key = `snapshots/${novelId}/${chapterId}/${timestamp}.txt`

  await env.STORAGE.put(key, content, { httpMetadata: { contentType: 'text/plain' } })

  const newKeys = [key, ...existingKeys].slice(0, MAX_SNAPSHOTS)
  await db.update(t).set({ snapshotKeys: JSON.stringify(newKeys) }).where(eq(t.id, chapterId))

  if (existingKeys.length >= MAX_SNAPSHOTS) {
    const oldestKey = existingKeys[existingKeys.length - 1]
    try { await env.STORAGE.delete(oldestKey) } catch {}
  }

  return key
}

export { router as chapters }
