import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { drizzle } from 'drizzle-orm/d1'
import { novels as t } from '../db/schema'
import { eq, isNull, desc, sql } from 'drizzle-orm'
import type { Env } from '../lib/types'

const router = new Hono<{ Bindings: Env }>()

const CreateSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().optional(),
  genre: z.string().optional(),
})

router.get('/', async (c) => {
  const db = drizzle(c.env.DB)
  const rows = await db.select().from(t)
    .where(isNull(t.deletedAt))
    .orderBy(desc(t.updatedAt))
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

router.patch('/:id', zValidator('json', CreateSchema.partial()), async (c) => {
  const db = drizzle(c.env.DB)
  const [row] = await db.update(t)
    .set({ ...c.req.valid('json'), updatedAt: sql`(unixepoch())` })
    .where(eq(t.id, c.req.param('id')))
    .returning()
  return c.json(row)
})

router.delete('/:id', async (c) => {
  const db = drizzle(c.env.DB)
  await db.update(t)
    .set({ deletedAt: sql`(unixepoch())` })
    .where(eq(t.id, c.req.param('id')))
  return c.json({ ok: true })
})

export { router as novels }
