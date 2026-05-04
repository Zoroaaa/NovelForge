/**
 * @file qualityCheck.ts
 * @description Agent章节质量评分服务 - 多维度评估章节质量（内容完整性/连贯性/一致性）
 * @date 2026-05-04
 */
import { drizzle } from 'drizzle-orm/d1'
import { qualityScores, chapters, characters, foreshadowing } from '../../db/schema'
import { eq, and, sql, isNull } from 'drizzle-orm'
import type { Env } from '../../lib/types'
import { resolveConfig, generateWithMetrics } from '../llm'
import type { LLMCallResult } from '../llm'

export interface QualityScoreResult {
  totalScore: number
  plotScore: number
  consistencyScore: number
  foreshadowingScore: number
  pacingScore: number
  fluencyScore: number
  details: Record<string, any>
  metrics?: LLMCallResult
}

function genId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(8)))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

export async function checkQuality(
  env: Env,
  data: { chapterId: string; novelId: string }
): Promise<QualityScoreResult> {
  const db = drizzle(env.DB)
  const { chapterId, novelId } = data

  const chapter = await db.select({ content: chapters.content, title: chapters.title }).from(chapters).where(eq(chapters.id, chapterId)).get()
  if (!chapter?.content) throw new Error('章节内容为空')

  let analysisConfig
  try {
    analysisConfig = await resolveConfig(db, 'analysis', novelId)
    analysisConfig.apiKey = analysisConfig.apiKey || ''
  } catch {
    return createDefaultResult()
  }

  const charList = await db.select({ name: characters.name, role: characters.role })
    .from(characters).where(eq(characters.novelId, novelId)).limit(10).all()

  const foreshadowList = await db.select({ title: foreshadowing.title, status: foreshadowing.status })
    .from(foreshadowing).where(and(eq(foreshadowing.novelId, novelId), isNull(foreshadowing.deletedAt))).limit(20).all()

  const contentPreview = chapter.content.slice(0, 8000)

  const prompt = `请对以下小说章节进行多维度质量评分（0-100分）。

【章节信息】
标题：${chapter.title}
内容：
${contentPreview}

【角色列表】
${charList.map(c => `- ${c.name}（${c.role}）`).join('\n') || '无'}

【伏笔列表】
${foreshadowList.map(f => `- ${f.title} [${f.status}]`).join('\n') || '无'}

【评分维度说明】
1. plot_score（情节推进度）：本章是否有实质性的情节发展？是否有冲突/转折/高潮？
2. consistency_score（人物一致性）：角色行为是否符合其性格设定？对话是否自然？
3. foreshadowing_score（伏笔遵守度）：是否合理推进或回收了伏笔？有无矛盾？
4. pacing_score（节奏密度）：叙事节奏是否合理？信息密度如何？爽感/期待感？
5. fluency_score（文笔流畅度）：文字表达是否流畅？描写质量如何？

请以JSON格式输出评分结果：
{
  "total_score": 0-100,
  "plot_score": 0-100,
  "consistency_score": 0-100,
  "foreshadowing_score": 0-100,
  "pacing_score": 0-100,
  "fluency_score": 0-100,
  "details": {
    "plot_comment": "情节维度简评",
    "consistency_comment": "人物维度简评",
    "foreshadowing_comment": "伏笔维度简评",
    "pacing_comment": "节奏维度简评",
    "fluency_comment": "文笔维度简评"
  }
}`

  const overrideConfig = {
    ...analysisConfig,
    params: { ...(analysisConfig.params || {}), temperature: 0.3, max_tokens: 800 },
  }

  const metrics = await generateWithMetrics(overrideConfig, [
    { role: 'system', content: '你是专业的小说质量评审。请严格按JSON格式输出，分数范围0-100，评价客观公正。' },
    { role: 'user', content: prompt },
  ])

  const { text } = metrics

  let result: QualityScoreResult
  try {
    const parsed = JSON.parse(text)
    result = {
      totalScore: Math.min(100, Math.max(0, Number(parsed.total_score ?? 60))),
      plotScore: Math.min(100, Math.max(0, Number(parsed.plot_score ?? 60))),
      consistencyScore: Math.min(100, Math.max(0, Number(parsed.consistency_score ?? 60))),
      foreshadowingScore: Math.min(100, Math.max(0, Number(parsed.foreshadowing_score ?? 60))),
      pacingScore: Math.min(100, Math.max(0, Number(parsed.pacing_score ?? 60))),
      fluencyScore: Math.min(100, Math.max(0, Number(parsed.fluency_score ?? 60))),
      details: parsed.details || {},
      metrics,
    }
  } catch {
    result = { ...createDefaultResult(), metrics }
  }

  const now = Math.floor(Date.now() / 1000)

  const existing = await db.select().from(qualityScores).where(eq(qualityScores.chapterId, chapterId)).get()
  if (existing) {
    await db.update(qualityScores)
      .set({
        totalScore: result.totalScore,
        plotScore: result.plotScore,
        consistencyScore: result.consistencyScore,
        foreshadowingScore: result.foreshadowingScore,
        pacingScore: result.pacingScore,
        fluencyScore: result.fluencyScore,
        details: JSON.stringify(result.details),
      })
      .where(eq(qualityScores.chapterId, chapterId))
  } else {
    await db.insert(qualityScores).values({
      id: genId(),
      novelId,
      chapterId,
      totalScore: result.totalScore,
      plotScore: result.plotScore,
      consistencyScore: result.consistencyScore,
      foreshadowingScore: result.foreshadowingScore,
      pacingScore: result.pacingScore,
      fluencyScore: result.fluencyScore,
      details: JSON.stringify(result.details),
      createdAt: now,
    })
  }

  return result
}

function createDefaultResult(): QualityScoreResult {
  return {
    totalScore: 60,
    plotScore: 60,
    consistencyScore: 60,
    foreshadowingScore: 60,
    pacingScore: 60,
    fluencyScore: 60,
    details: {},
    metrics: undefined,
  }
}
