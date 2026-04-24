/**
 * @file batch.ts
 * @description Agent批量生成功能
 */
import { drizzle } from 'drizzle-orm/d1'
import { chapters, volumes, novels } from '../../db/schema'
import { eq, desc, sql, and } from 'drizzle-orm'
import type { Env } from '../../lib/types'
import { resolveConfig, generate } from '../llm'
import {
  ERROR_MESSAGES,
  LOG_STYLES,
  OUTLINE_BATCH_SYSTEM_PROMPT,
  NEXT_CHAPTER_SYSTEM_PROMPT,
  JSON_OUTPUT_PROMPT,
} from './constants'

// ============================================================
// 内部：解析 LLM 返回的 JSON，兼容带/不带 markdown 代码块
// ============================================================
function parseJsonResponse<T>(content: string): T {
  const jsonMatch = content.match(/[\[{][\s\S]*[\]}]/)
  if (jsonMatch) return JSON.parse(jsonMatch[0]) as T
  return JSON.parse(content) as T
}

// ============================================================
// 内部：解析 LLM config，优先 outline_gen，fallback chapter_gen
// ============================================================
async function resolveOutlineConfig(db: any, novelId: string) {
  try {
    const config = await resolveConfig(db, 'outline_gen', novelId)
    config.apiKey = config.apiKey || ''
    return config
  } catch {
    const config = await resolveConfig(db, 'chapter_gen', novelId)
    config.apiKey = config.apiKey || ''
    return config
  }
}

// ============================================================
// 批量大纲生成（规划阶段，仅返回章节标题+摘要，不写库）
// ============================================================
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
  error?: string
  details?: string
}> {
  const { volumeId, novelId, chapterCount, context } = data
  const db = drizzle(env.DB)

  try {
    const volume = await db
      .select({ id: volumes.id, title: volumes.title, sortOrder: volumes.sortOrder, summary: volumes.summary })
      .from(volumes)
      .where(eq(volumes.id, volumeId))
      .get()

    if (!volume) return { ok: false, error: ERROR_MESSAGES.VOLUME_NOT_FOUND }

    const existingChapters = await db
      .select({ id: chapters.id, title: chapters.title, sortOrder: chapters.sortOrder })
      .from(chapters)
      .where(eq(chapters.volumeId, volumeId))
      .orderBy(chapters.sortOrder)
      .all()

    const targetCount = chapterCount || Math.max(existingChapters.length, 10)

    let llmConfig
    try {
      llmConfig = await resolveOutlineConfig(db, novelId)
    } catch {
      throw new Error(ERROR_MESSAGES.MODEL_NOT_CONFIGED('大纲生成或章节生成'))
    }

    const existingChaptersInfo =
      existingChapters.length > 0
        ? `\n\n${existingChapters.map((ch, i) => `${i + 1}. 第${ch.sortOrder || i + 1}章《${ch.title}》`).join('\n')}`
        : ''

    const userPrompt = `请为小说的某一卷生成章节标题和摘要规划。

【卷信息】
- 标题：《${volume.title}》
- 卷序：第${volume.sortOrder + 1}卷
${volume.summary ? `- 卷概要：${volume.summary}` : ''}
${existingChaptersInfo ? `\n【现有章节】${existingChaptersInfo}` : ''}
${context ? `\n【补充上下文】\n${context}` : ''}

【生成要求】
- 需要规划 ${targetCount} 个章节
- 每个章节包含：章节标题、章节摘要（150–200字，概括本章核心情节）
- 章节之间要有连贯性，形成完整的故事弧线
- 节奏：开头铺垫→中间发展→高潮迭起→结尾悬念

请以 JSON 数组格式输出，不要输出其他内容：
[
  {
    "chapterTitle": "章节标题",
    "summary": "章节摘要（150–200字）"
  }
]

要求：输出 ${targetCount} 个章节，摘要要有具体情节点而非空泛描述。`

    // 大纲生成需要较大的 max_tokens
    const overrideConfig = {
      ...llmConfig,
      params: { ...(llmConfig.params || {}), temperature: llmConfig.params?.temperature ?? 0.85, max_tokens: 8000 },
    }

    const { text } = await generate(overrideConfig, [
      { role: 'system', content: OUTLINE_BATCH_SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ])

    let parsedOutlines: Array<any>
    try {
      parsedOutlines = parseJsonResponse<Array<any>>(text)
    } catch (parseError) {
      LOG_STYLES.WARN(`批量大纲解析失败: ${parseError}`)
      return { ok: false, error: ERROR_MESSAGES.PARSE_ERROR, details: 'LLM返回的内容无法解析为JSON数组' }
    }

    if (!Array.isArray(parsedOutlines) || parsedOutlines.length === 0) {
      return { ok: false, error: ERROR_MESSAGES.EMPTY_RESULT, details: 'LLM未返回有效的章节大纲' }
    }

    const chapterPlans = parsedOutlines.map((item: any, i: number) => ({
      index: i,
      chapterTitle: item.chapterTitle || `第${i + 1}章`,
      summary: item.summary || '',
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

// ============================================================
// 确认写库：将规划好的章节批量插入数据库
// ============================================================
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
      .select({ id: volumes.id, sortOrder: volumes.sortOrder })
      .from(volumes)
      .where(eq(volumes.id, volumeId))
      .get()

    if (!volume) return { ok: false, error: ERROR_MESSAGES.VOLUME_NOT_FOUND }

    const lastChapter = await db
      .select({ sortOrder: chapters.sortOrder })
      .from(chapters)
      .where(eq(chapters.volumeId, volumeId))
      .orderBy(desc(chapters.sortOrder))
      .limit(1)
      .get()

    const startSortOrder = lastChapter ? lastChapter.sortOrder + 1 : 0
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

        createdChapters.push({ id: chapter.id, title: chapter.title, sortOrder: chapter.sortOrder })
      } catch (insertError) {
        LOG_STYLES.WARN(`创建章节 ${i} 失败: ${insertError}`)
      }
    }

    await db
      .update(volumes)
      .set({ chapterCount: sql`${volumes.chapterCount} + ${createdChapters.length}`, updatedAt: sql`(unixepoch())` })
      .where(eq(volumes.id, volumeId))

    await db
      .update(novels)
      .set({ chapterCount: sql`${novels.chapterCount} + ${createdChapters.length}`, updatedAt: sql`(unixepoch())` })
      .where(eq(novels.id, novelId))

    LOG_STYLES.SUCCESS(ERROR_MESSAGES.BATCH_CREATE_PARTIAL(createdChapters.length, chapterPlans.length))

    return { ok: true, message: `成功创建 ${createdChapters.length} 个章节`, createdChapters }
  } catch (error) {
    LOG_STYLES.ERROR(`批量创建章节失败: ${error}`)
    return { ok: false, error: '批量创建章节异常' }
  }
}

// ============================================================
// 生成下一章标题 + 摘要
// ============================================================
export async function generateNextChapter(
  env: Env,
  data: { volumeId: string; novelId: string }
): Promise<{ ok: boolean; chapterTitle?: string; summary?: string; error?: string }> {
  const { volumeId, novelId } = data
  const db = drizzle(env.DB)

  try {
    const volume = await db
      .select({ id: volumes.id, title: volumes.title, blueprint: volumes.blueprint, eventLine: volumes.eventLine, summary: volumes.summary })
      .from(volumes)
      .where(eq(volumes.id, volumeId))
      .get()

    if (!volume) return { ok: false, error: ERROR_MESSAGES.VOLUME_NOT_FOUND }

    const recentChapters = await db
      .select({ title: chapters.title, summary: chapters.summary })
      .from(chapters)
      .where(and(eq(chapters.volumeId, volumeId), sql`${chapters.deletedAt} IS NULL`))
      .orderBy(desc(chapters.sortOrder))
      .limit(3)
      .all()

    let llmConfig
    try {
      llmConfig = await resolveOutlineConfig(db, novelId)
    } catch {
      return { ok: false, error: ERROR_MESSAGES.MODEL_NOT_CONFIGED('大纲生成或章节生成') }
    }

    const isFirstChapter = recentChapters.length === 0
    const chapterOrdinal = isFirstChapter ? '第一' : '下一'

    const recentChaptersSection = isFirstChapter
      ? '\n\n【当前状态】该卷目前没有任何章节，这是本卷的第一章。'
      : `\n\n【最近章节（倒序）】\n${recentChapters.map((ch, i) => `${i + 1}. 《${ch.title}》\n   摘要：${ch.summary || '无'}`).join('\n\n')}`

    const continuationRequirement = isFirstChapter
      ? `- 从卷蓝图/事件线的起始处开始，做好开篇铺垫\n- 开篇要引人入胜，建立故事基调和主要人物`
      : `- 章节要与已有章节连贯，承接上一章的结尾状态`

    const userPrompt = `请为小说的某一卷生成${chapterOrdinal}章的标题和摘要。

【卷信息】
- 标题：《${volume.title}》
${volume.blueprint ? `- 卷蓝图：\n${volume.blueprint}` : ''}
${volume.eventLine ? `- 事件线：\n${volume.eventLine}` : ''}
${volume.summary ? `- 卷摘要：${volume.summary}` : ''}
${recentChaptersSection}

【生成要求】
- 生成${chapterOrdinal}章的章节标题（要有吸引力，符合小说风格）
- 生成章节摘要（150–200字，概括本章核心情节）
${continuationRequirement}
- 节奏：适当铺垫→情节推进→结尾悬念

请以 JSON 格式输出，不要输出其他内容：
{
  "chapterTitle": "章节标题",
  "summary": "章节摘要（150–200字）"
}`

    const overrideConfig = {
      ...llmConfig,
      params: { ...(llmConfig.params || {}), temperature: llmConfig.params?.temperature ?? 0.85, max_tokens: 1000 },
    }

    const { text } = await generate(overrideConfig, [
      { role: 'system', content: NEXT_CHAPTER_SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ])

    let parsedResult: any
    try {
      parsedResult = parseJsonResponse<any>(text)
    } catch {
      LOG_STYLES.WARN(`下一章解析失败`)
      return { ok: false, error: ERROR_MESSAGES.NEXT_CHAPTER_PARSE_FAILED }
    }

    if (!parsedResult.chapterTitle || !parsedResult.summary) {
      return { ok: false, error: ERROR_MESSAGES.NEXT_CHAPTER_RESULT_INCOMPLETE }
    }

    return { ok: true, chapterTitle: parsedResult.chapterTitle, summary: parsedResult.summary }
  } catch (error) {
    LOG_STYLES.ERROR(`生成下一章失败: ${error}`)
    return { ok: false, error: '生成下一章异常' }
  }
}