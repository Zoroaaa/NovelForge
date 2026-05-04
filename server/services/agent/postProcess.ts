/**
 * @file postProcess.ts
 * @description 章节后处理统一入口（跨章一致性增强版 — 链式分步执行）
 *
 * 参考 workshop_post_commit 的任务分拆模式，将原 10 步串行管线拆分为
 * 10 个独立 QueueMessage，通过链式入队实现分步执行：
 *
 * post_process_chapter（轻量调度器）
 *   → post_process_step_1  → post_process_step_1b → post_process_step_2
 *   → post_process_step_3  → post_process_step_4  → post_process_step_5
 *   → post_process_step_6  → post_process_step_7  → post_process_step_8
 *   → post_process_step_9  → quality_check + extract_plot_graph
 *
 * 每步独立执行，失败不阻塞后续步骤，天然适配 Cloudflare Queue visibility timeout。
 * 当 TASK_QUEUE 不可用时，退化为原始同步串行模式。
 */
import { drizzle } from 'drizzle-orm/d1'
import { chapters, characters } from '../../db/schema'
import { eq, and, sql } from 'drizzle-orm'
import type { Env } from '../../lib/types'
import { enqueue } from '../../lib/queue'
import { triggerAutoSummary, parseStructuredDataFromSummary } from './summarizer'
import { extractForeshadowingFromChapter } from '../foreshadowing'
import { detectPowerLevelBreakthrough } from '../powerLevel'
import { checkCharacterConsistency } from './consistency'
import { checkChapterCoherence } from './coherence'
import { checkVolumeProgress } from './volumeProgress'
import { saveCheckLog } from './checkLogService'
import { logGeneration } from './logging'
import { extractEntitiesFromChapter, persistExtractedEntities, triggerEntityVectorize } from './entityExtract'
import type { EntityExtractResult } from './entityExtract'
import { trackCharacterGrowth } from './characterGrowth'
import { detectEntityConflicts } from './entityConflict'

// ======================== 类型定义 ========================

export interface PostProcessPayload {
  chapterId: string
  novelId: string
  enableAutoSummary: boolean
  usage: { prompt_tokens: number; completion_tokens: number }
}

export interface StepChainPayload {
  chapterId: string
  novelId: string
  taskId?: string
  volumeId?: string
}

// ======================== 调度器入口 ========================

/**
 * 轻量调度器 — 仅做幂等锁 + 入队 step 1，不执行任何 LLM 调用。
 * 由 queue-handler 的 post_process_chapter case 调用。
 */
export async function dispatchPostProcess(env: Env, payload: PostProcessPayload & { taskId?: string; volumeId?: string }): Promise<void> {
  const { chapterId, novelId, enableAutoSummary, usage, taskId, volumeId } = payload

  if (env.TASK_QUEUE) {
    await enqueue(env, {
      type: 'post_process_step_1',
      payload: { chapterId, novelId, enableAutoSummary, usage, taskId, volumeId },
    })
    console.log(`[PostProcess] 已入队 step_1 for chapter ${chapterId}`)
  } else {
    console.warn('[PostProcess] TASK_QUEUE 不可用，退化为同步串行模式')
    await runPostProcess(env, { chapterId, novelId, enableAutoSummary, usage })
    await finishPostProcess(env, chapterId, novelId, taskId, volumeId)
  }
}

// ======================== 同步模式（兼容无队列环境） ========================

export async function runPostProcess(env: Env, payload: PostProcessPayload): Promise<void> {
  const { chapterId, novelId, enableAutoSummary, usage } = payload

  await step1AutoSummary(env, chapterId, novelId, enableAutoSummary, usage)
  await step1bParseStructuredData(env, chapterId, novelId)
  await step2Foreshadowing(env, chapterId, novelId)
  await step3PowerLevel(env, chapterId, novelId)
  await step4CharacterConsistency(env, chapterId, novelId)
  await step5Coherence(env, chapterId, novelId)
  await step6VolumeProgress(env, chapterId, novelId)
  const extractResult = await step7EntityExtract(env, chapterId, novelId)
  await step8CharacterGrowth(env, chapterId, novelId, extractResult)
  await step9EntityConflictDetect(env, chapterId, novelId)
}

// ======================== 链式分步入口（queue-handler 调用） ========================

export async function runStep1(env: Env, payload: PostProcessPayload & { taskId?: string; volumeId?: string }): Promise<void> {
  const { chapterId, novelId, enableAutoSummary, usage, taskId, volumeId } = payload
  await step1AutoSummary(env, chapterId, novelId, enableAutoSummary, usage)
  await chainNext(env, 'post_process_step_1b', { chapterId, novelId, taskId, volumeId })
}

export async function runStep1b(env: Env, payload: StepChainPayload): Promise<void> {
  const { chapterId, novelId, taskId, volumeId } = payload
  await step1bParseStructuredData(env, chapterId, novelId)
  await chainNext(env, 'post_process_step_2', { chapterId, novelId, taskId, volumeId })
}

export async function runStep2(env: Env, payload: StepChainPayload): Promise<void> {
  const { chapterId, novelId, taskId, volumeId } = payload
  await step2Foreshadowing(env, chapterId, novelId)
  await chainNext(env, 'post_process_step_3', { chapterId, novelId, taskId, volumeId })
}

export async function runStep3(env: Env, payload: StepChainPayload): Promise<void> {
  const { chapterId, novelId, taskId, volumeId } = payload
  await step3PowerLevel(env, chapterId, novelId)
  await chainNext(env, 'post_process_step_4', { chapterId, novelId, taskId, volumeId })
}

export async function runStep4(env: Env, payload: StepChainPayload): Promise<void> {
  const { chapterId, novelId, taskId, volumeId } = payload
  await step4CharacterConsistency(env, chapterId, novelId)
  await chainNext(env, 'post_process_step_5', { chapterId, novelId, taskId, volumeId })
}

export async function runStep5(env: Env, payload: StepChainPayload): Promise<void> {
  const { chapterId, novelId, taskId, volumeId } = payload
  await step5Coherence(env, chapterId, novelId)
  await chainNext(env, 'post_process_step_6', { chapterId, novelId, taskId, volumeId })
}

export async function runStep6(env: Env, payload: StepChainPayload): Promise<void> {
  const { chapterId, novelId, taskId, volumeId } = payload
  await step6VolumeProgress(env, chapterId, novelId)
  await chainNext(env, 'post_process_step_7', { chapterId, novelId, taskId, volumeId })
}

export async function runStep7(env: Env, payload: StepChainPayload): Promise<void> {
  const { chapterId, novelId, taskId, volumeId } = payload
  const extractResult = await step7EntityExtract(env, chapterId, novelId)
  await chainNext(env, 'post_process_step_8', {
    chapterId,
    novelId,
    characterGrowths: extractResult.characterGrowths,
    knowledgeReveals: extractResult.knowledgeReveals,
    taskId,
    volumeId,
  })
}

export async function runStep9(env: Env, payload: StepChainPayload): Promise<void> {
  const { chapterId, novelId, taskId, volumeId } = payload
  await step9EntityConflictDetect(env, chapterId, novelId)
  await finishPostProcess(env, chapterId, novelId, taskId, volumeId)
}

// ======================== 链式入队辅助 ========================

async function chainNext(
  env: Env,
  nextType: 'post_process_step_1b' | 'post_process_step_2' | 'post_process_step_3'
    | 'post_process_step_4' | 'post_process_step_5' | 'post_process_step_6'
    | 'post_process_step_7' | 'post_process_step_8' | 'post_process_step_9',
  payload: Record<string, unknown>,
): Promise<void> {
  if (env.TASK_QUEUE) {
    await enqueue(env, { type: nextType, payload } as any)
  }
}

/**
 * 后处理管线最终完成后的收尾工作：入队 quality_check 和 extract_plot_graph
 */
export async function finishPostProcess(
  env: Env,
  chapterId: string,
  novelId: string,
  taskId?: string,
  volumeId?: string,
): Promise<void> {
  // 后处理完成，将 post_processing 改回终态 generated
  const db = drizzle(env.DB)
  await db.update(chapters)
    .set({ status: 'generated' })
    .where(eq(chapters.id, chapterId))
    .run()

  if (!env.TASK_QUEUE) return

  if (taskId && volumeId) {
    await env.TASK_QUEUE.send({
      type: 'quality_check',
      payload: { chapterId, novelId, taskId, volumeId },
    })
  } else {
    await env.TASK_QUEUE.send({
      type: 'quality_check',
      payload: { chapterId, novelId },
    })
    await env.TASK_QUEUE.send({
      type: 'extract_plot_graph',
      payload: { chapterId, novelId },
    })
  }
}

// ======================== 步骤实现（每步独立 try-catch） ========================

async function step1AutoSummary(
  env: Env,
  chapterId: string,
  novelId: string,
  enableAutoSummary: boolean,
  usage: { prompt_tokens: number; completion_tokens: number }
): Promise<void> {
  if (!enableAutoSummary) return

  try {
    const result = await triggerAutoSummary(env, chapterId, novelId, usage)
    console.log(`✅ [PostProcess] 自动摘要完成 for chapter ${chapterId}`)

    const metrics = result.metrics
    await logGeneration(env, {
      novelId,
      chapterId,
      stage: 'auto_summary',
      modelId: metrics?.modelId || 'N/A',
      promptTokens: metrics?.usage.prompt_tokens || 0,
      completionTokens: metrics?.usage.completion_tokens || 0,
      durationMs: metrics?.durationMs || 0,
      status: 'success',
      contextSnapshot: JSON.stringify({ enabled: true }),
    })
  } catch (summaryError) {
    console.warn('[PostProcess] 自动摘要失败（非致命）:', summaryError)

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

async function step1bParseStructuredData(env: Env, chapterId: string, novelId: string): Promise<void> {
  try {
    await parseStructuredDataFromSummary(env, chapterId, novelId)
    console.log(`📋 [PostProcess] 摘要结构化解析完成 for chapter ${chapterId}`)
  } catch (error) {
    console.warn('[PostProcess] 摘要结构化解析失败（非致命）:', error)
  }
}

async function step2Foreshadowing(env: Env, chapterId: string, novelId: string): Promise<void> {
  try {
    const foreshadowingResult = await extractForeshadowingFromChapter(env, chapterId, novelId)
    console.log(`📝 [PostProcess] 伏笔提取: ${foreshadowingResult.newForeshadowing.length} 个新伏笔, ${foreshadowingResult.resolvedForeshadowingIds.length} 个已解决`)

    const metrics = foreshadowingResult.metrics
    await logGeneration(env, {
      novelId,
      chapterId,
      stage: 'foreshadowing_extraction',
      modelId: metrics?.modelId || 'N/A',
      promptTokens: metrics?.usage.prompt_tokens,
      completionTokens: metrics?.usage.completion_tokens,
      durationMs: metrics?.durationMs || 0,
      status: 'success',
      contextSnapshot: JSON.stringify({
        newCount: foreshadowingResult.newForeshadowing.length,
        resolvedCount: foreshadowingResult.resolvedForeshadowingIds.length,
        progressedCount: foreshadowingResult.progresses?.length || 0,
      }),
    })
  } catch (foreshadowError) {
    console.warn('[PostProcess] 伏笔提取失败（非致命）:', foreshadowError)

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
}

async function step3PowerLevel(env: Env, chapterId: string, novelId: string): Promise<void> {
  try {
    const powerLevelResult = await detectPowerLevelBreakthrough(env, chapterId, novelId)
    console.log(`⚡ [PostProcess] 境界检测: 检测到 ${powerLevelResult.updates.length} 个突破`)

    const metrics = powerLevelResult.metrics
    await logGeneration(env, {
      novelId,
      chapterId,
      stage: 'power_level_detection',
      modelId: metrics?.modelId || 'N/A',
      promptTokens: metrics?.usage.prompt_tokens,
      completionTokens: metrics?.usage.completion_tokens,
      durationMs: metrics?.durationMs || 0,
      status: 'success',
      contextSnapshot: JSON.stringify({
        hasBreakthrough: powerLevelResult.hasBreakthrough,
        updatesCount: powerLevelResult.updates.length,
        updates: powerLevelResult.updates.map(u => ({
          characterName: u.characterName,
          from: u.previousPowerLevel?.current,
          to: u.newPowerLevel.current,
        })),
      }),
    })
  } catch (powerLevelError) {
    console.warn('[PostProcess] 境界检测失败（非致命）:', powerLevelError)

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
}

async function step4CharacterConsistency(env: Env, chapterId: string, novelId: string): Promise<void> {
  try {
    const db = drizzle(env.DB)
    const chapterData = await db
      .select({ volumeId: chapters.volumeId })
      .from(chapters)
      .where(eq(chapters.id, chapterId))
      .get()

    if (!chapterData?.volumeId) return

    const charList = await db
      .select({ id: characters.id })
      .from(characters)
      .where(and(
        eq(characters.novelId, novelId),
        sql`${characters.deletedAt} IS NULL`
      ))
      .limit(10)
      .all()

    const characterIds = charList.map(c => c.id)
    if (characterIds.length === 0) return

    const consistencyResult = await checkCharacterConsistency(env, { chapterId, characterIds })
    console.log(`🎭 [PostProcess] 角色一致性: ${consistencyResult.conflicts.length} 个冲突, ${consistencyResult.warnings.length} 个警告`)

    await saveCheckLog(env, {
      novelId,
      chapterId,
      checkType: 'character_consistency',
      score: consistencyResult.score,
      status: 'success',
      characterResult: consistencyResult,
      issuesCount: consistencyResult.conflicts.length + consistencyResult.warnings.length,
    })

    await logGeneration(env, {
      novelId,
      chapterId,
      stage: 'character_consistency_check',
      modelId: consistencyResult.metrics?.modelId || 'N/A',
      promptTokens: consistencyResult.metrics?.usage?.prompt_tokens || 0,
      completionTokens: consistencyResult.metrics?.usage?.completion_tokens || 0,
      durationMs: consistencyResult.metrics?.durationMs || 0,
      status: 'success',
      contextSnapshot: JSON.stringify({
        conflictCount: consistencyResult.conflicts.length,
        warningCount: consistencyResult.warnings.length,
      }),
    })
  } catch (consistencyError) {
    console.warn('[PostProcess] 角色一致性检查失败（非致命）:', consistencyError)

    await saveCheckLog(env, {
      novelId,
      chapterId,
      checkType: 'character_consistency',
      status: 'error',
      errorMessage: (consistencyError as Error).message,
      issuesCount: 0,
    })
  }
}

async function step5Coherence(env: Env, chapterId: string, novelId: string): Promise<void> {
  try {
    const coherenceResult = await checkChapterCoherence(env, chapterId, novelId)
    console.log(`🔗 [PostProcess] 章节连贯性: score=${coherenceResult.score}, issues=${coherenceResult.issues?.length || 0}`)

    await saveCheckLog(env, {
      novelId,
      chapterId,
      checkType: 'chapter_coherence',
      score: coherenceResult.score,
      status: 'success',
      coherenceResult: coherenceResult,
      issuesCount: coherenceResult.issues?.length || 0,
    })
  } catch (coherenceError) {
    console.warn('[PostProcess] 章节连贯性检查失败（非致命）:', coherenceError)

    await saveCheckLog(env, {
      novelId,
      chapterId,
      checkType: 'chapter_coherence',
      status: 'error',
      errorMessage: (coherenceError as Error).message,
      issuesCount: 0,
    })
  }
}

async function step6VolumeProgress(env: Env, chapterId: string, novelId: string): Promise<void> {
  try {
    const volumeProgressResult = await checkVolumeProgress(env, chapterId, novelId)
    console.log(`📊 [PostProcess] 卷完成程度: 字数分=${volumeProgressResult.wordCountScore}, 节奏分=${volumeProgressResult.rhythmScore}, 综合=${volumeProgressResult.score}`)

    await saveCheckLog(env, {
      novelId,
      chapterId,
      checkType: 'volume_progress',
      score: volumeProgressResult.score,
      status: 'success',
      volumeProgressResult: volumeProgressResult,
      issuesCount: volumeProgressResult.wordCountIssues.length + volumeProgressResult.rhythmIssues.length,
    })

    await logGeneration(env, {
      novelId,
      chapterId,
      stage: 'volume_progress_check',
      modelId: volumeProgressResult.metrics?.modelId || 'N/A',
      promptTokens: volumeProgressResult.metrics?.usage?.prompt_tokens || 0,
      completionTokens: volumeProgressResult.metrics?.usage?.completion_tokens || 0,
      durationMs: volumeProgressResult.metrics?.durationMs || 0,
      status: 'success',
      contextSnapshot: JSON.stringify({
        wordCountScore: volumeProgressResult.wordCountScore,
        rhythmScore: volumeProgressResult.rhythmScore,
        totalScore: volumeProgressResult.score,
        issueCount: volumeProgressResult.wordCountIssues.length + volumeProgressResult.rhythmIssues.length,
      }),
    })
  } catch (progressError) {
    console.warn('[PostProcess] 卷进度检查失败（非致命）:', progressError)

    await saveCheckLog(env, {
      novelId,
      chapterId,
      checkType: 'volume_progress',
      status: 'error',
      errorMessage: (progressError as Error).message,
      issuesCount: 0,
    })
  }
}

export async function step7EntityExtract(env: Env, chapterId: string, novelId: string): Promise<EntityExtractResult> {
  try {
    const extractResult = await extractEntitiesFromChapter(env, chapterId, novelId)
    const { entityCount, stateChangeCount } = await persistExtractedEntities(env, chapterId, novelId, extractResult)
    await triggerEntityVectorize(env, novelId, extractResult)

    console.log(`🔍 [PostProcess] 实体提取完成: ${entityCount} 个新实体, ${stateChangeCount} 条状态记录`)

    const metrics = extractResult.metrics
    await logGeneration(env, {
      novelId,
      chapterId,
      stage: 'entity_extraction',
      modelId: metrics?.modelId || 'N/A',
      promptTokens: metrics?.usage.prompt_tokens,
      completionTokens: metrics?.usage.completion_tokens,
      durationMs: metrics?.durationMs || 0,
      status: 'success',
      contextSnapshot: JSON.stringify({
        entityCount,
        stateChangeCount,
        characterGrowthCount: extractResult.characterGrowths.length,
        knowledgeRevealCount: extractResult.knowledgeReveals.length,
      }),
    })

    return extractResult
  } catch (error) {
    console.warn('[PostProcess] 实体提取失败（非致命）:', error)

    await logGeneration(env, {
      novelId,
      chapterId,
      stage: 'entity_extraction',
      modelId: 'N/A',
      durationMs: 0,
      status: 'error',
      errorMsg: (error as Error).message,
      contextSnapshot: JSON.stringify({ error: (error as Error).message }),
    })

    return { entities: [], stateChanges: [], characterGrowths: [], knowledgeReveals: [] }
  }
}

export async function step8CharacterGrowth(
  env: Env,
  chapterId: string,
  novelId: string,
  extractResult: EntityExtractResult,
): Promise<void> {
  try {
    if (extractResult.characterGrowths.length === 0 && extractResult.knowledgeReveals.length === 0) {
      console.log(`📈 [PostProcess] 无角色成长数据，跳过 step8`)
      return
    }

    const { growthCount, relationshipCount } = await trackCharacterGrowth(env, chapterId, novelId, extractResult)
    console.log(`📈 [PostProcess] 角色成长追踪完成: ${growthCount} 条成长记录, ${relationshipCount} 条关系更新`)
  } catch (error) {
    console.warn('[PostProcess] 角色成长追踪失败（非致命）:', error)
  }
}

export async function step9EntityConflictDetect(env: Env, chapterId: string, novelId: string): Promise<void> {
  try {
    const { candidateCount, conflictCount, metrics } = await detectEntityConflicts(env, chapterId, novelId)
    console.log(`⚔️ [PostProcess] 实体碰撞检测完成: ${candidateCount} 个候选, ${conflictCount} 个确认矛盾`)

    await logGeneration(env, {
      novelId,
      chapterId,
      stage: 'entity_conflict_detection',
      modelId: metrics?.modelId || 'N/A',
      promptTokens: metrics?.usage?.prompt_tokens || 0,
      completionTokens: metrics?.usage?.completion_tokens || 0,
      durationMs: metrics?.durationMs || 0,
      status: 'success',
      contextSnapshot: JSON.stringify({ candidateCount, conflictCount }),
    })
  } catch (error) {
    console.warn('[PostProcess] 实体碰撞检测失败（非致命）:', error)

    await logGeneration(env, {
      novelId,
      chapterId,
      stage: 'entity_conflict_detection',
      modelId: 'N/A',
      durationMs: 0,
      status: 'error',
      errorMsg: (error as Error).message,
    })
  }
}
