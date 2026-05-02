/**
 * @file entityConflict.ts
 * @description 跨章一致性：step9 实体碰撞检测服务
 *   基于精确匹配快速筛查 + LLM 语义判断，检测新生成内容与历史记录的矛盾。
 *   检测结果写入 entity_conflict_log 表。
 */
import { drizzle } from 'drizzle-orm/d1'
import { eq, and, desc, sql } from 'drizzle-orm'
import {
  chapters,
  novelInlineEntities,
  entityStateLog,
  entityConflictLog,
  characterGrowthLog,
} from '../../db/schema'
import type { Env } from '../../lib/types'
import type { EntityExtractResult } from './entityExtract'
import { resolveConfig, generateWithMetrics } from '../llm'
import { JSON_OUTPUT_PROMPT, LOG_STYLES } from './constants'

interface ConflictCandidate {
  entityName: string
  entityType: string
  sourceType: string
  sourceId: string
  currentExcerpt: string
  historicalRecord: string
  historicalChapterOrder: number
  conflictType: string
}

interface LLMJudgedConflict {
  entityName: string
  conflictType: string
  description: string
  severity: string
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function findTextExcerpt(content: string, keyword: string, radius: number = 200): string {
  const index = content.indexOf(keyword)
  if (index === -1) return ''
  const start = Math.max(0, index - radius)
  const end = Math.min(content.length, index + keyword.length + radius)
  return `...${content.slice(start, end)}...`
}

async function exactMatchDetection(
  db: ReturnType<typeof drizzle>,
  novelId: string,
  chapterId: string,
  chapterOrder: number,
  chapterContent: string,
): Promise<ConflictCandidate[]> {
  const candidates: ConflictCandidate[] = []

  const entities = await db
    .select({
      id: novelInlineEntities.id,
      name: novelInlineEntities.name,
      entityType: novelInlineEntities.entityType,
      description: novelInlineEntities.description,
    })
    .from(novelInlineEntities)
    .where(and(
      eq(novelInlineEntities.novelId, novelId),
      sql`${novelInlineEntities.deletedAt} IS NULL`,
    ))

  for (const entity of entities) {
    if (!chapterContent.includes(entity.name)) continue

    const stateHistory = await db
      .select({
        stateType: entityStateLog.stateType,
        currState: entityStateLog.currState,
        stateSummary: entityStateLog.stateSummary,
        chapterOrder: entityStateLog.chapterOrder,
      })
      .from(entityStateLog)
      .where(and(
        eq(entityStateLog.novelId, novelId),
        eq(entityStateLog.entityName, entity.name),
      ))
      .orderBy(desc(entityStateLog.chapterOrder))
      .limit(3)

    if (stateHistory.length === 0) continue

    const latestState = stateHistory[0]
    const keywordInContent = chapterContent.includes(latestState.currState)

    if (!keywordInContent) {
      candidates.push({
        entityName: entity.name,
        entityType: entity.entityType,
        sourceType: 'inline_entity',
        sourceId: entity.id,
        currentExcerpt: findTextExcerpt(chapterContent, entity.name),
        historicalRecord: `最近状态记录：${latestState.stateType}=${latestState.currState}（第${latestState.chapterOrder}章）`,
        historicalChapterOrder: latestState.chapterOrder,
        conflictType: 'state_mismatch',
      })
    }
  }

  return candidates
}

async function llmJudgeConflicts(
  env: Env,
  novelId: string,
  chapterContent: string,
  candidates: ConflictCandidate[],
): Promise<LLMJudgedConflict[]> {
  if (candidates.length === 0) return []

  const db = drizzle(env.DB)

  let judgeConfig
  try {
    judgeConfig = await resolveConfig(db, 'analysis', novelId)
    judgeConfig.apiKey = judgeConfig.apiKey || ''
  } catch {
    LOG_STYLES.WARN('[step9] 未配置分析模型，跳过LLM判断，全部候选视为矛盾')
    return candidates.map(c => ({
      entityName: c.entityName,
      conflictType: c.conflictType,
      description: `精确匹配检测到可能矛盾：${c.historicalRecord}`,
      severity: 'warning',
    }))
  }

  const candidateDesc = candidates.map((c, i) =>
    `【候选${i + 1}】\n实体名：${c.entityName}\n类型：${c.entityType}\n历史记录：${c.historicalRecord}\n当前章节片段：${c.currentExcerpt.slice(0, 300)}`
  ).join('\n\n')

  const systemPrompt = `${JSON_OUTPUT_PROMPT}

你是一个专业的小说矛盾检测助手。请判断以下"矛盾候选"中哪些是真正的矛盾。

判断规则：
1. 上下文合理的变化不算矛盾（如角色升级、关系变化、物品进化等在正文中已解释）
2. 上下文不合理的矛盾才算（如已摧毁的法宝再次完好出现、已死亡的角色无故复活等）
3. 信息不全的情况标为 info 级别

输出JSON格式：
{
  "conflicts": [
    {
      "entityName": "实体名",
      "conflictType": "矛盾类型",
      "description": "矛盾描述",
      "severity": "error|warning|info"
    }
  ]
}
如果所有候选都不是真正的矛盾，返回空数组。`

  const metrics = await generateWithMetrics(
    { ...judgeConfig, params: { ...(judgeConfig.params || {}), temperature: 0.1 } },
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `【矛盾候选列表】\n${candidateDesc}\n\n请判断哪些是真正的矛盾。` },
    ],
  )

  const jsonMatch = metrics.text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) {
    LOG_STYLES.WARN('[step9] LLM判断返回无有效JSON，保守处理')
    return candidates.map(c => ({
      entityName: c.entityName,
      conflictType: c.conflictType,
      description: `LLM判断失败，保守记录：${c.historicalRecord}`,
      severity: 'warning',
    }))
  }

  try {
    const parsed = JSON.parse(jsonMatch[0])
    return parsed.conflicts || []
  } catch {
    LOG_STYLES.WARN('[step9] JSON解析失败，保守处理')
    return candidates.map(c => ({
      entityName: c.entityName,
      conflictType: c.conflictType,
      description: `JSON解析失败，保守记录：${c.historicalRecord}`,
      severity: 'warning',
    }))
  }
}

export async function detectEntityConflicts(
  env: Env,
  chapterId: string,
  novelId: string,
): Promise<{ candidateCount: number; conflictCount: number }> {
  const db = drizzle(env.DB)

  const chapter = await db
    .select({
      title: chapters.title,
      content: chapters.content,
      sortOrder: chapters.sortOrder,
    })
    .from(chapters)
    .where(eq(chapters.id, chapterId))
    .limit(1)

  if (chapter.length === 0 || !chapter[0].content) {
    LOG_STYLES.ERROR(`[step9] 找不到章节或内容为空: ${chapterId}`)
    return { candidateCount: 0, conflictCount: 0 }
  }

  const { content, sortOrder } = chapter[0]

  const candidates = await exactMatchDetection(db, novelId, chapterId, sortOrder, content)

  if (candidates.length === 0) {
    LOG_STYLES.INFO('[step9] 无矛盾候选，跳过LLM判断')
    return { candidateCount: 0, conflictCount: 0 }
  }

  LOG_STYLES.INFO(`[step9] 发现 ${candidates.length} 个矛盾候选，启动LLM判断`)

  const conflicts = await llmJudgeConflicts(env, novelId, content, candidates)

  let conflictCount = 0
  for (const conflict of conflicts) {
    const candidate = candidates.find(c => c.entityName === conflict.entityName)
    if (!candidate) continue

    await db.insert(entityConflictLog).values({
      novelId,
      detectedChapterId: chapterId,
      detectedChapterOrder: sortOrder,
      entityName: conflict.entityName,
      entityType: candidate.entityType,
      sourceType: candidate.sourceType,
      sourceId: candidate.sourceId,
      conflictType: conflict.conflictType,
      description: conflict.description,
      currentChapterExcerpt: candidate.currentExcerpt.slice(0, 500),
      historicalRecord: candidate.historicalRecord,
      historicalChapterOrder: candidate.historicalChapterOrder,
      severity: conflict.severity,
    })

    conflictCount++
  }

  return { candidateCount: candidates.length, conflictCount }
}
