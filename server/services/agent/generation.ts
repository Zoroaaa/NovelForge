/**
 * @file generation.ts
 * @description Agent章节生成主入口
 */
import { drizzle } from 'drizzle-orm/d1'
import { chapters, characters, volumes as volumesTable } from '../../db/schema'
import { eq, desc, sql, and } from 'drizzle-orm'
import type { Env } from '../../lib/types'
import { buildChapterContext, type ContextBundle } from '../contextBuilder'
import { resolveConfig, generate } from '../llm'
import { enqueue } from '../../lib/queue'
import { triggerAutoSummary } from './summarizer'
import { extractForeshadowingFromChapter } from '../foreshadowing'
import { detectPowerLevelBreakthrough } from '../powerLevel'
import { checkChapterCoherence } from './coherence'
import { checkCharacterConsistency } from './consistency'
import { checkVolumeProgress } from './volumeProgress'
import { runReActLoop } from './reactLoop'
import { buildMessages } from './messages'
import { DEFAULT_AGENT_CONFIG } from './types'
import { ERROR_MESSAGES, LOG_STYLES, NEXT_CHAPTER_SYSTEM_PROMPT } from './constants'
import type { AgentConfig, GenerationOptions, ToolCallEvent } from './types'
import { saveCheckLog } from './checkLogService'
import { logGeneration } from './logging'

export async function generateChapter(
  env: Env,
  chapterId: string,
  novelId: string,
  onChunk: (text: string) => void,
  onToolCall: (event: ToolCallEvent) => void,
  onDone: (usage: { prompt_tokens: number; completion_tokens: number }, resolvedModelId: string) => void,
  onError: (err: Error) => void,
  config: Partial<AgentConfig> = {},
  options: GenerationOptions = {}
): Promise<void> {
  const agentConfig = { ...DEFAULT_AGENT_CONFIG, ...config }
  const db = drizzle(env.DB)

  try {
    const chapter = await db.select().from(chapters).where(eq(chapters.id, chapterId)).get()
    if (!chapter) {
      onError(new Error(ERROR_MESSAGES.CHAPTER_NOT_FOUND))
      return
    }

    let contextBundle: ContextBundle | null = null

    if (agentConfig.enableRAG && env.VECTORIZE) {
      try {
        contextBundle = await buildChapterContext(env, novelId, chapterId)
        LOG_STYLES.CONTEXT_BUILT(contextBundle.debug)
      } catch (error) {
        LOG_STYLES.CONTEXT_BUILD_FAILED(error)
      }
    }

    let llmConfig
    try {
      llmConfig = await resolveConfig(db, 'chapter_gen', novelId)
      llmConfig.apiKey = llmConfig.apiKey || ''
    } catch (error) {
      throw new Error(ERROR_MESSAGES.MODEL_NOT_CONFIGED('章节生成'))
    }

    const messages = buildMessages(chapter.title, contextBundle, options, llmConfig.params?.systemPromptOverride)

    const usageResult = await runReActLoop(
      env,
      llmConfig,
      messages,
      novelId,
      onChunk,
      onToolCall,
      agentConfig.maxIterations
    )

    const fullContent = usageResult.collectedContent
    if (fullContent && fullContent.trim().length > 0) {
      await db.update(chapters)
        .set({
          content: fullContent,
          wordCount: fullContent.length,
          updatedAt: sql`(unixepoch())`,
        })
        .where(eq(chapters.id, chapterId))
      LOG_STYLES.SUCCESS(`B1 fix: 章节内容已写入数据库 (${fullContent.length} 字符)`)
    }

    if (env.TASK_QUEUE) {
      await enqueue(env, {
        type: 'post_process_chapter',
        payload: {
          chapterId,
          novelId,
          enableAutoSummary: agentConfig.enableAutoSummary,
          usage: {
            prompt_tokens: usageResult.promptTokens,
            completion_tokens: usageResult.completionTokens,
          },
        },
      })
      LOG_STYLES.SUCCESS('后处理任务已入队（异步模式）')
    } else {
      // ============================================================
      // 章节后处理（同步模式，无队列时直接执行）
      // 与 queue-handler.ts 的 post_process_chapter case 保持一致
      // ============================================================
      LOG_STYLES.TASK_QUEUE_UNAVAILABLE()

      // ----- 步骤1：自动摘要 -----
      if (agentConfig.enableAutoSummary) {
        const usage = {
          prompt_tokens: usageResult.promptTokens,
          completion_tokens: usageResult.completionTokens,
        }
        try {
          await triggerAutoSummary(env, chapterId, novelId, usage)
          LOG_STYLES.SUCCESS(`📝 [Sync] 自动摘要完成`)

          await logGeneration(env, {
            novelId,
            chapterId,
            stage: 'auto_summary',
            modelId: llmConfig.modelId,
            promptTokens: usage.prompt_tokens,
            completionTokens: usage.completion_tokens,
            durationMs: 0,
            status: 'success',
            contextSnapshot: JSON.stringify({ enabled: true }),
          })
        } catch (summaryError) {
          LOG_STYLES.WARN(`📝 [Sync] 自动摘要失败: ${summaryError}`)

          await logGeneration(env, {
            novelId,
            chapterId,
            stage: 'auto_summary',
            modelId: llmConfig.modelId,
            durationMs: 0,
            status: 'error',
            errorMsg: (summaryError as Error).message,
            contextSnapshot: JSON.stringify({ enabled: true, error: (summaryError as Error).message }),
          })
        }
      }

      // ----- 步骤2：伏笔提取 -----
      try {
        const foreshadowingResult = await extractForeshadowingFromChapter(env, chapterId, novelId)
        if (foreshadowingResult.newForeshadowing.length > 0 || foreshadowingResult.resolvedForeshadowingIds.length > 0) {
          LOG_STYLES.FORESHADOWING_RESULT(foreshadowingResult.newForeshadowing.length, foreshadowingResult.resolvedForeshadowingIds.length)
        }
        await logGeneration(env, {
          novelId,
          chapterId,
          stage: 'foreshadowing_extraction',
          modelId: llmConfig.modelId,
          contextSnapshot: JSON.stringify({
            newCount: foreshadowingResult.newForeshadowing.length,
            resolvedCount: foreshadowingResult.resolvedForeshadowingIds.length,
            progressedCount: foreshadowingResult.progresses?.length || 0,
          }),
          durationMs: 0,
          status: 'success',
        })
      } catch (foreshadowError) {
        LOG_STYLES.WARN(`${ERROR_MESSAGES.FORESHADOWING_EXTRACTION_FAILED}: ${foreshadowError}`)
        await logGeneration(env, {
          novelId,
          chapterId,
          stage: 'foreshadowing_extraction',
          modelId: llmConfig.modelId,
          contextSnapshot: JSON.stringify({ error: (foreshadowError as Error).message }),
          durationMs: 0,
          status: 'error',
          errorMsg: (foreshadowError as Error).message,
        })
        onToolCall({
          type: 'tool_call',
          name: 'postprocess_warning',
          args: { task: 'foreshadowing', error: (foreshadowError as Error).message },
          status: 'done',
          result: `⚠️ 伏笔提取失败: ${(foreshadowError as Error).message}`,
        })
      }

      // ----- 步骤3：境界突破检测 -----
      try {
        const powerLevelResult = await detectPowerLevelBreakthrough(env, chapterId, novelId)
        if (powerLevelResult.hasBreakthrough) {
          LOG_STYLES.POWER_LEVEL_RESULT(powerLevelResult.updates.length)
        }
        await logGeneration(env, {
          novelId,
          chapterId,
          stage: 'power_level_detection',
          modelId: llmConfig.modelId,
          contextSnapshot: JSON.stringify({
            hasBreakthrough: powerLevelResult.hasBreakthrough,
            updatesCount: powerLevelResult.updates.length,
            updates: powerLevelResult.updates.map(u => ({
              characterName: u.characterName,
              from: u.previousPowerLevel?.current,
              to: u.newPowerLevel.current,
            })),
          }),
          durationMs: 0,
          status: 'success',
        })
      } catch (powerLevelError) {
        LOG_STYLES.WARN(`${ERROR_MESSAGES.POWER_LEVEL_DETECTION_FAILED}: ${powerLevelError}`)
        await logGeneration(env, {
          novelId,
          chapterId,
          stage: 'power_level_detection',
          modelId: llmConfig.modelId,
          contextSnapshot: JSON.stringify({ error: (powerLevelError as Error).message }),
          durationMs: 0,
          status: 'error',
          errorMsg: (powerLevelError as Error).message,
        })
        onToolCall({
          type: 'tool_call',
          name: 'postprocess_warning',
          args: { task: 'power_level', error: (powerLevelError as Error).message },
          status: 'done',
          result: `⚠️ 境界检测失败: ${(powerLevelError as Error).message}`,
        })
      }
    }

    // ============================================================
    // 章节后处理检查（同步模式，无队列时执行）
    // 与 queue-handler.ts 的 post_process_chapter case 保持一致
    // ============================================================
    setTimeout(async () => {
      // ----- 步骤4：角色一致性检查 -----
      try {
        const db = drizzle(env.DB)
        const chapterData = await db.select({ volumeId: chapters.volumeId }).from(chapters).where(eq(chapters.id, chapterId)).get()

        if (chapterData?.volumeId) {
          const charList = await db.select({ id: characters.id }).from(characters).where(eq(characters.novelId, novelId)).limit(10).all()
          const characterIds = charList.map(c => c.id)

          if (characterIds.length > 0) {
            const consistencyResult = await checkCharacterConsistency(env, { chapterId, characterIds })
            LOG_STYLES.SUCCESS(`🎭 [Sync] 角色一致性: ${consistencyResult.conflicts.length} 个冲突, ${consistencyResult.warnings.length} 个警告`)

            await saveCheckLog(env, {
              novelId,
              chapterId,
              checkType: 'character_consistency',
              status: 'success',
              characterResult: consistencyResult,
              issuesCount: consistencyResult.conflicts.length + consistencyResult.warnings.length,
            })
          }
        }
      } catch (consistencyError) {
        LOG_STYLES.WARN(`角色一致性检查失败（非致命）: ${consistencyError}`)
        await saveCheckLog(env, {
          novelId,
          chapterId,
          checkType: 'character_consistency',
          status: 'error',
          errorMessage: (consistencyError as Error).message,
          issuesCount: 0,
        })
      }

      // ----- 步骤5：章节连贯性检查 -----
      try {
        const coherenceResult = await checkChapterCoherence(env, chapterId, novelId)
        if (coherenceResult.hasIssues) {
          LOG_STYLES.COHERENCE_RESULT(coherenceResult.issues.length)
          coherenceResult.issues.forEach((issue: any) => LOG_STYLES.WARN(`  - [${issue.severity}] ${issue.message}`))
        }
        await saveCheckLog(env, {
          novelId,
          chapterId,
          checkType: 'chapter_coherence',
          status: 'success',
          coherenceResult: coherenceResult,
          issuesCount: coherenceResult.issues.length,
        })
      } catch (coherenceError) {
        LOG_STYLES.WARN(`${ERROR_MESSAGES.COHERENCE_CHECK_FAILED}: ${coherenceError}`)
        await saveCheckLog(env, {
          novelId,
          chapterId,
          checkType: 'chapter_coherence',
          status: 'error',
          errorMessage: (coherenceError as Error).message,
          issuesCount: 0,
        })
      }

      // ----- 步骤6：卷完成程度检查 -----
      try {
        const volumeProgressResult = await checkVolumeProgress(env, chapterId, novelId)
        if (volumeProgressResult.healthStatus !== 'healthy') {
          LOG_STYLES.WARN(`卷进度检查: 状态=${volumeProgressResult.healthStatus}, 风险=${volumeProgressResult.risk || '无'}`)
          if (volumeProgressResult.suggestion) {
            LOG_STYLES.WARN(`  建议: ${volumeProgressResult.suggestion.slice(0, 100)}`)
          }
        } else {
          LOG_STYLES.SUCCESS(`卷进度检查: 状态正常 (${volumeProgressResult.currentChapter}/${volumeProgressResult.targetChapter || '?'}章)`)
        }
        await saveCheckLog(env, {
          novelId,
          chapterId,
          checkType: 'volume_progress',
          status: 'success',
          coherenceResult: volumeProgressResult,
          issuesCount: volumeProgressResult.healthStatus === 'critical' ? 1 : 0,
        })
      } catch (progressError) {
        LOG_STYLES.WARN(`卷进度检查失败（非致命）: ${progressError}`)
        await saveCheckLog(env, {
          novelId,
          chapterId,
          checkType: 'volume_progress',
          status: 'error',
          errorMessage: (progressError as Error).message,
          issuesCount: 0,
        })
      }
    }, 0)

    onDone(
      { prompt_tokens: usageResult.promptTokens, completion_tokens: usageResult.completionTokens },
      llmConfig.modelId
    )
  } catch (error) {
    console.error('Generation failed:', error)
    onError(error as Error)
  }
}

function parseJsonResponse<T>(content: string): T {
  const jsonMatch = content.match(/[\[{][\s\S]*[\]}]/)
  if (jsonMatch) return JSON.parse(jsonMatch[0]) as T
  return JSON.parse(content) as T
}

async function resolveChapterGenConfig(db: any, novelId: string) {
  const config = await resolveConfig(db, 'chapter_gen', novelId)
  config.apiKey = config.apiKey || ''
  return config
}

export async function generateNextChapter(
  env: Env,
  data: { volumeId: string; novelId: string }
): Promise<{ ok: boolean; chapterTitle?: string; summary?: string; error?: string }> {
  const { volumeId, novelId } = data
  const db = drizzle(env.DB)

  try {
    const volume = await db
      .select({ id: volumesTable.id, title: volumesTable.title, blueprint: volumesTable.blueprint, eventLine: volumesTable.eventLine, summary: volumesTable.summary })
      .from(volumesTable)
      .where(eq(volumesTable.id, volumeId))
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
      llmConfig = await resolveChapterGenConfig(db, novelId)
    } catch {
      return { ok: false, error: ERROR_MESSAGES.MODEL_NOT_CONFIGED('章节生成') }
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
