/**
 * @file volumeProgress.ts
 * @description Agent卷完成程度检查（字数风险 + 节奏风险双重判断）
 */
import { drizzle } from 'drizzle-orm/d1'
import { chapters, novels, volumes as volumesTable } from '../../db/schema'
import { eq, sql, and, asc } from 'drizzle-orm'
import type { Env } from '../../lib/types'
import { resolveConfig, generate, streamGenerate } from '../llm'
import { ERROR_MESSAGES, JSON_OUTPUT_PROMPT } from './constants'

export interface WordCountIssue {
  chapterNumber: number
  chapterTitle: string
  expectedWords: number
  actualWords: number
  deviationPct: number
  severity: 'warning' | 'error'
  message: string
}

export interface RhythmIssue {
  chapterNumber: number
  chapterTitle: string
  dimension: string
  deviation: string
  severity: 'warning' | 'error'
  suggestion: string
}

export interface VolumeProgressResult {
  volumeId: string
  currentChapter: number
  targetChapter: number | null
  currentWordCount: number
  targetWordCount: number | null
  chapterProgress: number
  wordProgress: number
  perChapterEstimate: number | null
  wordCountIssues: WordCountIssue[]
  rhythmIssues: RhythmIssue[]
  wordCountScore: number
  rhythmScore: number
  score: number
  diagnosis: string
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

  const volumeData = await db.select({
    id: volumesTable.id,
    title: volumesTable.title,
    targetChapterCount: volumesTable.targetChapterCount,
    chapterCount: volumesTable.chapterCount,
    targetWordCount: volumesTable.targetWordCount,
    wordCount: volumesTable.wordCount,
    blueprint: volumesTable.blueprint,
    eventLine: volumesTable.eventLine,
  }).from(volumesTable).where(eq(volumesTable.id, chapter.volumeId)).get()

  if (!volumeData) {
    throw new Error(ERROR_MESSAGES.VOLUME_NOT_FOUND)
  }

  const currentChapterInVolume = await db
    .select({ count: sql`count(*)` })
    .from(chapters)
    .where(and(
      eq(chapters.volumeId, chapter.volumeId),
      sql`${chapters.sortOrder} <= ${chapter.sortOrder}`
    ))
    .get()

  const completedChapters = await db
    .select({
      id: chapters.id,
      sortOrder: chapters.sortOrder,
      title: chapters.title,
      wordCount: chapters.wordCount,
      summary: chapters.summary,
    })
    .from(chapters)
    .where(and(
      eq(chapters.volumeId, chapter.volumeId),
      sql`${chapters.sortOrder} <= ${chapter.sortOrder}`
    ))
    .orderBy(asc(chapters.sortOrder))
    .all()

  const targetChapter = volumeData.targetChapterCount
  const targetWordCount = volumeData.targetWordCount
  const hasChapterTarget = targetChapter != null && targetChapter > 0
  const hasWordTarget = targetWordCount != null && targetWordCount > 0

  const chapterProgress = hasChapterTarget && targetChapter > 0
    ? (completedChapters.length / targetChapter) * 100
    : 0
  const wordProgress = hasWordTarget && targetWordCount > 0
    ? ((volumeData.wordCount || 0) / targetWordCount) * 100
    : 0
  const perChapterEstimate = hasChapterTarget && hasWordTarget
    ? targetWordCount / targetChapter
    : null

  let analysisConfig
  try {
    analysisConfig = await resolveConfig(db, 'analysis', novelId)
    analysisConfig.apiKey = analysisConfig.apiKey || ''
  } catch {
    return {
      volumeId: chapter.volumeId,
      currentChapter: completedChapters.length,
      targetChapter: targetChapter,
      currentWordCount: volumeData.wordCount || 0,
      targetWordCount: targetWordCount,
      chapterProgress: Math.round(chapterProgress * 10) / 10,
      wordProgress: Math.round(wordProgress * 10) / 10,
      perChapterEstimate,
      wordCountIssues: [],
      rhythmIssues: [],
      wordCountScore: 100,
      rhythmScore: 100,
      score: 100,
      diagnosis: '无法进行AI评估（模型未配置）',
      suggestion: '请配置智能分析模型以获取卷进度诊断',
    }
  }

  const overrideConfig = {
    ...analysisConfig,
    params: { ...(analysisConfig.params || {}), temperature: 0.3, max_tokens: 1500 },
  }

  // ============================================================
  // 字数风险判断（整卷宏观统计）
  // ============================================================
  const wordCountIssues: WordCountIssue[] = []
  if (perChapterEstimate && completedChapters.length > 0 && hasWordTarget) {
    const totalActualWords = volumeData.wordCount || 0
    const totalExpectedWords = completedChapters.length * perChapterEstimate
    const deviationPct = totalExpectedWords > 0
      ? Math.abs(totalActualWords - totalExpectedWords) / totalExpectedWords * 100
      : 0

    if (deviationPct > 20) {
      const isOver = totalActualWords > totalExpectedWords
      wordCountIssues.push({
        chapterNumber: completedChapters.length,
        chapterTitle: `全卷共${completedChapters.length}章`,
        expectedWords: Math.round(totalExpectedWords),
        actualWords: totalActualWords,
        deviationPct: Math.round(deviationPct),
        severity: 'error',
        message: isOver
          ? `全卷字数${totalActualWords.toLocaleString()}字，比预期多${Math.round(deviationPct - 20)}%，内容可能过于冗余，建议精简`
          : `全卷字数${totalActualWords.toLocaleString()}字，比预期少${Math.round(deviationPct - 20)}%，内容可能过于单薄，建议丰富`,
      })
    } else if (deviationPct > 15) {
      const isOver = totalActualWords > totalExpectedWords
      wordCountIssues.push({
        chapterNumber: completedChapters.length,
        chapterTitle: `全卷共${completedChapters.length}章`,
        expectedWords: Math.round(totalExpectedWords),
        actualWords: totalActualWords,
        deviationPct: Math.round(deviationPct),
        severity: 'warning',
        message: isOver
          ? `全卷字数${totalActualWords.toLocaleString()}字，超出预期${Math.round(deviationPct)}%，建议适当精简`
          : `全卷字数${totalActualWords.toLocaleString()}字，低于预期${Math.round(deviationPct)}%，建议适当丰富`,
      })
    }
  }

  const errorWordCountIssues = wordCountIssues.filter(i => i.severity === 'error').length
  const warningWordCountIssues = wordCountIssues.filter(i => i.severity === 'warning').length
  const wordCountScore = Math.max(0, 100 - errorWordCountIssues * 15 - warningWordCountIssues * 5)

  // ============================================================
  // 节奏风险判断（需要章节摘要 + 卷蓝图/事件线）
  // ============================================================
  const rhythmIssues: RhythmIssue[] = []
  const chaptersWithSummary = completedChapters.filter(ch => ch.summary && ch.summary.trim().length > 10)
  const hasBlueprint = volumeData.blueprint && volumeData.blueprint.trim().length > 10
  const hasEventLine = volumeData.eventLine && volumeData.eventLine.trim().length > 10

  if (chaptersWithSummary.length >= 1 && (hasBlueprint || hasEventLine)) {
    const recentChapters = chaptersWithSummary.slice(-5)
    const summariesText = recentChapters
      .map(ch => `【第${ch.sortOrder + 1}章 "${ch.title}" 摘要】\n${ch.summary}`)
      .join('\n\n')

    const eventLineContext = hasEventLine
      ? `\n【卷事件线】\n${volumeData.eventLine}`
      : '\n【卷事件线】未设定'

    const blueprintContext = hasBlueprint
      ? `\n【卷蓝图】\n${volumeData.blueprint}`
      : '\n【卷蓝图】未设定'

    const rhythmPrompt = `你是小说节奏健康诊断专家。请对比各章节摘要与卷纲的吻合度，识别节奏偏离问题。

【诊断维度】（每个章节摘要包含以下四维度）：
- 角色状态变化：角色境界突破、能力获得、属性变化
- 关键事件：主线剧情的起因、过程、结果
- 道具/功法：新出现或使用的道具、功法、丹药
- 章末状态：主角位置、处境、下一步方向

${eventLineContext}
${blueprintContext}

【待诊断章节摘要】
${summariesText}

【节奏偏离判断标准】：
- 章节摘要的四维度内容与对应位置的事件线描述明显不符（事件对不上/角色状态对不上）
- 关键道具/功法在该出现的位置没有出现，或不该出现时出现了
- 章末状态与蓝图设定的情节走向严重偏离

【严重程度划分】：
- warning（注意）：连续1-2章出现轻度偏离，表现为某维度描述与卷纲略有出入
- error（建议重写）：连续3章以上出现明显偏离，或单章内多个维度同时偏离卷纲

请以JSON格式输出：
{
  "issues": [
    {
      "chapterNumber": 5,
      "chapterTitle": "章节标题",
      "dimension": "角色状态变化|关键事件|道具/功法|章末状态",
      "deviation": "偏离的具体描述",
      "severity": "warning|error",
      "suggestion": "调整建议，10-20字"
    }
  ],
  "rhythmDiagnosis": "整体节奏健康状况的一句话总结",
  "rhythmSuggestion": "如果有问题，给出接下来3-5章的调整方向；没问题则返回'节奏良好'，不超过80字"
}`

    try {
      const { text } = await generate(overrideConfig, [
        { role: 'system', content: JSON_OUTPUT_PROMPT },
        { role: 'user', content: rhythmPrompt },
      ])

      const aiResult = JSON.parse(text)
      if (aiResult.issues && Array.isArray(aiResult.issues)) {
        for (const issue of aiResult.issues) {
          rhythmIssues.push({
            chapterNumber: issue.chapterNumber,
            chapterTitle: issue.chapterTitle || '',
            dimension: issue.dimension || '未知',
            deviation: issue.deviation || '',
            severity: issue.severity === 'error' ? 'error' : 'warning',
            suggestion: issue.suggestion || '',
          })
        }
      }
    } catch {
      // AI解析失败，跳过节奏检查
    }
  } else if (completedChapters.length > 0 && !hasBlueprint && !hasEventLine) {
    // 没有卷纲数据，只报告统计信息
  }

  const errorRhythmIssues = rhythmIssues.filter(i => i.severity === 'error').length
  const warningRhythmIssues = rhythmIssues.filter(i => i.severity === 'warning').length
  const rhythmScore = Math.max(0, 100 - errorRhythmIssues * 20 - warningRhythmIssues * 5)

  const totalScore = Math.round((wordCountScore + rhythmScore) / 2)

  // ============================================================
  // 生成综合诊断和建议
  // ============================================================
  const totalIssues = wordCountIssues.length + rhythmIssues.length
  const diagnosisParts: string[] = []
  if (wordCountIssues.length > 0) {
    diagnosisParts.push(`字数风险：${wordCountIssues.length}章偏离正常范围（${errorWordCountIssues}个严重，${warningWordCountIssues}个轻微）`)
  }
  if (rhythmIssues.length > 0) {
    diagnosisParts.push(`节奏风险：${rhythmIssues.length}章偏离卷纲（${errorRhythmIssues}个严重，${warningRhythmIssues}个轻微）`)
  }
  if (totalIssues === 0) {
    diagnosisParts.push('字数和节奏均在健康范围内')
  }

  const diagnosisText = diagnosisParts.join('；')

  let suggestionText = ''
  if (errorWordCountIssues > 0 && errorRhythmIssues > 0) {
    suggestionText = `字数和节奏双重风险，建议优先调整第${Math.min(...wordCountIssues.filter(i => i.severity === 'error').map(i => i.chapterNumber))}章，并检查卷纲是否需要更新`
  } else if (errorWordCountIssues > 0) {
    const firstError = wordCountIssues.find(i => i.severity === 'error')!
    suggestionText = firstError.actualWords > firstError.expectedWords
      ? `第${firstError.chapterNumber}章字数偏多，建议精简描写、控制节奏`
      : `第${firstError.chapterNumber}章字数偏少，建议丰富场景细节、增加情节铺垫`
  } else if (errorRhythmIssues > 0) {
    suggestionText = `第${Math.min(...rhythmIssues.filter(i => i.severity === 'error').map(i => i.chapterNumber))}章起出现连续偏离，建议重写相关章节或调整卷纲`
  } else if (warningWordCountIssues > 0) {
    suggestionText = `${warningWordCountIssues}章字数略偏，建议适当平衡各章内容量`
  } else if (warningRhythmIssues > 0) {
    suggestionText = `${warningRhythmIssues}章情节走向与卷纲略有出入，注意保持叙事一致性`
  } else if (totalIssues === 0) {
    suggestionText = '继续保持当前节奏，按卷纲计划推进'
  } else {
    suggestionText = '请参考各项问题提示进行微调'
  }

  return {
    volumeId: chapter.volumeId,
    currentChapter: completedChapters.length,
    targetChapter: targetChapter,
    currentWordCount: volumeData.wordCount || 0,
    targetWordCount: targetWordCount,
    chapterProgress: Math.round(chapterProgress * 10) / 10,
    wordProgress: Math.round(wordProgress * 10) / 10,
    perChapterEstimate: perChapterEstimate ? Math.round(perChapterEstimate) : null,
    wordCountIssues,
    rhythmIssues,
    wordCountScore,
    rhythmScore,
    score: totalScore,
    diagnosis: diagnosisText,
    suggestion: suggestionText,
  }
}

export async function repairChapterByVolumeIssues(
  env: Env,
  chapterId: string,
  novelId: string,
  wordCountIssues: Array<{ chapterNumber: number; chapterTitle: string; message: string }>,
  rhythmIssues: Array<{ chapterNumber: number; chapterTitle: string; dimension: string; deviation: string; suggestion: string }>,
  volumeProgressContext: string
): Promise<{ ok: boolean; repairedContent?: string; error?: string }> {
  const db = drizzle(env.DB)

  try {
    const chapter = await db
      .select({ content: chapters.content, title: chapters.title, volumeId: chapters.volumeId })
      .from(chapters)
      .where(eq(chapters.id, chapterId))
      .get()

    if (!chapter?.content) return { ok: false, error: ERROR_MESSAGES.CHAPTER_CONTENT_NOT_FOUND }

    const volume = chapter.volumeId
      ? await db.select({ title: volumesTable.title, targetChapterCount: volumesTable.targetChapterCount, targetWordCount: volumesTable.targetWordCount }).from(volumesTable).where(eq(volumesTable.id, chapter.volumeId)).get()
      : null

    let llmConfig
    try {
      llmConfig = await resolveConfig(db, 'chapter_gen', novelId)
      llmConfig.apiKey = llmConfig.apiKey || ''
    } catch {
      return { ok: false, error: ERROR_MESSAGES.MODEL_CONFIG_NOT_FOUND }
    }

    const wcIssueList = wordCountIssues.map((w, idx) => `${idx + 1}. ${w.message}`).join('\n')
    const rhIssueList = rhythmIssues.map((r, idx) => `${idx + 1}. 第${r.chapterNumber}章"${r.chapterTitle}"的${r.dimension}：${r.deviation}\n   建议：${r.suggestion}`).join('\n\n')

    const messages = [
      {
        role: 'system' as const,
        content: `你是专业的小说修改编辑。根据卷完成度检查报告对章节进行针对性修改。
修改原则：
- 只修改有问题的部分，其余内容保持不变
- 修改后字数与原文相近（允许±10%）
- 不改变核心情节走向和结尾状态
- 重点修正节奏偏离卷纲的问题
- 直接输出完整修改后的正文，不要任何解释`,
      },
      {
        role: 'user' as const,
        content: `章节《${chapter.title}》检测到卷完成度问题，请根据问题列表修改。

【卷信息】${volume ? `卷名：《${volume.title}》，目标${volume.targetChapterCount}章/${volume.targetWordCount}字` : '无卷信息'}

【字数风险】
${wcIssueList || '无'}

【节奏风险】
${rhIssueList || '无'}

【卷完成度诊断】
${volumeProgressContext}

【原文内容】
${chapter.content}

请直接输出修改后的完整正文：`,
      },
    ]

    let repairedContent = ''
    await streamGenerate(llmConfig, messages as any, {
      onChunk: (text) => { repairedContent += text },
      onToolCall: () => {},
      onDone: () => {},
      onError: (err) => { throw err },
    })

    if (!repairedContent.trim()) return { ok: false, error: ERROR_MESSAGES.REPAIR_PRODUCED_EMPTY }

    await db.update(chapters)
      .set({
        content: repairedContent,
        wordCount: repairedContent.length,
        updatedAt: sql`(unixepoch())`,
      })
      .where(eq(chapters.id, chapterId))

    return { ok: true, repairedContent }
  } catch (error) {
    console.error('[repairChapterByVolumeIssues] failed:', error)
    return { ok: false, error: (error as Error).message }
  }
}
