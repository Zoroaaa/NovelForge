/**
 * @file batch.ts
 * @description 批量生成路由模块，提供批量章节任务的创建、暂停、恢复、取消和状态查询API
 * @date 2026-05-04
 */
import { Hono } from 'hono'
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'
import type { Env } from '../lib/types'
import * as batchService from '../services/agent/batchGenerate'
import { checkAndCompleteVolume } from '../services/agent/volumeCompletion'
import { drizzle } from 'drizzle-orm/d1'
import { batchGenerationTasks } from '../db/schema'
import { eq, and, desc } from 'drizzle-orm'

const router = new Hono<{ Bindings: Env }>()

const StartSchema = z.object({
  novelId: z.string().min(1),
  volumeId: z.string().min(1),
  targetCount: z.number().int().min(1).max(200),
  startFromNext: z.boolean().default(true),
  startChapterOrder: z.number().int().optional(),
})

router.post('/start', zValidator('json', StartSchema), async (c) => {
  const body = c.req.valid('json')
  const env = c.env

  const activeTask = await batchService.getActiveBatchTask(env, body.novelId)
  if (activeTask) {
    return c.json({ error: '已有运行中的批量生成任务', activeTaskId: activeTask.id }, 409)
  }

  const result = await batchService.startBatchGeneration(env, body)
  return c.json(result)
})

router.get('/:taskId', async (c) => {
  const taskId = c.req.param('taskId')
  const task = await batchService.getBatchTask(c.env, taskId)

  if (!task) {
    return c.json({ error: '任务不存在' }, 404)
  }

  return c.json(task)
})

router.post('/:taskId/pause', async (c) => {
  const taskId = c.req.param('taskId')
  const task = await batchService.getBatchTask(c.env, taskId)

  if (!task) return c.json({ error: '任务不存在' }, 404)
  if (task.status !== 'running') return c.json({ error: '任务当前不可暂停' }, 400)

  await batchService.pauseBatchTask(c.env, taskId)
  return c.json({ ok: true })
})

router.post('/:taskId/resume', async (c) => {
  const taskId = c.req.param('taskId')
  const task = await batchService.getBatchTask(c.env, taskId)

  if (!task) return c.json({ error: '任务不存在' }, 404)
  if (task.status !== 'paused') return c.json({ error: '任务当前不可恢复' }, 400)

  await batchService.resumeBatchTask(c.env, taskId)
  return c.json({ ok: true })
})

router.delete('/:taskId', async (c) => {
  const taskId = c.req.param('taskId')
  const task = await batchService.getBatchTask(c.env, taskId)

  if (!task) return c.json({ error: '任务不存在' }, 404)
  if (task.status === 'done') return c.json({ error: '任务已完成，无法取消' }, 400)

  await batchService.cancelBatchTask(c.env, taskId)
  return c.json({ ok: true })
})

router.get('/novels/:id/active', async (c) => {
  const novelId = c.req.param('id')
  const task = await batchService.getActiveBatchTask(c.env, novelId)

  if (!task) {
    return c.json(null)
  }

  return c.json(task)
})

router.get('/novels/:id/history', zValidator('query', z.object({
  limit: z.coerce.number().optional().default(10),
  status: z.enum(['done', 'failed', 'cancelled']).optional(),
})), async (c) => {
  const novelId = c.req.param('id')
  const { limit, status } = c.req.valid('query')
  const db = drizzle(c.env.DB)

  let query = db.select()
    .from(batchGenerationTasks)
    .where(eq(batchGenerationTasks.novelId, novelId))
    .orderBy(desc(batchGenerationTasks.updatedAt))
    .limit(limit)

  if (status) {
    query = db.select()
      .from(batchGenerationTasks)
      .where(and(
        eq(batchGenerationTasks.novelId, novelId),
        eq(batchGenerationTasks.status, status)
      ))
      .orderBy(desc(batchGenerationTasks.updatedAt))
      .limit(limit)
  }

  const tasks = await query.all()
  return c.json({ tasks })
})

export const batch = router
