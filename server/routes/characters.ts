/**
 * @file characters.ts
 * @description 角色管理路由模块，提供角色CRUD、图片上传等功能
 * @version 1.0.0
 * @modified 2026-04-24 - 移除视觉分析功能，仅保留基础图片上传
 */
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { drizzle } from 'drizzle-orm/d1'
import { characters as t } from '../db/schema'
import { eq, and, isNull } from 'drizzle-orm'
import type { Env } from '../lib/types'
import { enqueue } from '../lib/queue'
import { deindexContent } from '../services/embedding'

const router = new Hono<{ Bindings: Env }>()

const CreateSchema = z.object({
  novelId: z.string(),
  name: z.string(),
  aliases: z.string().nullish(),
  role: z.string().nullish(),
  description: z.string().nullish(),
  attributes: z.string().nullish(),
  powerLevel: z.string().nullish(),
})

/**
 * GET / - 获取角色列表
 * @description 获取指定小说的所有角色
 * @param {string} novelId - 小说ID（查询参数）
 * @returns {Array} 角色数组
 * @throws {400} 缺少novelId参数
 */
router.get('/', async (c) => {
  const novelId = c.req.query('novelId')
  if (!novelId) return c.json({ error: 'novelId required' }, 400)
  const db = drizzle(c.env.DB)
  const rows = await db.select().from(t)
    .where(and(eq(t.novelId, novelId), isNull(t.deletedAt)))
  return c.json(rows)
})

/**
 * GET /:id - 获取单个角色详情
 * @param {string} id - 角色ID
 * @returns {Object} 角色对象
 * @throws {404} 角色不存在
 */
router.get('/:id', async (c) => {
  const db = drizzle(c.env.DB)
  const row = await db.select().from(t).where(eq(t.id, c.req.param('id'))).get()
  if (!row || row.deletedAt) return c.json({ error: 'Not found' }, 404)
  return c.json(row)
})

/**
 * POST / - 创建新角色
 * @param {string} novelId - 所属小说ID
 * @param {string} name - 角色名称
 * @param {string} [aliases] - 角色别名
 * @param {string} [role] - 角色定位
 * @param {string} [description] - 角色描述
 * @param {string} [attributes] - 角色属性
 * @returns {Object} 创建的角色对象
 */
router.post('/', zValidator('json', CreateSchema), async (c) => {
  const db = drizzle(c.env.DB)
  const [row] = await db.insert(t).values(c.req.valid('json')).returning()

  if (row && c.env.VECTORIZE) {
    const indexText = `${row.name}${row.role ? ` (${row.role})` : ''}\n${(row.description || '').slice(0, 300)}`
    await enqueue(c.env, {
      type: 'index_content',
      payload: {
        sourceType: 'character',
        sourceId: row.id,
        novelId: row.novelId,
        title: row.name,
        content: indexText,
      },
    })
  }

  return c.json(row, 201)
})

/**
 * PATCH /:id - 更新角色信息
 * @description 更新角色信息，描述更新时自动触发向量化
 * @param {string} id - 角色ID
 * @param {Object} body - 更新内容
 * @returns {Object} 更新后的角色对象
 */
router.patch('/:id', zValidator('json', CreateSchema.partial()), async (c) => {
  const db = drizzle(c.env.DB)
  const id = c.req.param('id')
  const body = c.req.valid('json')

  const [row] = await db.update(t)
    .set({ ...body, updatedAt: Math.floor(Date.now() / 1000) })
    .where(eq(t.id, id))
    .returning()

  // B6修复: 扩展重新向量化触发条件，覆盖 name/role 变更
  // 原bug：仅 description 变更时触发重新向量化；name 或 role 单独变更时向量内容变为陈旧
  const needsReindex = body.description !== undefined || body.name !== undefined || body.role !== undefined
  if (needsReindex && row && c.env.VECTORIZE) {
    const indexText = `${row.name}${row.role ? ` (${row.role})` : ''}\n${(row.description || '').slice(0, 300)}`
    await enqueue(c.env, {
      type: 'index_content',
      payload: {
        sourceType: 'character',
        sourceId: row.id,
        novelId: row.novelId,
        title: row.name,
        content: indexText,
      },
    })
  }

  return c.json(row)
})

/**
 * DELETE /:id - 删除角色（软删除）
 * @param {string} id - 角色ID
 * @returns {Object} { ok: boolean }
 */
router.delete('/:id', async (c) => {
  const db = drizzle(c.env.DB)
  const id = c.req.param('id')

  if (c.env.VECTORIZE) {
    deindexContent(c.env, 'character', id).then(() => {}).catch(e => console.warn('Character deindex failed:', e))
  }

  await db.update(t)
    .set({ deletedAt: Math.floor(Date.now() / 1000) })
    .where(eq(t.id, id))
  return c.json({ ok: true })
})

/**
 * POST /api/characters/:id/image
 *
 * 上传角色图片到 R2 存储
 *
 * Content-Type: multipart/form-data
 * - image: 图片文件（必填）
 */
router.post('/:id/image', async (c) => {
  try {
    const characterId = c.req.param('id')
    const db = drizzle(c.env.DB)

    const character = await db.select().from(t).where(eq(t.id, characterId)).get()
    if (!character || character.deletedAt) {
      return c.json({ error: 'Character not found' }, 404)
    }

    const formData = await c.req.formData()
    const imageFile = formData.get('image') as File | null

    if (!imageFile || !(imageFile instanceof File)) {
      return c.json({ error: 'Image file is required' }, 400)
    }

    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
    if (!allowedTypes.includes(imageFile.type)) {
      return c.json(
        {
          error: 'Unsupported image format',
          allowed: allowedTypes.join(', '),
        },
        400
      )
    }

    const maxSize = 5 * 1024 * 1024
    if (imageFile.size > maxSize) {
      return c.json(
        { error: `Image too large. Maximum size: ${maxSize / 1024 / 1024}MB` },
        400
      )
    }

    const imageBuffer = await imageFile.arrayBuffer()
    const key = `characters/${character.novelId}/${characterId}/${Date.now()}.${imageFile.type.split('/')[1]}`

    await c.env.STORAGE.put(key, imageBuffer, {
      httpMetadata: { contentType: imageFile.type },
    })

    await db
      .update(t)
      .set({ imageR2Key: key })
      .where(eq(t.id, characterId))

    const storageConfig = c.env.STORAGE as any
    const url = `https://pub-${storageConfig.bucketName}.${storageConfig.accountId}.r2.dev/${key}`

    return c.json({
      ok: true,
      imageUrl: url,
      imageKey: key,
    })
  } catch (error) {
    console.error('Character image upload failed:', error)
    return c.json(
      {
        error: 'Upload failed',
        details: (error as Error).message,
      },
      500
    )
  }
})

export { router as characters }
