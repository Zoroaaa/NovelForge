import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { drizzle } from 'drizzle-orm/d1'
import { outlines as t } from '../db/schema'
import { eq, and, isNull, sql } from 'drizzle-orm'
import type { Env } from '../lib/types'
import { indexContent, deindexContent } from '../services/embedding'

const router = new Hono<{ Bindings: Env }>()

const CreateSchema = z.object({
  novelId: z.string(),
  parentId: z.string().nullable().optional(),
  type: z.string(),
  title: z.string(),
  content: z.string().optional(),
  sortOrder: z.number().optional(),
})

/**
 * 异步触发向量化（不阻塞主流程）
 */
async function triggerVectorization(
  env: Env,
  sourceType: 'outline' | 'chapter' | 'character' | 'summary',
  sourceId: string,
  novelId: string,
  title: string,
  content: string | null | undefined
) {
  if (!env.VECTORIZE || !content) return

  try {
    await indexContent(env, sourceType, sourceId, novelId, title, content)
    console.log(`✅ Auto-indexed ${sourceType}:${sourceId}`)
  } catch (error) {
    console.warn(`⚠️ Auto-vectorization failed for ${sourceId}:`, error)
  }
}

router.get('/', async (c) => {
  const novelId = c.req.query('novelId')
  if (!novelId) return c.json({ error: 'novelId required' }, 400)
  const db = drizzle(c.env.DB)
  const rows = await db.select().from(t)
    .where(and(eq(t.novelId, novelId), isNull(t.deletedAt)))
    .orderBy(t.sortOrder)
  return c.json(rows)
})

router.get('/:id', async (c) => {
  const db = drizzle(c.env.DB)
  const row = await db.select().from(t).where(eq(t.id, c.req.param('id'))).get()
  if (!row || row.deletedAt) return c.json({ error: 'Not found' }, 404)
  return c.json(row)
})

router.post('/', zValidator('json', CreateSchema), async (c) => {
  const db = drizzle(c.env.DB)
  const body = c.req.valid('json')
  const [row] = await db.insert(t).values(body).returning()

  // 异步触发向量化
  c.executionContext.waitUntil(
    triggerVectorization(
      c.env,
      'outline',
      row.id,
      row.novelId,
      row.title,
      row.content
    )
  )

  return c.json(row, 201)
})

router.patch('/:id', zValidator('json', CreateSchema.partial()), async (c) => {
  const db = drizzle(c.env.DB)
  const id = c.req.param('id')
  const body = c.req.valid('json')

  const [row] = await db
    .update(t)
    .set({ ...body, updatedAt: sql`(unixepoch())` })
    .where(eq(t.id, id))
    .returning()

  // 异步重新索引（内容更新时）
  if (body.content !== undefined && row) {
    c.executionContext.waitUntil(
      triggerVectorization(
        c.env,
        'outline',
        row.id,
        row.novelId,
        row.title,
        body.content
      )
    )
  }

  return c.json(row)
})

router.patch('/sort', zValidator('json', z.array(z.object({
  id: z.string(),
  sortOrder: z.number(),
  parentId: z.string().nullable().optional(),
}))), async (c) => {
  const db = drizzle(c.env.DB)
  const items = c.req.valid('json')
  await Promise.all(items.map(item =>
    db.update(t).set({
      sortOrder: item.sortOrder,
      ...(item.parentId !== undefined ? { parentId: item.parentId } : {}),
    }).where(eq(t.id, item.id))
  ))
  return c.json({ ok: true })
})

router.delete('/:id', async (c) => {
  const db = drizzle(c.env.DB)
  const id = c.req.param('id')

  // 先删除向量索引
  if (c.env.VECTORIZE) {
    c.executionContext.waitUntil(
      deindexContent(c.env, 'outline', id, 1).catch((err) =>
        console.warn('Deindex failed:', err)
      )
    )
  }

  await db
    .update(t)
    .set({ deletedAt: new Date().getTime() })
    .where(eq(t.id, id))

  return c.json({ ok: true })
})

export { router as outlines }
