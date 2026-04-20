/**
 * NovelForge · 总纲路由（v2.0）
 *
 * API 端点：
 * GET    /api/v1/master-outline/:novelId      - 获取总纲
 * POST   /api/v1/master-outline               - 创建/更新总纲
 * PUT    /api/v1/master-outline/:id           - 更新总纲内容
 * DELETE /api/v1/master-outline/:id           - 删除总纲版本
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

// GET /master-outline/:novelId - 获取最新版本的总纲
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

// GET /master-outline/:novelId/history - 获取所有历史版本
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

// POST /master-outline - 创建新版本的总纲（自动递增版本号）
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

// DELETE /master-outline/:id - 删除某个版本的总纲（软删除）
router.delete('/:id', async (c) => {
  const id = c.req.param('id')
  const db = drizzle(c.env.DB)

  await db
    .update(masterOutline)
    .set({ deletedAt: Math.floor(Date.now() / 1000) })
    .where(eq(masterOutline.id, id))

  return c.json({ ok: true })
})

export { router as masterOutlineRouter }
