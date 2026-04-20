/**
 * NovelForge · Vectorize 向量化路由
 *
 * 管理向量索引的 CRUD 操作：
 * - POST /api/vectorize/index    - 手动触发内容向量化
 * - DELETE /api/vectorize/:id     - 删除指定内容的向量
 * - GET  /api/vectorize/status   - 查询向量化状态
 */

import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { drizzle } from 'drizzle-orm/d1'
import { masterOutline, chapters } from '../db/schema'
import { eq } from 'drizzle-orm'
import type { Env } from '../lib/types'
import {
  indexContent,
  deindexContent,
  searchSimilar,
  embedText,
} from '../services/embedding'

const router = new Hono<{ Bindings: Env }>()

/**
 * POST /api/vectorize/index
 *
 * 手动触发向量化（用于大纲/章节/角色）
 */
router.post(
  '/index',
  zValidator(
    'json',
    z.object({
      sourceType: z.enum(['outline', 'chapter', 'character', 'summary']),
      sourceId: z.string().min(1),
      novelId: z.string().min(1),
      title: z.string(),
      content: z.string().nullable().optional(),
    })
  ),
  async (c) => {
    const body = c.req.valid('json')
    const { sourceType, sourceId, novelId, title } = body

    // 如果没有提供content，从数据库获取
    let content = body.content
    if (!content) {
      const db = drizzle(c.env.DB)

      if (sourceType === 'outline') {
        // v2.0: 从总纲表获取内容（替代原 outlines）
        const row = await db
          .select({ content: masterOutline.content })
          .from(masterOutline)
          .where(eq(masterOutline.id, sourceId))
          .get()
        content = row?.content || null
      } else if (sourceType === 'chapter') {
        const row = await db
          .select({ content: chapters.content })
          .from(chapters)
          .where(eq(chapters.id, sourceId))
          .get()
        content = row?.content || null
      }
    }

    if (!c.env.VECTORIZE) {
      return c.json({ error: 'Vectorize binding not configured' }, 503)
    }

    try {
      const vectorIds = await indexContent(c.env, sourceType, sourceId, novelId, title, content)

      return c.json({
        ok: true,
        vectorIds,
        message: `Indexed ${vectorIds.length} vectors for ${sourceType}:${sourceId}`,
      })
    } catch (error) {
      console.error('Vectorization failed:', error)
      return c.json(
        {
          error: 'Vectorization failed',
          details: (error as Error).message,
        },
        500
      )
    }
  }
)

/**
 * DELETE /api/vectorize/:type/:id
 *
 * 删除指定内容的所有向量索引
 */
router.delete('/:type/:id', async (c) => {
  const sourceType = c.req.param('type') as any
  const sourceId = c.req.param('id')

  if (!['outline', 'chapter', 'character', 'summary'].includes(sourceType)) {
    return c.json({ error: 'Invalid source type' }, 400)
  }

  if (!c.env.VECTORIZE) {
    return c.json({ error: 'Vectorize binding not configured' }, 503)
  }

  try {
    // 从 D1 查询实际 chunk 数量，不再硬编码
    await deindexContent(c.env, sourceType, sourceId)

    return c.json({
      ok: true,
      message: `Deleted vectors for ${sourceType}:${sourceId}`,
    })
  } catch (error) {
    console.error('Deindex failed:', error)
    return c.json(
      {
        error: 'Deindex failed',
        details: (error as Error).message,
      },
      500
    )
  }
})

/**
 * GET /api/vectorize/search
 *
 * 语义相似度搜索（调试用）
 */
router.get('/search', async (c) => {
  const query = c.req.query('q')
  const novelId = c.req.query('novelId')

  if (!query) {
    return c.json({ error: 'Query parameter "q" is required' }, 400)
  }

  if (!c.env.VECTORIZE) {
    return c.json({ error: 'Vectorize binding not configured' }, 503)
  }

  try {
    const queryVector = await embedText(c.env.AI, query)
    const results = await searchSimilar(c.env.VECTORIZE, queryVector, {
      topK: 10,
      filter: novelId ? { novelId } : undefined,
    })

    return c.json({
      ok: true,
      query,
      resultsCount: results.length,
      results: results.map((r) => ({
        id: r.id,
        score: Math.round(r.score * 1000) / 1000,
        title: r.metadata.title,
        sourceType: r.metadata.sourceType,
        preview: r.metadata.content?.slice(0, 200),
      })),
    })
  } catch (error) {
    console.error('Search failed:', error)
    return c.json(
      {
        error: 'Search failed',
        details: (error as Error).message,
      },
      500
    )
  }
})

/**
 * GET /api/vectorize/status
 *
 * 检查 Vectorize 服务状态
 */
router.get('/status', async (c) => {
  try {
    if (!c.env.VECTORIZE) {
      return c.json({
        status: 'not_configured',
        message: 'Vectorize binding not configured in wrangler.toml',
      })
    }

    // 尝试一次空查询来验证连接
    await embedText(c.env.AI, 'test')

    return c.json({
      status: 'ok',
      message: 'Vectorize service is operational',
      embeddingModel: '@cf/baai/bge-base-zh-v1.5',
      dimensions: 768,
    })
  } catch (error) {
    return c.json({
      status: 'error',
      message: 'Vectorize service check failed',
      error: (error as Error).message,
    })
  }
})

export { router as vectorize }
