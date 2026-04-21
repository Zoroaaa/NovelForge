import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { drizzle } from 'drizzle-orm/d1'
import { chapters as t } from '../db/schema'
import { eq, and, isNull, sql } from 'drizzle-orm'
import type { Env } from '../lib/types'
import { indexContent, deindexContent } from '../services/embedding'

const router = new Hono<{ Bindings: Env }>()

const MAX_SNAPSHOTS = 10

const CreateSchema = z.object({
  novelId: z.string(),
  volumeId: z.string().optional().nullable(),
  outlineId: z.string().optional().nullable(),
  title: z.string(),
  sortOrder: z.number().optional(),
  content: z.string().optional().nullable(),
})

/**
 * 异步触发向量化（不阻塞主流程）
 */
async function safeWaitUntil(c: any, fn: Promise<void> | void) {
  const ctx = (c as any).executionContext
  if (ctx?.waitUntil) {
    ctx.waitUntil(Promise.resolve(fn).catch((e) => console.warn('Async task failed:', e)))
  } else {
    Promise.resolve(fn).catch((e) => console.warn('Async task failed:', e))
  }
}

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

  // 异步触发向量化（如果有内容）
  safeWaitUntil(c, triggerVectorization(
    c.env,
    'chapter',
    row.id,
    row.novelId,
    row.title,
    row.content
  ))

  return c.json(row, 201)
})

router.patch(
  '/:id',
  zValidator(
    'json',
    CreateSchema.partial().extend({
      status: z.string().optional(),
      summary: z.string().optional(),
    })
  ),
  async (c) => {
    const db = drizzle(c.env.DB)
    const id = c.req.param('id')
    const body = c.req.valid('json')

    if (body.content) {
      (body as any).wordCount = body.content.length
    }

    const [row] = await db
      .update(t)
      .set({ ...body, updatedAt: sql`(unixepoch())` })
      .where(eq(t.id, id))
      .returning()

    // 异步重新索引（内容更新时）
    if (body.content !== undefined && row) {
      safeWaitUntil(c, triggerVectorization(
        c.env,
        'chapter',
        row.id,
        row.novelId,
        row.title,
        body.content
      ))

      safeWaitUntil(c, saveSnapshot(c.env, row.novelId, row.id, body.content ?? '').then(() => {}).catch(e => console.warn('Snapshot save failed:', e)))
    }

    // 如果生成了摘要，也索引摘要
    if (body.summary !== undefined && row) {
      safeWaitUntil(c, triggerVectorization(
        c.env,
        'summary',
        row.id,
        row.novelId,
        `${row.title} 摘要`,
        body.summary
      ))
    }

    return c.json(row)
  }
)

router.delete('/:id', async (c) => {
  const db = drizzle(c.env.DB)
  const id = c.req.param('id')

  // 删除向量索引（章节+摘要）
  if (c.env.VECTORIZE) {
    safeWaitUntil(c, Promise.all([
      deindexContent(c.env, 'chapter', id),
      deindexContent(c.env, 'summary', id),
    ]).then(() => {}))
  }

  await db
    .update(t)
    .set({ deletedAt: new Date().getTime() })
    .where(eq(t.id, id))

  return c.json({ ok: true })
})

router.get('/:id/snapshots', async (c) => {
  const id = c.req.param('id')
  const db = drizzle(c.env.DB)

  const chapter = await db.select({ snapshotKeys: t.snapshotKeys }).from(t).where(eq(t.id, id)).get()
  if (!chapter) return c.json({ error: 'Chapter not found' }, 404)

  const keys: string[] = chapter.snapshotKeys ? JSON.parse(chapter.snapshotKeys) : []
  const snapshots = await Promise.all(
    keys.map(async (key) => {
      try {
        const obj = await c.env.STORAGE.get(key)
        if (!obj) return null
        const content = await obj.text()
        const match = key.match(/(\d+)\.txt$/)
        const timestamp = match ? parseInt(match[1]) : 0
        return { key, timestamp, preview: content.slice(0, 200) }
      } catch { return null }
    })
  )
  return c.json({ snapshots: snapshots.filter(Boolean) })
})

router.post('/:id/restore', zValidator('json', z.object({ key: z.string() })), async (c) => {
  const id = c.req.param('id')
  const { key } = c.req.valid('json')
  const db = drizzle(c.env.DB)

  const chapter = await db.select().from(t).where(eq(t.id, id)).get()
  if (!chapter) return c.json({ error: 'Chapter not found' }, 404)

  const obj = await c.env.STORAGE.get(key)
  if (!obj) return c.json({ error: 'Snapshot not found' }, 404)

  const content = await obj.text()
  await db.update(t).set({ content, updatedAt: Math.floor(Date.now() / 1e3) }).where(eq(t.id, id))

  return c.json({ ok: true, content })
})

async function saveSnapshot(env: Env, novelId: string, chapterId: string, content: string): Promise<string | null> {
  if (!content || !env.STORAGE) return null

  const db = drizzle(env.DB)
  const chapter = await db.select({ snapshotKeys: t.snapshotKeys }).from(t).where(eq(t.id, chapterId)).get()
  const existingKeys: string[] = chapter?.snapshotKeys ? JSON.parse(chapter.snapshotKeys) : []

  const timestamp = Date.now()
  const key = `snapshots/${novelId}/${chapterId}/${timestamp}.txt`

  await env.STORAGE.put(key, content, { httpMetadata: { contentType: 'text/plain' } })

  const newKeys = [key, ...existingKeys].slice(0, MAX_SNAPSHOTS)
  await db.update(t).set({ snapshotKeys: JSON.stringify(newKeys) }).where(eq(t.id, chapterId))

  if (existingKeys.length >= MAX_SNAPSHOTS) {
    const oldestKey = existingKeys[existingKeys.length - 1]
    try { await env.STORAGE.delete(oldestKey) } catch {}
  }

  return key
}

export { router as chapters }
