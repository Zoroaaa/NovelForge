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
} from '../db/schema'

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

export { router as crossChapterRouter }
