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
import { drizzle } from 'drizzle-orm/d1'
import { eq, desc, sql } from 'drizzle-orm'
import type { Env } from '../lib/types'
import { generateChapter } from '../services/agent'
import { generationLogs } from '../db/schema'

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
 * POST /api/generate/chapter
 *
 * 智能章节生成（SSE 流式输出）
 */
router.post('/chapter', async (c) => {
  const body = GenerateSchema.parse(await c.req.json())
  const { chapterId, novelId, mode, existingContent, options } = body

  const { readable, writable } = new TransformStream()
  const writer = writable.getWriter()
  const encoder = new TextEncoder()
  const startTime = Date.now()
  let resolvedModelId = 'unknown'

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
    async (usage, modelId) => {
      resolvedModelId = modelId
      const durationMs = Date.now() - startTime
      
      try {
        const db = drizzle(c.env.DB)
        await db.insert(generationLogs).values({
          novelId,
          chapterId,
          stage: 'chapter_gen',
          modelId: resolvedModelId,
          promptTokens: usage.prompt_tokens,
          completionTokens: usage.completion_tokens,
          durationMs,
          status: 'success',
        })
      } catch (logError) {
        console.error('Failed to write generation log:', logError)
      }

      const doneData = `data: ${JSON.stringify({ type: 'done', usage })}\n\ndata: [DONE]\n\n`
      writer.write(encoder.encode(doneData))
      writer.close()
    },
    // onError
    async (error) => {
      const durationMs = Date.now() - startTime
      
      // 记录错误日志
      try {
        const db = drizzle(c.env.DB)
        await db.insert(generationLogs).values({
          novelId,
          chapterId,
          stage: 'chapter_gen',
          modelId: resolvedModelId,
          durationMs,
          status: 'error',
          errorMsg: error.message,
        })
      } catch (logError) {
        console.error('Failed to write generation log:', logError)
      }

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

router.get('/logs', zValidator('query', z.object({
  novelId: z.string().optional(),
  limit: z.coerce.number().optional().default(50),
})), async (c) => {
  const { novelId, limit } = c.req.valid('query')
  const db = drizzle(c.env.DB)

  let query = db.select().from(generationLogs).orderBy(desc(generationLogs.createdAt)).limit(limit)
  
  if (novelId) {
    query = query.where(eq(generationLogs.novelId, novelId)) as any
  }

  const logs = await query.all()
  return c.json({ logs })
})
  
router.post('/check', zValidator('json', z.object({
  chapterId: z.string().min(1),
  characterIds: z.array(z.string()).optional().default([]),
})), async (c) => {
  const { chapterId, characterIds } = c.req.valid('json')
  const db = drizzle(c.env.DB)

  const chapter = await db.select().from(chapters).where(eq(chapters.id, chapterId)).get()
  if (!chapter?.content) {
    return c.json({ error: 'Chapter not found or has no content' }, 404)
  }

  let characterInfo = ''
  if (characterIds.length > 0) {
    const chars = await db.select().from(characters).where(
      characterIds.map(id => eq(characters.id, id)).reduce((a, b) => sql`${a} OR ${b}`)
    ).all()
    characterInfo = chars.map(c => `【${c.name}】${c.role}: ${c.description || ''}`).join('\n')
  }

  const checkPrompt = `你是一个角色一致性检查助手。请检查以下小说内容是否符合角色设定。
  
【角色设定】:
${characterInfo || '无特定角色设定'}

【待检查内容】:
${chapter.content.slice(0, 10000)}

请以JSON格式输出检查结果：
{
  "conflicts": [
    { "characterName": "角色名", "conflict": "冲突描述", "excerpt": "相关段落" }
  ],
  "warnings": ["警告1", "警告2"]
}

如果没有冲突，conflicts 数组为空。`

  let summaryConfig
  try {
    summaryConfig = await resolveConfig(db, 'summary_gen', chapter.novelId)
    summaryConfig.apiKey = (c.env as any)[summaryConfig.apiKeyEnv || 'VOLCENGINE_API_KEY'] || ''
  } catch {
    summaryConfig = {
      provider: 'volcengine',
      modelId: 'doubao-lite-32k',
      apiBase: 'https://ark.cn-beijing.volces.com/api/v3',
      apiKey: (c.env as any).VOLCENGINE_API_KEY || '',
      params: { temperature: 0.3, max__tokens: 1000 },
    }
  }

  const base = summaryConfig.apiBase || 'https://ark.cn-beijing.volces.com/api/v3'
  const resp = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${summaryConfig.apiKey}`,
    },
    body: JSON.stringify({
      model: summaryConfig.modelId,
      messages: [
        { role: 'system', content: '你是一个JSON生成助手，只输出JSON，不要其他内容。' },
        { role: 'user', content: checkPrompt },
      ],
      temperature: 0.3,
      max_tokens: 1000,
    }),
  })

  if (!resp.ok) {
    return c.json({ error: 'Check failed', details: resp.statusText }, 500)
  }

  const result = await resp.json()
  const content = result.choices?.[0]?.message?.content || '{}'

  try {
    const parsed = JSON.parse(content)
    return c.json(parsed)
  } catch {
    return c.json({ conflicts: [], warnings: ['解析失败'], raw: content })
  }
})

export { router as generate }
