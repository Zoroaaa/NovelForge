import { drizzle } from 'drizzle-orm/d1'
import { batchGenerationTasks, chapters, volumes } from '../../db/schema'
import { eq, and, sql, desc } from 'drizzle-orm'
import type { Env } from '../../lib/types'
import { enqueue } from '../../lib/queue'

export interface BatchTask {
  id: string
  novelId: string
  volumeId: string
  status: 'running' | 'paused' | 'done' | 'failed' | 'cancelled'
  startChapterOrder: number
  targetCount: number
  completedCount: number
  failedCount: number
  currentChapterOrder: number | null
  errorMsg: string | null
  createdAt: number
  updatedAt: number
}

function genId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(8)))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

export async function startBatchGeneration(
  env: Env,
  data: { novelId: string; volumeId: string; targetCount: number; startFromNext: boolean; startChapterOrder?: number }
): Promise<{ taskId: string }> {
  const db = drizzle(env.DB)
  const now = Math.floor(Date.now() / 1000)

  const startChapterOrder = data.startFromNext
    ? await getVolumeMaxSortOrder(db, data.volumeId) + 1
    : (data.startChapterOrder ?? 1)

  const taskId = genId()

  await db.insert(batchGenerationTasks).values({
    id: taskId,
    novelId: data.novelId,
    volumeId: data.volumeId,
    status: 'running',
    startChapterOrder,
    targetCount: data.targetCount,
    completedCount: 0,
    failedCount: 0,
    currentChapterOrder: startChapterOrder,
    createdAt: now,
    updatedAt: now,
  })

  if (env.TASK_QUEUE) {
    await env.TASK_QUEUE.send({
      type: 'batch_generate_chapter',
      payload: { taskId, novelId: data.novelId, volumeId: data.volumeId },
    })
  }

  return { taskId }
}

async function getVolumeMaxSortOrder(db: any, volumeId: string): Promise<number> {
  const row = await db.select({ sortOrder: chapters.sortOrder })
    .from(chapters)
    .where(eq(chapters.volumeId, volumeId))
    .orderBy(desc(chapters.sortOrder))
    .limit(1)
    .get()
  return row?.sortOrder ?? 0
}

export async function pauseBatchTask(env: Env, taskId: string): Promise<void> {
  const db = drizzle(env.DB)
  await db.update(batchGenerationTasks)
    .set({ status: 'paused', updatedAt: sql`(unixepoch())` })
    .where(eq(batchGenerationTasks.id, taskId))
}

export async function resumeBatchTask(env: Env, taskId: string): Promise<void> {
  const db = drizzle(env.DB)

  const task = await db.select().from(batchGenerationTasks).where(eq(batchGenerationTasks.id, taskId)).get()
  if (!task || task.status !== 'paused') return

  await db.update(batchGenerationTasks)
    .set({ status: 'running', updatedAt: sql`(unixepoch())` })
    .where(eq(batchGenerationTasks.id, taskId))

  if (env.TASK_QUEUE) {
    await env.TASK_QUEUE.send({
      type: 'batch_generate_chapter',
      payload: { taskId, novelId: task.novelId, volumeId: task.volumeId },
    })
  }
}

export async function cancelBatchTask(env: Env, taskId: string): Promise<void> {
  const db = drizzle(env.DB)
  await db.update(batchGenerationTasks)
    .set({ status: 'cancelled', updatedAt: sql`(unixepoch())` })
    .where(eq(batchGenerationTasks.id, taskId))
}

export async function getBatchTask(env: Env, taskId: string): Promise<BatchTask | null> {
  const db = drizzle(env.DB)
  return db.select().from(batchGenerationTasks).where(eq(batchGenerationTasks.id, taskId)).get() as any
}

export async function getActiveBatchTask(env: Env, novelId: string): Promise<BatchTask | null> {
  const db = drizzle(env.DB)
  return db.select()
    .from(batchGenerationTasks)
    .where(and(
      eq(batchGenerationTasks.novelId, novelId),
      sql`${batchGenerationTasks.status} IN ('running', 'paused')`
    ))
    .limit(1)
    .get() as any
}

export async function incrementCompleted(env: Env, taskId: string, success: boolean): Promise<void> {
  const db = drizzle(env.DB)
  // 修复: 原来用 sql`${field} + 1`，field 是JS字符串，插值后SQL变成 'completedCount' + 1 = 1，每次重置而非累加
  // 必须用 Drizzle 列引用作为 sql 模板参数
  const countUpdate = success
    ? { completedCount: sql`${batchGenerationTasks.completedCount} + 1` }
    : { failedCount: sql`${batchGenerationTasks.failedCount} + 1` }

  await db.update(batchGenerationTasks)
    .set({
      ...countUpdate,
      currentChapterOrder: sql`${batchGenerationTasks.currentChapterOrder} + 1`,
      updatedAt: sql`(unixepoch())`,
    })
    .where(eq(batchGenerationTasks.id, taskId))
}

export async function markTaskDone(env: Env, taskId: string, reason?: string): Promise<void> {
  const db = drizzle(env.DB)
  await db.update(batchGenerationTasks)
    .set({ status: 'done', updatedAt: sql`(unixepoch())` })
    .where(eq(batchGenerationTasks.id, taskId))
}

export async function markTaskFailed(env: Env, taskId: string, errorMsg: string): Promise<void> {
  const db = drizzle(env.DB)
  await db.update(batchGenerationTasks)
    .set({ status: 'failed', errorMsg, updatedAt: sql`(unixepoch())` })
    .where(eq(batchGenerationTasks.id, taskId))
}
