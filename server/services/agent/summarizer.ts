/**
 * @file summarizer.ts
 * @description Agent摘要生成功能
 */
import { drizzle } from 'drizzle-orm/d1'
import { chapters, masterOutline, volumes, novelSettings, chapterStructuredData } from '../../db/schema'
import { eq, desc, sql } from 'drizzle-orm'
import type { Env } from '../../lib/types'
import { resolveConfig, generateWithMetrics } from '../llm'
import type { AppDb } from '../contextBuilder'
import type { LLMCallResult } from '../llm'
import {
  ERROR_MESSAGES,
  LOG_STYLES,
  SUMMARY_SYSTEM_PROMPT,
  SETTING_SUMMARY_SYSTEM_PROMPT,
} from './constants'
import { logGeneration } from './logging'

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

interface SummaryLLMResult {
  text: string
  metrics: LLMCallResult
}

async function callSummaryLLM(opts: SummaryCallOptions): Promise<SummaryLLMResult> {
  const { db, novelId, stage, systemPrompt, userPrompt, maxTokens = 500 } = opts

  let config
  try {
    config = await resolveConfig(db, stage, novelId)
    config.apiKey = config.apiKey || ''
  } catch {
    throw new Error(ERROR_MESSAGES.MODEL_NOT_CONFIGED('摘要生成'))
  }

  const overrideConfig = {
    ...config,
    params: { ...(config.params || {}), max_tokens: maxTokens },
  }

  const metrics = await generateWithMetrics(overrideConfig, [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ])

  if (!metrics.text?.trim()) throw new Error(ERROR_MESSAGES.EMPTY_RESULT)
  return { text: metrics.text.trim(), metrics }
}

// ============================================================
// 章节摘要
// ============================================================

export async function triggerAutoSummary(
  env: Env,
  chapterId: string,
  novelId: string,
  generationUsage: { prompt_tokens: number; completion_tokens: number }
): Promise<{ ok: boolean; error?: string; metrics?: LLMCallResult }> {
  try {
    const result = await generateChapterSummary(env, chapterId, novelId, {
      source: 'auto',
      usage: generationUsage,
    })
    if (result.ok) {
      LOG_STYLES.SUCCESS(`章节 ${chapterId} 摘要生成成功: ${result.summary?.slice(0, 100)}`)
    }
    return result
  } catch (error) {
    LOG_STYLES.WARN(`${ERROR_MESSAGES.SUMMARY_FAILED}: ${error}`)
    return { ok: false, error: (error as Error).message }
  }
}

export async function triggerChapterSummary(
  env: Env,
  chapterId: string,
  novelId: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const result = await generateChapterSummary(env, chapterId, novelId, {
      source: 'manual',
    })
    return result
  } catch (error) {
    LOG_STYLES.ERROR(`${ERROR_MESSAGES.SUMMARY_FAILED}: ${error}`)
    return { ok: false, error: (error as Error).message }
  }
}

async function generateChapterSummary(
  env: Env,
  chapterId: string,
  novelId: string,
  opts: {
    source: 'auto' | 'manual'
    usage?: { prompt_tokens: number; completion_tokens: number }
  }
): Promise<{ ok: boolean; summary?: string; error?: string; metrics?: LLMCallResult }> {
  const db = drizzle(env.DB)

  const chapter = await db
    .select({ title: chapters.title, content: chapters.content })
    .from(chapters)
    .where(eq(chapters.id, chapterId))
    .get()

  if (!chapter) return { ok: false, error: 'Chapter not found' }
  if (!chapter?.content) return { ok: false, error: ERROR_MESSAGES.CHAPTER_CONTENT_EMPTY }

  const result = await callSummaryLLM({
    db,
    novelId,
    stage: 'summary_gen',
    systemPrompt: SUMMARY_SYSTEM_PROMPT,
    userPrompt: `请为以下小说章节生成结构化摘要。

【章节标题】《${chapter.title}》

【正文内容】
${chapter.content}

【输出格式】严格按以下四个标签输出，每项如确实没有内容则写"无"，不得省略标签：

【角色状态变化】本章中角色的实力突破、能力获得、重要状态变化。必须包含具体的等级名称（使用本小说设定中的名称），如实力变化则需注明变化前后状态。
【关键事件】本章主线剧情，2-3句话，包含起因、过程、结果。
【道具/功法】本章新出现、获得或使用的重要道具、功法、丹药（名称+一句话说明）。
【章末状态】本章结束时主角的：所在位置·当前处境·下一步明确方向或悬念。

字数要求：总计300-400字（四个标签合计）`,
    maxTokens: 1000,
  })

  const summaryText = result.text

  const updateData: Record<string, unknown> = {
    summary: summaryText,
    summaryAt: Math.floor(Date.now() / 1000),
    summaryModel: opts.source,
  }

  if (!validateSummaryStructure(summaryText)) {
    updateData.summaryModel = 'malformed'
    console.warn(`[summarizer] 摘要结构不完整，标记为 malformed: ${summaryText.slice(0, 100)}`)
  }

  updateData.promptTokens = result.metrics.usage.prompt_tokens
  updateData.completionTokens = result.metrics.usage.completion_tokens

  await db
    .update(chapters)
    .set(updateData)
    .where(eq(chapters.id, chapterId))

  return { ok: true, summary: summaryText, metrics: result.metrics }
}

// ============================================================
// 总纲摘要
// ============================================================

export async function generateMasterOutlineSummary(
  env: Env,
  novelId: string
): Promise<{ ok: boolean; summary?: string; error?: string; metrics?: LLMCallResult }> {
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

    const result = await callSummaryLLM({
      db,
      novelId,
      stage: 'summary_gen',
      systemPrompt: SUMMARY_SYSTEM_PROMPT,
      userPrompt: `请为以下小说总纲生成结构化摘要，用于AI创作章节时的宏观参考。

【总纲标题】《${outline.title}》

【总纲内容】
${outline.content}

【输出格式】严格按以下四个标签输出：

【世界与主角】一句话概括：世界背景 + 主角的初始身份和核心驱动力（50字以内）
【核心冲突】贯穿全书的主要矛盾是什么，涉及哪些主要势力或对立力量（100字以内）
【主线弧线】主角从起点到终局的大致成长路径，按"卷1→卷N"或"阶段"描述（150字以内）
【创作禁忌】从总纲中提炼的最高优先级约束（如：主角不得无故杀无辜/不得在XXX之前泄露身份），最多5条

字数：总计300-400字`,
      maxTokens: 1000,
    })

    await db
      .update(masterOutline)
      .set({ summary: result.text, updatedAt: sql`(unixepoch())` })
      .where(eq(masterOutline.id, outline.id))

    await logGeneration(env, {
      novelId,
      chapterId: null,
      stage: 'master_outline_summary',
      modelId: result.metrics.modelId || 'N/A',
      promptTokens: result.metrics.usage.prompt_tokens,
      completionTokens: result.metrics.usage.completion_tokens,
      durationMs: result.metrics.durationMs || 0,
      status: 'success',
      contextSnapshot: JSON.stringify({ outlineId: outline.id }),
    })

    return { ok: true, summary: result.text, metrics: result.metrics }
  } catch (error) {
    LOG_STYLES.WARN(`总纲摘要生成失败: ${error}`)

    await logGeneration(env, {
      novelId,
      chapterId: null,
      stage: 'master_outline_summary',
      modelId: 'N/A',
      durationMs: 0,
      status: 'error',
      errorMsg: (error as Error).message,
    })

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
): Promise<{ ok: boolean; summary?: string; error?: string; metrics?: LLMCallResult }> {
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

    const blueprintSummary = volume.blueprint
      ? extractBlueprintCore(volume.blueprint)
      : ''

    const eventLineSummary = volume.eventLine
      ? (() => {
          try {
            const items: string[] = JSON.parse(volume.eventLine)
            const keyItems = items.filter(l => /高潮|转折|揭秘|突破|决战/.test(l))
            const head = items.slice(0, 3)
            const tail = items.slice(-3)
            const sample = [...new Set([...head, ...keyItems, ...tail])].slice(0, 8)
            return sample.join('\n')
          } catch { return volume.eventLine.slice(0, 500) }
        })()
      : ''

    const result = await callSummaryLLM({
      db,
      novelId,
      stage: 'summary_gen',
      systemPrompt: SUMMARY_SYSTEM_PROMPT,
      userPrompt: `请为以下卷生成摘要，用于AI创作时定位当前卷的叙事方向。

【卷标题】《${volume.title}》

【卷蓝图核心】
${blueprintSummary || '（无蓝图）'}

【关键事件采样】
${eventLineSummary || '（无事件线）'}

【输出格式】严格按以下三个标签输出：

【本卷主题】一句话：本卷解决什么核心冲突，主角完成什么转变（30字以内）
【关键节点】本卷中改变走向的3-5个关键事件，每条一行（包含大致章节位置）
【卷末状态】本卷结束时主角的实力/状态·位置·与下卷的衔接点

字数：总计300-400字`,
      maxTokens: 1000,
    })

    await db
      .update(volumes)
      .set({ summary: result.text, updatedAt: sql`(unixepoch())` })
      .where(eq(volumes.id, volumeId))

    await logGeneration(env, {
      novelId,
      chapterId: null,
      stage: 'volume_summary',
      modelId: result.metrics.modelId || 'N/A',
      promptTokens: result.metrics.usage.prompt_tokens,
      completionTokens: result.metrics.usage.completion_tokens,
      durationMs: result.metrics.durationMs || 0,
      status: 'success',
      contextSnapshot: JSON.stringify({ volumeId }),
    })

    return { ok: true, summary: result.text, metrics: result.metrics }
  } catch (error) {
    LOG_STYLES.WARN(`卷摘要生成失败: ${error}`)

    await logGeneration(env, {
      novelId,
      chapterId: null,
      stage: 'volume_summary',
      modelId: 'N/A',
      durationMs: 0,
      status: 'error',
      errorMsg: (error as Error).message,
    })

    return { ok: false, error: (error as Error).message }
  }
}

// ============================================================
// 设定摘要
// ============================================================

export async function generateSettingSummary(
  env: Env,
  settingId: string
): Promise<{ ok: boolean; summary?: string; error?: string; metrics?: LLMCallResult }> {
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
    const typeSpecificHint: Record<string, string> = {
      power_system: `摘要必须包含完整的等级名称列表（从低到高），使用本小说设定中的原始名称，一字不差，这是全书一致性的基础。其次包含晋升/突破条件和跨级战力规则。等级名称的准确性是最高优先级。`,
      faction: `摘要必须包含：势力名称、与主角的关系（敌/友/中立）、势力的核心矛盾、重要人物（姓名+实力等级，使用本小说设定中的等级名称）。省略地理描述和历史背景。`,
      geography: `摘要必须包含：地点名称、特殊规则或危险、对主角的意义（主角会在此发生什么）。省略气候描述等无关信息。`,
      item_skill: `摘要必须包含：名称、效果（精确描述）、使用限制或副作用、当前归属（主角是否拥有）。省略来历故事。`,
      worldview: `摘要必须包含：世界核心法则（影响所有角色行为的规律）、当前格局（主要势力分布）、世界危机（如有）。`,
      misc: `摘要保留对AI写章节时有直接参考价值的内容，省略背景故事和描述性文字。`,
    }

    const result = await callSummaryLLM({
      db,
      novelId: row.novelId,
      stage: 'summary_gen',
      systemPrompt: SETTING_SUMMARY_SYSTEM_PROMPT,
      userPrompt: `请为以下小说设定生成用于RAG检索的摘要。

【设定名称】：${row.name}
【设定类型】：${row.type}

【设定内容】：
${row.content}

【本类型摘要重点】：
${typeSpecificHint[row.type] || '保留核心概念和关键规则，省略描述性文字。'}

【通用要求】：
1. 摘要长度：200-350字
2. 使用与原文完全一致的术语（特别是专有名词）
3. 信息密度高，每句话都有意义
4. 纯文本输出，不加任何格式标记`,
      maxTokens: 800,
    })

    await db
      .update(novelSettings)
      .set({ summary: result.text, updatedAt: sql`(unixepoch())` })
      .where(eq(novelSettings.id, settingId))

    LOG_STYLES.SUCCESS(`设定 ${row.name} 摘要已生成 (${result.text.length} 字符)`)

    await logGeneration(env, {
      novelId: row.novelId,
      chapterId: null,
      stage: 'setting_summary',
      modelId: result.metrics.modelId || 'N/A',
      promptTokens: result.metrics.usage.prompt_tokens,
      completionTokens: result.metrics.usage.completion_tokens,
      durationMs: result.metrics.durationMs || 0,
      status: 'success',
      contextSnapshot: JSON.stringify({ settingId, settingName: row.name, settingType: row.type }),
    })

    return { ok: true, summary: result.text, metrics: result.metrics }
  } catch (error) {
    LOG_STYLES.ERROR(`[generateSettingSummary] 失败: ${error}`)

    await logGeneration(env, {
      novelId: row?.novelId,
      chapterId: null,
      stage: 'setting_summary',
      modelId: 'N/A',
      durationMs: 0,
      status: 'error',
      errorMsg: (error as Error).message,
    })

    return { ok: false, error: (error as Error).message }
  }
}

function extractBlueprintCore(blueprint: string): string {
  const tags = ['本卷主题', '核心冲突', '关键节点', '卷末状态', '开卷状态']
  const parts: string[] = []
  for (const tag of tags) {
    const match = blueprint.match(new RegExp(`【${tag}】([\\s\\S]*?)(?=【|$)`))
    if (match) parts.push(`【${tag}】${match[1].trim().slice(0, 150)}`)
  }
  return parts.length > 0 ? parts.join('\n') : blueprint.slice(0, 500)
}

function validateSummaryStructure(text: string): boolean {
  return ['【角色状态变化】', '【关键事件】', '【道具/功法】', '【章末状态】']
    .every(tag => text.includes(tag))
}

const STRUCTURED_TAG_PATTERN = /【(角色状态变化|关键事件|道具\/功法|章末状态)】([\s\S]*?)(?=【|$)/g

/**
 * step1b：解析摘要中的结构化标签，写入 chapter_structured_data 表。
 * 幂等设计：若该章节已存在记录，覆盖更新。
 */
export async function parseStructuredDataFromSummary(
  env: Env,
  chapterId: string,
  novelId: string,
): Promise<void> {
  try {
    const db = drizzle(env.DB)
    const rows = await db
      .select({
        summary: chapters.summary,
        sortOrder: chapters.sortOrder,
      })
      .from(chapters)
      .where(eq(chapters.id, chapterId))
      .limit(1)

    if (rows.length === 0) {
      LOG_STYLES.ERROR(`[step1b] 找不到章节: ${chapterId}`)
      return
    }

    const { summary, sortOrder } = rows[0]
    if (!summary) {
      LOG_STYLES.ERROR(`[step1b] 章节 ${chapterId} 无摘要，跳过结构化解析`)
      return
    }

    const parsed: Record<string, string> = {}
    let match: RegExpExecArray | null
    STRUCTURED_TAG_PATTERN.lastIndex = 0
    while ((match = STRUCTURED_TAG_PATTERN.exec(summary)) !== null) {
      const [, tagName, content] = match
      parsed[tagName] = content.trim()
    }

    if (Object.keys(parsed).length === 0) {
      LOG_STYLES.ERROR(`[step1b] 摘要中未发现结构化标签`)
      return
    }

    const structuredRow = {
      novelId,
      chapterId,
      chapterOrder: sortOrder,
      characterChanges: parsed['角色状态变化'] ?? null,
      newEntities: parsed['道具/功法'] ?? null,
      chapterEndState: parsed['章末状态'] ?? null,
      keyEvents: parsed['关键事件'] ?? null,
      knowledgeReveals: null,
      updatedAt: Math.floor(Date.now() / 1000),
    }

    const existing = await db
      .select({ id: chapterStructuredData.id })
      .from(chapterStructuredData)
      .where(eq(chapterStructuredData.chapterId, chapterId))
      .limit(1)

    if (existing.length > 0) {
      await db.update(chapterStructuredData)
        .set(structuredRow)
        .where(eq(chapterStructuredData.chapterId, chapterId))
    } else {
      await db.insert(chapterStructuredData).values(structuredRow)
    }

    LOG_STYLES.SUCCESS(`[step1b] 摘要结构化完成，标签数: ${Object.keys(parsed).length}`)
  } catch (error) {
    LOG_STYLES.ERROR(`[step1b] 结构化解析失败: ${error}`)
  }
}