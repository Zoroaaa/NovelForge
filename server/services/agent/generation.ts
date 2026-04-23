/**
 * @file generation.ts
 * @description Agent章节生成主入口
 */
import { drizzle } from 'drizzle-orm/d1'
import { chapters } from '../../db/schema'
import { eq, sql } from 'drizzle-orm'
import type { Env } from '../../lib/types'
import { buildChapterContext, type ContextBundle } from '../contextBuilder'
import { resolveConfig } from '../llm'
import { enqueue } from '../../lib/queue'
import { triggerAutoSummary } from './summarizer'
import { extractForeshadowingFromChapter } from '../foreshadowing'
import { detectPowerLevelBreakthrough } from '../powerLevel'
import { checkChapterCoherence } from './coherence'
import { runReActLoop } from './reactLoop'
import { buildMessages } from './messages'
import { DEFAULT_AGENT_CONFIG } from './types'
import { ERROR_MESSAGES, LOG_STYLES } from './constants'
import type { AgentConfig, GenerationOptions, ToolCallEvent } from './types'

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
      LOG_STYLES.TASK_QUEUE_UNAVAILABLE()
      if (agentConfig.enableAutoSummary) {
        await triggerAutoSummary(env, chapterId, novelId, {
          prompt_tokens: usageResult.promptTokens,
          completion_tokens: usageResult.completionTokens,
        })
      }
      try {
        const foreshadowingResult = await extractForeshadowingFromChapter(env, chapterId, novelId)
        if (foreshadowingResult.newForeshadowing.length > 0 || foreshadowingResult.resolvedForeshadowingIds.length > 0) {
          LOG_STYLES.FORESHAWDOWING_RESULT(foreshadowingResult.newForeshadowing.length, foreshadowingResult.resolvedForeshadowingIds.length)
        }
      } catch (foreshadowError) {
        LOG_STYLES.WARN(`${ERROR_MESSAGES.FORESHAWDOWING_EXTRACTION_FAILED}: ${foreshadowError}`)
        onToolCall({
          type: 'tool_call',
          name: 'postprocess_warning',
          args: { task: 'foreshadowing', error: (foreshadowError as Error).message },
          status: 'done',
          result: `⚠️ 伏笔提取失败: ${(foreshadowError as Error).message}`,
        })
      }
      try {
        const powerLevelResult = await detectPowerLevelBreakthrough(env, chapterId, novelId)
        if (powerLevelResult.hasBreakthrough) {
          LOG_STYLES.POWER_LEVEL_RESULT(powerLevelResult.updates.length)
        }
      } catch (powerLevelError) {
        LOG_STYLES.WARN(`${ERROR_MESSAGES.POWER_LEVEL_DETECTION_FAILED}: ${powerLevelError}`)
        onToolCall({
          type: 'tool_call',
          name: 'postprocess_warning',
          args: { task: 'power_level', error: (powerLevelError as Error).message },
          status: 'done',
          result: `⚠️ 境界检测失败: ${(powerLevelError as Error).message}`,
        })
      }
    }

    setTimeout(async () => {
      try {
        const coherenceResult = await checkChapterCoherence(env, chapterId, novelId)
        if (coherenceResult.hasIssues) {
          LOG_STYLES.COHERENCE_RESULT(coherenceResult.issues.length)
          coherenceResult.issues.forEach((issue: any) => LOG_STYLES.WARN(`  - [${issue.severity}] ${issue.message}`))
        }
      } catch (coherenceError) {
        LOG_STYLES.WARN(`${ERROR_MESSAGES.COHERENCE_CHECK_FAILED}: ${coherenceError}`)
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
