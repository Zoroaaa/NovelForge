/**
 * @file batchGenerate.ts
 * @description 批量章节生成任务管理服务
 *   负责创建、暂停、恢复、取消批量生成任务，以及跟踪任务进度（完成数/失败数）
 * @date 2026-05-04
 */
import { drizzle } from 'drizzle-orm/d1'
import { batchGenerationTasks, chapters } from '../../db/schema'
import { eq, and, sql, desc } from 'drizzle-orm'
import type { Env } from '../../lib/types'

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

/**
 * 创建批量章节生成任务
 *
 * 为什么使用 crypto.getRandomValues 而非 UUID：
 * - 批量任务ID仅在系统内部使用，不需要全局唯一性保证
 * - 16位十六进制字符串足够在单小说范围内避免冲突
 * - 相比 UUID 库依赖，原生 Crypto API 性能更好且无外部依赖
 *
 * 为什么创建任务后立即发送队列消息：
 * - Cloud Workers 的执行模型要求主请求快速返回，不能长时间阻塞
 * - 将实际生成工作异步化到 Queue Consumer，避免请求超时
 * - 任务状态持久化到 DB 后即使 Worker 重启也不会丢失
 */
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

/**
 * 暂停正在运行的批量生成任务
 *
 * @param env - Cloud Workers 环境变量（包含数据库连接）
 * @param taskId - 任务ID（由 startBatchGeneration 返回）
 * @returns Promise<void> - 无返回值
 *
 * @throws {Error} 当任务不存在或数据库更新失败时抛出异常
 *
 * @example
 * ```typescript
 * await pauseBatchTask(env, 'abc123def')
 * console.log('任务已暂停')
 * ```
 */
export async function pauseBatchTask(env: Env, taskId: string): Promise<void> {
  const db = drizzle(env.DB)
  await db.update(batchGenerationTasks)
    .set({ status: 'paused', updatedAt: sql`(unixepoch())` })
    .where(eq(batchGenerationTasks.id, taskId))
}

/**
 * 恢复已暂停的批量生成任务
 *
 * @param env - Cloud Workers 环境变量（包含数据库连接和任务队列）
 * @param taskId - 任务ID（由 startBatchGeneration 返回）
 * @returns Promise<void> - 无返回值（如果任务不存在或非暂停状态则静默返回）
 *
 * @description
 * - 仅当任务状态为 'paused' 时才会恢复，其他状态直接返回
 * - 恢复后会重新发送队列消息以触发下一章生成
 *
 * @example
 * ```typescript
 * await resumeBatchTask(env, 'abc123def')
 * // 任务已恢复，将开始生成下一章
 * ```
 */
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

/**
 * 取消批量生成任务（不可恢复）
 *
 * @param env - Cloud Workers 环境变量（包含数据库连接）
 * @param taskId - 任务ID
 * @returns Promise<void> - 无返回值
 *
 * @description
 * - 将任务状态标记为 'cancelled'，正在执行的章节会完成但后续章节不会生成
 * - 取消后不可恢复，如需重新生成需调用 startBatchGeneration 创建新任务
 */
export async function cancelBatchTask(env: Env, taskId: string): Promise<void> {
  const db = drizzle(env.DB)
  await db.update(batchGenerationTasks)
    .set({ status: 'cancelled', updatedAt: sql`(unixepoch())` })
    .where(eq(batchGenerationTasks.id, taskId))
}

/**
 * 查询指定任务的详细信息
 *
 * @param env - Cloud Workers 环境变量
 * @param taskId - 任务ID
 * @returns Promise<BatchTask | null> - 任务对象（包含状态、进度等），不存在则返回 null
 *
 * @example
 * ```typescript
 * const task = await getBatchTask(env, 'abc123')
 * if (task) {
 *   console.log(`进度: ${task.completedCount}/${task.targetCount}`)
 * }
 * ```
 */
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

export async function markTaskDone(env: Env, taskId: string): Promise<void> {
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
