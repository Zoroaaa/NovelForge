/**
 * @file generation.ts
 * @description Agent章节生成主入口
 */
import { drizzle } from 'drizzle-orm/d1'
import { chapters, novels } from '../../db/schema'
import { eq, sql } from 'drizzle-orm'
import type { Env } from '../../lib/types'
import { buildChapterContext, type ContextBundle } from '../contextBuilder'
import { resolveConfig } from '../llm'
import { enqueue } from '../../lib/queue'
import { runReActLoop } from './reactLoop'
import { buildMessages } from './messages'
import { DEFAULT_AGENT_CONFIG } from './types'
import { ERROR_MESSAGES, LOG_STYLES } from './constants'
import type { AgentConfig, GenerationOptions, ToolCallEvent } from './types'
import { runPostProcess } from './postProcess'

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
      status: options.draftMode ? 'draft' : 'generated',
      updatedAt: sql`(unixepoch())`,
    }

    if (extractedTitle) {
      updateData.title = extractedTitle
    }

    await db.update(chapters)
      .set(updateData)
      .where(eq(chapters.id, chapterId))
    LOG_STYLES.SUCCESS(`B1 fix: 章节内容已写入数据库 (${fullContent.length} 字符, mode=${options.draftMode ? 'draft' : 'normal'})`)
  }

  // 草稿模式或批量生成时跳过后处理
  if (options.draftMode) {
    LOG_STYLES.SUCCESS('草稿模式：跳过 post_process，章节状态为 draft')
  } else if (!options.skipPostProcess) {
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

        await runPostProcess(env, {
          chapterId,
          novelId,
          enableAutoSummary: agentConfig.enableAutoSummary,
          usage: {
            prompt_tokens: usageResult.promptTokens,
            completion_tokens: usageResult.completionTokens,
          },
        })

        LOG_STYLES.SUCCESS('✅ [Sync] 章节后处理全部完成')
      }
    } else {
      LOG_STYLES.SUCCESS('批量生成模式：跳过 post_process 入队，由 batch 流程统一处理后续')
    }

    onDone(
      { prompt_tokens: usageResult.promptTokens, completion_tokens: usageResult.completionTokens },
      llmConfig.modelId
    )
  } catch (error) {
    console.error('Generation failed:', error)
    onError(error as Error)
  }
}
