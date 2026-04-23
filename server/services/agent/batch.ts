/**
 * @file batch.ts
 * @description Agent批量生成功能
 */
import { drizzle } from 'drizzle-orm/d1'
import { chapters, volumes, novels } from '../../db/schema'
import { eq, desc, sql, and } from 'drizzle-orm'
import type { Env } from '../../lib/types'
import { resolveConfig, getDefaultBase } from '../llm'
import { ERROR_MESSAGES, LOG_STYLES } from './constants'

export async function generateOutlineBatch(
  env: Env,
  data: {
    volumeId: string
    novelId: string
    chapterCount?: number
    context?: string
  }
): Promise<{
  ok: boolean
  message?: string
  outlines?: any[]
  totalRequested?: number
  successCount?: number
  volumeOutlinePreview?: string
  error?: string
  details?: string
}> {
  const { volumeId, novelId, chapterCount, context } = data
  const db = drizzle(env.DB)

  try {
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
      return { ok: false, error: ERROR_MESSAGES.VOLUME_NOT_FOUND }
    }

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

    const targetCount = chapterCount || Math.max(existingChapters.length, 10)

    let llmConfig
    try {
      llmConfig = await resolveConfig(db, 'outline_gen', novelId)
      llmConfig.apiKey = llmConfig.apiKey || ''
    } catch {
      try {
        llmConfig = await resolveConfig(db, 'chapter_gen', novelId)
        llmConfig.apiKey = llmConfig.apiKey || ''
      } catch (error) {
        throw new Error(ERROR_MESSAGES.MODEL_NOT_CONFIGED('大纲生成或章节生成'))
      }
    }

    const existingChaptersInfo = existingChapters.length > 0
      ? `\n\n【现有章节】\n${existingChapters.map((ch, i) => `${i + 1}. 第${ch.sortOrder || i + 1}章《${ch.title}》`).join('\n')}`
      : ''

    const batchPrompt = `请为小说的某一卷生成章节标题和摘要规划。

【卷信息】：
- 标题：《${volume.title}》
- 卷序：第${volume.sortOrder + 1}卷
${volume.summary ? `- 卷概要：${volume.summary}` : ''}

【生成要求】：
- 需要规划 ${targetCount} 个章节
- 每个章节包含：章节标题、章节摘要（150-200字，概括本章核心情节）
- 章节之间要有连贯性，形成完整的故事弧线
- 注意节奏：开头铺垫、中间发展、高潮迭起、结尾悬念
${existingChaptersInfo}
${context ? `\n【补充上下文】：\n${context}` : ''}

请以JSON数组格式输出（不要输出其他内容）：
[
  {
    "chapterTitle": "章节标题",
    "summary": "章节摘要（150-200字）"
  }
]

要求：
1. 输出 ${targetCount} 个章节的标题和摘要
2. 摘要质量要高，有具体的情节点而非空泛描述
3. 章节标题要有吸引力，符合小说风格`

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
        max_tokens: 8000,
      }),
    })

    if (!resp.ok) {
      const errorText = await resp.text()
      return { ok: false, error: ERROR_MESSAGES.EMPTY_RESULT, details: ERROR_MESSAGES.API_ERROR(resp.status) + ' ' + errorText }
    }

    const result = await resp.json() as any
    const content = result.choices?.[0]?.message?.content || ''

    let parsedOutlines: Array<any>
    try {
      const jsonMatch = content.match(/\[[\s\S]*\]/)
      if (jsonMatch) {
        parsedOutlines = JSON.parse(jsonMatch[0])
      } else {
        parsedOutlines = JSON.parse(content)
      }
    } catch (parseError) {
      LOG_STYLES.WARN(`批量大纲解析失败: ${parseError}`)
      return {
        ok: false,
        error: ERROR_MESSAGES.PARSE_ERROR,
        details: 'LLM返回的内容无法解析为JSON数组',
      }
    }

    if (!Array.isArray(parsedOutlines) || parsedOutlines.length === 0) {
      return { ok: false, error: ERROR_MESSAGES.EMPTY_RESULT, details: 'LLM未返回有效的章节大纲' }
    }

    const chapterPlans = parsedOutlines.map((outlineData: any, i: number) => ({
      index: i,
      chapterTitle: outlineData.chapterTitle || `第${i + 1}章`,
      summary: outlineData.summary || '',
    }))

    LOG_STYLES.SUCCESS(`批量章节规划已生成: ${chapterPlans.length} 个章节`)

    return {
      ok: true,
      message: `成功生成 ${chapterPlans.length} 个章节规划`,
      outlines: chapterPlans,
      totalRequested: parsedOutlines.length,
      successCount: chapterPlans.length,
    }
  } catch (error) {
    LOG_STYLES.ERROR(`批量大纲生成失败: ${error}`)
    return { ok: false, error: '批量生成异常', details: (error as Error).message }
  }
}

export async function confirmBatchChapterCreation(
  env: Env,
  data: {
    volumeId: string
    novelId: string
    chapterPlans: Array<{ chapterTitle: string; summary: string }>
  }
): Promise<{
  ok: boolean
  message?: string
  createdChapters?: Array<{ id: string; title: string; sortOrder: number }>
  error?: string
}> {
  const { volumeId, novelId, chapterPlans } = data
  const db = drizzle(env.DB)

  try {
    const volume = await db
      .select({
        id: volumes.id,
        sortOrder: volumes.sortOrder,
      })
      .from(volumes)
      .where(eq(volumes.id, volumeId))
      .get()

    if (!volume) {
      return { ok: false, error: ERROR_MESSAGES.VOLUME_NOT_FOUND }
    }

    const existingChapters = await db
      .select({
        sortOrder: chapters.sortOrder,
      })
      .from(chapters)
      .where(eq(chapters.volumeId, volumeId))
      .orderBy(desc(chapters.sortOrder))
      .limit(1)
      .get()

    const startSortOrder = existingChapters ? existingChapters.sortOrder + 1 : 0

    const createdChapters: Array<{ id: string; title: string; sortOrder: number }> = []

    for (let i = 0; i < chapterPlans.length; i++) {
      const plan = chapterPlans[i]
      try {
        const [chapter] = await db
          .insert(chapters)
          .values({
            novelId,
            volumeId,
            title: plan.chapterTitle,
            summary: plan.summary,
            sortOrder: startSortOrder + i,
            content: null,
            wordCount: 0,
            status: 'draft',
          })
          .returning()

        createdChapters.push({
          id: chapter.id,
          title: chapter.title,
          sortOrder: chapter.sortOrder,
        })
      } catch (insertError) {
        LOG_STYLES.WARN(`创建章节 ${i} 失败: ${insertError}`)
      }
    }

    await db
      .update(volumes)
      .set({
        chapterCount: sql`${volumes.chapterCount} + ${createdChapters.length}`,
        updatedAt: sql`(unixepoch())`,
      })
      .where(eq(volumes.id, volumeId))

    await db
      .update(novels)
      .set({
        chapterCount: sql`${novels.chapterCount} + ${createdChapters.length}`,
        updatedAt: sql`(unixepoch())`,
      })
      .where(eq(novels.id, novelId))

    LOG_STYLES.SUCCESS(ERROR_MESSAGES.BATCH_CREATE_PARTIAL(createdChapters.length, chapterPlans.length))

    return {
      ok: true,
      message: `成功创建 ${createdChapters.length} 个章节`,
      createdChapters,
    }
  } catch (error) {
    LOG_STYLES.ERROR(`批量创建章节失败: ${error}`)
    return { ok: false, error: '批量创建章节异常' }
  }
}

export async function generateNextChapter(
  env: Env,
  data: {
    volumeId: string
    novelId: string
  }
): Promise<{
  ok: boolean
  chapterTitle?: string
  summary?: string
  error?: string
}> {
  const { volumeId, novelId } = data
  const db = drizzle(env.DB)

  try {
    const volume = await db
      .select({
        id: volumes.id,
        title: volumes.title,
        blueprint: volumes.blueprint,
        eventLine: volumes.eventLine,
        summary: volumes.summary,
      })
      .from(volumes)
      .where(eq(volumes.id, volumeId))
      .get()

    if (!volume) {
      return { ok: false, error: ERROR_MESSAGES.VOLUME_NOT_FOUND }
    }

    const existingChapters = await db
      .select({
        title: chapters.title,
        summary: chapters.summary,
      })
      .from(chapters)
      .where(and(
        eq(chapters.volumeId, volumeId),
        sql`${chapters.deletedAt} IS NULL`
      ))
      .orderBy(desc(chapters.sortOrder))
      .limit(3)
      .all()

    let llmConfig
    try {
      llmConfig = await resolveConfig(db, 'outline_gen', novelId)
      llmConfig.apiKey = llmConfig.apiKey || ''
    } catch {
      try {
        llmConfig = await resolveConfig(db, 'chapter_gen', novelId)
        llmConfig.apiKey = llmConfig.apiKey || ''
      } catch (error) {
        return { ok: false, error: ERROR_MESSAGES.MODEL_NOT_CONFIGED('大纲生成或章节生成') }
      }
    }

    const isFirstChapter = existingChapters.length === 0

    const recentChaptersInfo = isFirstChapter
      ? '\n\n【当前状态】该卷目前没有任何章节，这是本卷的第一章。'
      : `\n\n【最近章节】\n${existingChapters.map((ch, i) => `${i + 1}. 《${ch.title}》\n   摘要：${ch.summary || '无'}`).join('\n\n')}`

    const continuationRequirement = isFirstChapter
      ? `- 这是本卷的第一章，请从卷蓝图/事件线的起始处开始，做好开篇铺垫
- 开篇要引人入胜，建立故事基调和主要人物`
      : `- 章节要与已有章节连贯，承接上一章的结尾`

    const prompt = `请为小说的某一卷生成${isFirstChapter ? '第一' : '下一'}章的标题和摘要。

【卷信息】：
- 标题：《${volume.title}》
${volume.blueprint ? `- 卷蓝图：\n${volume.blueprint}` : ''}
${volume.eventLine ? `- 事件线：\n${volume.eventLine}` : ''}
${volume.summary ? `- 卷摘要：${volume.summary}` : ''}
${recentChaptersInfo}

【生成要求】：
- 生成${isFirstChapter ? '第一' : '下一'}章的章节标题（要有吸引力，符合小说风格）
- 生成章节摘要（150-200字，概括本章核心情节）
${continuationRequirement}
- 注意节奏：开头铺垫、中间发展、高潮迭起、结尾悬念

请以JSON格式输出（不要输出其他内容）：
{
  "chapterTitle": "章节标题",
  "summary": "章节摘要（150-200字）"
}`

    const base = llmConfig.apiBase || getDefaultBase(llmConfig.provider)
    const resp = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${llmConfig.apiKey}`,
      },
      body: JSON.stringify({
        model: llmConfig.modelId,
        messages: [
          { role: 'system', content: '你是一个专业的小说创作助手，擅长生成连贯的章节标题和摘要。你只输出JSON，不要其他内容。' },
          { role: 'user', content: prompt },
        ],
        stream: false,
        temperature: llmConfig.params?.temperature ?? 0.85,
        max_tokens: 1000,
      }),
    })

    if (!resp.ok) {
      const errorText = await resp.text()
      return { ok: false, error: ERROR_MESSAGES.NEXT_CHAPTER_API_ERROR(resp.status, errorText) }
    }

    const result = await resp.json() as any
    const content = result.choices?.[0]?.message?.content || ''

    let parsedResult: any
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        parsedResult = JSON.parse(jsonMatch[0])
      } else {
        parsedResult = JSON.parse(content)
      }
    } catch (parseError) {
      LOG_STYLES.WARN(`下一章解析失败: ${parseError}`)
      return { ok: false, error: ERROR_MESSAGES.NEXT_CHAPTER_PARSE_FAILED }
    }

    if (!parsedResult.chapterTitle || !parsedResult.summary) {
      return { ok: false, error: ERROR_MESSAGES.NEXT_CHAPTER_RESULT_INCOMPLETE }
    }

    return {
      ok: true,
      chapterTitle: parsedResult.chapterTitle,
      summary: parsedResult.summary,
    }
  } catch (error) {
    LOG_STYLES.ERROR(`生成下一章失败: ${error}`)
    return { ok: false, error: '生成下一章异常' }
  }
}
