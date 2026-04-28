import type { Env } from './lib/types'
import type { QueueMessage } from './lib/queue'
import { indexContent, deindexContent, deleteVector } from './services/embedding'
import { rebuildEntityIndex } from './services/entity-index'
import { triggerAutoSummary } from './services/agent'
import { detectPowerLevelBreakthrough } from './services/powerLevel'
import { extractForeshadowingFromChapter } from './services/foreshadowing'
import { checkCharacterConsistency } from './services/agent/consistency'
import { checkChapterCoherence } from './services/agent/coherence'
import { checkVolumeProgress } from './services/agent/volumeProgress'
import { logGeneration } from './services/agent/logging'
import { saveCheckLog } from './services/agent/checkLogService'
import { commitWorkshopSessionCore } from './services/workshop'
import { generateChapter } from './services/agent/generation'
import { startBatchGeneration as enqueueNextBatchChapter, incrementCompleted, markTaskDone, markTaskFailed, getBatchTask } from './services/agent/batchGenerate'
import { checkAndCompleteVolume } from './services/agent/volumeCompletion'
import { buildPrevChapterAdvice } from './services/agent/prevChapterAdvice'
import { checkQuality } from './services/agent/qualityCheck'
import { drizzle } from 'drizzle-orm/d1'
import { novelSettings, characters, foreshadowing, chapters, queueTaskLogs, vectorIndex } from './db/schema'
import { eq, and, sql } from 'drizzle-orm'
import { enqueueBatch } from './lib/queue'

export async function handleQueueBatch(
  batch: MessageBatch<QueueMessage>,
  env: Env
): Promise<void> {
    for (const message of batch.messages) {
      try {
        await logTaskStart(env, message)
        await handleMessage(env, message.body)
        await logTaskSuccess(env, message.id)
        message.ack()
      } catch (error) {
        console.error(`Queue task failed [${message.body.type}]:`, error)
        await logTaskFailure(env, message.id, error as Error)
        message.retry()
      }
    }
  }

async function handleMessage(env: Env, msg: QueueMessage): Promise<void> {
  switch (msg.type) {
    case 'index_content': {
      const { sourceType, sourceId, novelId, title, content, extraMetadata } = msg.payload
      await indexContent(env, sourceType, sourceId, novelId, title, content, extraMetadata)
      break
    }

    case 'reindex_all': {
      await handleReindexAll(env, msg.payload)
      break
    }

    case 'rebuild_entity_index': {
      await rebuildEntityIndex(env, msg.payload.novelId)
      break
    }

    case 'extract_foreshadowing': {
      await extractForeshadowingFromChapter(
        env,
        msg.payload.chapterId,
        msg.payload.novelId
      )
      break
    }

    case 'commit_workshop': {
      console.log(`[Queue] 开始处理 commit_workshop task for session ${msg.payload.sessionId}`)
      const result = await commitWorkshopSessionCore(env, msg.payload.sessionId)
      console.log(`[Queue] commit_workshop 完成: novelId=${result.novelId}`)
      break
    }

    case 'generate_chapter': {
      const { chapterId, novelId, mode, existingContent, targetWords, issuesContext, enableRAG, enableAutoSummary } = msg.payload

      console.log(`[Queue] 开始后台生成章节: chapter=${chapterId}, novel=${novelId}, mode=${mode}`)

      await generateChapter(
        env,
        chapterId,
        novelId,
        (text) => {
          console.log(`[Queue] 生成进度: ${text.slice(0, 50)}...`)
        },
        (event) => {
          console.log(`[Queue] 工具调用: ${event.name}`)
        },
        async (usage, modelId) => {
          console.log(`[Queue] 章节生成完成: model=${modelId}, tokens=${usage.completion_tokens}`)

          await logGeneration(env, {
            novelId,
            chapterId,
            stage: 'chapter_gen',
            modelId,
            promptTokens: usage.prompt_tokens,
            completionTokens: usage.completion_tokens,
            durationMs: 0,
            status: 'success',
          })
        },
        async (error) => {
          console.error(`[Queue] 章节生成失败:`, error)

          await logGeneration(env, {
            novelId,
            chapterId,
            stage: 'chapter_gen',
            modelId: 'unknown',
            durationMs: 0,
            status: 'error',
            errorMsg: error.message,
          })

          throw error
        },
        { enableRAG: enableRAG ?? true, enableAutoSummary: enableAutoSummary ?? true },
        { mode, existingContent, targetWords, issuesContext }
      )

      console.log(`[Queue] 后台章节生成全部完成 for chapter ${chapterId}`)
      break
    }

    case 'post_process_chapter': {
      // ============================================================
      // 章节后处理（异步模式，通过队列执行）
      // 与 generation.ts 的同步模式 setTimeout 部分保持一致
      // ============================================================
      const { chapterId, novelId, enableAutoSummary, usage } = msg.payload

      // ----- 步骤1：自动摘要 -----
      if (enableAutoSummary) {
        try {
          const usage = msg.payload.usage || { prompt_tokens: 0, completion_tokens: 0 }
          await triggerAutoSummary(env, chapterId, novelId, usage)
          console.log(`✅ [Queue] 自动摘要完成 for chapter ${chapterId}`)

          // 写入生成日志
          await logGeneration(env, {
            novelId,
            chapterId,
            stage: 'auto_summary',
            modelId: 'N/A',
            promptTokens: usage.prompt_tokens,
            completionTokens: usage.completion_tokens,
            durationMs: 0,
            status: 'success',
            contextSnapshot: JSON.stringify({ enabled: true }),
          })
        } catch (summaryError) {
          console.warn('[Queue] 自动摘要失败（非致命）:', summaryError)

          await logGeneration(env, {
            novelId,
            chapterId,
            stage: 'auto_summary',
            modelId: 'N/A',
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
        console.log(`📝 [Queue] 伏笔提取: ${foreshadowingResult.newForeshadowing.length} 个新伏笔, ${foreshadowingResult.resolvedForeshadowingIds.length} 个已解决`)

        await logGeneration(env, {
          novelId,
          chapterId,
          stage: 'foreshadowing_extraction',
          modelId: 'N/A',
          contextSnapshot: JSON.stringify({
            newCount: foreshadowingResult.newForeshadowing.length,
            resolvedCount: foreshadowingResult.resolvedForeshadowingIds.length,
            progressedCount: foreshadowingResult.progresses?.length || 0,
          }),
          durationMs: 0,
          status: 'success',
        })
      } catch (foreshadowError) {
        console.warn('[Queue] 伏笔提取失败（非致命）:', foreshadowError)

        await logGeneration(env, {
          novelId,
          chapterId,
          stage: 'foreshadowing_extraction',
          modelId: 'N/A',
          contextSnapshot: JSON.stringify({ error: (foreshadowError as Error).message }),
          durationMs: 0,
          status: 'error',
          errorMsg: (foreshadowError as Error).message,
        })
      }

      // ----- 步骤3：境界突破检测 -----
      try {
        const powerLevelResult = await detectPowerLevelBreakthrough(env, chapterId, novelId)
        console.log(`⚡ [Queue] 境界检测: 检测到 ${powerLevelResult.updates.length} 个突破`)

        await logGeneration(env, {
          novelId,
          chapterId,
          stage: 'power_level_detection',
          modelId: 'N/A',
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
        console.warn('[Queue] 境界检测失败（非致命）:', powerLevelError)

        await logGeneration(env, {
          novelId,
          chapterId,
          stage: 'power_level_detection',
          modelId: 'N/A',
          contextSnapshot: JSON.stringify({ error: (powerLevelError as Error).message }),
          durationMs: 0,
          status: 'error',
          errorMsg: (powerLevelError as Error).message,
        })
      }

      // ----- 步骤4：角色一致性检查 -----
      try {
        const db = drizzle(env.DB)
        const chapterData = await db.select({ volumeId: chapters.volumeId }).from(chapters).where(eq(chapters.id, chapterId)).get()

        if (chapterData?.volumeId) {
          const charList = await db.select({ id: characters.id }).from(characters).where(eq(characters.novelId, novelId)).limit(10).all()
          const characterIds = charList.map(c => c.id)

          if (characterIds.length > 0) {
            const consistencyResult = await checkCharacterConsistency(env, { chapterId, characterIds })
            console.log(`🎭 [Queue] 角色一致性: ${consistencyResult.conflicts.length} 个冲突, ${consistencyResult.warnings.length} 个警告`)

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
        console.warn('[Queue] 角色一致性检查失败（非致命）:', consistencyError)

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
        console.log(`🔗 [Queue] 章节连贯性: score=${coherenceResult.score}, issues=${coherenceResult.issues?.length || 0}`)

        await saveCheckLog(env, {
          novelId,
          chapterId,
          checkType: 'chapter_coherence',
          status: 'success',
          coherenceResult: coherenceResult,
          issuesCount: coherenceResult.issues?.length || 0,
        })
      } catch (coherenceError) {
        console.warn('[Queue] 章节连贯性检查失败（非致命）:', coherenceError)

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
        console.log(`📊 [Queue] 卷完成程度: status=${volumeProgressResult.healthStatus}, risk=${volumeProgressResult.risk}`)

        await saveCheckLog(env, {
          novelId,
          chapterId,
          checkType: 'volume_progress',
          status: 'success',
          coherenceResult: volumeProgressResult,
          issuesCount: volumeProgressResult.healthStatus === 'critical' ? 1 : 0,
        })
      } catch (progressError) {
        console.warn('[Queue] 卷进度检查失败（非致命）:', progressError)

        await saveCheckLog(env, {
          novelId,
          chapterId,
          checkType: 'volume_progress',
          status: 'error',
          errorMessage: (progressError as Error).message,
          issuesCount: 0,
        })
      }

      console.log(`✅ [Queue] 章节后处理全部完成 for chapter ${chapterId}`)

      // ----- 步骤7：质量评分（Phase 2）-----
      if (env.TASK_QUEUE) {
        await env.TASK_QUEUE.send({
          type: 'quality_check',
          payload: { chapterId, novelId },
        })
      }

      break
    }

    case 'batch_generate_chapter': {
      const { taskId, novelId, volumeId } = msg.payload
      const db = drizzle(env.DB)

      const task = await getBatchTask(env, taskId)
      if (!task || (task.status !== 'running' && task.status !== 'paused')) {
        console.log(`[Queue] batch task ${taskId} status=${task?.status}, skipping`)
        break
      }

      if (task.status === 'paused') {
        console.log(`[Queue] batch task ${taskId} is paused, skipping`)
        break
      }

      const volumeCompleted = await checkAndCompleteVolume(env, volumeId)
      if (volumeCompleted.completed) {
        console.log(`[Queue] volume ${volumeId} completed, marking batch done`)
        await markTaskDone(env, taskId)
        break
      }

      const currentOrder = task.currentChapterOrder ?? task.startChapterOrder

      let chapter = await db.select()
        .from(chapters)
        .where(and(eq(chapters.volumeId, volumeId), eq(chapters.sortOrder, currentOrder)))
        .get()

      if (!chapter) {
        const now = Math.floor(Date.now() / 1000)
        ;[chapter] = await db.insert(chapters).values({
          novelId,
          volumeId,
          title: `第${currentOrder}章`,
          sortOrder: currentOrder,
          status: 'draft',
          wordCount: 0,
          createdAt: now,
          updatedAt: now,
        }).returning()
      }

      let prevChapterAdvice: string | null = null
      if (currentOrder > task.startChapterOrder) {
        const prevChapters = await db.select({ id: chapters.id })
          .from(chapters)
          .where(and(eq(chapters.volumeId, volumeId), eq(chapters.sortOrder, currentOrder - 1)))
          .limit(1)
          .all()

        if (prevChapters.length > 0) {
          try {
            prevChapterAdvice = await buildPrevChapterAdvice(env, prevChapters[0].id)
          } catch (e) {
            console.warn('[Queue] buildPrevChapterAdvice failed:', e)
          }
        }
      }

      try {
        await generateChapter(
          env,
          chapter.id,
          novelId,
          () => {},
          () => {},
          async () => {},
          async (error) => { throw error },
          { enableRAG: true, enableAutoSummary: true },
          { issuesContext: prevChapterAdvice ? [prevChapterAdvice] : undefined }
        )

        if (env.TASK_QUEUE) {
          await env.TASK_QUEUE.send({
            type: 'post_process_chapter',
            payload: { chapterId: chapter.id, novelId, enableAutoSummary: true },
          })
        }

        if (env.TASK_QUEUE) {
          await env.TASK_QUEUE.send({
            type: 'batch_chapter_done',
            payload: { taskId, novelId, volumeId, chapterId: chapter.id, success: true },
          })
        }
      } catch (genError) {
        console.error(`[Queue] batch chapter generation failed:`, genError)

        if (env.TASK_QUEUE) {
          await env.TASK_QUEUE.send({
            type: 'batch_chapter_done',
            payload: { taskId, novelId, volumeId, chapterId: chapter.id, success: false },
          })
        }
      }

      break
    }

    case 'batch_chapter_done': {
      const { taskId, success } = msg.payload

      await incrementCompleted(env, taskId, success)

      const task = await getBatchTask(env, taskId)
      if (!task) break

      if (task.completedCount + task.failedCount >= task.targetCount) {
        await markTaskDone(env, taskId)
        console.log(`[Queue] batch task ${taskId} done: ${task.completedCount}/${task.targetCount}`)
      } else if (task.status === 'running' && env.TASK_QUEUE) {
        await env.TASK_QUEUE.send({
          type: 'batch_generate_chapter',
          payload: { taskId, novelId: task.novelId, volumeId: task.volumeId },
        })
      }

      break
    }

    case 'quality_check': {
      const { chapterId, novelId } = msg.payload

      try {
        await checkQuality(env, { chapterId, novelId })
        console.log(`✅ [Queue] 质量评分完成 for chapter ${chapterId}`)
      } catch (qualityError) {
        console.warn('[Queue] 质量评分失败（非致命）:', qualityError)
      }

      break
    }

    default: {
      const _exhaustive: never = msg
      console.warn('Unknown queue message type:', (_exhaustive as QueueMessage).type)
    }
  }
}

async function handleReindexAll(
  env: Env,
  payload: Extract<QueueMessage, { type: 'reindex_all' }>['payload']
): Promise<void> {
  const { novelId, types = ['setting', 'character', 'foreshadowing'], clearExisting } = payload
  const db = drizzle(env.DB)

  if (clearExisting && env.VECTORIZE) {
    try {
      const existingVectors = await db.select({ id: vectorIndex.id })
        .from(vectorIndex)
        .where(eq(vectorIndex.novelId, novelId))
        .all()

      for (const v of existingVectors) {
        await deleteVector(env.VECTORIZE, v.id)
      }

      await db.delete(vectorIndex).where(eq(vectorIndex.novelId, novelId))
      console.log(`Cleared ${existingVectors.length} existing vectors for novel ${novelId}`)
    } catch (e) {
      console.warn('Failed to clear existing vectors:', e)
    }
  }

  const messages: QueueMessage[] = []

  if (types.includes('setting')) {
    const settings = await db.select({
      id: novelSettings.id,
      novelId: novelSettings.novelId,
      name: novelSettings.name,
      content: novelSettings.content,
      summary: novelSettings.summary,
      type: novelSettings.type,
      importance: novelSettings.importance,
    })
    .from(novelSettings)
    .where(and(
      eq(novelSettings.novelId, novelId),
      sql`${novelSettings.deletedAt} IS NULL`,
      sql`${novelSettings.content} IS NOT NULL`
    ))
    .all()

    for (const s of settings) {
      if (!s.content) continue
      const indexContent = s.summary || (s.content.length > 500 ? s.content.slice(0, 500) : s.content)
      messages.push({
        type: 'index_content',
        payload: {
          sourceType: 'setting',
          sourceId: s.id,
          novelId: s.novelId,
          title: s.name,
          content: indexContent,
          extraMetadata: { settingType: s.type, importance: s.importance },
        },
      })
    }
  }

  if (types.includes('character')) {
    const chars = await db.select({
      id: characters.id,
      novelId: characters.novelId,
      name: characters.name,
      description: characters.description,
    })
    .from(characters)
    .where(and(
      eq(characters.novelId, novelId),
      sql`${characters.deletedAt} IS NULL`,
      sql`${characters.description} IS NOT NULL`
    ))
    .all()

    for (const ch of chars) {
      if (!ch.description) continue
      const indexText = `${ch.name}\n${(ch.description || '').slice(0, 300)}`
      messages.push({
        type: 'index_content',
        payload: {
          sourceType: 'character',
          sourceId: ch.id,
          novelId: ch.novelId,
          title: ch.name,
          content: indexText,
        },
      })
    }
  }

  if (types.includes('foreshadowing')) {
    const items = await db.select({
      id: foreshadowing.id,
      novelId: foreshadowing.novelId,
      title: foreshadowing.title,
      description: foreshadowing.description,
      importance: foreshadowing.importance,
    })
    .from(foreshadowing)
    .where(and(
      eq(foreshadowing.novelId, novelId),
      sql`${foreshadowing.deletedAt} IS NULL`,
      sql`${foreshadowing.description} IS NOT NULL`
    ))
    .all()

    for (const f of items) {
      if (!f.description) continue
      messages.push({
        type: 'index_content',
        payload: {
          sourceType: 'foreshadowing',
          sourceId: f.id,
          novelId: f.novelId,
          title: f.title,
          content: f.description,
          extraMetadata: { importance: f.importance },
        },
      })
    }
  }

  if (env.TASK_QUEUE && messages.length > 0) {
    await enqueueBatch(env, messages)
  }

  console.log(`reindex_all enqueued ${messages.length} tasks for novel ${novelId}`)
}

async function logTaskStart(env: Env, message: { id: string; body: QueueMessage }): Promise<void> {
  try {
    const db = drizzle(env.DB)
    await db.insert(queueTaskLogs).values({
      id: message.id,
      novelId: getNovelId(message.body),
      taskType: message.body.type,
      status: 'pending',
      payload: JSON.stringify(message.body.payload),
      createdAt: Math.floor(Date.now() / 1000),
    })
  } catch (e) {
    console.warn('Failed to log task start:', e)
  }
}

async function logTaskSuccess(env: Env, messageId: string): Promise<void> {
  try {
    const db = drizzle(env.DB)
    await db.update(queueTaskLogs)
      .set({ status: 'success', finishedAt: Math.floor(Date.now() / 1000) })
      .where(eq(queueTaskLogs.id, messageId))
  } catch (e) {
    console.warn('Failed to log task success:', e)
  }
}

async function logTaskFailure(env: Env, messageId: string, error: Error): Promise<void> {
  try {
    const db = drizzle(env.DB)
    await db.update(queueTaskLogs)
      .set({
        status: 'failed',
        errorMsg: error.message,
        finishedAt: Math.floor(Date.now() / 1000),
      })
      .where(eq(queueTaskLogs.id, messageId))
  } catch (e) {
    console.warn('Failed to log task failure:', e)
  }
}

function getNovelId(msg: QueueMessage): string {
  switch (msg.type) {
    case 'index_content':
      return msg.payload.novelId
    case 'reindex_all':
      return msg.payload.novelId
    case 'rebuild_entity_index':
      return msg.payload.novelId
    case 'extract_foreshadowing':
      return msg.payload.novelId
    case 'post_process_chapter':
      return msg.payload.novelId
    case 'commit_workshop':
      return ''
    case 'generate_chapter':
      return msg.payload.novelId
    case 'batch_generate_chapter':
      return msg.payload.novelId
    case 'batch_chapter_done':
      return msg.payload.novelId
    case 'quality_check':
      return msg.payload.novelId
  }
}
