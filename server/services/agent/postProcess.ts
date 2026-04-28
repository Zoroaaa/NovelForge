/**
 * @file postProcess.ts
 * @description 章节后处理统一入口
 *
 * 将 generation.ts（同步模式）和 queue-handler.ts（队列模式）的
 * 章节后处理逻辑统一到此处，避免两条路径独立维护导致步骤遗漏。
 */
import { drizzle } from 'drizzle-orm/d1'
import { chapters, characters } from '../../db/schema'
import { eq, and, sql } from 'drizzle-orm'
import type { Env } from '../../lib/types'
import { triggerAutoSummary } from './summarizer'
import { extractForeshadowingFromChapter } from '../foreshadowing'
import { detectPowerLevelBreakthrough } from '../powerLevel'
import { checkCharacterConsistency } from './consistency'
import { checkChapterCoherence } from './coherence'
import { checkVolumeProgress } from './volumeProgress'
import { saveCheckLog } from './checkLogService'
import { logGeneration } from './logging'

export interface PostProcessPayload {
  chapterId: string
  novelId: string
  enableAutoSummary: boolean
  usage: { prompt_tokens: number; completion_tokens: number }
}

export async function runPostProcess(env: Env, payload: PostProcessPayload): Promise<void> {
  const { chapterId, novelId, enableAutoSummary, usage } = payload

  await step1AutoSummary(env, chapterId, novelId, enableAutoSummary, usage)
  await step2Foreshadowing(env, chapterId, novelId)
  await step3PowerLevel(env, chapterId, novelId)
  await step4CharacterConsistency(env, chapterId, novelId)
  await step5Coherence(env, chapterId, novelId)
  await step6VolumeProgress(env, chapterId, novelId)
}

async function step1AutoSummary(
  env: Env,
  chapterId: string,
  novelId: string,
  enableAutoSummary: boolean,
  usage: { prompt_tokens: number; completion_tokens: number }
): Promise<void> {
  if (!enableAutoSummary) return

  try {
    await triggerAutoSummary(env, chapterId, novelId, usage)
    console.log(`✅ [PostProcess] 自动摘要完成 for chapter ${chapterId}`)

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

async function step2Foreshadowing(env: Env, chapterId: string, novelId: string): Promise<void> {
  try {
    const foreshadowingResult = await extractForeshadowingFromChapter(env, chapterId, novelId)
    console.log(`📝 [PostProcess] 伏笔提取: ${foreshadowingResult.newForeshadowing.length} 个新伏笔, ${foreshadowingResult.resolvedForeshadowingIds.length} 个已解决`)

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
