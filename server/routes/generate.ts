/**
 * NovelForge · Generate 路由（Phase 2 智能版）
 *
 * 支持两种模式：
 * - Phase 1 兼容模式：简单流式生成
 * - Phase 2 智能模式：RAG 上下文 + Agent 循环 + 自动摘要
 *
 * API 端点：
 * POST /api/generate/chapter  - 智能章节生成
 * GET  /api/generate/status/:id  - 查询生成状态
 */

import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import type { Env } from '../lib/types'
import { generateChapter } from '../services/agent'

const router = new Hono<{ Bindings: Env }>()

const GenerateSchema = z.object({
  chapterId: z.string().min(1),
  novelId: z.string().min(1),
  options: z
    .object({
      enableRAG: z.boolean().optional(),
      enableAutoSummary: z.boolean().optional(),
    })
    .optional(),
})

/**
 * POST /api/generate/chapter
 *
 * 智能章节生成（SSE 流式输出）
 */
router.post('/chapter', async (c) => {
  const body = GenerateSchema.parse(await c.req.json())
  const { chapterId, novelId, options } = body

  const { readable, writable } = new TransformStream()
  const writer = writable.getWriter()
  const encoder = new TextEncoder()

  // 启动异步生成流程
  generateChapter(
    c.env,
    chapterId,
    novelId,
    // onChunk
    (text) => {
      const data = `data: ${JSON.stringify({ content: text })}\n\n`
      writer.write(encoder.encode(data))
    },
    // onDone
    (usage) => {
      const doneData = `data: ${JSON.stringify({ type: 'done', usage })}\n\ndata: [DONE]\n\n`
      writer.write(encoder.encode(doneData))
      writer.close()
    },
    // onError
    (error) => {
      const errorData = `data: ${JSON.stringify({ type: 'error', error: error.message })}\n\n`
      writer.write(encoder.encode(errorData))
      writer.close()
    },
    options || {}
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
 * POST /api/generate/summary
 *
 * 手动触发摘要生成（用于已有内容的章节）
 */
router.post('/summary', zValidator('json', z.object({
  chapterId: z.string().min(1),
  novelId: z.string().min(1),
})), async (c) => {
  const { chapterId, novelId } = c.req.valid('json')

  try {
    const { triggerAutoSummary } = await import('../services/agent')
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

export { router as generate }
