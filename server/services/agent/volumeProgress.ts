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
  diagnosis?: string
  raw?: string
  score: number
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
      score: 100,
    }
  }

  const chapterProgressPct = targetChapter ? Math.round((currentChapterInVolume / targetChapter) * 100) : null
  const wordProgressPct = targetWordCount ? Math.round(((volumeData.wordCount || 0) / targetWordCount) * 100) : null

  const checkPrompt = `你是小说卷进度评估助手。请根据数据评估当前卷的创作进度并给出具体建议。

【卷数据】
卷标题：${volumeData.title}
章节进度：第${currentChapterInVolume}章 / 目标${targetChapter || '未设定'}章（${chapterProgressPct !== null ? chapterProgressPct + '%' : '无法计算'}）
字数进度：${volumeData.wordCount || 0}字 / 目标${targetWordCount || '未设定'}字（${wordProgressPct !== null ? wordProgressPct + '%' : '无法计算'}）
当前章节：《${chapter.title}》

【健康状态判断标准】
- healthy：章节进度和字数进度均在目标的85%-110%范围内
- ahead：进度超过目标110%，有提前收尾风险
- behind：进度低于目标70%，有拖延收尾风险
- critical：进度超过目标130%或低于50%，需要立即调整

【风险判断】
- early_ending：当前章节进度≥90%但字数进度<80%，说明情节铺展过快，可能提前耗尽内容
- late_ending：当前章节进度<60%但字数进度≥80%，说明字数已消耗较多但情节推进缓慢

请以JSON格式输出：
{
  "healthStatus": "healthy|ahead|behind|critical",
  "risk": "early_ending|late_ending|null",
  "diagnosis": "当前进度的问题诊断，1-2句话说明哪里出了偏差",
  "suggestion": "接下来3-5章的具体调整建议，如：加快情节推进/增加场景细节/压缩某类描写，60-100字"
}`

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
    const healthStatus = aiResult.healthStatus || 'healthy'
    const risk = aiResult.risk || null

    const statusDeduction: Record<string, number> = {
      healthy: 0,
      ahead: 10,
      behind: 30,
      critical: 50,
    }
    const score = Math.max(0, 100 - (statusDeduction[healthStatus] || 0) - (risk ? 10 : 0))

    return {
      volumeId: chapter.volumeId,
      currentChapter: currentChapterInVolume,
      targetChapter: targetChapter,
      currentWordCount: volumeData.wordCount,
      targetWordCount: targetWordCount,
      chapterProgress: Math.round(chapterProgress * 10) / 10,
      wordProgress: Math.round(wordProgress * 10) / 10,
      healthStatus,
      risk,
      diagnosis: aiResult.diagnosis || '',
      suggestion: aiResult.suggestion || '无法获取AI评估建议',
      raw: text,
      score,
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
      score: 100,
    }
  }
}
