/**
 * @file search.ts
 * @description 搜索路由模块，提供章节内容全文搜索功能
 * @version 1.0.0
 * @modified 2026-04-21 - 添加规范化注释
 */
import { Hono } from 'hono'
import type { Env } from '../lib/types'
import { logGeneration } from '../services/agent/logging'

const router = new Hono<{ Bindings: Env }>()

/**
 * GET / - 搜索章节内容
 * @description 在章节内容中进行全文搜索，返回匹配结果
 * @param {string} q - 搜索关键词（至少2个字符）
 * @param {string} [novelId] - 小说ID（可选过滤）
 * @param {number} [limit=20] - 返回结果数量限制
 * @returns {Object} { query: string, total: number, results: Array }
 * @throws {400} 查询参数过短
 */
router.get('/', async (c) => {
  const q = c.req.query('q')
  const novelId = c.req.query('novelId')
  const limit = parseInt(c.req.query('limit') || '20')

  if (!q || q.trim().length < 2) {
    return c.json({ error: 'Query must be at least 2 characters' }, 400)
  }

  try {
    const results = await c.env.DB
      .prepare(
        `SELECT
          c.id, c.novel_id, c.title, c.chapter_number, c.summary,
          CASE
            WHEN instr(lower(c.content), lower(?)) > 0
            THEN substr(c.content, MAX(1, instr(lower(c.content), lower(?)) - 30), 120)
            ELSE ''
          END as snippet
        FROM chapters c
        WHERE c.novel_id = ?
          AND c.deleted_at IS NULL
          AND c.content IS NOT NULL
          AND instr(lower(c.content), lower(?)) > 0
        ORDER BY LENGTH(c.content) - (LENGTH(REPLACE(LOWER(c.content), LOWER(?), ''))) DESC
        LIMIT ?`
      )
      .bind(q, q, novelId || '', q, q, limit)
      .all()

    const resultCount = results.results?.length || 0

    try {
      await logGeneration(c.env, {
        novelId: novelId || '',
        chapterId: null,
        stage: 'semantic_search',
        modelId: 'N/A',
        contextSnapshot: JSON.stringify({ query: q, resultsCount: resultCount }),
        durationMs: 0,
        status: 'success',
      })
    } catch (logError) {
      console.warn('[search] Failed to write log:', logError)
    }

    return c.json({
      query: q,
      total: resultCount,
      results: (results.results || []).map((r: any) => ({
        id: r.id,
        novelId: r.novel_id,
        title: r.title,
        chapterNumber: r.chapter_number,
        summary: r.summary,
        snippet: r.snippet,
      })),
    })
  } catch (error) {
    return c.json({
      query: q,
      total: 0,
      results: [],
      error: (error as Error).message,
    })
  }
})

export { router as search }
