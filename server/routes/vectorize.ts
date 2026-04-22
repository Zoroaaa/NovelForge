/**
 * @file vectorize.ts
 * @description 向量化索引路由模块，提供内容向量化、相似度搜索和索引管理功能
 * @version 1.0.0
 * @modified 2026-04-21 - 添加规范化注释
 */
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import type { Env } from '../lib/types'
import { enqueue } from '../lib/queue'
import { drizzle } from 'drizzle-orm/d1'
import { eq, and, sql, count, isNull } from 'drizzle-orm'
import {
  indexContent,
  deindexContent,
  searchSimilar,
  embedText,
  fetchContentForIndexing,
} from '../services/embedding'
import { vectorIndex, novelSettings, characters as charactersTable, masterOutline, foreshadowing } from '../db/schema'

const router = new Hono<{ Bindings: Env }>()

/**
 * POST /index - 创建向量化索引
 * @description 将内容进行向量化并存储到向量数据库，支持大纲、章节、角色、摘要等类型
 * @param {string} sourceType - 内容类型：outline | chapter | character | summary
 * @param {string} sourceId - 内容ID
 * @param {string} novelId - 所属小说ID
 * @param {string} title - 内容标题
 * @param {string} [content] - 可选的内容文本，不提供时自动从数据库获取
 * @returns {Object} { ok: boolean, vectorIds: string[], message: string }
 * @throws {503} Vectorize服务未配置
 * @throws {500} 向量化失败
 */
router.post(
  '/index',
  zValidator(
    'json',
    z.object({
      sourceType: z.enum(['outline', 'chapter', 'character', 'summary', 'setting', 'foreshadowing']),
      sourceId: z.string().min(1),
      novelId: z.string().min(1),
      title: z.string(),
      content: z.string().nullable().optional(),
      settingType: z.string().optional(),
      importance: z.string().optional(),
    })
  ),
  async (c) => {
    const body = c.req.valid('json')
    const { sourceType, sourceId, novelId, title, settingType, importance } = body

    let content = body.content
    if (!content) {
      if (sourceType === 'outline' || sourceType === 'chapter') {
        const fetched = await fetchContentForIndexing(c.env, sourceType, sourceId)
        content = fetched.content
      }
    }

    if (!c.env.VECTORIZE) {
      return c.json({ error: 'Vectorize binding not configured' }, 503)
    }

    try {
      const extraMetadata: Record<string, string> = {}
      if (settingType) extraMetadata.settingType = settingType
      if (importance) extraMetadata.importance = importance

      const vectorIds = await indexContent(
        c.env,
        sourceType,
        sourceId,
        novelId,
        title,
        content ?? null,
        Object.keys(extraMetadata).length > 0 ? extraMetadata : undefined
      )

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
 * DELETE /:type/:id - 删除向量化索引
 * @description 从向量数据库中删除指定类型和ID的向量索引
 * @param {string} type - 内容类型：outline | chapter | character | summary
 * @param {string} id - 内容ID
 * @returns {Object} { ok: boolean, message: string }
 * @throws {400} 无效的内容类型
 * @throws {503} Vectorize服务未配置
 * @throws {500} 删除失败
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
 * GET /search - 相似内容搜索
 * @description 通过向量相似度搜索相关内容，支持按小说ID过滤
 * @param {string} q - 搜索查询文本
 * @param {string} [novelId] - 可选的小说ID过滤
 * @returns {Object} { ok: boolean, query: string, resultsCount: number, results: Array }
 * @throws {400} 缺少查询参数
 * @throws {503} Vectorize服务未配置
 * @throws {500} 搜索失败
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
 * GET /status - 获取向量化服务状态
 * @description 检查Vectorize服务配置和运行状态
 * @returns {Object} { status: string, message: string, embeddingModel?: string, dimensions?: number }
 */
router.get('/status', async (c) => {
  try {
    if (!c.env.VECTORIZE) {
      return c.json({
        status: 'not_configured',
        message: 'Vectorize binding not configured in wrangler.toml',
      })
    }

    await embedText(c.env.AI, 'test')

    return c.json({
      status: 'ok',
      message: 'Vectorize service is operational',
      embeddingModel: '@cf/baai/bge-m3',
      dimensions: 1024,
    })
  } catch (error) {
    return c.json({
      status: 'error',
      message: 'Vectorize service check failed',
      error: (error as Error).message,
    })
  }
})

/**
 * GET /stats/:novelId - 获取向量索引统计信息
 * @description 统计指定小说的向量索引情况，包括总数、分类统计、未索引数量等
 * @param {string} novelId - 小说ID
 * @returns {Object} { total, byType, lastIndexedAt, unindexedCounts }
 */
router.get('/stats/:novelId', async (c) => {
  const novelId = c.req.param('novelId')
  const db = drizzle(c.env.DB)

  try {
    const totalResult = await db
      .select({ count: count() })
      .from(vectorIndex)
      .where(eq(vectorIndex.novelId, novelId))
      .get()

    const byTypeResult = await db
      .select({
        sourceType: vectorIndex.sourceType,
        count: count(),
      })
      .from(vectorIndex)
      .where(eq(vectorIndex.novelId, novelId))
      .groupBy(vectorIndex.sourceType)
      .all()

    const lastIndexedResult = await db
      .select({ createdAt: vectorIndex.createdAt })
      .from(vectorIndex)
      .where(eq(vectorIndex.novelId, novelId))
      .orderBy(sql`${vectorIndex.createdAt} DESC`)
      .limit(1)
      .get()

    const unindexedSettings = await db
      .select({ count: count() })
      .from(novelSettings)
      .where(
        and(
          eq(novelSettings.novelId, novelId),
          isNull(novelSettings.deletedAt),
          sql`${novelSettings.vectorId} IS NULL`
        )
      )
      .get()

    const unindexedCharacters = await db
      .select({ count: count() })
      .from(charactersTable)
      .where(
        and(
          eq(charactersTable.novelId, novelId),
          isNull(charactersTable.deletedAt),
          sql`${charactersTable.vectorId} IS NULL`
        )
      )
      .get()

    const unindexedForeshadowing = await db
      .select({ count: count() })
      .from(foreshadowing)
      .where(
        and(
          eq(foreshadowing.novelId, novelId),
          isNull(foreshadowing.deletedAt),
          sql`${foreshadowing.description} IS NOT NULL`,
          sql`${foreshadowing.description} != ''`
        )
      )
      .get()

    const byType: Record<string, number> = {}
    byTypeResult.forEach((row) => {
      byType[row.sourceType] = row.count
    })

    return c.json({
      total: totalResult?.count || 0,
      byType,
      lastIndexedAt: lastIndexedResult?.createdAt || null,
      unindexedCounts: {
        settings: unindexedSettings?.count || 0,
        characters: unindexedCharacters?.count || 0,
        foreshadowing: unindexedForeshadowing?.count || 0,
      },
    })
  } catch (error) {
    console.error('Failed to get vector stats:', error)
    return c.json(
      {
        error: 'Failed to get vector stats',
        details: (error as Error).message,
      },
      500
    )
  }
})

/**
 * POST /reindex-all - 全量重建向量索引
 * @description 清除旧索引并重建指定小说的所有内容向量索引
 * @param {string} novelId - 小说ID
 * @param {string[]} [types] - 可选，指定要重建的类型列表
 * @returns {Object} { indexed, failed, details }
 */
router.post(
  '/reindex-all',
  zValidator(
    'json',
    z.object({
      novelId: z.string().min(1),
      types: z.array(z.enum(['setting', 'character', 'outline', 'foreshadowing'])).optional(),
      clearExisting: z.boolean().optional(),
    })
  ),
  async (c) => {
    const body = c.req.valid('json')
    const { novelId, types, clearExisting } = body

    if (!c.env.VECTORIZE) {
      return c.json({ error: 'Vectorize binding not configured' }, 503)
    }

    try {
      await enqueue(c.env, c, {
        type: 'reindex_all',
        payload: {
          novelId,
          types,
          clearExisting,
        },
      })

      return c.json({
        ok: true,
        message: `Reindex task enqueued for novel ${novelId}`,
      })
    } catch (error) {
      console.error('Failed to enqueue reindex-all:', error)
      return c.json(
        {
          error: 'Failed to enqueue reindex task',
          details: (error as Error).message,
        },
        500
      )
    }
  }
)

export { router as vectorize }
