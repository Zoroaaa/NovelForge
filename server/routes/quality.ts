/**
 * @file quality.ts
 * @description 质量检查路由模块 - 提供章节质量评分、批量检查、质量汇总等功能
 * @version 2.1.0
 * @modified 2026-04-30 - 完整集成角色一致性检查到批量检查和汇总功能
 */
import { Hono } from 'hono'
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'
import type { Env } from '../lib/types'
import { qualityScores, checkLogs, chapters } from '../db/schema'
import { eq, and, desc, sql, inArray } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import {
  checkChapterCoherence,
  checkVolumeProgress,
  checkCharacterConsistency,
} from '../services/agent'

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

/**
 * GET /summary - 获取质量检查汇总数据
 * @description 聚合最近N章的质量检查结果，返回各维度分数和问题列表
 * @query {string} novelId - 小说ID（必填）
 * @query {number} [limit=10] - 返回章节数限制
 * @returns {Object} { chapters: Array, averages: Object }
 */
router.get('/summary', zValidator('query', z.object({
  novelId: z.string().min(1),
  limit: z.coerce.number().int().min(1).max(50).optional().default(10),
})), async (c) => {
  const { novelId, limit } = c.req.valid('query')
  const db = drizzle(c.env.DB)

  try {
    const recentChapters = await db
      .select({
        id: chapters.id,
        title: chapters.title,
        sortOrder: chapters.sortOrder,
      })
      .from(chapters)
      .where(eq(chapters.novelId, novelId))
      .orderBy(desc(chapters.sortOrder))
      .limit(limit)
      .all()

    if (recentChapters.length === 0) {
      return c.json({
        chapters: [],
        averages: {
          coherence: 0,
          character: 0,
          progress: 0,
          overall: 0,
        },
      })
    }

    const chapterIds = recentChapters.map(ch => ch.id)

    const checkResults = await db
      .select({
        chapterId: checkLogs.chapterId,
        checkType: checkLogs.checkType,
        score: checkLogs.score,
        status: checkLogs.status,
        coherenceResult: checkLogs.coherenceResult,
        volumeProgressResult: checkLogs.volumeProgressResult,
        characterResult: checkLogs.characterResult,
        issuesCount: checkLogs.issuesCount,
        createdAt: checkLogs.createdAt,
      })
      .from(checkLogs)
      .where(
        and(
          inArray(checkLogs.chapterId, chapterIds),
          eq(checkLogs.status, 'success')
        )
      )
      .orderBy(desc(checkLogs.createdAt))
      .all()

    const chapterCheckMap = new Map<string, typeof checkResults>()

    checkResults.forEach(result => {
      const existing = chapterCheckMap.get(result.chapterId) || []
      existing.push(result)
      chapterCheckMap.set(result.chapterId, existing)
    })

    const qualityChapters = recentChapters.map(chapter => {
      const checks = chapterCheckMap.get(chapter.id) || []

      let coherenceScore: number | null = null
      let characterScore: number | null = null
      let progressScore: number | null = null
      let lastCheckedAt: number | null = null
      const issues: Array<{ severity: 'error' | 'warning'; category: string; message: string }> = []

      const coherenceCheck = checks.find(c =>
        (c.checkType === 'chapter_coherence' || c.checkType === 'combined')
      )
      const progressCheck = checks.find(c =>
        c.checkType === 'volume_progress' || c.checkType === 'combined'
      )
      const characterCheck = checks.find(c =>
        c.checkType === 'character_consistency'
      )

      if (coherenceCheck) {
        coherenceScore = coherenceCheck.score
        if (!lastCheckedAt || coherenceCheck.createdAt > lastCheckedAt) {
          lastCheckedAt = coherenceCheck.createdAt
        }
        if (coherenceCheck.coherenceResult) {
          try {
            const result = JSON.parse(coherenceCheck.coherenceResult)
            if (result.issues && Array.isArray(result.issues)) {
              result.issues.forEach((issue: { severity?: string; category?: string; message?: string }) => {
                issues.push({
                  severity: (issue.severity === 'error' ? 'error' : 'warning') as 'error' | 'warning',
                  category: issue.category || 'coherence',
                  message: issue.message || '连贯性问题',
                })
              })
            }
          } catch {}
        }
      }

      if (progressCheck) {
        progressScore = progressCheck.score
        if (!lastCheckedAt || progressCheck.createdAt > lastCheckedAt) {
          lastCheckedAt = progressCheck.createdAt
        }
        if (progressCheck.volumeProgressResult) {
          try {
            const result = JSON.parse(progressCheck.volumeProgressResult)
            if (result.wordCountIssues && Array.isArray(result.wordCountIssues)) {
              result.wordCountIssues.forEach((issue: { severity?: string; message?: string; dimension?: string }) => {
                issues.push({
                  severity: (issue.severity === 'error' ? 'error' : 'warning') as 'error' | 'warning',
                  category: issue.dimension || 'progress',
                  message: issue.message || '进度偏差问题',
                })
              })
            }
            if (result.rhythmIssues && Array.isArray(result.rhythmIssues)) {
              result.rhythmIssues.forEach((issue: { severity?: string; message?: string }) => {
                issues.push({
                  severity: 'warning',
                  category: 'rhythm',
                  message: issue.message || '节奏问题',
                })
              })
            }
          } catch {}
        }
      }

      if (characterCheck) {
        characterScore = characterCheck.score
        if (!lastCheckedAt || characterCheck.createdAt > lastCheckedAt) {
          lastCheckedAt = characterCheck.createdAt
        }
        if (characterCheck.characterResult) {
          try {
            const result = JSON.parse(characterCheck.characterResult)
            if (result.conflicts && Array.isArray(result.conflicts)) {
              result.conflicts.forEach((conflict: { type?: string; description?: string; severity?: string }) => {
                issues.push({
                  severity: (conflict.severity === 'error' ? 'error' : 'warning') as 'error' | 'warning',
                  category: conflict.type || 'character',
                  message: conflict.description || '角色冲突问题',
                })
              })
            }
            if (result.warnings && Array.isArray(result.warnings)) {
              result.warnings.forEach((warning: { type?: string; description?: string }) => {
                issues.push({
                  severity: 'warning',
                  category: warning.type || 'character',
                  message: warning.description || '角色一致性警告',
                })
              })
            }
          } catch {}
        }
      }

      const allScores = [coherenceScore, characterScore, progressScore].filter(s => s !== null)
      const overallScore = allScores.length > 0
        ? Math.round(allScores.reduce((a, b) => a + b!, 0) / allScores.length)
        : null

      return {
        id: chapter.id,
        chapterNumber: chapter.sortOrder,
        title: chapter.title || '',
        lastCheckedAt,
        coherenceScore,
        characterScore,
        progressScore,
        overallScore,
        issueCount: issues.length,
        issues,
      }
    })

    const validScores = qualityChapters.filter(ch => ch.overallScore !== null)

    const averages = validScores.length > 0 ? {
      coherence: Math.round(validScores.reduce((sum, ch) => sum + (ch.coherenceScore || 0), 0) / validScores.filter(ch => ch.coherenceScore !== null).length || 1),
      character: Math.round(validScores.reduce((sum, ch) => sum + (ch.characterScore || 0), 0) / validScores.filter(ch => ch.characterScore !== null).length || 1),
      progress: Math.round(validScores.reduce((sum, ch) => sum + (ch.progressScore || 0), 0) / validScores.filter(ch => ch.progressScore !== null).length || 1),
      overall: Math.round(validScores.reduce((sum, ch) => sum + (ch.overallScore || 0), 0) / validScores.length),
    } : {
      coherence: 0,
      character: 0,
      progress: 0,
      overall: 0,
    }

    return c.json({
      chapters: qualityChapters,
      averages,
    })
  } catch (error) {
    console.error('[Quality] Summary failed:', error)
    return c.json(
      { error: 'Internal Server Error', code: 'QUALITY_SUMMARY_FAILED', message: '获取质量汇总失败' },
      500
    )
  }
})

/**
 * POST /batch-check - 批量触发质量检查
 * @description 对指定小说的最新章节进行批量质量检查（连贯性 + 进度）
 * @body {string} novelId - 小说ID（必填）
 * @body {string[]} [chapterIds] - 可选的章节ID列表（为空则自动选择最新5章）
 * @returns {Object} { ok: boolean, checked: number, total: number, message: string }
 */
router.post('/batch-check', zValidator('json', z.object({
  novelId: z.string().min(1),
  chapterIds: z.array(z.string()).optional().default([]),
})), async (c) => {
  const { novelId, chapterIds } = c.req.valid('json')

  try {
    const db = drizzle(c.env.DB)

    let targetChapterIds: string[] = chapterIds

    if (targetChapterIds.length === 0) {
      const recentChapters = await db
        .select({ id: chapters.id })
        .from(chapters)
        .where(eq(chapters.novelId, novelId))
        .orderBy(desc(chapters.sortOrder))
        .limit(5)
        .all()

      targetChapterIds = recentChapters.map(ch => ch.id)
    }

    if (targetChapterIds.length === 0) {
      return c.json({
        ok: true,
        checked: 0,
        total: 0,
        message: '该小说暂无章节可检查',
      })
    }

    let checkedCount = 0
    const errors: string[] = []

    for (const chapterId of targetChapterIds) {
      try {
        console.log(`[BatchCheck] Checking chapter ${chapterId}`)

        const [coherenceResult, progressResult, characterResult] = await Promise.allSettled([
          checkChapterCoherence(c.env, chapterId, novelId),
          checkVolumeProgress(c.env, chapterId, novelId),
          checkCharacterConsistency(c.env, { chapterId, characterIds: [] }),
        ])

        if (coherenceResult.status === 'fulfilled' && coherenceResult.value?.score !== undefined) {
          checkedCount++
        }
        if (progressResult.status === 'fulfilled' && progressResult.value?.score !== undefined) {
          checkedCount++
        }
        if (characterResult.status === 'fulfilled' && characterResult.value?.score !== undefined) {
          checkedCount++
        }

        if (coherenceResult.status === 'rejected') {
          errors.push(`章节${chapterId}连贯性检查失败`)
        }
        if (progressResult.status === 'rejected') {
          errors.push(`章节${chapterId}进度检查失败`)
        }
        if (characterResult.status === 'rejected') {
          errors.push(`章节${chapterId}角色一致性检查失败`)
        }
      } catch (error) {
        console.error(`[BatchCheck] Error checking chapter ${chapterId}:`, error)
        errors.push(`章节${chapterId}检查异常`)
      }
    }

    const totalChecks = targetChapterIds.length * 3
    const successMessage = errors.length > 0
      ? `已完成 ${checkedCount}/${totalChecks} 项检查，${errors.length}个任务遇到错误`
      : `成功完成全部 ${totalChecks} 项质量检查（连贯性+进度+角色一致性）`

    return c.json({
      ok: true,
      checked: checkedCount,
      total: targetChapterIds.length,
      message: successMessage,
      ...(errors.length > 0 && { errors }),
    })
  } catch (error) {
    console.error('[Quality] Batch check failed:', error)
    return c.json(
      { error: 'Internal Server Error', code: 'BATCH_CHECK_FAILED', message: '批量检查失败' },
      500
    )
  }
})

export const quality = router
