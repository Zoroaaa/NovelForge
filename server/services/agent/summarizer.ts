/**
 * @file summarizer.ts
 * @description Agent摘要生成功能
 */
import { drizzle } from 'drizzle-orm/d1'
import { chapters, masterOutline, volumes, novelSettings } from '../../db/schema'
import { eq, desc, sql } from 'drizzle-orm'
import type { Env } from '../../lib/types'
import { resolveConfig, getDefaultBase } from '../llm'
import type { AppDb } from '../contextBuilder'
import { ERROR_MESSAGES, LOG_STYLES } from './constants'

export async function triggerAutoSummary(
  env: Env,
  chapterId: string,
  novelId: string,
  generationUsage: { prompt_tokens: number; completion_tokens: number }
): Promise<void> {
  try {
    const db = drizzle(env.DB)

    const chapter = await db
      .select({
        title: chapters.title,
        content: chapters.content,
      })
      .from(chapters)
      .where(eq(chapters.id, chapterId))
      .get()

    if (!chapter?.content) {
      LOG_STYLES.INFO('无内容需要摘要')
      return
    }

    let summaryConfig
    try {
      summaryConfig = await resolveConfig(db, 'summary_gen', novelId)
      summaryConfig.apiKey = summaryConfig.apiKey || ''
    } catch (error) {
      throw new Error(ERROR_MESSAGES.MODEL_NOT_CONFIGED('摘要生成'))
    }

    const contentForSummary = chapter.content

    const summaryMessages = [
      {
        role: 'system' as const,
        content:
          '你是一个专业的文本摘要助手。请为以下小说章节生成一段简洁的摘要（150-200字），概括本章的主要情节、关键转折点和人物动态。',
      },
      {
        role: 'user' as const,
        content: `章节标题：《${chapter.title}》\n\n正文内容：\n${contentForSummary}`,
      },
    ]

    const base = summaryConfig.apiBase || getDefaultBase(summaryConfig.provider)
    const resp = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${summaryConfig.apiKey}`,
      },
      body: JSON.stringify({
        model: summaryConfig.modelId,
        messages: summaryMessages,
        stream: false,
        temperature: summaryConfig.params?.temperature ?? 0.3,
        max_tokens: summaryConfig.params?.max_tokens ?? 500,
      }),
    })

    if (!resp.ok) {
      throw new Error(ERROR_MESSAGES.API_ERROR(resp.status))
    }

    const result = await resp.json() as any
    const summaryText = result.choices?.[0]?.message?.content

    if (summaryText) {
      await db
        .update(chapters)
        .set({
          summary: summaryText,
          summaryAt: Math.floor(Date.now() / 1000),
          summaryModel: summaryConfig.modelId,
          promptTokens: generationUsage.prompt_tokens,
          completionTokens: generationUsage.completion_tokens,
        })
        .where(eq(chapters.id, chapterId))

      LOG_STYLES.SUCCESS(`章节 ${chapterId} 摘要生成成功: ${summaryText.slice(0, 100)}`)
    }
  } catch (error) {
    LOG_STYLES.WARN(`${ERROR_MESSAGES.SUMMARY_FAILED}: ${error}`)
  }
}

export async function generateMasterOutlineSummary(
  env: Env,
  novelId: string
): Promise<{ ok: boolean; summary?: string; error?: string }> {
  try {
    const db = drizzle(env.DB)

    const outline = await db
      .select({
        id: masterOutline.id,
        title: masterOutline.title,
        content: masterOutline.content,
      })
      .from(masterOutline)
      .where(eq(masterOutline.novelId, novelId))
      .orderBy(desc(masterOutline.version))
      .get()

    if (!outline?.content) {
      return { ok: false, error: ERROR_MESSAGES.EMPTY_RESULT + ': 总纲内容为空' }
    }

    let summaryConfig
    try {
      summaryConfig = await resolveConfig(db, 'summary_gen', novelId)
      summaryConfig.apiKey = summaryConfig.apiKey || ''
    } catch (error) {
      return { ok: false, error: ERROR_MESSAGES.MODEL_NOT_CONFIGED('摘要生成') }
    }

    const contentForSummary = outline.content

    const summaryMessages = [
      {
        role: 'system' as const,
        content: '你是一个专业的文本摘要助手。请为以下小说总纲生成一段简洁的摘要（200-300字），概括核心世界观、主线剧情和关键设定。',
      },
      {
        role: 'user' as const,
        content: `总纲标题：《${outline.title}》\n\n总纲内容：\n${contentForSummary}`,
      },
    ]

    const base = summaryConfig.apiBase || getDefaultBase(summaryConfig.provider)
    const resp = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${summaryConfig.apiKey}`,
      },
      body: JSON.stringify({
        model: summaryConfig.modelId,
        messages: summaryMessages,
        stream: false,
        temperature: summaryConfig.params?.temperature ?? 0.3,
        max_tokens: summaryConfig.params?.max_tokens ?? 500,
      }),
    })

    if (!resp.ok) {
      return { ok: false, error: ERROR_MESSAGES.API_ERROR(resp.status) }
    }

    const result = await resp.json() as any
    const summaryText = result.choices?.[0]?.message?.content

    if (summaryText) {
      await db
        .update(masterOutline)
        .set({
          summary: summaryText,
          updatedAt: sql`(unixepoch())`,
        })
        .where(eq(masterOutline.id, outline.id))

      return { ok: true, summary: summaryText }
    }

    return { ok: false, error: ERROR_MESSAGES.EMPTY_RESULT }
  } catch (error) {
    LOG_STYLES.WARN(`总纲摘要生成失败: ${error}`)
    return { ok: false, error: (error as Error).message }
  }
}

export async function generateVolumeSummary(
  env: Env,
  volumeId: string,
  novelId: string
): Promise<{ ok: boolean; summary?: string; error?: string }> {
  try {
    const db = drizzle(env.DB)

    const volume = await db
      .select({
        id: volumes.id,
        title: volumes.title,
        blueprint: volumes.blueprint,
        eventLine: volumes.eventLine,
      })
      .from(volumes)
      .where(eq(volumes.id, volumeId))
      .get()

    if (!volume) {
      return { ok: false, error: ERROR_MESSAGES.VOLUME_NOT_FOUND }
    }

    if (!volume.blueprint && !volume.eventLine) {
      return { ok: false, error: ERROR_MESSAGES.EMPTY_RESULT + ': 卷蓝图和事件线都为空' }
    }

    let summaryConfig
    try {
      summaryConfig = await resolveConfig(db, 'summary_gen', novelId)
      summaryConfig.apiKey = summaryConfig.apiKey || ''
    } catch (error) {
      return { ok: false, error: ERROR_MESSAGES.MODEL_NOT_CONFIGED('摘要生成') }
    }

    const contentForSummary = [
      volume.blueprint ? `【卷蓝图】\n${volume.blueprint}` : '',
      volume.eventLine ? `\n【事件线】\n${volume.eventLine}` : '',
    ].join('\n')

    const summaryMessages = [
      {
        role: 'system' as const,
        content: '你是一个专业的文本摘要助手。请为以下卷的蓝图和事件线生成一段简洁的摘要（150-200字），概括本卷的核心情节和关键事件。',
      },
      {
        role: 'user' as const,
        content: `卷标题：《${volume.title}》\n\n${contentForSummary}`,
      },
    ]

    const base = summaryConfig.apiBase || getDefaultBase(summaryConfig.provider)
    const resp = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${summaryConfig.apiKey}`,
      },
      body: JSON.stringify({
        model: summaryConfig.modelId,
        messages: summaryMessages,
        stream: false,
        temperature: summaryConfig.params?.temperature ?? 0.3,
        max_tokens: summaryConfig.params?.max_tokens ?? 500,
      }),
    })

    if (!resp.ok) {
      return { ok: false, error: ERROR_MESSAGES.API_ERROR(resp.status) }
    }

    const result = await resp.json() as any
    const summaryText = result.choices?.[0]?.message?.content

    if (summaryText) {
      await db
        .update(volumes)
        .set({
          summary: summaryText,
          updatedAt: sql`(unixepoch())`,
        })
        .where(eq(volumes.id, volumeId))

      return { ok: true, summary: summaryText }
    }

    return { ok: false, error: ERROR_MESSAGES.EMPTY_RESULT }
  } catch (error) {
    LOG_STYLES.WARN(`卷摘要生成失败: ${error}`)
    return { ok: false, error: (error as Error).message }
  }
}

export async function generateSettingSummary(
  env: Env,
  settingId: string,
): Promise<{ ok: boolean; summary?: string; error?: string }> {
  const db = drizzle(env.DB) as AppDb

  const row = await db
    .select({
      id: novelSettings.id,
      name: novelSettings.name,
      type: novelSettings.type,
      content: novelSettings.content,
      novelId: novelSettings.novelId,
    })
    .from(novelSettings)
    .where(eq(novelSettings.id, settingId))
    .get()

  if (!row) return { ok: false, error: ERROR_MESSAGES.SETTING_NOT_FOUND }
  if (!row.content?.trim()) return { ok: false, error: ERROR_MESSAGES.CHAPTER_CONTENT_EMPTY }

  let llmConfig
  try {
    llmConfig = await resolveConfig(db as any, 'summary_gen', row.novelId)
  } catch (e) {
    return { ok: false, error: ERROR_MESSAGES.MODEL_NOT_CONFIGED('摘要生成') + `: ${(e as Error).message}` }
  }

  const contentForLLM = row.content

  const systemPrompt = `你是一个专业的小说世界观设定助手，擅长将冗长的设定描述精炼为语义丰富的短摘要。
你只输出摘要文本本身（纯文本），不要输出任何解释、标题或格式标记。`

  const userPrompt = `请为以下小说设定生成一段简洁的摘要。

【设定名称】：${row.name}
【设定类型】：${row.type}

【设定内容】：
${contentForLLM}

【要求】：
1. 摘要长度控制在200-400字之间
2. 保留核心概念、关键数值、重要关系和独特规则
3. 省略细节描述和举例说明
4. 使用与原文一致的术语体系
5. 输出纯文本，不要任何格式标记`

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
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      stream: false,
      temperature: llmConfig.params?.temperature ?? 0.3,
      max_tokens: 800,
    }),
  })

  if (!resp.ok) {
    const errorText = await resp.text()
    LOG_STYLES.ERROR(`[generateSettingSummary] API error ${resp.status}: ${errorText}`)
    return { ok: false, error: ERROR_MESSAGES.API_ERROR(resp.status) }
  }

  const result = await resp.json() as any
  const aiSummary = result.choices?.[0]?.message?.content?.trim()

  if (!aiSummary) return { ok: false, error: ERROR_MESSAGES.EMPTY_RESULT + ': 模型返回为空' }

  await db
    .update(novelSettings)
    .set({ summary: aiSummary, updatedAt: sql`(unixepoch())` })
    .where(eq(novelSettings.id, settingId))

  LOG_STYLES.SUCCESS(`设定 ${row.name} 摘要已生成 (${aiSummary.length} 字符)`)

  return { ok: true, summary: aiSummary }
}
