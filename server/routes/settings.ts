import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { drizzle } from 'drizzle-orm/d1'
import { modelConfigs as t } from '../db/schema'
import { eq } from 'drizzle-orm'
import type { Env } from '../lib/types'

const router = new Hono<{ Bindings: Env }>()

const CreateSchema = z.object({
  novelId: z.string().optional(),
  scope: z.string(),
  stage: z.string(),
  provider: z.string(),
  modelId: z.string(),
  apiBase: z.string().optional(),
  apiKeyEnv: z.string(),
  params: z.string().optional(),
})

router.get('/', async (c) => {
  const novelId = c.req.query('novelId')
  const db = drizzle(c.env.DB)
  let rows
  if (novelId) {
    rows = await db.select().from(t)
      .where(eq(t.novelId, novelId))
  } else {
    rows = await db.select().from(t).where(eq(t.scope, 'global'))
  }
  return c.json(rows)
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

router.delete('/:id', async (c) => {
  const db = drizzle(c.env.DB)
  await db.delete(t).where(eq(t.id, c.req.param('id')))
  return c.json({ ok: true })
})

export { router as settings }
