import { Hono } from 'hono'
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'
import type { Env } from '../lib/types'
import { qualityScores } from '../db/schema'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'

const router = new Hono<{ Bindings: Env }>()

router.get('/chapter/:chapterId', async (c) => {
  const chapterId = c.req.param('chapterId')
  const db = drizzle(c.env.DB)

  const score = await db.select().from(qualityScores).where(eq(qualityScores.chapterId, chapterId)).get()

  if (!score) return c.json(null)

  let details: Record<string, unknown> | null = null
  if (score.details) {
    try { details = JSON.parse(score.details) } catch {}
  }

  return c.json({
    ...score,
    details,
  })
})

router.get('/novel/:novelId', async (c) => {
  const novelId = c.req.param('novelId')
  const db = drizzle(c.env.DB)

  const scores = await db.select()
    .from(qualityScores)
    .where(eq(qualityScores.novelId, novelId))
    .all()

  return c.json(scores.map(s => {
    let details: Record<string, unknown> | null = null
    if (s.details) {
      try { details = JSON.parse(s.details) } catch {}
    }
    return { ...s, details }
  }))
})

export const quality = router
