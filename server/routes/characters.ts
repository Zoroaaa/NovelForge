/**
 * @file characters.ts
 * @description 角色管理路由模块，提供角色CRUD、图片上传、AI视觉分析等功能
 * @version 1.0.0
 * @modified 2026-04-21 - 添加规范化注释
 */
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { drizzle } from 'drizzle-orm/d1'
import { characters as t } from '../db/schema'
import { eq, and, isNull } from 'drizzle-orm'
import type { Env } from '../lib/types'
import { enqueue } from '../lib/queue'
import {
  uploadAndAnalyzeImage,
  analyzeCharacterImage,
} from '../services/vision'

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

  if (body.description !== undefined && row && c.env.VECTORIZE) {
    const descriptionContent = body.description ?? ''
    if (descriptionContent.trim()) {
      const indexText = `${row.name}${row.role ? ` (${row.role})` : ''}\n${descriptionContent.slice(0, 300)}`
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
  await db.update(t)
    .set({ deletedAt: Math.floor(Date.now() / 1000) })
    .where(eq(t.id, c.req.param('id')))
  return c.json({ ok: true })
})

/**
 * POST /api/characters/:id/image
 *
 * 上传角色图片并可选进行 AI 视觉分析
 *
 * Content-Type: multipart/form-data
 * - image: 图片文件（必填）
 * - analyze: 是否进行AI分析（可选，默认true）
 */
router.post('/:id/image', async (c) => {
  try {
    const characterId = c.req.param('id')
    const db = drizzle(c.env.DB)

    // 验证角色存在
    const character = await db.select().from(t).where(eq(t.id, characterId)).get()
    if (!character || character.deletedAt) {
      return c.json({ error: 'Character not found' }, 404)
    }

    // 解析 multipart 表单数据
    const formData = await c.req.formData()
    const imageFile = formData.get('image') as File | null

    if (!imageFile || !(imageFile instanceof File)) {
      return c.json({ error: 'Image file is required' }, 400)
    }

    // 验证文件类型
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

    // 验证文件大小（最大 5MB）
    const maxSize = 5 * 1024 * 1024
    if (imageFile.size > maxSize) {
      return c.json(
        { error: `Image too large. Maximum size: ${maxSize / 1024 / 1024}MB` },
        400
      )
    }

    const shouldAnalyze = formData.get('analyze') !== 'false'

    // 上传并可选分析
    const result = await uploadAndAnalyzeImage(
      c.env,
      imageFile,
      character.novelId,
      characterId,
      {
        characterName: character.name,
        role: character.role ?? undefined,
        skipAnalysis: !shouldAnalyze,
      }
    )

    // 更新数据库中的图片 key
    await db
      .update(t)
      .set({ imageR2Key: result.key })
      .where(eq(t.id, characterId))

    // 如果有分析结果，返回建议的描述更新
    let suggestedUpdate = null
    if (result.analysis && shouldAnalyze) {
      suggestedUpdate = {
        description: result.analysis.description,
        appearance: result.analysis.appearance,
        traits: result.analysis.traits,
        tags: result.analysis.tags,
      }
    }

    return c.json({
      ok: true,
      imageUrl: result.url,
      imageKey: result.key,
      analysis: result.analysis,
      suggestedUpdate,
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

/**
 * POST /api/characters/:id/analyze-image
 *
 * 对已有图片进行视觉分析（或重新分析）
 */
router.post('/:id/analyze-image', zValidator('json', z.object({
  imageUrl: z.string().url().optional(),
})), async (c) => {
  try {
    const characterId = c.req.param('id')
    const db = drizzle(c.env.DB)

    const character = await db.select().from(t).where(eq(t.id, characterId)).get()
    if (!character || character.deletedAt) {
      return c.json({ error: 'Character not found' }, 404)
    }

    const imageUrl = c.req.valid('json').imageUrl || (character.imageR2Key ? `https://pub-${(c.env.STORAGE as any).bucketName}.${(c.env.STORAGE as any).accountId}.r2.dev/${character.imageR2Key}` : null)
    if (!imageUrl) {
      return c.json({ error: 'No image available for analysis' }, 400)
    }

    // 从 URL 获取图片
    const response = await fetch(imageUrl)
    if (!response.ok) {
      throw new Error(`Failed to fetch image: ${response.status}`)
    }

    const imageBuffer = await response.arrayBuffer()

    // 进行视觉分析
    const analysis = await analyzeCharacterImage(c.env, imageBuffer, {
      characterName: character.name,
      role: character.role ?? undefined,
    })

    return c.json({
      ok: true,
      analysis,
    })
  } catch (error) {
    console.error('Image analysis failed:', error)
    return c.json(
      {
        error: 'Analysis failed',
        details: (error as Error).message,
      },
      500
    )
  }
})

export { router as characters }
