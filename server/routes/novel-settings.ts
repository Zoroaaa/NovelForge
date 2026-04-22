/**
 * @file novel-settings.ts
 * @description 小说设定路由模块，提供世界观、力量体系、势力等设定的管理
 * @version 2.0.0
 * @modified 2026-04-21 - 添加规范化注释
 */
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { drizzle } from 'drizzle-orm/d1'
import { novelSettings } from '../db/schema'
import { eq, and, desc, sql } from 'drizzle-orm'
import type { Env } from '../lib/types'
import { enqueue } from '../lib/queue'
import { deindexContent } from '../services/embedding'

const router = new Hono<{ Bindings: Env }>()

// Schema 验证
const CreateSettingSchema = z.object({
  novelId: z.string().min(1),
  type: z.enum(['worldview', 'power_system', 'faction', 'geography', 'item_skill', 'misc']),
  category: z.string().optional(),
  name: z.string().min(1).max(100),
  content: z.string().min(1),
  attributes: z.string().optional(),
  parentId: z.string().optional(),
  importance: z.enum(['high', 'normal', 'low']).default('normal'),
  relatedIds: z.string().optional(),
})

const UpdateSettingSchema = z.object({
  type: z.enum(['worldview', 'power_system', 'faction', 'geography', 'item_skill', 'misc']).optional(),
  category: z.string().optional(),
  name: z.string().min(1).max(100).optional(),
  content: z.string().min(1).optional(),
  attributes: z.string().optional(),
  parentId: z.string().optional(),
  importance: z.enum(['high', 'normal', 'low']).optional(),
  relatedIds: z.string().optional(),
  sortOrder: z.number().optional(),
})

/**
 * GET /:novelId - 获取小说的所有设定
 * @description 获取指定小说的设定列表，支持分页和多条件筛选
 * @param {string} novelId - 小说ID
 * @param {string} [type] - 设定类型：worldview | power_system | faction | geography | item_skill | misc
 * @param {string} [category] - 分类过滤
 * @param {string} [importance] - 重要程度：high | normal | low
 * @param {number} [limit=50] - 返回数量限制
 * @param {number} [offset=0] - 偏移量
 * @returns {Object} { settings: Array, total: number, limit: number, offset: number }
 */
router.get('/:novelId', zValidator('query', z.object({
  type: z.enum(['worldview', 'power_system', 'faction', 'geography', 'item_skill', 'misc']).optional(),
  category: z.string().optional(),
  importance: z.enum(['high', 'normal', 'low']).optional(),
  limit: z.coerce.number().optional().default(50),
  offset: z.coerce.number().optional().default(0),
})), async (c) => {
  const novelId = c.req.param('novelId')
  const { type, category, importance, limit, offset } = c.req.valid('query')
  const db = drizzle(c.env.DB)

  // 动态构建查询条件
  const conditions = [
    eq(novelSettings.novelId, novelId),
    sql`${novelSettings.deletedAt} IS NULL`
  ]

  if (type) {
    conditions.push(eq(novelSettings.type, type))
  }
  if (category) {
    conditions.push(eq(novelSettings.category, category))
  }
  if (importance) {
    conditions.push(eq(novelSettings.importance, importance))
  }

  const settings = await db
    .select()
    .from(novelSettings)
    .where(and(...conditions))
    .orderBy(desc(novelSettings.importance), novelSettings.sortOrder)
    .limit(limit)
    .offset(offset)
    .all()

  // 获取总数（使用相同的筛选条件）
  const countResult = await db
    .select({ count: sql`count(*)` })
    .from(novelSettings)
    .where(and(...conditions))
    .get()

  return c.json({
    settings,
    total: countResult?.count || 0,
    limit,
    offset,
  })
})

/**
 * GET /:novelId/:id - 获取单个设定的详细信息
 * @param {string} novelId - 小说ID
 * @param {string} id - 设定ID
 * @returns {Object} { setting: Object }
 * @throws {404} 设定不存在
 */
router.get('/:novelId/:id', async (c) => {
  const { novelId, id } = c.req.param() as { novelId: string; id: string }
  const db = drizzle(c.env.DB)

  const setting = await db.select()
    .from(novelSettings)
    .where(and(
      eq(novelSettings.id, id),
      eq(novelSettings.novelId, novelId),
      sql`${novelSettings.deletedAt} IS NULL`
    ))
    .get()

  if (!setting) {
    return c.json({ error: '设定不存在' }, 404)
  }

  return c.json({ setting })
})

/**
 * POST / - 创建新设定
 * @param {string} novelId - 小说ID
 * @param {string} type - 设定类型
 * @param {string} [category] - 分类
 * @param {string} name - 设定名称（1-100字符）
 * @param {string} content - 设定内容
 * @param {string} [attributes] - 属性JSON
 * @param {string} [parentId] - 父设定ID
 * @param {string} [importance='normal'] - 重要程度
 * @param {string} [relatedIds] - 关联ID列表JSON
 * @returns {Object} { ok: boolean, setting: Object }
 * @throws {500} 创建失败
 */
router.post('/', zValidator('json', CreateSettingSchema), async (c) => {
  const body = c.req.valid('json')
  const db = drizzle(c.env.DB)

  try {
    const newSetting = await db.insert(novelSettings).values({
      novelId: body.novelId,
      type: body.type,
      category: body.category,
      name: body.name,
      content: body.content,
      attributes: body.attributes,
      parentId: body.parentId,
      importance: body.importance,
      relatedIds: body.relatedIds,
    }).returning().get()

    if (c.env.VECTORIZE && newSetting.content) {
      await enqueue(c.env, {
        type: 'index_content',
        payload: {
          sourceType: 'setting',
          sourceId: newSetting.id,
          novelId: newSetting.novelId,
          title: newSetting.name,
          content: newSetting.content,
          extraMetadata: { settingType: newSetting.type, importance: newSetting.importance },
        },
      })
    }

    return c.json({ ok: true, setting: newSetting }, 201)
  } catch (error) {
    console.error('Failed to create setting:', error)
    return c.json({ error: '创建设定失败', details: (error as Error).message }, 500)
  }
})

/**
 * PUT /:id - 更新设定
 * @param {string} id - 设定ID
 * @param {Object} body - 更新内容
 * @returns {Object} { ok: boolean, setting: Object }
 * @throws {404} 设定不存在
 * @throws {500} 更新失败
 */
router.put('/:id', zValidator('json', UpdateSettingSchema), async (c) => {
  const id = c.req.param('id')
  const body = c.req.valid('json')
  const db = drizzle(c.env.DB)

  try {
    const existing = await db.select()
      .from(novelSettings)
      .where(eq(novelSettings.id, id))
      .get()

    if (!existing) {
      return c.json({ error: '设定不存在' }, 404)
    }

    const updateData: any = {}
    if (body.type !== undefined) updateData.type = body.type
    if (body.category !== undefined) updateData.category = body.category
    if (body.name !== undefined) updateData.name = body.name
    if (body.content !== undefined) updateData.content = body.content
    if (body.attributes !== undefined) updateData.attributes = body.attributes
    if (body.parentId !== undefined) updateData.parentId = body.parentId
    if (body.importance !== undefined) updateData.importance = body.importance
    if (body.relatedIds !== undefined) updateData.relatedIds = body.relatedIds
    if (body.sortOrder !== undefined) updateData.sortOrder = body.sortOrder

    const updated = await db
      .update(novelSettings)
      .set({ ...updateData, updatedAt: sql`(unixepoch())` })
      .where(eq(novelSettings.id, id))
      .returning()
      .get()

    if (c.env.VECTORIZE && body.content !== undefined && updated.content) {
      await enqueue(c.env, {
        type: 'index_content',
        payload: {
          sourceType: 'setting',
          sourceId: updated.id,
          novelId: updated.novelId,
          title: updated.name,
          content: updated.content,
          extraMetadata: { settingType: updated.type, importance: updated.importance },
        },
      })
    }

    return c.json({ ok: true, setting: updated })
  } catch (error) {
    console.error('Failed to update setting:', error)
    return c.json({ error: '更新设定失败', details: (error as Error).message }, 500)
  }
})

/**
 * DELETE /:id - 删除设定（软删除）
 * @param {string} id - 设定ID
 * @returns {Object} { ok: boolean }
 * @throws {500} 删除失败
 */
router.delete('/:id', async (c) => {
  const id = c.req.param('id')
  const db = drizzle(c.env.DB)

  try {
    if (c.env.VECTORIZE) {
      deindexContent(c.env, 'setting', id).then(() => {}).catch(e => console.warn('Setting deindex failed:', e))
    }

    await db
      .update(novelSettings)
      .set({ deletedAt: Math.floor(Date.now() / 1000) })
      .where(eq(novelSettings.id, id))

    return c.json({ ok: true })
  } catch (error) {
    console.error('Failed to delete setting:', error)
    return c.json({ error: '删除设定失败', details: (error as Error).message }, 500)
  }
})

/**
 * GET /tree/:novelId - 获取树形结构的设定列表
 * @description 获取设定树形结构，按父子关系组织
 * @param {string} novelId - 小说ID
 * @returns {Object} { tree: Array, stats: Object, total: number }
 */
router.get('/tree/:novelId', async (c) => {
  const novelId = c.req.param('novelId')
  const db = drizzle(c.env.DB)

  // 查询所有未删除的设定
  const allSettings = await db
    .select()
    .from(novelSettings)
    .where(and(
      eq(novelSettings.novelId, novelId),
      sql`${novelSettings.deletedAt} IS NULL`
    ))
    .orderBy(novelSettings.type, novelSettings.sortOrder)
    .all()

  // 构建树形结构
  const buildTree = (parentId: string | null = null): any[] => {
    return allSettings
      .filter(s => s.parentId === parentId)
      .map(setting => ({
        ...setting,
        children: buildTree(setting.id),
      }))
  }

  const tree = buildTree(null)

  // 按 type 分组统计
  const stats = allSettings.reduce((acc, s) => {
    acc[s.type] = (acc[s.type] || 0) + 1
    return acc
  }, {} as Record<string, number>)

  return c.json({
    tree,
    stats,
    total: allSettings.length,
  })
})

export { router as novelSettingsRouter }
