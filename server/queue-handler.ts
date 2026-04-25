import type { Env } from './lib/types'
import type { QueueMessage } from './lib/queue'
import { indexContent, deindexContent, deleteVector } from './services/embedding'
import { rebuildEntityIndex } from './services/entity-index'
import { triggerAutoSummary } from './services/agent'
import { detectPowerLevelBreakthrough } from './services/powerLevel'
import { extractForeshadowingFromChapter } from './services/foreshadowing'
import { checkCharacterConsistency } from './services/agent/consistency'
import { checkVolumeProgress } from './services/agent/volumeProgress'
import { logGeneration } from './services/agent/logging'
import { saveCheckLog } from './services/agent/checkLogService'
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

    case 'post_process_chapter': {
      // 架构优化: 异步执行章节后处理（摘要/伏笔/境界检测/检查），避免阻塞SSE流
      const { chapterId, novelId, enableAutoSummary, usage } = msg.payload

      if (enableAutoSummary) {
        try {
          await triggerAutoSummary(env, chapterId, novelId, usage || { prompt_tokens: 0, completion_tokens: 0 })
          console.log(`✅ [Queue] Auto summary completed for chapter ${chapterId}`)
        } catch (summaryError) {
          console.warn('[Queue] Auto-summary failed (non-critical):', summaryError)
        }
      }

      try {
        const foreshadowingResult = await extractForeshadowingFromChapter(env, chapterId, novelId)
        console.log(`📝 [Queue] Foreshadowing: ${foreshadowingResult.newForeshadowing.length} new, ${foreshadowingResult.resolvedForeshadowingIds.length} resolved, ${foreshadowingResult.progresses?.length || 0} progressed`)

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
        console.warn('[Queue] Foreshadowing extraction failed (non-critical):', foreshadowError)

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

      try {
        const powerLevelResult = await detectPowerLevelBreakthrough(env, chapterId, novelId)
        console.log(`⚡ [Queue] Power level: ${powerLevelResult.updates.length} breakthroughs detected`)

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
        console.warn('[Queue] Power level detection failed (non-critical):', powerLevelError)

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

      try {
        const db = drizzle(env.DB)
        const chapterData = await db.select({ volumeId: chapters.volumeId }).from(chapters).where(eq(chapters.id, chapterId)).get()

        if (chapterData?.volumeId) {
          const charList = await db.select({ id: characters.id }).from(characters).where(eq(characters.novelId, novelId)).limit(10).all()
          const characterIds = charList.map(c => c.id)

          if (characterIds.length > 0) {
            const consistencyResult = await checkCharacterConsistency(env, { chapterId, characterIds })
            console.log(`🎭 [Queue] Character consistency: ${consistencyResult.conflicts.length} conflicts, ${consistencyResult.warnings.length} warnings`)

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
        console.warn('[Queue] Character consistency check failed (non-critical):', consistencyError)

        await saveCheckLog(env, {
          novelId,
          chapterId,
          checkType: 'character_consistency',
          status: 'error',
          errorMessage: (consistencyError as Error).message,
          issuesCount: 0,
        })
      }

      try {
        const volumeProgressResult = await checkVolumeProgress(env, chapterId, novelId)
        console.log(`📊 [Queue] Volume progress: status=${volumeProgressResult.healthStatus}, risk=${volumeProgressResult.risk}`)

        await saveCheckLog(env, {
          novelId,
          chapterId,
          checkType: 'volume_progress',
          status: 'success',
          coherenceResult: volumeProgressResult,
          issuesCount: volumeProgressResult.healthStatus === 'critical' ? 1 : 0,
        })
      } catch (progressError) {
        console.warn('[Queue] Volume progress check failed (non-critical):', progressError)

        await saveCheckLog(env, {
          novelId,
          chapterId,
          checkType: 'volume_progress',
          status: 'error',
          errorMessage: (progressError as Error).message,
          issuesCount: 0,
        })
      }

      console.log(`✅ [Queue] Post-processing completed for chapter ${chapterId}`)
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
  const { novelId, types = ['setting', 'character', 'outline', 'foreshadowing'], clearExisting } = payload
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
  }
}
