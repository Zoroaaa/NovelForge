import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { drizzle } from 'drizzle-orm/d1'
import { characters as t } from '../db/schema'
import { eq, and, isNull } from 'drizzle-orm'
import type { Env } from '../lib/types'
import {
  uploadAndAnalyzeImage,
  analyzeCharacterImage,
} from '../services/vision'

const router = new Hono<{ Bindings: Env }>()

const CreateSchema = z.object({
  novelId: z.string(),
  name: z.string(),
  aliases: z.string().optional(),
  role: z.string().optional(),
  description: z.string().optional(),
  attributes: z.string().optional(),
})

router.get('/', async (c) => {
  const novelId = c.req.query('novelId')
  if (!novelId) return c.json({ error: 'novelId required' }, 400)
  const db = drizzle(c.env.DB)
  const rows = await db.select().from(t)
    .where(and(eq(t.novelId, novelId), isNull(t.deletedAt)))
  return c.json(rows)
})

router.get('/:id', async (c) => {
  const db = drizzle(c.env.DB)
  const row = await db.select().from(t).where(eq(t.id, c.req.param('id'))).get()
  if (!row || row.deletedAt) return c.json({ error: 'Not found' }, 404)
  return c.json(row)
})

router.post('/', zValidator('json', CreateSchema), async (c) => {
  const db = drizzle(c.env.DB)
  const [row] = await db.insert(t).values(c.req.valid('json')).returning()
  return c.json(row, 201)
})

router.patch('/:id', zValidator('json', CreateSchema.partial()), async (c) => {
  const db = drizzle(c.env.DB)
  const [row] = await db.update(t)
    .set(c.req.valid('json'))
    .where(eq(t.id, c.req.param('id')))
    .returning()
  return c.json(row)
})

router.delete('/:id', async (c) => {
  const db = drizzle(c.env.DB)
  await db.update(t)
    .set({ deletedAt: new Date().getTime() })
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
        role: character.role,
        skipAnalysis: !shouldAnalyze,
      }
    )

    // 更新数据库中的图片 URL
    await db
      .update(t)
      .set({ imageUrl: result.url })
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

    const imageUrl = c.req.valid('json').imageUrl || character.imageUrl
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
      role: character.role,
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
