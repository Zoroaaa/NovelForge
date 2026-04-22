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
// alias for use in new reindex routes
const characters = charactersTable

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
 * GET /status - 获取向量化服务状态（含完整诊断信息）
 * @description 检查所有 bindings 配置和运行状态，用于排查 503 问题
 * @returns {Object} { status, bindings, diagnostics, recommendations }
 */
router.get('/status', async (c) => {
  const diagnostics = {
    timestamp: new Date().toISOString(),
    environment: c.req.url.includes('pages.dev') ? 'preview' : 'production',
    bindings: {} as Record<string, any>,
    issues: [] as string[],
    recommendations: [] as string[]
  }

  try {
    // 检测 DB binding
    diagnostics.bindings.DB = {
      configured: !!c.env.DB,
      type: c.env.DB ? 'D1Database' : 'undefined'
    }
    if (!c.env.DB) {
      diagnostics.issues.push('DB (D1) binding 未配置')
    }

    // 检测 AI binding
    diagnostics.bindings.AI = {
      configured: !!c.env.AI,
      type: c.env.AI ? 'Ai' : 'undefined'
    }
    if (!c.env.AI) {
      diagnostics.issues.push('AI (Workers AI) binding 未配置')
    }

    // 检测 VECTORIZE binding（关键！）
    diagnostics.bindings.VECTORIZE = {
      configured: !!c.env.VECTORIZE,
      type: c.env.VECTORIZE ? c.env.VECTORIZE.constructor?.name || 'object' : 'undefined',
      hasUpsert: typeof c.env.VECTORIZE?.upsert === 'function',
      hasQuery: typeof c.env.VECTORIZE?.query === 'function',
      hasDeleteByIds: typeof c.env.VECTORIZE?.deleteByIds === 'function'
    }

    if (!c.env.VECTORIZE) {
      diagnostics.issues.push('❌ VECTORIZE binding 未配置或不可用（这是 503 的根本原因）')
      diagnostics.recommendations.push(
        '1. 在 Cloudflare Dashboard → Workers & Pages → novelforge → Settings → Bindings 中确认 VECTORIZE 绑定存在',
        '2. 绑定后必须重新部署项目（Redeploy）才能生效',
        '3. 检查 wrangler.toml 中的 [[vectorize]] 配置是否正确',
        '4. 确认 Vectorize 索引 "novelforge-index" 已创建且未过期'
      )

      return c.json({
        status: 'error',
        code: 'VECTORIZE_UNAVAILABLE',
        message: 'Vectorize 服务不可用（503）',
        diagnostics,
        quickFix: '请访问 Cloudflare Dashboard 确认绑定并重新部署'
      }, 503)
    }

    // 测试 AI embedding
    let aiWorking = false
    try {
      await embedText(c.env.AI, 'test')
      aiWorking = true
      diagnostics.bindings.AI.working = true
    } catch (e) {
      diagnostics.bindings.AI.working = false
      diagnostics.bindings.AI.error = (e as Error).message
      diagnostics.issues.push(`AI embedding 测试失败: ${(e as Error).message}`)
    }

    // 测试 Vectorize 基本操作
    let vectorizeWorking = false
    try {
      const testVector = {
        id: '__diagnostic_test__',
        values: Array(1024).fill(0.1),
        metadata: { test: true, ts: Date.now() }
      }
      await c.env.VECTORIZE.upsert([testVector])
      await c.env.VECTORIZE.deleteByIds(['__diagnostic_test__'])
      vectorizeWorking = true
      diagnostics.bindings.VECTORIZE.working = true
    } catch (e) {
      diagnostics.bindings.VECTORIZE.working = false
      diagnostics.bindings.VECTORIZE.error = (e as Error).message
      diagnostics.issues.push(`Vectorize 操作测试失败: ${(e as Error).message}`)
      diagnostics.recommendations.push(
        'Vectorize binding 存在但无法执行操作，可能是：',
        '- 索引已损坏或需要重建',
        '- 权限不足',
        '- 账户配额已用尽'
      )
    }

    if (diagnostics.issues.length === 0 && aiWorking && vectorizeWorking) {
      return c.json({
        status: 'ok',
        message: '✅ 所有服务正常运行',
        diagnostics,
        embeddingModel: '@cf/baai/bge-m3',
        dimensions: 1024
      })
    } else {
      return c.json({
        status: 'warning',
        message: `⚠️ 发现 ${diagnostics.issues.length} 个问题`,
        diagnostics
      })
    }
  } catch (error) {
    return c.json({
      status: 'error',
      message: '诊断过程出错',
      error: (error as Error).message,
      stack: (error as Error).stack,
      diagnostics
    }, 500)
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
 * POST /reindex-all - 查询待索引条目并返回列表（不执行索引，由前端分批并发调用 /reindex-items）
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
    const { novelId, types = ['setting', 'character', 'outline', 'foreshadowing'], clearExisting } = body
    const db = drizzle(c.env.DB)

    if (!c.env.VECTORIZE) {
      return c.json({ error: 'Vectorize binding not configured' }, 503)
    }

    try {
      // 清除旧索引
      if (clearExisting) {
        const existingVectors = await db.select({ id: vectorIndex.id })
          .from(vectorIndex)
          .where(eq(vectorIndex.novelId, novelId))
          .all()
        for (const v of existingVectors) {
          await c.env.VECTORIZE.deleteByIds([v.id]).catch(() => {})
        }
        await db.delete(vectorIndex).where(eq(vectorIndex.novelId, novelId))
      }

      // 收集所有待索引 items
      type IndexItem = {
        sourceType: string
        sourceId: string
        novelId: string
        title: string
        content: string
        extraMetadata?: Record<string, string>
      }
      const items: IndexItem[] = []

      if (types.includes('setting')) {
        const rows = await db.select({
          id: novelSettings.id, novelId: novelSettings.novelId,
          name: novelSettings.name, content: novelSettings.content,
          type: novelSettings.type, importance: novelSettings.importance,
        }).from(novelSettings).where(and(
          eq(novelSettings.novelId, novelId),
          sql`${novelSettings.deletedAt} IS NULL`,
          sql`${novelSettings.content} IS NOT NULL`
        )).all()
        for (const r of rows) {
          if (!r.content) continue
          items.push({ sourceType: 'setting', sourceId: r.id, novelId: r.novelId, title: r.name, content: r.content, extraMetadata: { settingType: r.type, importance: r.importance } })
        }
      }

      if (types.includes('character')) {
        const rows = await db.select({
          id: characters.id, novelId: characters.novelId,
          name: characters.name, description: characters.description,
        }).from(characters).where(and(
          eq(characters.novelId, novelId),
          sql`${characters.deletedAt} IS NULL`,
          sql`${characters.description} IS NOT NULL`
        )).all()
        for (const r of rows) {
          if (!r.description) continue
          items.push({ sourceType: 'character', sourceId: r.id, novelId: r.novelId, title: r.name, content: r.description })
        }
      }

      if (types.includes('foreshadowing')) {
        const rows = await db.select({
          id: foreshadowing.id, novelId: foreshadowing.novelId,
          title: foreshadowing.title, description: foreshadowing.description, importance: foreshadowing.importance,
        }).from(foreshadowing).where(and(
          eq(foreshadowing.novelId, novelId),
          sql`${foreshadowing.deletedAt} IS NULL`,
          sql`${foreshadowing.description} IS NOT NULL`
        )).all()
        for (const r of rows) {
          if (!r.description) continue
          items.push({ sourceType: 'foreshadowing', sourceId: r.id, novelId: r.novelId, title: r.title, content: r.description, extraMetadata: { importance: r.importance } })
        }
      }

      if (types.includes('outline')) {
        const rows = await db.select({
          id: masterOutline.id, novelId: masterOutline.novelId,
          title: masterOutline.title, content: masterOutline.content,
        }).from(masterOutline).where(and(
          eq(masterOutline.novelId, novelId),
          sql`${masterOutline.deletedAt} IS NULL`,
          sql`${masterOutline.content} IS NOT NULL`
        )).all()
        for (const r of rows) {
          if (!r.content) continue
          items.push({ sourceType: 'outline', sourceId: r.id, novelId: r.novelId, title: r.title, content: r.content })
        }
      }

      return c.json({ ok: true, items, total: items.length })
    } catch (error) {
      console.error('reindex-all list failed:', error)
      return c.json({ error: 'Failed to list reindex items', details: (error as Error).message }, 500)
    }
  }
)

/**
 * POST /reindex-items - 同步执行一批索引（前端并发调用）
 * @param items - IndexItem 数组（每批建议 1~2 条，最多 5 条）
 * @returns { ok, indexed, failed, errors }
 */
router.post(
  '/reindex-items',
  zValidator(
    'json',
    z.object({
      items: z.array(z.object({
        sourceType: z.enum(['setting', 'character', 'outline', 'foreshadowing', 'chapter', 'summary']),
        sourceId: z.string().min(1),
        novelId: z.string().min(1),
        title: z.string(),
        content: z.string().max(50000),
        extraMetadata: z.record(z.string(), z.string()).optional(),
      })).max(5, '单次请求最多 5 条，请分批处理')
    })
  ),
  async (c) => {
    const startTime = Date.now()
    const { items } = c.req.valid('json')

    console.log(`[reindex-items] Received ${items.length} items to index`)

    if (!c.env.VECTORIZE) {
      return c.json({
        error: 'Vectorize service unavailable',
        code: 'VECTORIZE_NOT_CONFIGURED',
        message: '向量索引服务未配置。请在 Cloudflare 控制台创建 Vectorize 索引，或在 wrangler.toml 中确认绑定配置。',
        docs: 'https://developers.cloudflare.com/vectorize/get-started/'
      }, 503)
    }

    let indexed = 0
    let failed = 0
    const errors: string[] = []

    // 串行处理以避免并发过高导致 CPU 超时
    for (const item of items) {
      try {
        console.log(`[reindex-items] Indexing ${item.sourceType}:${item.sourceId}...`)
        const result = await indexContent(c.env, item.sourceType as any, item.sourceId, item.novelId, item.title, item.content, item.extraMetadata)
        indexed++
        if (result.length > 0) {
          console.log(`[reindex-items] ✓ ${item.sourceType}:${item.sourceId} - ${result.length} vectors`)
        } else {
          console.log(`[reindex-items] ⊘ ${item.sourceType}:${item.sourceId} - skipped (unchanged or empty)`)
        }
      } catch (e) {
        failed++
        const errorMsg = e instanceof Error ? e.message : String(e)
        errors.push(`${item.sourceType}:${item.sourceId} - ${errorMsg}`)
        console.error(`[reindex-items] ✗ Failed to index ${item.sourceType}:${item.sourceId}:`, e)
      }
    }

    const duration = Date.now() - startTime
    console.log(`[reindex-items] Completed in ${duration}ms: ${indexed} indexed, ${failed} failed`)

    return c.json({ ok: true, indexed, failed, errors, duration })
  }
)

export { router as vectorize }
