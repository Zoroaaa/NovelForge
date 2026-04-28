/**
 * @file cover.ts
 * @description 封面管理路由模块，支持AI生成封面和手动上传封面
 * @version 1.0.0
 */
import { Hono } from 'hono'
import { drizzle } from 'drizzle-orm/d1'
import { novels } from '../db/schema'
import { eq, sql } from 'drizzle-orm'
import type { Env } from '../lib/types'
import { enqueue } from '../lib/queue'

const router = new Hono<{ Bindings: Env }>()

router.post('/:id/generate', async (c) => {
  const novelId = c.req.param('id')
  const db = drizzle(c.env.DB)

  const novel = await db.select({ id: novels.id }).from(novels).where(eq(novels.id, novelId)).get()
  if (!novel) {
    return c.json({ error: '小说不存在' }, 404)
  }

  await enqueue(c.env, {
    type: 'generate_cover',
    payload: { novelId },
  })

  return c.json({ ok: true, message: '封面生成任务已提交' })
})

router.post('/:id/upload', async (c) => {
  const novelId = c.req.param('id')
  const db = drizzle(c.env.DB)

  const novel = await db.select({ coverR2Key: novels.coverR2Key }).from(novels).where(eq(novels.id, novelId)).get()
  if (!novel) {
    return c.json({ error: '小说不存在' }, 404)
  }

  const formData = await c.req.formData()
  const imageFile = formData.get('image') as File | null

  if (!imageFile) {
    return c.json({ error: '请选择图片文件' }, 400)
  }

  const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
  if (!allowedTypes.includes(imageFile.type)) {
    return c.json({ error: '仅支持 JPG/PNG/GIF/WebP 格式' }, 400)
  }

  const maxSize = 10 * 1024 * 1024
  if (imageFile.size > maxSize) {
    return c.json({ error: '图片大小不能超过10MB' }, 400)
  }

  const ext = imageFile.type.split('/')[1] || 'jpg'
  const key = `covers/${novelId}/${Date.now()}.${ext}`
  const imageBuffer = await imageFile.arrayBuffer()

  await c.env.STORAGE.put(key, imageBuffer, {
    httpMetadata: { contentType: imageFile.type },
  })

  if (novel.coverR2Key) {
    try { await c.env.STORAGE.delete(novel.coverR2Key) } catch {}
  }

  await db.update(novels)
    .set({ coverR2Key: key, updatedAt: sql`(unixepoch())` })
    .where(eq(novels.id, novelId))

  return c.json({ ok: true, coverUrl: `/api/novels/${novelId}/cover` })
})

export { router as cover }
