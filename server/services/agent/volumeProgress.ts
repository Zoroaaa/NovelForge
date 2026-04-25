/**
 * @file volumeProgress.ts
 * @description Agent卷完成程度检查（AI评估模式）
 */
import { drizzle } from 'drizzle-orm/d1'
import { chapters, novels, volumes as volumesTable } from '../../db/schema'
import { eq, sql, and, desc } from 'drizzle-orm'
import type { Env } from '../../lib/types'
import { resolveConfig, generate } from '../llm'
import { ERROR_MESSAGES, JSON_OUTPUT_PROMPT } from './constants'

export interface VolumeProgressResult {
  volumeId: string
  currentChapter: number
  targetChapter: number | null
  currentWordCount: number
  targetWordCount: number | null
  chapterProgress: number
  wordProgress: number
  healthStatus: 'healthy' | 'ahead' | 'behind' | 'critical'
  risk: 'early_ending' | 'late_ending' | null
  suggestion: string
  raw?: string
}

export async function checkVolumeProgress(
  env: Env,
  chapterId: string,
  novelId: string
): Promise<VolumeProgressResult> {
  const db = drizzle(env.DB)

  const chapter = await db.select({
    id: chapters.id,
    volumeId: chapters.volumeId,
    sortOrder: chapters.sortOrder,
    title: chapters.title,
    novelId: chapters.novelId,
  }).from(chapters).where(eq(chapters.id, chapterId)).get()

  if (!chapter || !chapter.volumeId) {
    throw new Error('章节不存在或未关联卷')
  }

  const [volumeData, novelData, currentChapterInVolumeResult] = await Promise.all([
    db.select({
      id: volumesTable.id,
      title: volumesTable.title,
      targetChapterCount: volumesTable.targetChapterCount,
      chapterCount: volumesTable.chapterCount,
      targetWordCount: volumesTable.targetWordCount,
      wordCount: volumesTable.wordCount,
    }).from(volumesTable).where(eq(volumesTable.id, chapter.volumeId)).get(),

    db.select({
      targetWordCount: novels.targetWordCount,
      wordCount: novels.wordCount,
    }).from(novels).where(eq(novels.id, novelId)).get(),

    db.select({ count: sql`count(*)` })
      .from(chapters)
      .where(and(
        eq(chapters.volumeId, chapter.volumeId),
        sql`${chapters.sortOrder} <= ${chapter.sortOrder}`
      ))
      .get(),
  ])

  if (!volumeData) {
    throw new Error(ERROR_MESSAGES.VOLUME_NOT_FOUND)
  }

  const currentChapterInVolume = Number(currentChapterInVolumeResult?.count ?? 0)
  const targetChapter = volumeData.targetChapterCount
  const targetWordCount = volumeData.targetWordCount

  let analysisConfig
  try {
    analysisConfig = await resolveConfig(db, 'analysis', novelId)
    analysisConfig.apiKey = analysisConfig.apiKey || ''
  } catch {
    return {
      volumeId: chapter.volumeId,
      currentChapter: currentChapterInVolume,
      targetChapter: targetChapter,
      currentWordCount: volumeData.wordCount,
      targetWordCount: targetWordCount,
      chapterProgress: targetChapter ? (currentChapterInVolume / targetChapter) * 100 : 0,
      wordProgress: targetWordCount ? (volumeData.wordCount / targetWordCount) * 100 : 0,
      healthStatus: 'healthy',
      risk: null,
      suggestion: ERROR_MESSAGES.MODEL_NOT_CONFIGED('智能分析') + '（用于卷完成度检查）',
    }
  }

  const checkPrompt = `你是一个小说卷完成程度评估助手。请根据以下数据评估当前卷的进度是否健康。

【卷信息】
- 卷标题：${volumeData.title}
- 当前章节：第 ${currentChapterInVolume} 章 / 共 ${volumeData.chapterCount} 章
- 目标章节数：${targetChapter || '未设定'}
- 当前字数：${volumeData.wordCount} 字
- 目标字数：${targetWordCount || '未设定'}
- 当前章节标题：${chapter.title}

【评估标准】
1. 健康范围：
   - 章节进度偏差：目标章节数 ±5章（如目标70章，65-75章范围内收尾算正常）
   - 字数进度偏差：目标字数 ±15%
2. 风险判断：
   - early_ending：当前章节已接近或超过目标，可能提前收尾
   - late_ending：按当前节奏推算会大幅超出目标，可能延期收尾
3. 整体评估要考虑小说创作的灵活性，允许一定幅度的偏差

请以JSON格式输出评估结果：
{
  "healthStatus": "healthy|ahead|behind|critical",
  "risk": "early_ending|late_ending|null",
  "suggestion": "详细的评估建议和调整意见（中文，50-200字）"
}

healthStatus 说明：
- healthy：进度正常，在合理范围内
- ahead：进度稍快，但风险可控
- behind：进度偏慢，需要关注
- critical：严重偏离规划，需要立即调整`

  const overrideConfig = {
    ...analysisConfig,
    params: { ...(analysisConfig.params || {}), temperature: 0.3, max_tokens: 800 },
  }

  const { text } = await generate(overrideConfig, [
    { role: 'system', content: JSON_OUTPUT_PROMPT },
    { role: 'user', content: checkPrompt },
  ])

  try {
    const aiResult = JSON.parse(text)
    const chapterProgress = targetChapter ? (currentChapterInVolume / targetChapter) * 100 : 0
    const wordProgress = targetWordCount ? (volumeData.wordCount / targetWordCount) * 100 : 0

    return {
      volumeId: chapter.volumeId,
      currentChapter: currentChapterInVolume,
      targetChapter: targetChapter,
      currentWordCount: volumeData.wordCount,
      targetWordCount: targetWordCount,
      chapterProgress: Math.round(chapterProgress * 10) / 10,
      wordProgress: Math.round(wordProgress * 10) / 10,
      healthStatus: aiResult.healthStatus || 'healthy',
      risk: aiResult.risk || null,
      suggestion: aiResult.suggestion || '无法获取AI评估建议',
      raw: text,
    }
  } catch {
    const chapterProgress = targetChapter ? (currentChapterInVolume / targetChapter) * 100 : 0
    const wordProgress = targetWordCount ? (volumeData.wordCount / targetWordCount) * 100 : 0

    return {
      volumeId: chapter.volumeId,
      currentChapter: currentChapterInVolume,
      targetChapter: targetChapter,
      currentWordCount: volumeData.wordCount,
      targetWordCount: targetWordCount,
      chapterProgress: Math.round(chapterProgress * 10) / 10,
      wordProgress: Math.round(wordProgress * 10) / 10,
      healthStatus: 'healthy',
      risk: null,
      suggestion: 'AI评估解析失败',
      raw: text,
    }
  }
}
