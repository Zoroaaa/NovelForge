/**
 * @file summarizer.ts
 * @description Agent摘要生成功能
 */
import { drizzle } from 'drizzle-orm/d1'
import { chapters, masterOutline, volumes, novelSettings } from '../../db/schema'
import { eq, desc, sql } from 'drizzle-orm'
import type { Env } from '../../lib/types'
import { resolveConfig, generate } from '../llm'
import type { AppDb } from '../contextBuilder'
import {
  ERROR_MESSAGES,
  LOG_STYLES,
  SUMMARY_SYSTEM_PROMPT,
  SETTING_SUMMARY_SYSTEM_PROMPT,
} from './constants'

// ============================================================
// 内部公共函数：统一调用 LLM 生成摘要文本
// ============================================================

interface SummaryCallOptions {
  db: any
  novelId: string
  stage: string
  systemPrompt: string
  userPrompt: string
  maxTokens?: number
}

async function callSummaryLLM(opts: SummaryCallOptions): Promise<string> {
  const { db, novelId, stage, systemPrompt, userPrompt, maxTokens = 500 } = opts

  let config
  try {
    config = await resolveConfig(db, stage, novelId)
    config.apiKey = config.apiKey || ''
  } catch {
    throw new Error(ERROR_MESSAGES.MODEL_NOT_CONFIGED('摘要生成'))
  }

  // 覆盖 max_tokens，其余参数沿用 config.params
  const overrideConfig = {
    ...config,
    params: { ...(config.params || {}), max_tokens: maxTokens },
  }

  const { text } = await generate(overrideConfig, [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ])

  if (!text?.trim()) throw new Error(ERROR_MESSAGES.EMPTY_RESULT)
  return text.trim()
}

// ============================================================
// 章节摘要
// ============================================================

export async function triggerAutoSummary(
  env: Env,
  chapterId: string,
  novelId: string,
  generationUsage: { prompt_tokens: number; completion_tokens: number }
): Promise<void> {
  try {
    const db = drizzle(env.DB)

    const chapter = await db
      .select({ title: chapters.title, content: chapters.content })
      .from(chapters)
      .where(eq(chapters.id, chapterId))
      .get()

    if (!chapter?.content) {
      LOG_STYLES.INFO('无内容需要摘要')
      return
    }

    const summaryText = await callSummaryLLM({
      db,
      novelId,
      stage: 'summary_gen',
      systemPrompt: SUMMARY_SYSTEM_PROMPT,
      userPrompt: `请为以下小说章节生成一段简洁的摘要（150–200字），概括本章的主要情节、关键转折点和人物动态。

章节标题：《${chapter.title}》

正文内容：
${chapter.content}`,
      maxTokens: 500,
    })

    await db
      .update(chapters)
      .set({
        summary: summaryText,
        summaryAt: Math.floor(Date.now() / 1000),
        summaryModel: 'auto',
        promptTokens: generationUsage.prompt_tokens,
        completionTokens: generationUsage.completion_tokens,
      })
      .where(eq(chapters.id, chapterId))

    LOG_STYLES.SUCCESS(`章节 ${chapterId} 摘要生成成功: ${summaryText.slice(0, 100)}`)
  } catch (error) {
    LOG_STYLES.WARN(`${ERROR_MESSAGES.SUMMARY_FAILED}: ${error}`)
  }
}

// ============================================================
// 总纲摘要
// ============================================================

export async function generateMasterOutlineSummary(
  env: Env,
  novelId: string
): Promise<{ ok: boolean; summary?: string; error?: string }> {
  try {
    const db = drizzle(env.DB)

    const outline = await db
      .select({ id: masterOutline.id, title: masterOutline.title, content: masterOutline.content })
      .from(masterOutline)
      .where(eq(masterOutline.novelId, novelId))
      .orderBy(desc(masterOutline.version))
      .get()

    if (!outline?.content) {
      return { ok: false, error: `${ERROR_MESSAGES.EMPTY_RESULT}: 总纲内容为空` }
    }

    const summaryText = await callSummaryLLM({
      db,
      novelId,
      stage: 'summary_gen',
      systemPrompt: SUMMARY_SYSTEM_PROMPT,
      userPrompt: `请为以下小说总纲生成一段简洁的摘要（200–300字），概括核心世界观、主线剧情和关键设定。

总纲标题：《${outline.title}》

总纲内容：
${outline.content}`,
      maxTokens: 600,
    })

    await db
      .update(masterOutline)
      .set({ summary: summaryText, updatedAt: sql`(unixepoch())` })
      .where(eq(masterOutline.id, outline.id))

    return { ok: true, summary: summaryText }
  } catch (error) {
    LOG_STYLES.WARN(`总纲摘要生成失败: ${error}`)
    return { ok: false, error: (error as Error).message }
  }
}

// ============================================================
// 卷摘要
// ============================================================

export async function generateVolumeSummary(
  env: Env,
  volumeId: string,
  novelId: string
): Promise<{ ok: boolean; summary?: string; error?: string }> {
  try {
    const db = drizzle(env.DB)

    const volume = await db
      .select({ id: volumes.id, title: volumes.title, blueprint: volumes.blueprint, eventLine: volumes.eventLine })
      .from(volumes)
      .where(eq(volumes.id, volumeId))
      .get()

    if (!volume) return { ok: false, error: ERROR_MESSAGES.VOLUME_NOT_FOUND }
    if (!volume.blueprint && !volume.eventLine) {
      return { ok: false, error: `${ERROR_MESSAGES.EMPTY_RESULT}: 卷蓝图和事件线都为空` }
    }

    const contentParts = [
      volume.blueprint ? `【卷蓝图】\n${volume.blueprint}` : '',
      volume.eventLine ? `【事件线】\n${volume.eventLine}` : '',
    ].filter(Boolean).join('\n\n')

    const summaryText = await callSummaryLLM({
      db,
      novelId,
      stage: 'summary_gen',
      systemPrompt: SUMMARY_SYSTEM_PROMPT,
      userPrompt: `请为以下卷的蓝图和事件线生成一段简洁的摘要（150–200字），概括本卷的核心情节和关键事件。

卷标题：《${volume.title}》

${contentParts}`,
      maxTokens: 500,
    })

    await db
      .update(volumes)
      .set({ summary: summaryText, updatedAt: sql`(unixepoch())` })
      .where(eq(volumes.id, volumeId))

    return { ok: true, summary: summaryText }
  } catch (error) {
    LOG_STYLES.WARN(`卷摘要生成失败: ${error}`)
    return { ok: false, error: (error as Error).message }
  }
}

// ============================================================
// 设定摘要
// ============================================================

export async function generateSettingSummary(
  env: Env,
  settingId: string
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

  try {
    const summaryText = await callSummaryLLM({
      db,
      novelId: row.novelId,
      stage: 'summary_gen',
      systemPrompt: SETTING_SUMMARY_SYSTEM_PROMPT,
      userPrompt: `请为以下小说设定生成一段简洁的摘要。

【设定名称】：${row.name}
【设定类型】：${row.type}

【设定内容】：
${row.content}

【要求】：
1. 摘要长度控制在 200–400 字之间
2. 保留核心概念、关键数值、重要关系和独特规则
3. 省略细节描述和举例说明
4. 使用与原文一致的术语体系
5. 输出纯文本，不要任何格式标记`,
      maxTokens: 800,
    })

    await db
      .update(novelSettings)
      .set({ summary: summaryText, updatedAt: sql`(unixepoch())` })
      .where(eq(novelSettings.id, settingId))

    LOG_STYLES.SUCCESS(`设定 ${row.name} 摘要已生成 (${summaryText.length} 字符)`)
    return { ok: true, summary: summaryText }
  } catch (error) {
    LOG_STYLES.ERROR(`[generateSettingSummary] 失败: ${error}`)
    return { ok: false, error: (error as Error).message }
  }
}