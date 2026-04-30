/**
 * @file master-outline.ts
 * @description 总纲管理路由模块，提供总纲版本管理和历史记录功能
 * @version 2.0.0
 * @modified 2026-04-21 - 添加规范化注释
 */
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { drizzle } from 'drizzle-orm/d1'
import { masterOutline } from '../db/schema'
import { eq, desc, and, sql } from 'drizzle-orm'
import type { Env } from '../lib/types'

const router = new Hono<{ Bindings: Env }>()

const CreateMasterOutlineSchema = z.object({
  novelId: z.string().min(1),
  title: z.string().min(1).max(200),
  content: z.string().min(10),
  summary: z.string().max(500).optional(),
})

/**
 * GET /:novelId/history - 获取所有历史版本
 * @description 获取指定小说的总纲历史版本列表
 * @param {string} novelId - 小说ID
 * @returns {Object} { history: Array }
 */
router.get('/:novelId/history', async (c) => {
  const novelId = c.req.param('novelId')
  const db = drizzle(c.env.DB)

  const history = await db
    .select({
      id: masterOutline.id,
      version: masterOutline.version,
      title: masterOutline.title,
      summary: masterOutline.summary,
      wordCount: masterOutline.wordCount,
      createdAt: masterOutline.createdAt,
    })
    .from(masterOutline)
    .where(and(
      eq(masterOutline.novelId, novelId),
      sql`${masterOutline.deletedAt} IS NULL`
    ))
    .orderBy(desc(masterOutline.version))
    .all()

  return c.json({ history })
})

/**
 * GET /:novelId - 获取最新版本的总纲
 * @description 获取指定小说的最新版本总纲
 * @param {string} novelId - 小说ID
 * @returns {Object} { exists: boolean, outline?: Object }
 */
router.get('/:novelId', async (c) => {
  const novelId = c.req.param('novelId')
  const db = drizzle(c.env.DB)

  const outline = await db
    .select()
    .from(masterOutline)
    .where(and(
      eq(masterOutline.novelId, novelId),
      sql`${masterOutline.deletedAt} IS NULL`
    ))
    .orderBy(desc(masterOutline.version))
    .limit(1)
    .get()

  if (!outline) {
    return c.json({ exists: false })
  }

  return c.json({ exists: true, outline })
})

/**
 * POST / - 创建新版本的总纲
 * @description 创建新版本总纲，自动递增版本号
 * @param {string} novelId - 小说ID
 * @param {string} title - 总纲标题（1-200字符）
 * @param {string} content - 总纲内容（至少10字符）
 * @param {string} [summary] - 总纲摘要（最多500字符）
 * @returns {Object} { ok: boolean, outline: Object }
 * @throws {500} 创建失败
 */
router.post('/', zValidator('json', CreateMasterOutlineSchema), async (c) => {
  const body = c.req.valid('json')
  const db = drizzle(c.env.DB)

  try {
    // 获取当前最大版本号
    const lastVersion = await db
      .select({ version: masterOutline.version })
      .from(masterOutline)
      .where(eq(masterOutline.novelId, body.novelId))
      .orderBy(desc(masterOutline.version))
      .limit(1)
      .get()

    const newVersion = (lastVersion?.version || 0) + 1

    // 计算字数（粗估）
    const wordCount = body.content.length

    const newOutline = await db
      .insert(masterOutline)
      .values({
        novelId: body.novelId,
        title: body.title,
        content: body.content,
        summary: body.summary || body.content.slice(0, 200),
        version: newVersion,
        wordCount,
      })
      .returning()
      .get()

    console.log(`✅ Master outline v${newVersion} created for novel ${body.novelId}`)

    return c.json({ ok: true, outline: newOutline }, 201)
  } catch (error) {
    console.error('Failed to create master outline:', error)
    return c.json({ 
      error: '创建总纲失败', 
      details: (error as Error).message 
    }, 500)
  }
})

// PUT /master-outline/:id - 更新总纲内容（不增加版本号）
const UpdateMasterOutlineSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  content: z.string().min(10).optional(),
  summary: z.string().max(500).optional(),
})

/**
 * PUT /:id - 更新总纲内容
 * @description 更新总纲内容（不增加版本号）
 * @param {string} id - 总纲ID
 * @param {string} [title] - 总纲标题
 * @param {string} [content] - 总纲内容
 * @param {string} [summary] - 总纲摘要
 * @returns {Object} { ok: boolean, outline: Object }
 * @throws {500} 更新失败
 */
router.put('/:id', zValidator('json', UpdateMasterOutlineSchema), async (c) => {
  const id = c.req.param('id')
  const body = c.req.valid('json')
  const db = drizzle(c.env.DB)

  try {
    const updateData: any = { updatedAt: sql`(unixepoch())` }
    
    if (body.title !== undefined) {
      updateData.title = body.title
    }
    
    if (body.content !== undefined) {
      updateData.content = body.content
      updateData.wordCount = body.content.length
    }
    
    if (body.summary !== undefined) {
      updateData.summary = body.summary
    }

    const updated = await db
      .update(masterOutline)
      .set(updateData)
      .where(eq(masterOutline.id, id))
      .returning()
      .get()

    return c.json({ ok: true, outline: updated })
  } catch (error) {
    console.error('Failed to update master outline:', error)
    return c.json({ error: '更新总纲失败' }, 500)
  }
})

/**
 * DELETE /:id - 删除总纲版本（软删除）
 * @param {string} id - 总纲ID
 * @returns {Object} { ok: boolean }
 */
router.delete('/:id', async (c) => {
  const id = c.req.param('id')
  const db = drizzle(c.env.DB)

  await c.env.DB.prepare(`DELETE FROM vector_index WHERE source_type = 'summary' AND source_id = ?`).bind(id).run()
  await c.env.DB.prepare(`DELETE FROM entity_index WHERE entity_type = 'master_outline' AND entity_id = ?`).bind(id).run()

  await db
    .update(masterOutline)
    .set({ deletedAt: Math.floor(Date.now() / 1000) })
    .where(eq(masterOutline.id, id))

  return c.json({ ok: true })
})

export { router as masterOutlineRouter }
