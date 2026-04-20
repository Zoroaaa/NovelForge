import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { drizzle } from 'drizzle-orm/d1'
import { outlines as t } from '../db/schema'
import { eq, and, isNull } from 'drizzle-orm'
import type { Env } from '../lib/types'

const router = new Hono<{ Bindings: Env }>()

const CreateSchema = z.object({
  novelId: z.string(),
  parentId: z.string().nullable().optional(),
  type: z.string(),
  title: z.string(),
  content: z.string().optional(),
  sortOrder: z.number().optional(),
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

router.patch('/:id', zValidator('json', CreateSchema.partial()), async (c) => {
  const db = drizzle(c.env.DB)
  const [row] = await db.update(t)
    .set(c.req.valid('json'))
    .where(eq(t.id, c.req.param('id')))
    .returning()
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
  await db.update(t)
    .set({ deletedAt: new Date().getTime() })
    .where(eq(t.id, c.req.param('id')))
  return c.json({ ok: true })
})

export { router as outlines }
