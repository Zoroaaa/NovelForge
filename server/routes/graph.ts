/**
 * @file graph.ts
 * @description 情节图谱路由模块，提供多种图谱数据查询接口
 * @version 1.0.0
 */
import { Hono } from 'hono'
import { drizzle } from 'drizzle-orm/d1'
import { plotNodes, plotEdges, characters, chapters, volumes, novels } from '../db/schema'
import { eq, and, sql, inArray } from 'drizzle-orm'
import type { Env } from '../lib/types'
import { enqueue } from '../lib/queue'

const router = new Hono<{ Bindings: Env }>()

router.get('/novel/:novelId', async (c) => {
  const novelId = c.req.param('novelId')
  const db = drizzle(c.env.DB)

  const nodes = await db.select().from(plotNodes)
    .where(eq(plotNodes.novelId, novelId)).all()

  const edges = await db.select().from(plotEdges)
    .where(eq(plotEdges.novelId, novelId)).all()

  const novelInfo = await db.select({ title: novels.title, genre: novels.genre })
    .from(novels).where(eq(novels.id, novelId)).get()

  return c.json({
    ok: true,
    graph: { nodes, edges },
    meta: { novelId, novelTitle: novelInfo?.title, genre: novelInfo?.genre },
  })
})

router.get('/volume/:volumeId', async (c) => {
  const volumeId = c.req.param('volumeId')
  const db = drizzle(c.env.DB)

  const volume = await db.select({ id: volumes.id, novelId: volumes.novelId, title: volumes.title })
    .from(volumes).where(eq(volumes.id, volumeId)).get()
  if (!volume) return c.json({ error: '卷不存在' }, 404)

  const volumeChapters = await db.select({ id: chapters.id })
    .from(chapters)
    .where(and(eq(chapters.volumeId, volumeId), sql`${chapters.deletedAt} IS NULL`))
    .all()

  const chapterIds = volumeChapters.map(ch => ch.id)
  if (chapterIds.length === 0) {
    return c.json({ ok: true, graph: { nodes: [], edges: [] }, meta: { volumeId, volumeTitle: volume.title } })
  }

  const nodes = await db.select().from(plotNodes)
    .where(and(
      eq(plotNodes.novelId, volume.novelId),
      inArray(plotNodes.chapterId, chapterIds)
    )).all()

  const nodeIds = nodes.map(n => n.id)
  let edges: any[] = []
  if (nodeIds.length > 0) {
    const placeholders = nodeIds.map(() => '?').join(',')
    const edgeResult = await c.env.DB.prepare(
      `SELECT * FROM plot_edges WHERE novel_id = ? AND (from_id IN (${placeholders}) OR to_id IN (${placeholders}))`
    ).bind(volume.novelId, ...nodeIds, ...nodeIds).all()
    edges = edgeResult.results as any[]
  }

  return c.json({
    ok: true,
    graph: { nodes, edges },
    meta: { volumeId, volumeTitle: volume.title, novelId: volume.novelId },
  })
})

router.get('/chapter/:chapterId', async (c) => {
  const chapterId = c.req.param('chapterId')
  const db = drizzle(c.env.DB)

  const chapter = await db.select({ id: chapters.id, novelId: chapters.novelId, title: chapters.title, volumeId: chapters.volumeId })
    .from(chapters).where(eq(chapters.id, chapterId)).get()
  if (!chapter) return c.json({ error: '章节不存在' }, 404)

  const nodes = await db.select().from(plotNodes)
    .where(and(eq(plotNodes.novelId, chapter.novelId), eq(plotNodes.chapterId, chapterId))).all()

  const nodeIds = nodes.map(n => n.id)
  let edges: any[] = []
  if (nodeIds.length > 0) {
    const placeholders = nodeIds.map(() => '?').join(',')
    const edgeResult = await c.env.DB.prepare(
      `SELECT * FROM plot_edges WHERE novel_id = ? AND (from_id IN (${placeholders}) OR to_id IN (${placeholders}))`
    ).bind(chapter.novelId, ...nodeIds, ...nodeIds).all()
    edges = edgeResult.results as any[]
  }

  return c.json({
    ok: true,
    graph: { nodes, edges },
    meta: { chapterId, chapterTitle: chapter.title, novelId: chapter.novelId, volumeId: chapter.volumeId },
  })
})

router.get('/characters/:novelId', async (c) => {
  const novelId = c.req.param('novelId')
  const db = drizzle(c.env.DB)

  const chars = await db.select({
    id: characters.id,
    name: characters.name,
    role: characters.role,
    description: characters.description,
    attributes: characters.attributes,
  })
    .from(characters)
    .where(and(eq(characters.novelId, novelId), sql`${characters.deletedAt} IS NULL`))
    .all()

  const charNodes = chars.map(ch => ({
    id: ch.id,
    novelId,
    type: 'character',
    title: ch.name,
    description: ch.description || '',
    chapterId: null,
    meta: JSON.stringify({
      role: ch.role,
      attributes: ch.attributes ? JSON.parse(ch.attributes) : null,
    }),
  }))

  const charEdges = await buildCharacterRelationshipEdges(db, novelId, chars)

  return c.json({
    ok: true,
    graph: { nodes: charNodes, edges: charEdges },
    meta: { novelId },
  })
})

router.post('/extract/:chapterId', async (c) => {
  const chapterId = c.req.param('chapterId')
  const db = drizzle(c.env.DB)

  const chapter = await db.select({ id: chapters.id, novelId: chapters.novelId })
    .from(chapters).where(eq(chapters.id, chapterId)).get()
  if (!chapter) return c.json({ error: '章节不存在' }, 404)

  await enqueue(c.env, {
    type: 'extract_plot_graph',
    payload: { chapterId, novelId: chapter.novelId },
  })

  return c.json({ ok: true, message: '图谱提取任务已提交' })
})

router.post('/extract-novel/:novelId', async (c) => {
  const novelId = c.req.param('novelId')
  const db = drizzle(c.env.DB)

  const novelChapters = await db.select({ id: chapters.id })
    .from(chapters)
    .where(and(eq(chapters.novelId, novelId), sql`${chapters.deletedAt} IS NULL`, sql`${chapters.content} IS NOT NULL`))
    .all()

  for (const ch of novelChapters) {
    await enqueue(c.env, {
      type: 'extract_plot_graph',
      payload: { chapterId: ch.id, novelId },
    })
  }

  return c.json({ ok: true, message: `已提交 ${novelChapters.length} 个章节的图谱提取任务` })
})

async function buildCharacterRelationshipEdges(
  db: ReturnType<typeof drizzle>,
  novelId: string,
  chars: Array<{ id: string; name: string; role: string | null; description: string | null; attributes: string | null }>,
): Promise<Array<{
  id: string; novelId: string; fromId: string; toId: string; relation: string; createdAt: number
}>> {
  const edges: Array<{
    id: string; novelId: string; fromId: string; toId: string; relation: string; createdAt: number
  }> = []

  const charEdges = await db.select().from(plotEdges)
    .where(and(
      eq(plotEdges.novelId, novelId),
      sql`${plotEdges.relation} IN ('related_to', 'participated_in', 'owned_by')`
    )).all()

  const charIds = new Set(chars.map(c => c.id))
  for (const edge of charEdges) {
    if (charIds.has(edge.fromId) && charIds.has(edge.toId)) {
      edges.push(edge)
    }
  }

  return edges
}

export { router as graph }
