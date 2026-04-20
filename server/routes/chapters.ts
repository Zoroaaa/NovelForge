import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { drizzle } from 'drizzle-orm/d1'
import { chapters as t } from '../db/schema'
import { eq, and, isNull, sql } from 'drizzle-orm'
import type { Env } from '../lib/types'

const router = new Hono<{ Bindings: Env }>()

const CreateSchema = z.object({
  novelId: z.string(),
  volumeId: z.string().optional(),
  outlineId: z.string().optional(),
  title: z.string(),
  sortOrder: z.number().optional(),
  content: z.string().optional(),
})

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
  const [row] = await db.insert(t).values(c.req.valid('json')).returning()
  return c.json(row, 201)
})

router.patch('/:id', zValidator('json', CreateSchema.partial().extend({
  status: z.string().optional(),
  summary: z.string().optional(),
})), async (c) => {
  const db = drizzle(c.env.DB)
  const body = c.req.valid('json')
  if (body.content) {
    body.wordCount = body.content.length
  }
  const [row] = await db.update(t)
    .set({ ...body, updatedAt: sql`(unixepoch())` })
    .where(eq(t.id, c.req.param('id')))
    .returning()
  return c.json(row)
})

router.delete('/:id', async (c) => {
  const db = drizzle(c.env.DB)
  await db.update(t)
    .set({ deletedAt: new Date().getTime() })
    .where(eq(t.id, c.req.param('id')))
  return c.json({ ok: true })
})

export { router as chapters }
