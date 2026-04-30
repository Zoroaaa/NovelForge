/**
 * @file generate.ts
 * @description 内容生成路由模块，提供章节生成、摘要生成、角色一致性检查等功能
 * @version 1.0.0
 * @modified 2026-04-21 - 添加规范化注释
 */
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import type { Env } from '../lib/types'
import {
  generateChapter,
  type ToolCallEvent,
  triggerAutoSummary,
  logGeneration,
  getGenerationLogs,
  checkCharacterConsistency,
  checkChapterCoherence,
  repairChapterByIssues,
  repairChapterByCharacterIssues,
  repairChapterByVolumeIssues,
  generateMasterOutlineSummary,
  generateVolumeSummary,
  checkVolumeProgress,
} from '../services/agent'
import { SSE_STREAM_TIMEOUT } from '../services/agent/constants'
import { saveCheckLog, getLatestCheckLog, getCheckLogHistory } from '../services/agent/checkLogService'
import { buildChapterContext } from '../services/contextBuilder'
import { buildMessages } from '../services/agent/messages'
import { drizzle } from 'drizzle-orm/d1'
import { novels, chapters } from '../db/schema'
import { eq, isNull } from 'drizzle-orm'
import { enqueue } from '../lib/queue'
import { checkAndCompleteVolume } from '../services/agent/volumeCompletion'

const router = new Hono<{ Bindings: Env }>()

const GenerateSchema = z.object({
  chapterId: z.string().min(1),
  novelId: z.string().min(1),
  mode: z.enum(['generate', 'continue', 'rewrite']).optional().default('generate'),
  existingContent: z.string().optional(),
  targetWords: z.number().min(500).max(8000).optional(),
  issuesContext: z.array(z.string()).optional(),
  options: z
    .object({
      enableRAG: z.boolean().optional(),
      enableAutoSummary: z.boolean().optional(),
    })
    .optional(),
})

/**
 * POST /chapter - 生成章节内容（流式响应）
 * @description 使用AI生成章节内容，支持生成、续写、重写三种模式
 * @param {string} chapterId - 章节ID
 * @param {string} novelId - 小说ID
 * @param {string} [mode='generate'] - 生成模式：generate | continue | rewrite
 * @param {string} [existingContent] - 现有内容（续写/重写模式需要）
 * @param {Object} [options] - 可选配置
 * @param {boolean} [options.enableRAG] - 是否启用RAG检索增强
 * @param {boolean} [options.enableAutoSummary] - 是否自动生成摘要
 * @returns {ReadableStream} SSE流式响应
 */
router.post('/chapter', async (c) => {
  const body = GenerateSchema.parse(await c.req.json())
  const { chapterId, novelId, mode, existingContent, targetWords, issuesContext, options } = body

  try {
    const db = drizzle(c.env.DB)
    const chapterRow = await db.select({ volumeId: chapters.volumeId }).from(chapters).where(eq(chapters.id, chapterId)).get()
    if (chapterRow?.volumeId) {
      const volumeCheck = await checkAndCompleteVolume(c.env, chapterRow.volumeId)
      if (volumeCheck.completed) {
        return c.json({ error: 'VOLUME_COMPLETED', message: '该卷已达到目标章节数，无法继续生成' }, 403)
      }
    }
  } catch {
    // 卷完成检测失败不阻塞生成
  }

  const { readable, writable } = new TransformStream()
  const writer = writable.getWriter()
  const encoder = new TextEncoder()
  const startTime = Date.now()
  let resolvedModelId = 'unknown'

  const abortController = new AbortController()
  const timeoutId = setTimeout(() => {
    abortController.abort()
    console.warn(`[generate] SSE stream timeout (${SSE_STREAM_TIMEOUT/1000}s), aborting`)
  }, SSE_STREAM_TIMEOUT)

  c.req.raw.signal.addEventListener('abort', () => {
    writer.close().catch(err => console.warn('[generate] Failed to close writer on client disconnect:', err))
    clearTimeout(timeoutId)
    abortController.abort()
  })

  generateChapter(
    c.env,
    chapterId,
    novelId,
    (text) => {
      const data = `data: ${JSON.stringify({ content: text })}\n\n`
      writer.write(encoder.encode(data))
    },
    (event: ToolCallEvent) => {
      console.log(`[SSE] 工具调用: ${event.name}`)
      const data = `data: ${JSON.stringify({ type: 'tool_call', name: event.name, args: event.args, result: (event.result || '').slice(0, 500) })}\n\n`
      writer.write(encoder.encode(data))
    },
    async (usage, modelId) => {
      resolvedModelId = modelId
      const durationMs = Date.now() - startTime
      
      console.log(`[SSE] 章节生成完成: chapter=${chapterId}, model=${modelId}, tokens=${usage.completion_tokens}, duration=${durationMs}ms`)

      await logGeneration(c.env, {
        novelId,
        chapterId,
        stage: 'chapter_gen',
        modelId: resolvedModelId,
        promptTokens: usage.prompt_tokens,
        completionTokens: usage.completion_tokens,
        durationMs,
        status: 'success',
      })

      // Phase 2.3: 异步发送连贯性检查结果，score < 70 时触发自动修复
      const coherenceCheckPromise = checkChapterCoherence(c.env, chapterId, novelId)
        .then(async coherenceResult => {
          if (!coherenceResult.hasIssues) return

          // 先推送检查结果
          const coherenceData = `data: ${JSON.stringify({
            type: 'coherence_check',
            score: coherenceResult.score,
            issues: coherenceResult.issues,
          })}\n\n`
          writer.write(encoder.encode(coherenceData))

          // score < 70 才触发自动修复，避免小问题浪费 token
          if (coherenceResult.score < 70) {
            const repairResult = await repairChapterByIssues(
              c.env, chapterId, novelId, coherenceResult.issues, coherenceResult.score
            )
            if (repairResult.ok && repairResult.repairedContent) {
              const fixData = `data: ${JSON.stringify({
                type: 'coherence_fix',
                repairedContent: repairResult.repairedContent,
                originalScore: coherenceResult.score,
                issues: coherenceResult.issues,
              })}\n\n`
              writer.write(encoder.encode(fixData))
            }
          }
        })
        .catch(err => console.warn('Failed to send coherence check:', err))

      // 等待连贯性检查+修复完成后再发送 [DONE] 并关闭流（最多等 60 秒）
      Promise.race([
        coherenceCheckPromise,
        new Promise(resolve => setTimeout(resolve, 60000)),
      ]).then(() => {
        const doneData = `data: ${JSON.stringify({ type: 'done', usage })}\n\ndata: [DONE]\n\n`
        writer.write(encoder.encode(doneData))
      }).finally(() => {
        clearTimeout(timeoutId)
        writer.close()
      })
    },
    async (error) => {
      clearTimeout(timeoutId)
      const durationMs = Date.now() - startTime
      
      console.error(`[SSE] 章节生成失败: chapter=${chapterId}, duration=${durationMs}ms`, error)

      await logGeneration(c.env, {
        novelId,
        chapterId,
        stage: 'chapter_gen',
        modelId: resolvedModelId,
        durationMs,
        status: 'error',
        errorMsg: error.message,
      })

      const errorData = `data: ${JSON.stringify({ type: 'error', error: error.message })}\n\n`
      writer.write(encoder.encode(errorData))
      writer.close()
    },
    options || {},
    { mode, existingContent, targetWords, issuesContext }
  )

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
})

/**
 * POST /chapter/queue - 后台生成章节内容（异步队列模式）
 * @description 将章节生成任务提交到队列，立即返回，用户可关闭页面
 * @param {string} chapterId - 章节ID
 * @param {string} novelId - 小说ID
 * @param {string} [mode='generate'] - 生成模式：generate | continue | rewrite
 * @param {string} [existingContent] - 现有内容（续写/重写模式需要）
 * @param {Object} [options] - 可选配置
 * @returns {Object} { ok: boolean, taskId: string, message: string }
 */
router.post('/chapter/queue', async (c) => {
  const body = GenerateSchema.parse(await c.req.json())
  const { chapterId, novelId, mode, existingContent, targetWords, issuesContext, options } = body

  try {
    const taskId = await enqueue(c.env, {
      type: 'generate_chapter',
      payload: {
        chapterId,
        novelId,
        mode: mode || 'generate',
        existingContent,
        targetWords,
        issuesContext,
        enableRAG: options?.enableRAG,
        enableAutoSummary: options?.enableAutoSummary,
      },
    })

    return c.json({
      ok: true,
      message: '章节生成任务已提交到后台队列',
      taskId,
    })
  } catch (error) {
    console.error('Failed to enqueue generation task:', error)
    return c.json(
      {
        error: 'Failed to enqueue generation task',
        details: (error as Error).message,
      },
      500
    )
  }
})

/**
 * POST /summary - 生成章节摘要
 * @description 手动触发章节摘要生成
 * @param {string} chapterId - 章节ID
 * @param {string} novelId - 小说ID
 * @returns {Object} { ok: boolean, message: string }
 * @throws {500} 摘要生成失败
 */
router.post('/summary', zValidator('json', z.object({
  chapterId: z.string().min(1),
  novelId: z.string().min(1),
})), async (c) => {
  const { chapterId, novelId } = c.req.valid('json')

  try {
    const result = await triggerAutoSummary(c.env, chapterId, novelId, {
      prompt_tokens: 0,
      completion_tokens: 0,
    })

    const metrics = result.metrics
    await logGeneration(c.env, {
      novelId,
      chapterId,
      stage: 'auto_summary',
      modelId: metrics?.modelId || 'N/A',
      promptTokens: metrics?.usage.prompt_tokens || 0,
      completionTokens: metrics?.usage.completion_tokens || 0,
      durationMs: metrics?.durationMs || 0,
      status: 'success',
      contextSnapshot: JSON.stringify({ enabled: true, manual: true }),
    })

    return c.json({ ok: true, message: 'Summary generation triggered' })
  } catch (error) {
    console.error('Manual summary failed:', error)

    await logGeneration(c.env, {
      novelId,
      chapterId,
      stage: 'auto_summary',
      modelId: 'N/A',
      durationMs: 0,
      status: 'error',
      errorMsg: (error as Error).message,
      contextSnapshot: JSON.stringify({ enabled: true, manual: true, error: (error as Error).message }),
    })

    return c.json(
      { error: 'Failed to generate summary', details: (error as Error).message },
      500
    )
  }
})

/**
 * GET /logs - 获取生成日志
 * @description 获取AI生成任务的日志记录
 * @param {string} [novelId] - 可选的小说ID过滤
 * @param {number} [limit=50] - 返回条数限制
 * @returns {Object} { logs: Array }
 */
router.get('/logs', zValidator('query', z.object({
  novelId: z.string().optional(),
  limit: z.coerce.number().optional().default(50),
})), async (c) => {
  const { novelId, limit } = c.req.valid('query')
  const logs = await getGenerationLogs(c.env, { novelId, limit })
  return c.json({ logs })
})
  
/**
 * POST /check - 检查角色一致性
 * @description 检查章节内容中角色描写的一致性
 * @param {string} chapterId - 章节ID
 * @param {string[]} [characterIds] - 可选的角色ID列表
 * @returns {Object} 一致性检查结果
 * @throws {500} 检查失败
 */
router.post('/check', zValidator('json', z.object({
  chapterId: z.string().min(1),
  characterIds: z.array(z.string()).optional().default([]),
  novelId: z.string().min(1).optional(),
})), async (c) => {
  const { chapterId, characterIds, novelId } = c.req.valid('json')

  try {
    const result = await checkCharacterConsistency(c.env, { chapterId, characterIds })

    if (novelId) {
      await saveCheckLog(c.env, {
        novelId,
        chapterId,
        checkType: 'character_consistency',
        score: result.score,
        status: 'success',
        characterResult: result,
        issuesCount: (result.conflicts?.length || 0) + (result.warnings?.length || 0),
      })
    }

    return c.json(result)
  } catch (error) {
    console.error('Character check failed:', error)

    if (novelId) {
      await saveCheckLog(c.env, {
        novelId,
        chapterId,
        checkType: 'character_consistency',
        status: 'error',
        errorMessage: (error as Error).message,
      })
    }

    return c.json(
      { error: 'Check failed', details: (error as Error).message },
      500
    )
  }
})

router.post('/master-outline-summary', zValidator('json', z.object({
  novelId: z.string().min(1),
})), async (c) => {
  const { novelId } = c.req.valid('json')
  const result = await generateMasterOutlineSummary(c.env, novelId)
  
  if (!result.ok) {
    return c.json({ error: result.error }, 500)
  }
  
  return c.json({ ok: true, summary: result.summary })
})

router.post('/volume-summary', zValidator('json', z.object({
  volumeId: z.string().min(1),
  novelId: z.string().min(1),
})), async (c) => {
  const { volumeId, novelId } = c.req.valid('json')
  const result = await generateVolumeSummary(c.env, volumeId, novelId)
  
  if (!result.ok) {
    return c.json({ error: result.error }, 500)
  }
  
  return c.json({ ok: true, summary: result.summary })
})

/**
 * POST /preview-context - 预览章节生成的上下文信息和最终Prompt
 * @description 查看指定章节生成时会注入的上下文各层内容，以及最终发送给AI的完整Prompt，用于调试和诊断
 * @param {string} novelId - 小说ID
 * @param {string} chapterId - 章节ID
 * @returns {Object} { contextBundle, finalPrompt, debugInfo }
 */
router.post('/preview-context', zValidator('json', z.object({
  novelId: z.string().min(1),
  chapterId: z.string().min(1),
})), async (c) => {
  const { novelId, chapterId } = c.req.valid('json')

  console.log(`[Preview-Context] Request received for novel=${novelId}, chapter=${chapterId}`)

  const TIMEOUT_MS = 120000

  c.header('X-RateLimit-Reminder', 'This is a diagnostic endpoint. Avoid frequent calls in production.')

  try {
    const startTime = Date.now()
    const db = drizzle(c.env.DB)

    const [contextBundle, chapterRow, novelRow] = await Promise.all([
      Promise.race([
        buildChapterContext(c.env, novelId, chapterId),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Context building timeout')), TIMEOUT_MS)
        ),
      ]),
      db.select({ title: chapters.title }).from(chapters).where(eq(chapters.id, chapterId)).get(),
      db.select({ systemPrompt: novels.systemPrompt }).from(novels).where(eq(novels.id, novelId)).get(),
    ])

    const buildTimeMs = Date.now() - startTime

    if (!contextBundle) {
      return c.json({
        ok: false,
        error: 'Failed to build context',
      }, 500)
    }

    if (!chapterRow) {
      return c.json({
        ok: false,
        error: 'Chapter not found',
      }, 404)
    }

    const finalMessages = buildMessages(
      chapterRow.title,
      contextBundle,
      {},
      undefined,
      novelRow?.systemPrompt ?? undefined
    )

    const finalPrompt = finalMessages.map(m => `[${m.role.toUpperCase()}]\n${m.content}`).join('\n\n')

    return c.json({
      ok: true,
      contextBundle,
      finalPrompt,
      messages: finalMessages,
      chapterTitle: chapterRow.title,
      buildTimeMs,
      summary: {
        totalLayers: Object.keys(contextBundle.core).filter(k => contextBundle.core[k as keyof typeof contextBundle.core]).length +
                     Object.keys(contextBundle.dynamic).filter(k => {
                       const val = contextBundle.dynamic[k as keyof typeof contextBundle.dynamic]
                       return Array.isArray(val) ? val.length > 0 : false
                     }).length,
        coreLayerCount: Object.keys(contextBundle.core).filter(k => contextBundle.core[k as keyof typeof contextBundle.core]).length,
        dynamicLayerCount: Object.keys(contextBundle.dynamic).filter(k => {
          const val = contextBundle.dynamic[k as keyof typeof contextBundle.dynamic]
          return Array.isArray(val) ? val.length > 0 : false
        }).length,
        ragResultCount: contextBundle.debug.ragQueriesCount,
        ragRawResultCount: {
          characters: contextBundle.debug.ragRawResults.characters.length,
          foreshadowing: contextBundle.debug.ragRawResults.foreshadowing.length,
          settings: contextBundle.debug.ragRawResults.settings.length,
        },
        promptTokenEstimate: Math.ceil(finalPrompt.length * 1.3),
      },
    })
  } catch (error) {
    console.error('Preview context failed:', error)

    const isTimeout = (error as Error).message?.includes('timeout')

    return c.json(
      {
        error: isTimeout ? 'Context building timeout (30s)' : 'Preview context failed',
        details: (error as Error).message,
        ...(isTimeout && { suggestion: 'Try simplifying the chapter or reducing context layers' }),
      },
      isTimeout ? 504 : 500
    )
  }
})

router.post('/coherence-check', zValidator('json', z.object({
  chapterId: z.string().min(1),
  novelId: z.string().min(1),
})), async (c) => {
  const { chapterId, novelId } = c.req.valid('json')

  try {
    const result = await checkChapterCoherence(c.env, chapterId, novelId)

    await saveCheckLog(c.env, {
      novelId,
      chapterId,
      checkType: 'chapter_coherence',
      score: result.score,
      status: 'success',
      coherenceResult: result,
      issuesCount: result.issues?.length || 0,
    })

    return c.json({
      score: result.score,
      issues: result.issues,
    })
  } catch (error) {
    console.error('Coherence check failed:', error)

    await saveCheckLog(c.env, {
      novelId,
      chapterId,
      checkType: 'chapter_coherence',
      status: 'error',
      errorMessage: (error as Error).message,
    })

    return c.json(
      { error: '一致性检查失败', details: (error as Error).message },
      500
    )
  }
})

/**
 * POST /volume-progress-check - 卷完成程度检查
 * @description 使用AI评估当前卷的进度是否健康
 * @param {string} chapterId - 章节ID
 * @param {string} novelId - 小说ID
 */
router.post('/volume-progress-check', zValidator('json', z.object({
  chapterId: z.string().min(1),
  novelId: z.string().min(1),
})), async (c) => {
  const { chapterId, novelId } = c.req.valid('json')

  try {
    const result = await checkVolumeProgress(c.env, chapterId, novelId)

    await saveCheckLog(c.env, {
      novelId,
      chapterId,
      checkType: 'volume_progress',
      score: result.score,
      status: 'success',
      volumeProgressResult: result,
      issuesCount: result.wordCountIssues.length + result.rhythmIssues.length,
    })

    return c.json(result)
  } catch (error) {
    console.error('Volume progress check failed:', error)

    await saveCheckLog(c.env, {
      novelId,
      chapterId,
      checkType: 'volume_progress',
      status: 'error',
      errorMessage: (error as Error).message,
      issuesCount: 0,
    })

    return c.json(
      { error: '卷完成度检查失败', details: (error as Error).message },
      500
    )
  }
})

/**
 * POST /repair-chapter - 根据检查报告修复章节
 * @description 将检查报告的问题和章节原文交给AI进行针对性修复
 * @param {string} chapterId - 章节ID
 * @param {string} novelId - 小说ID
 * @param {string} repairType - 修复类型：'coherence' | 'character' | 'volume'
 * @param {Object} issues - 各类型对应的检查结果问题
 * @param {string} [volumeContext] - 卷进度修复时的诊断上下文
 */
router.post('/repair-chapter', zValidator('json', z.object({
  chapterId: z.string().min(1),
  novelId: z.string().min(1),
  repairType: z.enum(['coherence', 'character', 'volume']),
  coherenceIssues: z.array(z.object({
    severity: z.string(),
    message: z.string(),
    suggestion: z.string().optional(),
    category: z.string().optional(),
  })).optional(),
  coherenceScore: z.number().optional(),
  characterConflicts: z.array(z.object({
    characterName: z.string(),
    dimension: z.string(),
    issue: z.string(),
    excerpt: z.string().optional(),
    suggestion: z.string().optional(),
  })).optional(),
  wordCountIssues: z.array(z.object({
    chapterNumber: z.number(),
    chapterTitle: z.string(),
    message: z.string(),
  })).optional(),
  rhythmIssues: z.array(z.object({
    chapterNumber: z.number(),
    chapterTitle: z.string(),
    dimension: z.string(),
    deviation: z.string(),
    suggestion: z.string(),
  })).optional(),
  volumeContext: z.string().optional(),
})), async (c) => {
  const { chapterId, novelId, repairType, coherenceIssues, coherenceScore, characterConflicts, wordCountIssues, rhythmIssues, volumeContext } = c.req.valid('json')

  try {
    let result: { ok: boolean; repairedContent?: string; error?: string }

    switch (repairType) {
      case 'coherence':
        if (!coherenceIssues) return c.json({ ok: false, error: '缺少连贯性问题数据' }, 400)
        result = await repairChapterByIssues(c.env, chapterId, novelId, coherenceIssues as any, coherenceScore || 0)
        break
      case 'character':
        if (!characterConflicts) return c.json({ ok: false, error: '缺少角色冲突数据' }, 400)
        result = await repairChapterByCharacterIssues(c.env, chapterId, novelId, characterConflicts)
        break
      case 'volume':
        result = await repairChapterByVolumeIssues(c.env, chapterId, novelId, wordCountIssues || [], rhythmIssues || [], volumeContext || '')
        break
      default:
        return c.json({ ok: false, error: '未知修复类型' }, 400)
    }

    return c.json(result)
  } catch (error) {
    console.error('Repair chapter failed:', error)
    return c.json({ ok: false, error: (error as Error).message }, 500)
  }
})

/**
 * POST /combined-check - 组合检查（角色一致性 + 章节连贯性）
 * @description 同时执行角色一致性检查和章节连贯性检查
 * @param {string} chapterId - 章节ID
 * @param {string} novelId - 小说ID
 * @param {string[]} [characterIds] - 可选的角色ID列表
 * @returns {Object} 组合检查结果，包含两个检查的结果和综合评分
 * @throws {500} 检查失败
 */
router.post('/combined-check', zValidator('json', z.object({
  chapterId: z.string().min(1),
  novelId: z.string().min(1),
  characterIds: z.array(z.string()).optional().default([]),
})), async (c) => {
  const { chapterId, novelId, characterIds } = c.req.valid('json')

  try {
    const [characterResult, coherenceResult, volumeProgressResult] = await Promise.all([
      checkCharacterConsistency(c.env, { chapterId, characterIds }),
      checkChapterCoherence(c.env, chapterId, novelId),
      checkVolumeProgress(c.env, chapterId, novelId),
    ])

    const characterScore = characterResult.score
    const combinedScore = Math.round((characterScore + coherenceResult.score + volumeProgressResult.score) / 3)

    await saveCheckLog(c.env, {
      novelId,
      chapterId,
      checkType: 'combined',
      score: combinedScore,
      status: 'success',
      characterResult: characterResult,
      coherenceResult: coherenceResult,
      volumeProgressResult: volumeProgressResult,
      issuesCount: (characterResult.conflicts?.length || 0) +
                   (characterResult.warnings?.length || 0) +
                   (coherenceResult.issues?.length || 0) +
                   volumeProgressResult.wordCountIssues.length +
                   volumeProgressResult.rhythmIssues.length,
    })

    return c.json({
      score: combinedScore,
      characterCheck: characterResult,
      coherenceCheck: {
        score: coherenceResult.score,
        issues: coherenceResult.issues,
      },
      volumeProgressCheck: volumeProgressResult,
      hasIssues: characterResult.conflicts?.length > 0 || coherenceResult.hasIssues ||
                 volumeProgressResult.wordCountIssues.length > 0 || volumeProgressResult.rhythmIssues.length > 0,
    })
  } catch (error) {
    console.error('Combined check failed:', error)

    await saveCheckLog(c.env, {
      novelId,
      chapterId,
      checkType: 'combined',
      status: 'error',
      errorMessage: (error as Error).message,
    })

    return c.json(
      { error: '组合检查失败', details: (error as Error).message },
      500
    )
  }
})

/**
 * GET /check-logs/latest - 获取最新检查日志
 * @description 获取指定章节的最新检查记录
 * @param {string} chapterId - 章节ID
 * @param {string} [checkType] - 可选的检查类型过滤
 * @returns {Object} 最新检查日志
 */
router.get('/check-logs/latest', zValidator('query', z.object({
  chapterId: z.string().min(1),
  checkType: z.string().optional(),
})), async (c) => {
  const { chapterId, checkType } = c.req.valid('query')

  try {
    const log = await getLatestCheckLog(c.env, chapterId, checkType)

    if (!log) {
      return c.json({ log: null })
    }

    return c.json({ log })
  } catch (error) {
    console.error('Get latest check log failed:', error)
    return c.json(
      { error: '获取检查日志失败', details: (error as Error).message },
      500
    )
  }
})

/**
 * GET /check-logs/history - 获取检查日志历史
 * @description 获取指定章节的检查历史记录
 * @param {string} chapterId - 章节ID
 * @param {string} [checkType] - 可选的检查类型过滤
 * @param {number} [limit=20] - 返回条数限制
 * @returns {Object} 检查日志列表
 */
router.get('/check-logs/history', zValidator('query', z.object({
  chapterId: z.string().min(1),
  checkType: z.string().optional(),
  limit: z.coerce.number().optional().default(20),
})), async (c) => {
  const { chapterId, checkType, limit } = c.req.valid('query')

  try {
    const logs = await getCheckLogHistory(c.env, chapterId, checkType, limit)
    return c.json({ logs })
  } catch (error) {
    console.error('Get check logs history failed:', error)
    return c.json(
      { error: '获取检查日志历史失败', details: (error as Error).message },
      500
    )
  }
})

export { router as generate }
