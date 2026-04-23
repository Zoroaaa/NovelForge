/**
 * @file logging.ts
 * @description Agent生成日志
 */
import { drizzle } from 'drizzle-orm/d1'
import { generationLogs } from '../../db/schema'
import { eq, desc } from 'drizzle-orm'
import type { Env } from '../../lib/types'

export async function logGeneration(
  env: Env,
  data: {
    novelId: string
    chapterId: string
    stage: string
    modelId: string
    promptTokens?: number
    completionTokens?: number
    durationMs: number
    status: 'success' | 'error'
    errorMsg?: string
  }
): Promise<void> {
  const db = drizzle(env.DB)
  try {
    await db.insert(generationLogs).values({
      novelId: data.novelId,
      chapterId: data.chapterId,
      stage: data.stage,
      modelId: data.modelId,
      promptTokens: data.promptTokens,
      completionTokens: data.completionTokens,
      durationMs: data.durationMs,
      status: data.status,
      errorMsg: data.errorMsg,
    })
  } catch (logError) {
    console.error('Failed to write generation log:', logError)
  }
}

export async function getGenerationLogs(
  env: Env,
  options: { novelId?: string; limit?: number }
): Promise<any[]> {
  const db = drizzle(env.DB)
  const { novelId, limit = 50 } = options

  let query = db.select().from(generationLogs).orderBy(desc(generationLogs.createdAt)).limit(limit)

  if (novelId) {
    query = query.where(eq(generationLogs.novelId, novelId)) as any
  }

  return query.all()
}
