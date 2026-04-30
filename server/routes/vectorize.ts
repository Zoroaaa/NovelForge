/**
 * @file vectorize.ts
 * @description 向量化索引路由模块，提供内容向量化、相似度搜索和索引管理功能
 * @version 2.0.0
 * @modified 2026-04-22 - 改造为 Workers 独立部署，向量化全量重建回归 Queue 后台执行
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
  searchSimilarMulti,
  ACTIVE_SOURCE_TYPES,
  embedText,
  fetchContentForIndexing,
} from '../services/embedding'
import { vectorIndex, novelSettings, characters as charactersTable, masterOutline, foreshadowing, novels } from '../db/schema'
import { enqueue, enqueueBatch, QueueMessage } from '../lib/queue'

const router = new Hono<{ Bindings: Env }>()

router.post(
  '/index',
  zValidator(
    'json',
    z.object({
      sourceType: z.enum(['chapter', 'character', 'summary', 'setting', 'foreshadowing']),
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
      if (sourceType === 'chapter') {
        const fetched = await fetchContentForIndexing(c.env, sourceType, sourceId)
        content = fetched.content
      }
    }

    if (content) {
      const MAX_CONTENT_LENGTH: Record<string, number> = {
        setting: 500,
        character: 400,
        foreshadowing: 0,
        chapter: 0,
        summary: 0,
      }
      const maxLen = MAX_CONTENT_LENGTH[sourceType]
      if (maxLen && content.length > maxLen) {
        content = content.slice(0, maxLen)
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

router.delete('/:type/:id', async (c) => {
  const sourceType = c.req.param('type') as any
  const sourceId = c.req.param('id')

  if (!['chapter', 'character', 'summary', 'setting', 'foreshadowing'].includes(sourceType)) {
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

router.get('/search', async (c) => {
  const query = c.req.query('q')
  const novelId = c.req.query('novelId')
  const sourceTypesParam = c.req.query('sourceTypes')

  if (!query) {
    return c.json({ error: 'Query parameter "q" is required' }, 400)
  }

  if (!c.env.VECTORIZE) {
    return c.json({ error: 'Vectorize binding not configured' }, 503)
  }

  try {
    const queryVector = await embedText(c.env.AI, query)
    const sourceTypes = sourceTypesParam
      ? sourceTypesParam.split(',').map(s => s.trim())
      : [...ACTIVE_SOURCE_TYPES]

    const results = await searchSimilarMulti(c.env.VECTORIZE, queryVector, {
      topK: 10,
      novelId: novelId || '',
      sourceTypes,
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

export async function handleVectorStatus(c: any) {
  const diagnostics = {
    timestamp: new Date().toISOString(),
    environment: c.req.url.includes('pages.dev') ? 'preview' : 'production',
    bindings: {} as Record<string, unknown>,
    issues: [] as string[],
    recommendations: [] as string[]
  }

  try {
    diagnostics.bindings.DB = {
      configured: !!c.env.DB,
      type: c.env.DB ? 'D1Database' : 'undefined'
    }
    if (!c.env.DB) {
      diagnostics.issues.push('DB (D1) binding 未配置')
    }

    diagnostics.bindings.AI = {
      configured: !!c.env.AI,
      type: c.env.AI ? 'Ai' : 'undefined'
    }
    if (!c.env.AI) {
      diagnostics.issues.push('AI (Workers AI) binding 未配置')
    }

    diagnostics.bindings.VECTORIZE = {
      configured: !!c.env.VECTORIZE,
      type: c.env.VECTORIZE ? (c.env.VECTORIZE as object).constructor?.name || 'object' : 'undefined',
      hasUpsert: typeof (c.env.VECTORIZE as Record<string, unknown>)?.upsert === 'function',
      hasQuery: typeof (c.env.VECTORIZE as Record<string, unknown>)?.query === 'function',
      hasDeleteByIds: typeof (c.env.VECTORIZE as Record<string, unknown>)?.deleteByIds === 'function'
    }

    if (!c.env.VECTORIZE) {
      diagnostics.issues.push('VECTORIZE binding 未配置或不可用')
      diagnostics.recommendations.push(
        '1. 在 Cloudflare Dashboard → Workers → novelforge → Settings → Bindings 中确认 VECTORIZE 绑定存在',
        '2. 绑定后必须重新部署项目才能生效',
        '3. 检查 wrangler.toml 中的 [[vectorize]] 配置是否正确',
        '4. 确认 Vectorize 索引 "novelforge-index" 已创建且未过期'
      )

      return c.json({
        status: 'error',
        code: 'VECTORIZE_UNAVAILABLE',
        message: 'Vectorize 服务不可用',
        diagnostics,
        quickFix: '请访问 Cloudflare Dashboard 确认绑定并重新部署'
      }, 503)
    }

    let aiWorking = false
    try {
      await embedText(c.env.AI, 'test')
      aiWorking = true
      ;(diagnostics.bindings.AI as Record<string, unknown>).working = true
    } catch (e) {
      ;(diagnostics.bindings.AI as Record<string, unknown>).working = false
      ;(diagnostics.bindings.AI as Record<string, unknown>).error = (e as Error).message
      diagnostics.issues.push(`AI embedding 测试失败: ${(e as Error).message}`)
    }

    let vectorizeWorking = false
    try {
      const testVector = {
        id: '__diagnostic_test__',
        values: Array(1024).fill(0.1),
        metadata: { test: true, ts: Date.now() }
      }
      await (c.env.VECTORIZE as { upsert: (v: unknown[]) => Promise<unknown> }).upsert([testVector])
      await (c.env.VECTORIZE as { deleteByIds: (ids: string[]) => Promise<unknown> }).deleteByIds(['__diagnostic_test__'])
      vectorizeWorking = true
      ;(diagnostics.bindings.VECTORIZE as Record<string, unknown>).working = true
    } catch (e) {
      ;(diagnostics.bindings.VECTORIZE as Record<string, unknown>).working = false
      ;(diagnostics.bindings.VECTORIZE as Record<string, unknown>).error = (e as Error).message
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
        message: '所有服务正常运行',
        diagnostics,
        embeddingModel: '@cf/baai/bge-m3',
        dimensions: 1024
      })
    } else {
      return c.json({
        status: 'warning',
        message: `发现 ${diagnostics.issues.length} 个问题`,
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
}

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
      .leftJoin(vectorIndex, and(
        eq(vectorIndex.sourceId, foreshadowing.id),
        eq(vectorIndex.sourceType, 'foreshadowing')
      ))
      .where(
        and(
          eq(foreshadowing.novelId, novelId),
          isNull(foreshadowing.deletedAt),
          sql`${foreshadowing.description} IS NOT NULL`,
          sql`${foreshadowing.description} != ''`,
          sql`${vectorIndex.id} IS NULL`
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

router.post(
  '/reindex-all',
  zValidator(
    'json',
    z.object({
      novelId: z.string().min(1),
      types: z.array(z.enum(['setting', 'character', 'foreshadowing'])).optional(),
      clearExisting: z.boolean().optional(),
    })
  ),
  async (c) => {
    const body = c.req.valid('json')
    const { novelId, types = ['setting', 'character', 'foreshadowing'], clearExisting } = body

    if (!c.env.VECTORIZE) {
      return c.json({ error: 'Vectorize binding not configured' }, 503)
    }

    if (!c.env.TASK_QUEUE) {
      return c.json({ error: 'Task queue not configured', code: 'QUEUE_UNAVAILABLE' }, 503)
    }

    try {
      await enqueue(c.env, {
        type: 'reindex_all',
        payload: { novelId, types, clearExisting: clearExisting ?? true },
      })

      return c.json({
        ok: true,
        message: '全量索引重建任务已提交到后台队列，请稍后查看索引统计',
        novelId,
      })
    } catch (error) {
      console.error('Failed to enqueue reindex task:', error)
      return c.json({ error: 'Failed to enqueue reindex task', details: (error as Error).message }, 500)
    }
  }
)

router.post(
  '/index-missing',
  zValidator(
    'json',
    z.object({
      novelId: z.string().min(1),
      types: z.array(z.enum(['setting', 'character', 'foreshadowing'])).optional(),
    })
  ),
  async (c) => {
    const body = c.req.valid('json')
    const { novelId, types = ['setting', 'character', 'foreshadowing'] } = body
    const db = drizzle(c.env.DB)

    if (!c.env.VECTORIZE) {
      return c.json({ error: 'Vectorize binding not configured' }, 503)
    }

    if (!c.env.TASK_QUEUE) {
      return c.json({ error: 'Task queue not configured', code: 'QUEUE_UNAVAILABLE' }, 503)
    }

    try {
      const messages: QueueMessage[] = []
      const stats = { settings: 0, characters: 0, foreshadowing: 0 }

      if (types.includes('setting')) {
        const unindexedSettings = await db
          .select({ id: novelSettings.id, novelId: novelSettings.novelId, name: novelSettings.name, content: novelSettings.content, summary: novelSettings.summary, type: novelSettings.type, importance: novelSettings.importance })
          .from(novelSettings)
          .leftJoin(vectorIndex, and(eq(vectorIndex.sourceId, novelSettings.id), eq(vectorIndex.sourceType, 'setting')))
          .where(and(eq(novelSettings.novelId, novelId), sql`${novelSettings.deletedAt} IS NULL`, sql`${novelSettings.content} IS NOT NULL`, sql`${novelSettings.content} != ''`, sql`${vectorIndex.id} IS NULL`))
          .all()

        for (const s of unindexedSettings) {
          const indexContent = s.summary || (s.content.length > 500 ? s.content.slice(0, 500) : s.content)
          messages.push({ type: 'index_content', payload: { sourceType: 'setting', sourceId: s.id, novelId: s.novelId, title: s.name, content: indexContent, extraMetadata: { settingType: s.type, importance: s.importance } } })
          stats.settings++
        }
      }

      if (types.includes('character')) {
        const unindexedChars = await db
          .select({ id: charactersTable.id, novelId: charactersTable.novelId, name: charactersTable.name, description: charactersTable.description, role: charactersTable.role })
          .from(charactersTable)
          .leftJoin(vectorIndex, and(eq(vectorIndex.sourceId, charactersTable.id), eq(vectorIndex.sourceType, 'character')))
          .where(and(eq(charactersTable.novelId, novelId), sql`${charactersTable.deletedAt} IS NULL`, sql`${charactersTable.description} IS NOT NULL`, sql`${vectorIndex.id} IS NULL`))
          .all()

        for (const ch of unindexedChars) {
          const indexText = `${ch.name}${ch.role ? ` (${ch.role})` : ''}\n${(ch.description || '').slice(0, 300)}`
          messages.push({ type: 'index_content', payload: { sourceType: 'character', sourceId: ch.id, novelId: ch.novelId, title: ch.name, content: indexText } })
          stats.characters++
        }
      }

      if (types.includes('foreshadowing')) {
        const unindexedForeshadowing = await db
          .select({ id: foreshadowing.id, novelId: foreshadowing.novelId, title: foreshadowing.title, description: foreshadowing.description, importance: foreshadowing.importance })
          .from(foreshadowing)
          .leftJoin(vectorIndex, and(eq(vectorIndex.sourceId, foreshadowing.id), eq(vectorIndex.sourceType, 'foreshadowing')))
          .where(and(eq(foreshadowing.novelId, novelId), sql`${foreshadowing.deletedAt} IS NULL`, sql`${foreshadowing.description} IS NOT NULL`, sql`${foreshadowing.description} != ''`, sql`${vectorIndex.id} IS NULL`))
          .all()

        for (const f of unindexedForeshadowing) {
          if (!f.description) continue
          messages.push({ type: 'index_content', payload: { sourceType: 'foreshadowing', sourceId: f.id, novelId: f.novelId, title: f.title, content: f.description, extraMetadata: { importance: f.importance } } })
          stats.foreshadowing++
        }
      }

      if (messages.length > 0) {
        await enqueueBatch(c.env, messages)
      }

      return c.json({
        ok: true,
        message: `发现 ${messages.length} 条未索引记录，已提交增量索引任务`,
        novelId,
        stats,
      })
    } catch (error) {
      console.error('Failed to index missing:', error)
      return c.json({ error: 'Failed to index missing content', details: (error as Error).message }, 500)
    }
  }
)

export { router as vectorize }

router.delete('/orphan-indexes', async (c) => {
  if (!c.env.VECTORIZE) {
    return c.json({ error: 'Vectorize binding not configured' }, 503)
  }

  const db = drizzle(c.env.DB)

  const allNovelIds = await db
    .select({ id: novels.id })
    .from(novels)
    .all()

  const validNovelIds = new Set(allNovelIds.map(n => n.id))

  const orphanedVectors = await db
    .select({ id: vectorIndex.id, novelId: vectorIndex.novelId, sourceType: vectorIndex.sourceType, sourceId: vectorIndex.sourceId })
    .from(vectorIndex)
    .all()

  const orphansToDelete = orphanedVectors.filter(v => !validNovelIds.has(v.novelId))

  if (orphansToDelete.length === 0) {
    return c.json({ ok: true, deleted: 0, message: '没有发现残留索引' })
  }

  let deletedCount = 0
  for (const v of orphansToDelete) {
    await c.env.VECTORIZE.deleteByIds([v.id]).catch(() => {})
    await db.delete(vectorIndex).where(eq(vectorIndex.id, v.id)).run()
    deletedCount++
  }

  return c.json({ ok: true, deleted: deletedCount, message: `已清空 ${deletedCount} 条残留索引` })
})

router.post('/clear-all', async (c) => {
  if (!c.env.VECTORIZE) {
    return c.json({ error: 'Vectorize binding not configured' }, 503)
  }

  const db = drizzle(c.env.DB)

  const allVectors = await db.select({ id: vectorIndex.id }).from(vectorIndex).all()

  if (allVectors.length === 0) {
    return c.json({ ok: true, deleted: 0, message: '没有索引记录' })
  }

  for (const v of allVectors) {
    await c.env.VECTORIZE.deleteByIds([v.id]).catch(() => {})
  }

  await db.delete(vectorIndex).run()

  return c.json({ ok: true, deleted: allVectors.length, message: `已清空全部 ${allVectors.length} 条索引记录` })
})
