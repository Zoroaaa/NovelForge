import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { drizzle } from 'drizzle-orm/d1'
import { modelConfigs as t } from '../db/schema'
import { eq, and } from 'drizzle-orm'
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
  apiKey: z.string().optional(),
  params: z.string().optional(),
})

router.get('/', async (c) => {
  const novelId = c.req.query('novelId')
  const stage = c.req.query('stage')
  const db = drizzle(c.env.DB)

  // 构建查询条件
  const query = db.select().from(t)

  if (stage) {
    // 如果指定了 stage，按优先级返回：novel级 > global级
    const conditions = [eq(t.stage, stage), eq(t.isActive, 1)]
    if (novelId) {
      // 优先查 novel 级配置
      const novelConfig = await db
        .select()
        .from(t)
        .where(and(...conditions, eq(t.novelId, novelId)))
        .limit(1)
        .get()
      if (novelConfig) return c.json([novelConfig])
    }
    // 回退到 global 配置
    const globalConfig = await db
      .select()
      .from(t)
      .where(and(...conditions, eq(t.scope, 'global')))
      .all()
    return c.json(globalConfig)
  }

  // 无 stage 参数，返回所有匹配配置
  if (novelId) {
    return c.json(await query.where(eq(t.novelId, novelId)))
  }
  return c.json(await query.where(eq(t.scope, 'global')))
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
