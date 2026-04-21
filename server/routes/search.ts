/**
 * @file search.ts
 * @description 搜索路由模块，提供章节内容全文搜索功能
 * @version 1.0.0
 * @modified 2026-04-21 - 添加规范化注释
 */
import { Hono } from 'hono'
import { drizzle } from 'drizzle-orm/d1'
import { sql } from 'drizzle-orm'
import type { Env } from '../lib/types'

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
  const db = drizzle(c.env.DB)
  const q = c.req.query('q')
  const novelId = c.req.query('novelId')
  const limit = parseInt(c.req.query('limit') || '20')

  if (!q || q.trim().length < 2) {
    return c.json({ error: 'Query must be at least 2 characters' }, 400)
  }

  try {
    const rows = await db
      .select({
        id: c.env.DB.prepare(`
          SELECT 
            c.id, c.novelId, c.title, c.chapterNumber, c.summary,
            substr(c.content, 
              instr(lower(c.content), lower(?)) - 30, 
              120
            ) as snippet,
            length(replace(lower(c.content), lower(?), '')) - length(c.content) as rank
          FROM chapters c
          WHERE c.novelId = ?2
            AND c.deletedAt IS NULL
            AND c.content IS NOT NULL
            AND instr(lower(c.content), lower(?1)) > 0
          ORDER BY length(c.content) - (length(replace(lower(c.content), lower(?1), ''))) DESC
          LIMIT ?3
        `)
          .bind(q, novelId || '', q, limit)
          .raw() as any,
      })
      .from(sql`SELECT 1`)

    const results = await c.env.DB
      .prepare(
        `SELECT 
          c.id, c.novelId, c.title, c.chapterNumber, c.summary,
          CASE
            WHEN instr(lower(c.content), lower(?)) > 0
            THEN substr(c.content, MAX(1, instr(lower(c.content), lower(?)) - 30), 120)
            ELSE ''
          END as snippet
        FROM chapters c
        WHERE c.novelId = ?
          AND c.deletedAt IS NULL
          AND c.content IS NOT NULL
          AND instr(lower(c.content), lower(?)) > 0
        ORDER BY LENGTH(c.content) - (LENGTH(REPLACE(LOWER(c.content), LOWER(?), ''))) DESC
        LIMIT ?`
      )
      .bind(q, q, novelId || '', q, q, limit)
      .all()

    return c.json({
      query: q,
      total: results.results?.length || 0,
      results: (results.results || []).map((r: any) => ({
        id: r.id,
        novelId: r.novelId,
        title: r.title,
        chapterNumber: r.chapterNumber,
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
