/**
 * @file generate.ts
 * @description 内容生成路由模块，提供章节生成、大纲生成、摘要生成、角色一致性检查等功能
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
  generateOutlineBatch,
  checkChapterCoherence,
  generateMasterOutlineSummary,
  generateVolumeSummary,
  confirmBatchChapterCreation,
  generateNextChapter,
} from '../services/agent'
import { generateOutline } from '../services/llm'

const router = new Hono<{ Bindings: Env }>()

const GenerateSchema = z.object({
  chapterId: z.string().min(1),
  novelId: z.string().min(1),
  mode: z.enum(['generate', 'continue', 'rewrite']).optional().default('generate'),
  existingContent: z.string().optional(),
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
  const { chapterId, novelId, mode, existingContent, options } = body

  const { readable, writable } = new TransformStream()
  const writer = writable.getWriter()
  const encoder = new TextEncoder()
  const startTime = Date.now()
  let resolvedModelId = 'unknown'

  generateChapter(
    c.env,
    chapterId,
    novelId,
    (text) => {
      const data = `data: ${JSON.stringify({ content: text })}\n\n`
      writer.write(encoder.encode(data))
    },
    (event: ToolCallEvent) => {
      const data = `data: ${JSON.stringify({ type: 'tool_call', name: event.name, args: event.args, result: (event.result || '').slice(0, 500) })}\n\n`
      writer.write(encoder.encode(data))
    },
    async (usage, modelId) => {
      resolvedModelId = modelId
      const durationMs = Date.now() - startTime
      
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

      // Phase 2.3: 异步发送连贯性检查结果（不阻塞主流程）
      const coherenceCheckPromise = checkChapterCoherence(c.env, chapterId, novelId)
        .then(coherenceResult => {
          if (coherenceResult.hasIssues) {
            const coherenceData = `data: ${JSON.stringify({
              type: 'coherence_check',
              score: coherenceResult.score,
              issues: coherenceResult.issues,
            })}\n\n`
            writer.write(encoder.encode(coherenceData))
          }
        })
        .catch(err => console.warn('Failed to send coherence check:', err))

      const doneData = `data: ${JSON.stringify({ type: 'done', usage })}\n\ndata: [DONE]\n\n`
      writer.write(encoder.encode(doneData))

      // 等待连贯性检查完成后再关闭流（最多等 5 秒）
      Promise.race([
        coherenceCheckPromise,
        new Promise(resolve => setTimeout(resolve, 5000)),
      ]).finally(() => writer.close())
    },
    async (error) => {
      const durationMs = Date.now() - startTime
      
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
    { mode, existingContent }
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
    await triggerAutoSummary(c.env, chapterId, novelId, {
      prompt_tokens: 0,
      completion_tokens: 0,
    })

    return c.json({ ok: true, message: 'Summary generation triggered' })
  } catch (error) {
    console.error('Manual summary failed:', error)
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
})), async (c) => {
  const { chapterId, characterIds } = c.req.valid('json')

  try {
    const result = await checkCharacterConsistency(c.env, { chapterId, characterIds })
    return c.json(result)
  } catch (error) {
    console.error('Character check failed:', error)
    return c.json(
      { error: 'Check failed', details: (error as Error).message },
      500
    )
  }
})

/**
 * POST /outline - 生成单个大纲节点
 * @description 使用AI生成单个大纲节点内容
 * @param {string} novelId - 小说ID
 * @param {string} title - 大纲标题
 * @param {string} type - 大纲类型
 * @param {string} [parentTitle] - 父节点标题
 * @param {string} [context] - 上下文信息
 * @returns {Object} { content: string }
 * @throws {500} 生成异常
 */
router.post('/outline', zValidator('json', z.object({
  novelId: z.string().min(1),
  title: z.string().min(1),
  type: z.string(),
  parentTitle: z.string().optional(),
  context: z.string().optional(),
})), async (c) => {
  const { novelId, title, type, parentTitle, context } = c.req.valid('json')

  try {
    const content = await generateOutline(c.env, { novelId, title, type, parentTitle, context })
    return c.json({ content })
  } catch (error) {
    return c.json(
      { error: '生成异常', details: (error as Error).message },
      500
    )
  }
})

/**
 * POST /outline-batch - 批量生成大纲
 * @description 批量生成卷下的章节大纲
 * @param {string} volumeId - 卷ID
 * @param {string} novelId - 小说ID
 * @param {number} [chapterCount] - 章节数量（1-30）
 * @param {string} [context] - 上下文信息
 * @returns {Object} 批量生成结果
 * @throws {500} 批量生成异常
 */
router.post('/outline-batch', zValidator('json', z.object({
  volumeId: z.string().min(1),
  novelId: z.string().min(1),
  chapterCount: z.number().min(1).max(30).optional(),
  context: z.string().optional(),
})), async (c) => {
  const { volumeId, novelId, chapterCount, context } = c.req.valid('json')

  try {
    const result = await generateOutlineBatch(c.env, { volumeId, novelId, chapterCount, context })
    
    if (!result.ok) {
      return c.json({ error: result.error, details: result.details }, 500)
    }
    
    return c.json(result)
  } catch (error) {
    console.error('Batch outline generation failed:', error)
    return c.json(
      { error: '批量生成异常', details: (error as Error).message },
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

router.post('/confirm-batch-chapters', zValidator('json', z.object({
  volumeId: z.string().min(1),
  novelId: z.string().min(1),
  chapterPlans: z.array(z.object({
    chapterTitle: z.string(),
    summary: z.string(),
  })),
})), async (c) => {
  const { volumeId, novelId, chapterPlans } = c.req.valid('json')
  const result = await confirmBatchChapterCreation(c.env, { volumeId, novelId, chapterPlans })
  
  if (!result.ok) {
    return c.json({ error: result.error }, 500)
  }
  
  return c.json(result)
})

router.post('/next-chapter', zValidator('json', z.object({
  volumeId: z.string().min(1),
  novelId: z.string().min(1),
})), async (c) => {
  const { volumeId, novelId } = c.req.valid('json')
  const result = await generateNextChapter(c.env, { volumeId, novelId })
  
  if (!result.ok) {
    return c.json({ error: result.error }, 500)
  }
  
  return c.json(result)
})

export { router as generate }
