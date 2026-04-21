/**
 * NovelForge · Generate 路由（Phase 2 智能版 + Phase 1.5 批量生成）
 *
 * 支持两种模式：
 * - Phase 1 兼容模式：简单流式生成
 * - Phase 2 智能模式：RAG 上下文 + Agent 循环 + 自动摘要
 *
 * API 端点：
 * POST /api/generate/chapter        - 智能章节生成
 * GET  /api/generate/status/:id     - 查询生成状态
 * POST /api/generate/outline-batch   - Phase 1.5: 批量生成章节大纲（非流式）
 */

import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { drizzle } from 'drizzle-orm/d1'
import { eq, desc, sql } from 'drizzle-orm'
import type { Env } from '../lib/types'
import { generateChapter, type ToolCallEvent } from '../services/agent'
import { generationLogs, chapters, characters, volumes } from '../db/schema'
import { resolveConfig } from '../services/llm'

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
    // onToolCall
    (event: ToolCallEvent) => {
      const data = `data: ${JSON.stringify({ type: 'tool_call', name: event.name, args: event.args, result: (event.result || '').slice(0, 500) })}\n\n`
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
    summaryConfig.apiKey = summaryConfig.apiKey || (c.env as any)[summaryConfig.apiKeyEnv || 'VOLCENGINE_API_KEY'] || ''
  } catch {
    summaryConfig = {
      provider: 'volcengine',
      modelId: 'doubao-lite-32k',
      apiBase: 'https://ark.cn-beijing.volces.com/api/v3',
      apiKey: (c.env as any).VOLCENGINE_API_KEY || '',
      params: { temperature: 0.3, max_tokens: 1000 },
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

  const result = await resp.json() as any
  const content = result.choices?.[0]?.message?.content || '{}'

  try {
    const parsed = JSON.parse(content)
    return c.json(parsed)
  } catch {
    return c.json({ conflicts: [], warnings: ['解析失败'], raw: content })
  }
})

/**
 * POST /api/generate/outline
 *
 * AI 生成大纲内容（非流式，大纲内容短）
 */
router.post('/outline', zValidator('json', z.object({
  novelId: z.string().min(1),
  title: z.string().min(1),
  type: z.string(),
  parentTitle: z.string().optional(),
  context: z.string().optional(),
})), async (c) => {
  const { novelId, title, type, parentTitle, context } = c.req.valid('json')
  const db = drizzle(c.env.DB)

  let llmConfig
  try {
    llmConfig = await resolveConfig(db, 'outline_gen', novelId)
    llmConfig.apiKey = llmConfig.apiKey || (c.env as any)[llmConfig.apiKeyEnv || 'VOLCENGINE_API_KEY'] || ''
  } catch {
    try {
      llmConfig = await resolveConfig(db, 'chapter_gen', novelId)
      llmConfig.apiKey = llmConfig.apiKey || (c.env as any)[llmConfig.apiKeyEnv || 'VOLCENGINE_API_KEY'] || ''
    } catch {
      llmConfig = {
        provider: 'volcengine',
        modelId: 'doubao-seed-2-pro',
        apiBase: 'https://ark.cn-beijing.volces.com/api/v3',
        apiKey: (c.env as any).VOLCENGINE_API_KEY || '',
        params: { temperature: 0.85, max_tokens: 4096 },
      }
    }
  }

  const typeLabels: Record<string, string> = {
    world_setting: '世界观设定',
    volume: '卷纲',
    chapter_outline: '章节大纲',
    arc: '故事线',
    custom: '自定义大纲',
  }

  const typeLabel = typeLabels[type] || '大纲'

  const outlinePrompt = `请为小说生成${typeLabel}内容。

【标题】：${title}
【类型】：${typeLabel}
${parentTitle ? `【上级节点】：${parentTitle}` : ''}
${context ? `【补充上下文】：\n${context}` : ''}

要求：
1. 内容详细、结构清晰
2. 符合${typeLabel}的定位和作用
3. 如果是章节大纲，包含情节走向、关键冲突、人物动态
4. 如果是卷纲，包含本卷主线、重要转折点、人物成长
5. 如果是世界观设定，包含地理、势力、修炼体系、历史背景
6. 使用 Markdown 格式
7. 字数 800-2000 字`

  try {
    const base = llmConfig.apiBase || 'https://ark.cn-beijing.volces.com/api/v3'
    const resp = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${llmConfig.apiKey}`,
      },
      body: JSON.stringify({
        model: llmConfig.modelId,
        messages: [
          { role: 'system', content: '你是一个专业的小说大纲助手，擅长构建世界观、卷纲和章节大纲。' },
          { role: 'user', content: outlinePrompt },
        ],
        stream: false,
        temperature: 0.85,
        max_tokens: 4096,
      }),
    })

    if (!resp.ok) {
      const errorText = await resp.text()
      return c.json({ error: '生成失败', details: `${resp.status} ${errorText}` }, 500)
    }

    const result = await resp.json() as any
    const content = result.choices?.[0]?.message?.content || ''

    return c.json({ content })
  } catch (error) {
    return c.json(
      { error: '生成异常', details: (error as Error).message },
      500
    )
  }
})

/**
 * POST /api/generate/outline-batch
 *
 * Phase 1.5: 批量生成章节大纲
 * 接受卷ID，一次性生成该卷下所有章节大纲（非流式）
 * 
 * 请求体：
 * - volumeId: 卷ID（必填）
 * - novelId: 小说ID（必填）
 * - chapterCount: 要生成的章节数（可选，默认根据现有章节推算）
 * - context: 补充上下文（可选，如卷纲总结等）
 */
router.post('/outline-batch', zValidator('json', z.object({
  volumeId: z.string().min(1),
  novelId: z.string().min(1),
  chapterCount: z.number().min(1).max(30).optional(),
  context: z.string().optional(),
})), async (c) => {
  const { volumeId, novelId, chapterCount, context } = c.req.valid('json')
  const db = drizzle(c.env.DB)

  try {
    // 1. 获取卷信息
    const volume = await db
      .select({
        id: volumes.id,
        title: volumes.title,
        sortOrder: volumes.sortOrder,
        summary: volumes.summary,
      })
      .from(volumes)
      .where(eq(volumes.id, volumeId))
      .get()

    if (!volume) {
      return c.json({ error: '卷不存在' }, 404)
    }

    // 2. 获取该卷下现有的章节大纲
    const existingChapters = await db
      .select({
        id: chapters.id,
        title: chapters.title,
        sortOrder: chapters.sortOrder,
      })
      .from(chapters)
      .where(eq(chapters.volumeId, volumeId))
      .orderBy(chapters.sortOrder)
      .all()

    // 3. 确定要生成的章节数量
    const targetCount = chapterCount || Math.max(existingChapters.length, 10)

    // 4. 解析模型配置
    let llmConfig
    try {
      llmConfig = await resolveConfig(db, 'outline_gen', novelId)
      llmConfig.apiKey = llmConfig.apiKey || (c.env as any)[llmConfig.apiKeyEnv || 'VOLCENGINE_API_KEY'] || ''
    } catch {
      try {
        llmConfig = await resolveConfig(db, 'chapter_gen', novelId)
        llmConfig.apiKey = llmConfig.apiKey || (c.env as any)[llmConfig.apiKeyEnv || 'VOLCENGINE_API_KEY'] || ''
      } catch {
        llmConfig = {
          provider: 'volcengine',
          modelId: 'doubao-seed-2-pro',
          apiBase: 'https://ark.cn-beijing.volces.com/api/v3',
          apiKey: (c.env as any).VOLCENGINE_API_KEY || '',
          params: { temperature: 0.85, max_tokens: 4096 },
        }
      }
    }

    // 5. 构建批量生成提示词
    const existingChaptersInfo = existingChapters.length > 0
      ? `\n\n【现有章节】\n${existingChapters.map((ch, i) => `${i + 1}. 第${ch.sortOrder || i + 1}章《${ch.title}》`).join('\n')}`
      : ''

    const batchPrompt = `请为小说的某一卷生成完整的章节大纲规划。

【卷信息】：
- 标题：《${volume.title}》
- 卷序：第${volume.sortOrder + 1}卷
${volume.summary ? `- 卷概要：${volume.summary}` : ''}

【生成要求】：
- 需要规划 ${targetCount} 个章节
- 每个章节包含：章节标题、本章核心情节（200-300字）、关键冲突点、伏笔安排、人物动态
- 章节之间要有连贯性，形成完整的故事弧线
- 注意节奏：开头铺垫、中间发展、高潮迭起、结尾悬念
${existingChaptersInfo}
${context ? `\n【补充上下文】：\n${context}` : ''}

请以JSON数组格式输出（不要输出其他内容）：
[
  {
    "chapterTitle": "章节标题",
    "outline": "本章大纲内容（200-300字）",
    "keyConflicts": ["关键冲突1", "关键冲突2"],
    "foreshadowingSetup": ["埋入伏笔1", "收尾伏笔2"],
    "characterDynamics": "人物动态描述"
  }
]

要求：
1. 输出 ${targetCount} 个章节的大纲规划
2. 每章大纲质量要高，有具体的情节点而非空泛描述
3. 合理安排伏笔的埋入和收尾`

    // 6. 调用 LLM 批量生成
    const base = llmConfig.apiBase || 'https://ark.cn-beijing.volces.com/api/v3'
    const resp = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${llmConfig.apiKey}`,
      },
      body: JSON.stringify({
        model: llmConfig.modelId,
        messages: [
          { role: 'system', content: '你是一个专业的小说大纲助手，擅长构建连贯的章节大纲序列。你只输出JSON，不要其他内容。' },
          { role: 'user', content: batchPrompt },
        ],
        stream: false,
        temperature: llmConfig.params?.temperature ?? 0.85,
        max_tokens: 8000, // 批量生成需要更多token
      }),
    })

    if (!resp.ok) {
      const errorText = await resp.text()
      return c.json({ error: '批量生成失败', details: `${resp.status} ${errorText}` }, 500)
    }

    const result = await resp.json() as any
    const content = result.choices?.[0]?.message?.content || ''

    // 7. 解析JSON结果
    let parsedOutlines: Array<any>
    try {
      // 尝试提取JSON数组（处理可能的markdown代码块包裹）
      const jsonMatch = content.match(/\[[\s\S]*\]/)
      if (jsonMatch) {
        parsedOutlines = JSON.parse(jsonMatch[0])
      } else {
        parsedOutlines = JSON.parse(content)
      }
    } catch (parseError) {
      console.warn('Failed to parse batch outline result:', parseError)
      return c.json({ 
        error: '解析生成结果失败', 
        details: 'LLM返回的内容无法解析为JSON数组',
        raw: content.slice(0, 1000) 
      }, 500)
    }

    if (!Array.isArray(parsedOutlines) || parsedOutlines.length === 0) {
      return c.json({ error: '生成结果为空', details: 'LLM未返回有效的章节大纲' }, 500)
    }

    // 8. 将生成的大纲写入卷表（v2.0: 存储到 volumes.outline 字段）
    const createdOutlines: any[] = []
    
    // 构建完整的卷大纲文档（Markdown 格式）
    let volumeOutlineContent = `# 《${volume.title}》章节大纲\n\n`
    volumeOutlineContent += `生成时间：${new Date().toLocaleString('zh-CN')}\n\n`
    volumeOutlineContent += `---\n\n`

    for (let i = 0; i < parsedOutlines.length; i++) {
      const outlineData = parsedOutlines[i]
      
      try {
        // 构建单个章节的大纲内容
        const chapterOutline = [
          `## ${outlineData.chapterTitle || `第${i + 1}章`}`,
          outlineData.outline || '',
          outlineData.keyConflicts && outlineData.keyConflicts.length > 0 
            ? `\n**关键冲突**：\n${outlineData.keyConflicts.map((c: string) => `- ${c}`).join('\n')}` 
            : '',
          outlineData.foreshadowingSetup && outlineData.foreshadowingSetup.length > 0
            ? `\n**伏笔安排**：\n${outlineData.foreshadowingSetup.map((f: string) => `- ${f}`).join('\n')}`
            : '',
          outlineData.characterDynamics ? `\n**人物动态**：\n${outlineData.characterDynamics}` : '',
        ].filter(Boolean).join('\n')

        // 追加到卷大纲文档
        volumeOutlineContent += chapterOutline + '\n\n---\n\n'

        createdOutlines.push({
          index: i,
          title: outlineData.chapterTitle || `第${i + 1}章`,
          action: 'created',
        })
      } catch (outlineError) {
        console.warn(`Failed to process outline ${i}:`, outlineError)
        createdOutlines.push({
          index: i,
          action: 'failed',
          error: (outlineError as Error).message,
        })
      }
    }

    // 将完整的卷大纲写入 volumes 表
    try {
      await db
        .update(volumes)
        .set({
          outline: volumeOutlineContent,
          updatedAt: sql`(unixepoch())`,
        })
        .where(eq(volumes.id, volumeId))

      console.log(`✅ Volume outline updated for volume ${volumeId}`)
    } catch (updateError) {
      console.warn('Failed to update volume outline:', updateError)
      return c.json({ 
        error: '更新卷大纲失败', 
        details: (updateError as Error).message 
      }, 500)
    }

    console.log(`✅ Batch outline generation complete: ${createdOutlines.filter(o => o.action !== 'failed').length}/${parsedOutlines.length} chapters planned`)

    return c.json({
      ok: true,
      message: `成功生成卷大纲，包含 ${createdOutlines.filter(o => o.action !== 'failed').length} 个章节规划`,
      outlines: createdOutlines,
      totalRequested: parsedOutlines.length,
      successCount: createdOutlines.filter(o => o.action !== 'failed').length,
      volumeOutlinePreview: volumeOutlineContent.slice(0, 500),  // 返回预览
    })
  } catch (error) {
    console.error('Batch outline generation failed:', error)
    return c.json(
      { error: '批量生成异常', details: (error as Error).message },
      500
    )
  }
})

export { router as generate }
