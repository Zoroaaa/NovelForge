/**
 * @file generation.ts
 * @description Agent章节生成主入口
 */
import { drizzle } from 'drizzle-orm/d1'
import { chapters, characters, volumes as volumesTable, novels } from '../../db/schema'
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
import { ERROR_MESSAGES, LOG_STYLES } from './constants'
import type { AgentConfig, GenerationOptions, ToolCallEvent } from './types'
import { saveCheckLog } from './checkLogService'
import { logGeneration } from './logging'

function extractTitleFromContent(content: string): string | null {
  const match = content.match(/^#\s+(.+)$/m)
  return match?.[1]?.trim() || null
}

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

    // 从novel表读取systemPrompt作为小说专属引言
    const novelRow = await db.select({ systemPrompt: novels.systemPrompt }).from(novels).where(eq(novels.id, novelId)).get()
    const novelSystemNote = novelRow?.systemPrompt || undefined

    const messages = buildMessages(chapter.title, contextBundle, options, llmConfig.params?.systemPromptOverride, novelSystemNote)

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
      const extractedTitle = extractTitleFromContent(fullContent)
      const updateData: Record<string, unknown> = {
        content: fullContent,
        wordCount: fullContent.length,
        updatedAt: sql`(unixepoch())`,
      }

      if (options.isBackgroundGeneration && extractedTitle) {
        updateData.title = extractedTitle
        LOG_STYLES.SUCCESS(`[Background] 标题已更新: ${extractedTitle}`)
      }

      await db.update(chapters)
        .set(updateData)
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
              score: consistencyResult.score,
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
          score: coherenceResult.score,
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
        if (volumeProgressResult.wordCountIssues.length > 0 || volumeProgressResult.rhythmIssues.length > 0) {
          LOG_STYLES.WARN(`卷进度检查: 字数分=${volumeProgressResult.wordCountScore}, 节奏分=${volumeProgressResult.rhythmScore}, 综合=${volumeProgressResult.score}`)
          if (volumeProgressResult.suggestion) {
            LOG_STYLES.WARN(`  建议: ${volumeProgressResult.suggestion.slice(0, 100)}`)
          }
        } else {
          LOG_STYLES.SUCCESS(`卷进度检查: 正常 (字数分=${volumeProgressResult.wordCountScore}, 节奏分=${volumeProgressResult.rhythmScore})`)
        }
        await saveCheckLog(env, {
          novelId,
          chapterId,
          checkType: 'volume_progress',
          score: volumeProgressResult.score,
          status: 'success',
          volumeProgressResult: volumeProgressResult,
          issuesCount: volumeProgressResult.wordCountIssues.length + volumeProgressResult.rhythmIssues.length,
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
