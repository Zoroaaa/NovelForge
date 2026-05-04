/**
 * @file cross-chapter.ts
 * @description 跨章一致性系统路由：内联实体 / 实体碰撞 / 角色成长 / 关系网络 / 结构化数据
 */
import { Hono } from 'hono'
import { drizzle } from 'drizzle-orm/d1'
import { eq, and, desc, sql } from 'drizzle-orm'
import type { Env } from '../lib/types'
import {
  novelInlineEntities,
  entityStateLog,
  entityConflictLog,
  characterGrowthLog,
  characterRelationships,
  chapterStructuredData,
  chapters,
} from '../db/schema'
import { extractEntitiesFromChapter, persistExtractedEntities } from '../services/agent/entityExtract'
import { trackCharacterGrowth } from '../services/agent/characterGrowth'
import { detectEntityConflicts } from '../services/agent/entityConflict'

const router = new Hono<{ Bindings: Env }>()

// ── 内联实体 CRUD ──────────────────────────────────────────────────────

router.get('/inline-entities', async (c) => {
  const novelId = c.req.query('novelId')
  if (!novelId) return c.json({ error: 'novelId required' }, 400)

  const db = drizzle(c.env.DB)
  const entityType = c.req.query('entityType')
  const page = parseInt(c.req.query('page') || '1', 10)
  const pageSize = Math.min(parseInt(c.req.query('pageSize') || '50', 10), 200)

  const conditions = [
    eq(novelInlineEntities.novelId, novelId),
    sql`${novelInlineEntities.deletedAt} IS NULL`,
  ]
  if (entityType) {
    conditions.push(eq(novelInlineEntities.entityType, entityType))
  }

  const rows = await db
    .select()
    .from(novelInlineEntities)
    .where(and(...conditions))
    .orderBy(desc(novelInlineEntities.lastChapterOrder))
    .limit(pageSize)
    .offset((page - 1) * pageSize)
    .all()

  return c.json(rows)
})

router.get('/inline-entities/:id', async (c) => {
  const id = c.req.param('id')
  const db = drizzle(c.env.DB)

  const rows = await db
    .select()
    .from(novelInlineEntities)
    .where(eq(novelInlineEntities.id, id))
    .limit(1)

  if (rows.length === 0) return c.json({ error: 'Not found' }, 404)
  return c.json(rows[0])
})

router.delete('/inline-entities/:id', async (c) => {
  const id = c.req.param('id')
  const db = drizzle(c.env.DB)

  await c.env.DB.prepare(`DELETE FROM entity_state_log WHERE source_type = 'inline_entity' AND source_id = ?`).bind(id).run()

  await db.update(novelInlineEntities)
    .set({ deletedAt: Math.floor(Date.now() / 1000) })
    .where(eq(novelInlineEntities.id, id))

  return c.json({ success: true })
})

// ── 实体状态历史 ──────────────────────────────────────────────────────

router.get('/entity-state-log', async (c) => {
  const novelId = c.req.query('novelId')
  if (!novelId) return c.json({ error: 'novelId required' }, 400)

  const db = drizzle(c.env.DB)
  const entityName = c.req.query('entityName')
  const stateType = c.req.query('stateType')
  const limit = Math.min(parseInt(c.req.query('limit') || '50', 10), 200)

  const conditions = [eq(entityStateLog.novelId, novelId)]
  if (entityName) conditions.push(eq(entityStateLog.entityName, entityName))
  if (stateType) conditions.push(eq(entityStateLog.stateType, stateType))

  const rows = await db
    .select()
    .from(entityStateLog)
    .where(and(...conditions))
    .orderBy(desc(entityStateLog.chapterOrder))
    .limit(limit)
    .all()

  return c.json(rows)
})

// ── 实体碰撞记录 ──────────────────────────────────────────────────────

router.get('/entity-conflicts', async (c) => {
  const novelId = c.req.query('novelId')
  if (!novelId) return c.json({ error: 'novelId required' }, 400)

  const db = drizzle(c.env.DB)
  const resolution = c.req.query('resolution')
  const page = parseInt(c.req.query('page') || '1', 10)
  const pageSize = Math.min(parseInt(c.req.query('pageSize') || '50', 10), 200)

  const conditions = [eq(entityConflictLog.novelId, novelId)]
  if (resolution === 'pending') {
    conditions.push(sql`${entityConflictLog.resolution} IS NULL`)
  } else if (resolution) {
    conditions.push(eq(entityConflictLog.resolution, resolution))
  }

  const rows = await db
    .select()
    .from(entityConflictLog)
    .where(and(...conditions))
    .orderBy(desc(entityConflictLog.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize)
    .all()

  return c.json(rows)
})

router.put('/entity-conflicts/:id/resolve', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json()
  const { resolution } = body

  if (!resolution) return c.json({ error: 'resolution required' }, 400)

  const db = drizzle(c.env.DB)
  await db.update(entityConflictLog)
    .set({
      resolution,
      resolvedAt: Math.floor(Date.now() / 1000),
    })
    .where(eq(entityConflictLog.id, id))

  return c.json({ success: true })
})

// ── 角色成长记录 ──────────────────────────────────────────────────────

router.get('/character-growth', async (c) => {
  const novelId = c.req.query('novelId')
  if (!novelId) return c.json({ error: 'novelId required' }, 400)

  const db = drizzle(c.env.DB)
  const characterId = c.req.query('characterId')
  const dimension = c.req.query('dimension')
  const limit = Math.min(parseInt(c.req.query('limit') || '50', 10), 200)

  const conditions = [eq(characterGrowthLog.novelId, novelId)]
  if (characterId) conditions.push(eq(characterGrowthLog.characterId, characterId))
  if (dimension) conditions.push(eq(characterGrowthLog.growthDimension, dimension))

  const rows = await db
    .select()
    .from(characterGrowthLog)
    .where(and(...conditions))
    .orderBy(desc(characterGrowthLog.chapterOrder))
    .limit(limit)
    .all()

  return c.json(rows)
})

// ── 关系网络 ──────────────────────────────────────────────────────────

router.get('/relationships', async (c) => {
  const novelId = c.req.query('novelId')
  if (!novelId) return c.json({ error: 'novelId required' }, 400)

  const db = drizzle(c.env.DB)
  const characterId = c.req.query('characterId')

  const conditions = [
    eq(characterRelationships.novelId, novelId),
    sql`${characterRelationships.deletedAt} IS NULL`,
  ]
  if (characterId) {
    conditions.push(
      sql`(${characterRelationships.characterIdA} = ${characterId} OR ${characterRelationships.characterIdB} = ${characterId})`
    )
  }

  const rows = await db
    .select()
    .from(characterRelationships)
    .where(and(...conditions))
    .orderBy(desc(characterRelationships.lastUpdatedChapterOrder))
    .all()

  return c.json(rows)
})

// ── 结构化数据（step1b产出）──────────────────────────────────────────

router.get('/structured-data', async (c) => {
  const novelId = c.req.query('novelId')
  if (!novelId) return c.json({ error: 'novelId required' }, 400)

  const db = drizzle(c.env.DB)
  const chapterId = c.req.query('chapterId')
  const limit = Math.min(parseInt(c.req.query('limit') || '50', 10), 200)

  const conditions = [eq(chapterStructuredData.novelId, novelId)]
  if (chapterId) conditions.push(eq(chapterStructuredData.chapterId, chapterId))

  const rows = await db
    .select()
    .from(chapterStructuredData)
    .where(and(...conditions))
    .orderBy(desc(chapterStructuredData.chapterOrder))
    .limit(limit)
    .all()

  return c.json(rows)
})

// ── 统计概览 ──────────────────────────────────────────────────────────

router.get('/stats', async (c) => {
  const novelId = c.req.query('novelId')
  if (!novelId) return c.json({ error: 'novelId required' }, 400)

  const db = drizzle(c.env.DB)

  const [entityCount, conflictPendingCount, growthCount, relationshipCount] = await Promise.all([
    db.select({ count: sql<number>`count(*)` })
      .from(novelInlineEntities)
      .where(and(eq(novelInlineEntities.novelId, novelId), sql`${novelInlineEntities.deletedAt} IS NULL`))
      .then(r => r[0]?.count ?? 0),
    db.select({ count: sql<number>`count(*)` })
      .from(entityConflictLog)
      .where(and(eq(entityConflictLog.novelId, novelId), sql`${entityConflictLog.resolution} IS NULL`))
      .then(r => r[0]?.count ?? 0),
    db.select({ count: sql<number>`count(*)` })
      .from(characterGrowthLog)
      .where(eq(characterGrowthLog.novelId, novelId))
      .then(r => r[0]?.count ?? 0),
    db.select({ count: sql<number>`count(*)` })
      .from(characterRelationships)
      .where(and(eq(characterRelationships.novelId, novelId), sql`${characterRelationships.deletedAt} IS NULL`))
      .then(r => r[0]?.count ?? 0),
  ])

  return c.json({
    inlineEntityCount: entityCount,
    pendingConflictCount: conflictPendingCount,
    growthRecordCount: growthCount,
    relationshipCount,
  })
})

// ── 手动触发章节实体提取 ───────────────────────────────────────────

router.post('/extract-entities', async (c) => {
  const body = await c.req.json()
  const { chapterId, novelId } = body

  if (!chapterId || !novelId) {
    return c.json({ error: 'chapterId and novelId are required' }, 400)
  }

  const db = drizzle(c.env.DB)

  const chapter = await db
    .select({ id: chapters.id })
    .from(chapters)
    .where(eq(chapters.id, chapterId))
    .limit(1)

  if (chapter.length === 0) {
    return c.json({ error: 'Chapter not found' }, 404)
  }

  try {
    const extractResult = await extractEntitiesFromChapter(c.env, chapterId, novelId)
    const { entityCount, stateChangeCount } = await persistExtractedEntities(c.env, chapterId, novelId, extractResult)

    let growthCount = 0
    let relationshipCount = 0
    let conflictCount = 0

    try {
      const growthResult = await trackCharacterGrowth(c.env, chapterId, novelId, extractResult)
      growthCount = growthResult.growthCount
      relationshipCount = growthResult.relationshipCount
    } catch (growthError) {
      console.warn('[CrossChapter] Step 8 (character growth) failed:', growthError)
    }

    try {
      const conflictResult = await detectEntityConflicts(c.env, chapterId, novelId)
      conflictCount = conflictResult.conflictCount
    } catch (conflictError) {
      console.warn('[CrossChapter] Step 9 (entity conflict) failed:', conflictError)
    }

    return c.json({
      success: true,
      entityCount,
      stateChangeCount,
      growthCount,
      relationshipCount,
      conflictCount,
      extractedEntities: extractResult.entities.length,
      characterGrowths: extractResult.characterGrowths.length,
      knowledgeReveals: extractResult.knowledgeReveals.length,
    })
  } catch (error) {
    console.error('[CrossChapter] Manual entity extraction failed:', error)
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }, 500)
  }
})

export { router as crossChapterRouter }
