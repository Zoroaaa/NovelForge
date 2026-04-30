/**
 * @file novels.ts
 * @description 小说管理路由模块，提供小说CRUD、封面上传等功能
 * @version 1.0.0
 * @modified 2026-04-21 - 添加规范化注释
 */
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { drizzle } from 'drizzle-orm/d1'
import { novels as t, chapters, characters, novelSettings, masterOutline, volumes, foreshadowing, writingRules } from '../db/schema'
import { eq, isNull, desc, and, sql } from 'drizzle-orm'
import type { Env } from '../lib/types'
import { deindexContent, deindexNovel } from '../services/embedding'
import { generateGenreSystemPrompt } from '../services/workshop/generateGenreSystemPrompt'

const router = new Hono<{ Bindings: Env }>()

const CreateSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().optional(),
  genre: z.string().optional(),
  status: z.enum(['draft', 'writing', 'completed', 'archived']).optional(),
  targetWordCount: z.number().optional(),
  targetChapterCount: z.number().optional(),
  systemPrompt: z.string().optional(),
})

/**
 * GET / - 获取小说列表（支持分页和过滤）
 * @description 获取所有未删除的小说，按更新时间倒序排列
 * @query {number} [page=1] - 页码
 * @query {number} [perPage=20] - 每页数量（1-100）
 * @query {string} [status] - 状态过滤：draft | writing | completed | archived
 * @query {string} [genre] - 类型过滤
 * @returns {Object} { data: Array, total: number, page: number, perPage: number }
 */
router.get('/', zValidator('query', z.object({
  page: z.coerce.number().min(1).default(1),
  perPage: z.coerce.number().min(1).max(100).default(20),
  status: z.enum(['draft', 'writing', 'completed', 'archived']).optional(),
  genre: z.string().optional(),
})), async (c) => {
  const { page, perPage, status, genre } = c.req.valid('query')
  const db = drizzle(c.env.DB)
  const offset = (page - 1) * perPage

  const validConditions = [
    isNull(t.deletedAt),
    status ? eq(t.status, status) : undefined,
    genre ? eq(t.genre, genre) : undefined,
  ].filter((c): c is Exclude<typeof c, undefined> => Boolean(c))

  const rows = await db.select()
    .from(t)
    .where(and(...validConditions))
    .orderBy(desc(t.updatedAt))
    .limit(perPage)
    .offset(offset)

  const countResult = await db.select({ count: sql`count(*)` })
    .from(t)
    .where(isNull(t.deletedAt))
    .get()

  return c.json({
    data: rows,
    total: Number(countResult?.count ?? 0),
    page,
    perPage,
  })
})

/**
 * GET /trash - 获取所有已删除的小说（全局回收站）
 * @description 获取所有标记为删除的小说及其删除时间
 * @returns {Object} { ok: boolean, novels: Array, total: number }
 */
router.get('/trash', async (c) => {
  const db = drizzle(c.env.DB)

  const deletedNovels = await db.select({
    id: t.id,
    title: t.title,
    genre: t.genre,
    status: t.status,
    wordCount: t.wordCount,
    chapterCount: t.chapterCount,
    deletedAt: t.deletedAt,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  })
    .from(t)
    .where(sql`${t.deletedAt} IS NOT NULL`)
    .orderBy(desc(t.deletedAt))
    .all()

  return c.json({ ok: true, novels: deletedNovels, total: deletedNovels.length })
})

/**
 * DELETE /trash - 永久删除小说及其所有关联数据
 * @description 彻底删除小说本身，并级联清理所有关联数据
 * @query {string} id - 小说ID
 * @returns {Object} { ok: boolean, deleted: number }
 */
router.delete('/trash', async (c) => {
  const novelId = c.req.query('id')
  if (!novelId) {
    return c.json({ error: 'Missing novel id' }, 400)
  }

  const db = drizzle(c.env.DB)

  const deletedNovel = await db.select({ id: t.id }).from(t).where(and(eq(t.id, novelId), sql`${t.deletedAt} IS NOT NULL`)).get()
  if (!deletedNovel) {
    return c.json({ error: 'Novel not found in trash' }, 404)
  }

  let totalDeleted = 0

  try {
    await c.env.DB.prepare(
      `DELETE FROM foreshadowing_progress WHERE foreshadowing_id IN (SELECT id FROM foreshadowing WHERE novel_id = ?)`
    ).bind(novelId).run()

    await c.env.DB.prepare(
      `DELETE FROM foreshadowing WHERE novel_id = ?`
    ).bind(novelId).run()

    await c.env.DB.prepare(
      `DELETE FROM check_logs WHERE novel_id = ?`
    ).bind(novelId).run()

    await c.env.DB.prepare(
      `DELETE FROM generation_logs WHERE novel_id = ?`
    ).bind(novelId).run()

    await c.env.DB.prepare(
      `DELETE FROM exports WHERE novel_id = ?`
    ).bind(novelId).run()

    await c.env.DB.prepare(
      `DELETE FROM queue_task_logs WHERE novel_id = ?`
    ).bind(novelId).run()

    await c.env.DB.prepare(
      `DELETE FROM batch_generation_tasks WHERE novel_id = ?`
    ).bind(novelId).run()

    await c.env.DB.prepare(
      `DELETE FROM quality_scores WHERE novel_id = ?`
    ).bind(novelId).run()

    await c.env.DB.prepare(
      `DELETE FROM workshop_sessions WHERE novel_id = ?`
    ).bind(novelId).run()

    await c.env.DB.prepare(
      `DELETE FROM model_configs WHERE novel_id = ?`
    ).bind(novelId).run()

    await c.env.DB.prepare(
      `DELETE FROM entity_index WHERE novel_id = ?`
    ).bind(novelId).run()

    await deindexNovel(c.env, novelId)

    await c.env.DB.prepare(
      `DELETE FROM plot_edges WHERE novel_id = ?`
    ).bind(novelId).run()

    await c.env.DB.prepare(
      `DELETE FROM plot_nodes WHERE novel_id = ?`
    ).bind(novelId).run()

    await c.env.DB.prepare(
      `DELETE FROM chapters WHERE novel_id = ?`
    ).bind(novelId).run()

    await c.env.DB.prepare(
      `DELETE FROM volumes WHERE novel_id = ?`
    ).bind(novelId).run()

    await c.env.DB.prepare(
      `DELETE FROM characters WHERE novel_id = ?`
    ).bind(novelId).run()

    await c.env.DB.prepare(
      `DELETE FROM novel_settings WHERE novel_id = ?`
    ).bind(novelId).run()

    await c.env.DB.prepare(
      `DELETE FROM master_outline WHERE novel_id = ?`
    ).bind(novelId).run()

    await c.env.DB.prepare(
      `DELETE FROM writing_rules WHERE novel_id = ?`
    ).bind(novelId).run()

    const result = await c.env.DB.prepare(
      `DELETE FROM novels WHERE id = ? AND deleted_at IS NOT NULL`
    ).bind(novelId).run()

    totalDeleted = result.meta.changes ?? 0

    return c.json({ ok: true, deleted: totalDeleted })
  } catch (e) {
    console.error('[trash] Failed to permanently delete novel:', e)
    return c.json({ error: '删除失败' }, 500)
  }
})

/**
 * GET /:id - 获取单个小说详情
 * @param {string} id - 小说ID
 * @returns {Object} 小说对象
 * @throws {404} 小说不存在
 */
router.get('/:id', async (c) => {
  const db = drizzle(c.env.DB)
  const row = await db.select().from(t).where(eq(t.id, c.req.param('id'))).get()
  if (!row || row.deletedAt) return c.json({ error: 'Not found' }, 404)
  return c.json(row)
})

/**
 * POST / - 创建新小说
 * @param {string} title - 小说标题（必填，1-200字符）
 * @param {string} [description] - 小说简介
 * @param {string} [genre] - 小说类型
 * @returns {Object} 创建的小说对象
 */
router.post('/', zValidator('json', CreateSchema), async (c) => {
  const db = drizzle(c.env.DB)
  const [row] = await db.insert(t).values(c.req.valid('json')).returning()
  return c.json(row, 201)
})

/**
 * PATCH /:id - 更新小说信息
 * @param {string} id - 小说ID
 * @param {Object} body - 更新内容
 * @returns {Object} 更新后的小说对象
 */
router.patch('/:id', zValidator('json', CreateSchema.partial()), async (c) => {
  const db = drizzle(c.env.DB)
  const [row] = await db.update(t)
    .set({ ...c.req.valid('json'), updatedAt: sql`(unixepoch())` })
    .where(eq(t.id, c.req.param('id')))
    .returning()
  return c.json(row)
})

router.post('/:id/generate-system-prompt', async (c) => {
  const novelId = c.req.param('id')
  const db = drizzle(c.env.DB)

  const novel = await db.select().from(t).where(eq(t.id, novelId)).get()
  if (!novel || novel.deletedAt) {
    return c.json({ error: '小说不存在' }, 404)
  }

  const charList = await db.select({ name: characters.name, role: characters.role, description: characters.description, powerLevel: characters.powerLevel })
    .from(characters)
    .where(and(eq(characters.novelId, novelId), sql`${characters.deletedAt} IS NULL`))
    .limit(10)
    .all()

  const settingList = await db.select({ name: novelSettings.name, type: novelSettings.type, summary: novelSettings.summary })
    .from(novelSettings)
    .where(and(eq(novelSettings.novelId, novelId), sql`${novelSettings.deletedAt} IS NULL`))
    .limit(10)
    .all()

  const ruleList = await db.select({ category: writingRules.category, title: writingRules.title, content: writingRules.content })
    .from(writingRules)
    .where(eq(writingRules.novelId, novelId))
    .limit(10)
    .all()

  const data: import('../services/workshop/types').WorkshopExtractedData = {
    title: novel.title,
    genre: novel.genre || undefined,
    description: novel.description || undefined,
    coreAppeal: undefined,
    writingRules: ruleList.map(r => ({ category: 'general', title: r.title, content: r.content || '' })),
  }

  const extraContext = [
    charList.length > 0 ? `主要角色：${charList.map(c => `${c.name}（${c.role}${c.powerLevel ? '，' + c.powerLevel : ''}）`).join('、')}` : '',
    settingList.length > 0 ? `世界设定：${settingList.map(s => `${s.name}（${s.type}）`).join('、')}` : '',
  ].filter(Boolean).join('\n')

  try {
    const systemPrompt = await generateGenreSystemPrompt(c.env, novelId, data, extraContext)
    await db.update(t).set({ systemPrompt, updatedAt: sql`(unixepoch())` }).where(eq(t.id, novelId)).run()
    return c.json({ ok: true, systemPrompt })
  } catch (e) {
    console.error('[generate-system-prompt] 生成失败:', e)
    return c.json({ error: '生成失败: ' + (e as Error).message }, 500)
  }
})

/**
 * PATCH /:id/restore - 恢复已删除的小说
 * @param {string} id - 小说ID
 * @returns {Object} 恢复后的小说对象
 */
router.patch('/:id/restore', async (c) => {
  const db = drizzle(c.env.DB)
  const [row] = await db.update(t)
    .set({ deletedAt: null, updatedAt: sql`(unixepoch())` })
    .where(and(eq(t.id, c.req.param('id')), sql`${t.deletedAt} IS NOT NULL`))
    .returning()
  if (!row) return c.json({ error: 'Not found or not deleted' }, 404)
  return c.json(row)
})

/**
 * DELETE /:id - 删除小说（软删除）
 * @param {string} id - 小说ID
 * @returns {Object} { ok: boolean }
 */
router.delete('/:id', async (c) => {
  const db = drizzle(c.env.DB)
  await db.update(t)
    .set({ deletedAt: sql`(unixepoch())` })
    .where(eq(t.id, c.req.param('id')))
  return c.json({ ok: true })
})

/**
 * POST /:id/cover - 上传小说封面
 * @description 上传封面图片到R2存储，自动删除旧封面
 * @param {string} id - 小说ID
 * @param {File} body - 图片文件（Content-Type: image/*）
 * @returns {Object} { ok: boolean, coverUrl: string }
 * @throws {400} 非图片文件
 */
router.post('/:id/cover', async (c) => {
  const id = c.req.param('id')
  const db = drizzle(c.env.DB)

  const contentType = c.req.header('content-type') || ''
  if (!contentType.includes('image/')) {
    return c.json({ error: 'Only image files are allowed' }, 400)
  }

  const body = await c.req.arrayBuffer()
  const key = `covers/${id}/${Date.now()}.jpg`

  await c.env.STORAGE.put(key, body, { httpMetadata: { contentType } })

  const novel = await db.select({ coverR2Key: t.coverR2Key }).from(t).where(eq(t.id, id)).get()

  if (novel?.coverR2Key) {
    try { await c.env.STORAGE.delete(novel.coverR2Key) } catch {}
  }

  await db.update(t).set({ coverR2Key: key, updatedAt: sql`(unixepoch())` }).where(eq(t.id, id))

  return c.json({ ok: true, coverUrl: `/api/novels/${id}/cover` })
})

/**
 * GET /:id/trash - 获取小说的回收站（所有软删除数据）
 * @description 查询该小说下所有表的软删除记录，按表分组返回
 * @param {string} id - 小说ID
 * @returns {Object} { tables: Array<{ name, label, count, items }>, total }
 */
router.get('/:id/trash', async (c) => {
  const novelId = c.req.param('id')
  const db = drizzle(c.env.DB)

  try {
    const [deletedChapters, deletedCharacters, deletedSettings, deletedOutlines, deletedVolumes, deletedForeshadowing, deletedRules] = await Promise.all([
      db.select({ id: chapters.id, title: chapters.title, sortOrder: chapters.sortOrder, deletedAt: chapters.deletedAt })
        .from(chapters).where(and(eq(chapters.novelId, novelId), sql`${chapters.deletedAt} IS NOT NULL`)).orderBy(desc(chapters.deletedAt)).limit(50).all(),
      db.select({ id: characters.id, name: characters.name, role: characters.role, deletedAt: characters.deletedAt })
        .from(characters).where(and(eq(characters.novelId, novelId), sql`${characters.deletedAt} IS NOT NULL`)).orderBy(desc(characters.deletedAt)).limit(50).all(),
      db.select({ id: novelSettings.id, name: novelSettings.name, type: novelSettings.type, deletedAt: novelSettings.deletedAt })
        .from(novelSettings).where(and(eq(novelSettings.novelId, novelId), sql`${novelSettings.deletedAt} IS NOT NULL`)).orderBy(desc(novelSettings.deletedAt)).limit(50).all(),
      db.select({ id: masterOutline.id, title: masterOutline.title, deletedAt: masterOutline.deletedAt })
        .from(masterOutline).where(and(eq(masterOutline.novelId, novelId), sql`${masterOutline.deletedAt} IS NOT NULL`)).orderBy(desc(masterOutline.deletedAt)).limit(20).all(),
      db.select({ id: volumes.id, title: volumes.title, sortOrder: volumes.sortOrder, deletedAt: volumes.deletedAt })
        .from(volumes).where(and(eq(volumes.novelId, novelId), sql`${volumes.deletedAt} IS NOT NULL`)).orderBy(desc(volumes.deletedAt)).limit(20).all(),
      db.select({ id: foreshadowing.id, title: foreshadowing.title, status: foreshadowing.status, deletedAt: foreshadowing.deletedAt })
        .from(foreshadowing).where(and(eq(foreshadowing.novelId, novelId), sql`${foreshadowing.deletedAt} IS NOT NULL`)).orderBy(desc(foreshadowing.deletedAt)).limit(50).all(),
      db.select({ id: writingRules.id, title: writingRules.title, category: writingRules.category, deletedAt: writingRules.deletedAt })
        .from(writingRules).where(and(eq(writingRules.novelId, novelId), sql`${writingRules.deletedAt} IS NOT NULL`)).orderBy(desc(writingRules.deletedAt)).limit(30).all(),
    ])

    const tables = [
      { key: 'chapters', label: '章节', icon: 'BookOpen', count: deletedChapters.length, items: deletedChapters },
      { key: 'characters', label: '角色', icon: 'Users', count: deletedCharacters.length, items: deletedCharacters },
      { key: 'settings', label: '设定', icon: 'Layers', count: deletedSettings.length, items: deletedSettings },
      { key: 'outlines', label: '总纲', icon: 'AlignLeft', count: deletedOutlines.length, items: deletedOutlines },
      { key: 'volumes', label: '卷', icon: 'Library', count: deletedVolumes.length, items: deletedVolumes },
      { key: 'foreshadowing', label: '伏笔', icon: 'Bookmark', count: deletedForeshadowing.length, items: deletedForeshadowing },
      { key: 'rules', label: '规则', icon: 'ScrollText', count: deletedRules.length, items: deletedRules },
    ].filter(t => t.count > 0)

    return c.json({ ok: true, tables, total: tables.reduce((s, t) => s + t.count, 0) })
  } catch (error) {
    console.error('Trash query failed:', error)
    return c.json({ error: '查询回收站失败' }, 500)
  }
})

/**
 * DELETE /:id/trash - 清空回收站（永久删除软删除数据）
 * @description 可按表类型过滤或全部清除
 * @param {string} id - 小说ID
 * @query {string} table - 可选，指定表名（chapters/characters/settings/outlines/volumes/foreshadowing/rules），不传则全部清除
 * @returns {Object} { ok: boolean, deleted: number }
 */
router.delete('/:id/trash', async (c) => {
  const novelId = c.req.param('id')
  const targetTable = c.req.query('table') || ''

  const allTables = ['chapters', 'characters', 'settings', 'outlines', 'volumes', 'foreshadowing', 'rules']
  const tablesToClean = targetTable ? [targetTable] : allTables

  let totalDeleted = 0

  for (const tbl of tablesToClean) {
    if (!allTables.includes(tbl)) continue

    let tableName: string
    switch (tbl) {
      case 'chapters': tableName = 'chapters'; break
      case 'characters': tableName = 'characters'; break
      case 'settings': tableName = 'novel_settings'; break
      case 'outlines': tableName = 'master_outline'; break
      case 'volumes': tableName = 'volumes'; break
      case 'foreshadowing': tableName = 'foreshadowing'; break
      case 'rules': tableName = 'writing_rules'; break
      default: continue
    }

    try {
      if (tbl === 'chapters') {
        await c.env.DB.prepare(
          `DELETE FROM foreshadowing WHERE chapter_id IN (SELECT id FROM chapters WHERE novel_id = ? AND deleted_at IS NOT NULL) OR resolved_chapter_id IN (SELECT id FROM chapters WHERE novel_id = ? AND deleted_at IS NOT NULL)`
        ).bind(novelId, novelId).run()
        await c.env.DB.prepare(
          `DELETE FROM generation_logs WHERE chapter_id IN (SELECT id FROM chapters WHERE novel_id = ? AND deleted_at IS NOT NULL)`
        ).bind(novelId).run()
      }

      if (tbl === 'characters' || tbl === 'settings' || tbl === 'foreshadowing') {
        const sourceType = tbl === 'characters' ? 'character' : tbl === 'settings' ? 'setting' : 'foreshadowing'
        const query = tbl === 'settings'
          ? `SELECT id FROM novel_settings WHERE novel_id = ? AND deleted_at IS NOT NULL`
          : `SELECT id FROM ${tableName} WHERE novel_id = ? AND deleted_at IS NOT NULL`
        const deletedRows = await c.env.DB.prepare(query).bind(novelId).all()
        for (const row of deletedRows.results ?? []) {
          await deindexContent(c.env, sourceType as any, String(row.id), 1).catch((e: any) => console.warn(`[trash] Failed to deindex ${sourceType} ${row.id}:`, e))
        }
      }

      const result = await c.env.DB.prepare(
        `DELETE FROM ${tableName} WHERE novel_id = ? AND deleted_at IS NOT NULL`
      ).bind(novelId).run()
      totalDeleted += result.meta.changes ?? 0
    } catch (e) {
      console.warn(`[trash] Failed to clean ${tableName}:`, e)
    }
  }

  return c.json({ ok: true, deleted: totalDeleted })
})

export { router as novels }
