/**
 * @file checkLogService.ts
 * @description 章节检查日志服务，负责存储和查询角色一致性/连贯性检查结果
 */
import { drizzle } from 'drizzle-orm/d1'
import { checkLogs } from '../../db/schema'
import { eq, desc, and, sql } from 'drizzle-orm'
import type { Env } from '../../lib/types'

export interface CheckLogData {
  novelId: string
  chapterId: string
  checkType: 'character_consistency' | 'chapter_coherence' | 'combined' | 'volume_progress'
  score?: number
  status: 'success' | 'failed' | 'error'
  characterResult?: any // 角色一致性检查结果
  coherenceResult?: any // 连贯性检查结果 / 卷完成程度检查结果
  issuesCount?: number
  errorMessage?: string
}

export async function saveCheckLog(env: Env, data: CheckLogData): Promise<string> {
  const db = drizzle(env.DB)

  const logId = Array.from(crypto.getRandomValues(new Uint8Array(8)))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')

  await db.insert(checkLogs).values({
    id: logId,
    novelId: data.novelId,
    chapterId: data.chapterId,
    checkType: data.checkType,
    score: data.score ?? 100,
    status: data.status,
    characterResult: data.characterResult ? JSON.stringify(data.characterResult) : null,
    coherenceResult: data.coherenceResult ? JSON.stringify(data.coherenceResult) : null,
    issuesCount: data.issuesCount ?? 0,
    errorMessage: data.errorMessage || null,
  })

  return logId
}

export async function getLatestCheckLog(
  env: Env,
  chapterId: string,
  checkType?: string
): Promise<any> {
  const db = drizzle(env.DB)

  let query = db
    .select()
    .from(checkLogs)
    .where(eq(checkLogs.chapterId, chapterId))
    .orderBy(desc(checkLogs.createdAt))
    .limit(1)

  if (checkType) {
    query = db
      .select()
      .from(checkLogs)
      .where(and(
        eq(checkLogs.chapterId, chapterId),
        eq(checkLogs.checkType, checkType as any)
      ))
      .orderBy(desc(checkLogs.createdAt))
      .limit(1)
  }

  const result = await query.get()

  if (!result) return null

  return {
    ...result,
    characterResult: result.characterResult ? JSON.parse(result.characterResult) : null,
    coherenceResult: result.coherenceResult ? JSON.parse(result.coherenceResult) : null,
  }
}

export async function getCheckLogHistory(
  env: Env,
  chapterId: string,
  checkType?: string,
  limit: number = 20
): Promise<any[]> {
  const db = drizzle(env.DB)

  let results

  if (checkType) {
    results = await db
      .select()
      .from(checkLogs)
      .where(and(
        eq(checkLogs.chapterId, chapterId),
        eq(checkLogs.checkType, checkType as any)
      ))
      .orderBy(desc(checkLogs.createdAt))
      .limit(limit)
      .all()
  } else {
    results = await db
      .select()
      .from(checkLogs)
      .where(eq(checkLogs.chapterId, chapterId))
      .orderBy(desc(checkLogs.createdAt))
      .limit(limit)
      .all()
  }

  return results.map(log => ({
    ...log,
    characterResult: log.characterResult ? JSON.parse(log.characterResult) : null,
    coherenceResult: log.coherenceResult ? JSON.parse(log.coherenceResult) : null,
  }))
}
