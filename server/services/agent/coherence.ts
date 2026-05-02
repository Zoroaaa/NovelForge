/**
 * @file coherence.ts
 * @description Agent章节连贯性检查
 */
import { drizzle } from 'drizzle-orm/d1'
import { chapters, characters, foreshadowing } from '../../db/schema'
import { eq, desc, sql, and } from 'drizzle-orm'
import type { Env } from '../../lib/types'
import type { CoherenceCheckResult } from './types'
import { embedText, searchSimilar } from '../../services/embedding'
import { resolveConfig, streamGenerate } from '../llm'
import { ERROR_MESSAGES } from './constants'

export async function checkChapterCoherence(
  env: Env,
  chapterId: string,
  novelId: string
): Promise<CoherenceCheckResult> {
  const db = drizzle(env.DB)
  const issues: CoherenceCheckResult['issues'] = []

  try {
    const currentChapter = await db
      .select({
        id: chapters.id,
        novelId: chapters.novelId,
        title: chapters.title,
        content: chapters.content,
        sortOrder: chapters.sortOrder,
      })
      .from(chapters)
      .where(eq(chapters.id, chapterId))
      .get()

    if (!currentChapter?.content) {
      return { hasIssues: false, issues: [], score: 100 }
    }

    await checkContinuityWithPrevChapter(db, currentChapter, issues)
    await checkForeshadowingConsistency(db, env, novelId, currentChapter, issues)
    await checkPowerLevelConsistency(db, novelId, currentChapter, issues)

    const deduction = issues.reduce((sum, issue) => {
      return sum + (issue.severity === 'error' ? 20 : 10)
    }, 0)
    const score = Math.max(0, 100 - deduction)

    return {
      hasIssues: issues.length > 0,
      issues,
      score,
    }
  } catch (error) {
    console.error('Coherence check error:', error)
    return { hasIssues: false, issues: [], score: 0 }
  }
}

async function checkContinuityWithPrevChapter(
  db: any,
  currentChapter: { id: string; novelId: string; title: string; content: string | null; sortOrder: number },
  issues: CoherenceCheckResult['issues']
): Promise<void> {
  try {
    const prevChapter = await db
      .select({
        summary: chapters.summary,
        title: chapters.title,
        content: chapters.content,
      })
      .from(chapters)
      .where(and(
        eq(chapters.novelId, currentChapter.novelId),
        sql`${chapters.sortOrder} < ${currentChapter.sortOrder}`,
        sql`${chapters.deletedAt} IS NULL`
      ))
      .orderBy(desc(chapters.sortOrder))
      .limit(1)
      .get()

    if (!prevChapter) return

    const prevChapterRef = prevChapter.summary
      ?? (prevChapter.content ? `（摘要未生成，使用章节末尾片段）\n${prevChapter.content.slice(-800)}` : null)
    if (!prevChapterRef) return

    const prevEndingKeywords = extractKeyPhrases(prevChapterRef.slice(-200))
    const currentBeginning = (currentChapter.content || '').slice(0, 500)

    const matchedKeywords = prevEndingKeywords.filter((kw: string) =>
      currentBeginning.includes(kw)
    )

    if (prevEndingKeywords.length > 0 && matchedKeywords.length === 0) {
      issues.push({
        severity: 'warning',
        category: 'continuity',
        message: `与上一章《${prevChapter.title}》的情节衔接可能不够紧密`,
        suggestion: '建议在章节开头适当回顾或承接上章的关键事件/人物状态',
      })
    }
  } catch (error) {
    console.warn('Continuity check failed:', error)
  }
}

async function checkForeshadowingConsistency(
  db: any,
  env: Env,
  novelId: string,
  currentChapter: { id: string; content: string | null },
  issues: CoherenceCheckResult['issues']
): Promise<void> {
  try {
    const openForeshadowing = await db
      .select({
        id: foreshadowing.id,
        title: foreshadowing.title,
        description: foreshadowing.description,
        importance: foreshadowing.importance,
        deletedAt: foreshadowing.deletedAt,
      })
      .from(foreshadowing)
      .where(
        and(
          eq(foreshadowing.novelId, novelId),
          eq(foreshadowing.status, 'open'),
          sql`${foreshadowing.deletedAt} IS NULL`
        )
      )
      .all()

    if (openForeshadowing.length === 0) return

    const hasVectorize = !!env.VECTORIZE

    const keywordCheckedIds = new Set<string>()
    const semanticConfirmedIds = new Set<string>()

    for (const fs of openForeshadowing) {
      const keywords = [fs.title, ...(fs.description ? fs.description.split(/[，。、]/).slice(0, 3) : [])]
      const hasMention = keywords.some((kw: string) =>
        kw.trim().length > 1 && (currentChapter.content || '').includes(kw.trim())
      )

      if (hasMention) {
        keywordCheckedIds.add(fs.id)
      } else if (!hasVectorize && fs.importance === 'high') {
        issues.push({
          severity: 'warning',
          category: 'foreshadowing',
          message: `重要伏笔《${fs.title}》本章未提及或推进`,
          suggestion: `建议在本章中适当提及或为该伏笔做铺垫（描述:${fs.description?.slice(0, 50)}）`,
        })
      }
    }

    if (hasVectorize && currentChapter.content) {
      try {
        const chapterVector = await embedText(env.AI, currentChapter.content.slice(0, 3000))

        const semanticTargets = openForeshadowing.filter((fs: typeof openForeshadowing[number]) =>
          !keywordCheckedIds.has(fs.id) && fs.description && fs.description.trim().length > 5
        )

        for (const fs of semanticTargets) {
          const fsVector = await embedText(env.AI, fs.description.slice(0, 500))
          const results = await searchSimilar(env.VECTORIZE, fsVector, {
            topK: 5,
            filter: { sourceType: 'chapter', novelId },
          })

          const hasMatch = results.some(
            (r) => r.metadata.sourceId === currentChapter.id && r.score > 0.6
          )

          if (hasMatch) {
            semanticConfirmedIds.add(fs.id)
          } else if (fs.importance === 'high') {
            issues.push({
              severity: 'warning',
              category: 'foreshadowing',
              message: `重要伏笔《${fs.title}》本章未提及（语义检测确认）`,
              suggestion: `建议在本章中适当提及或为该伏笔做铺垫（描述:${fs.description?.slice(0, 50)}）`,
            })
          }
        }
      } catch (semanticError) {
        console.warn('Foreshadowing semantic check failed, falling back to keyword-only:', semanticError)

        for (const fs of openForeshadowing) {
          if (keywordCheckedIds.has(fs.id) || semanticConfirmedIds.has(fs.id)) continue
          if (fs.importance !== 'high') continue

          const keywords = [fs.title, ...(fs.description ? fs.description.split(/[，。、]/).slice(0, 3) : [])]
          const hasMention = keywords.some((kw: string) =>
            kw.trim().length > 1 && (currentChapter.content || '').includes(kw.trim())
          )

          if (!hasMention) {
            issues.push({
              severity: 'warning',
              category: 'foreshadowing',
              message: `重要伏笔《${fs.title}》本章未提及或推进`,
              suggestion: `建议在本章中适当提及或为该伏笔做铺垫（描述:${fs.description?.slice(0, 50)}）`,
            })
          }
        }
      }
    }

    console.log(`📝 [Coherence] Foreshadowing check: ${keywordCheckedIds.size} keyword-match, ${semanticConfirmedIds.size} semantic-confirm, ${openForeshadowing.length - keywordCheckedIds.size - semanticConfirmedIds.size} unchecked`)
  } catch (error) {
    console.warn('Foreshadowing consistency check failed:', error)
  }
}

async function checkPowerLevelConsistency(
  db: any,
  novelId: string,
  currentChapter: { content: string | null },
  issues: CoherenceCheckResult['issues']
): Promise<void> {
  try {
    const protagonists = await db
      .select({
        name: characters.name,
        powerLevel: characters.powerLevel,
      })
      .from(characters)
      .where(
        and(
          eq(characters.novelId, novelId),
          eq(characters.role, 'protagonist'),
          sql`${characters.deletedAt} IS NULL`
        )
      )
      .all()

    for (const protagonist of protagonists) {
      if (!protagonist.powerLevel) continue

      let powerData: any
      try {
        powerData = JSON.parse(protagonist.powerLevel)
      } catch {
        continue
      }

      const breakthroughPattern = new RegExp(`${protagonist.name}.{0,50}(突破|进阶|晋升|升级).{0,30}(突破|进阶|晋升|升级)`, 'g')
      const matches = (currentChapter.content || '').match(breakthroughPattern)

      if (matches && matches.length > 1) {
        issues.push({
          severity: 'error',
          category: 'power_level',
          message: `${protagonist.name} 在本章出现 ${matches.length} 次境界变化描述，可能存在不合理突变`,
          suggestion: '通常一章节内不应超过1次重大境界突破，请检查是否符合设定逻辑',
        })
      }

      if (powerData.breakthroughs && powerData.breakthroughs.length > 0) {
        const lastBreakthrough = powerData.breakthroughs[powerData.breakthroughs.length - 1]
        if (lastBreakthrough.timestamp) {
          const breakthroughTime = new Date(lastBreakthrough.timestamp).getTime()
          const now = Date.now()

          if (now - breakthroughTime < 60000) {
            const levelGap = estimatePowerLevelGap(lastBreakthrough.from, lastBreakthrough.to)
            if (levelGap > 3) {
              issues.push({
                severity: 'warning',
                category: 'power_level',
                message: `${protagonist.name} 从 ${lastBreakthrough.from} 直接突破到 ${lastBreakthrough.to}，跨度较大`,
                suggestion: '考虑增加过渡阶段或在后续章节补充修炼过程描写',
              })
            }
          }
        }
      }
    }
  } catch (error) {
    console.warn('Power level consistency check failed:', error)
  }
}

function extractKeyPhrases(text: string): string[] {
  if (!text || text.length < 10) return []
  const phrases: string[] = []
  const sentences = text.split(/[，。！？；\n]/).filter(s => s.trim().length > 5)

  for (const sentence of sentences.slice(-3)) {
    const words = sentence.trim().split(/[\s、：""''（）【】《》]+/)
      .filter(w => w.length >= 2)
    phrases.push(...words.slice(0, 2))
  }

  return [...new Set(phrases)].slice(0, 8)
}

function estimatePowerLevelGap(fromLevel: string, toLevel: string): number {
  // 通用数字阶段匹配（适配任意体系，如1-10级、一至九层等）
  const numericLevels = [
    '一', '二', '三', '四', '五', '六', '七', '八', '九', '十',
    '1', '2', '3', '4', '5', '6', '7', '8', '9', '10',
    '初级', '中级', '高级', '巅峰', '圆满',
  ]

  const fromIndex = numericLevels.findIndex(l => fromLevel.includes(l))
  const toIndex = numericLevels.findIndex(l => toLevel.includes(l))

  if (fromIndex === -1 || toIndex === -1) return 1
  return Math.abs(toIndex - fromIndex)
}

export async function repairChapterByIssues(
  env: Env,
  chapterId: string,
  novelId: string,
  issues: { severity: string; message: string; suggestion?: string; category?: string }[],
  score: number
): Promise<{ ok: boolean; repairedContent?: string; error?: string }> {
  const db = drizzle(env.DB)

  try {
    const chapter = await db
      .select({ content: chapters.content, title: chapters.title })
      .from(chapters)
      .where(eq(chapters.id, chapterId))
      .get()

    if (!chapter?.content) return { ok: false, error: ERROR_MESSAGES.CHAPTER_CONTENT_NOT_FOUND }

    const protagonists = await db
      .select({ name: characters.name, powerLevel: characters.powerLevel, attributes: characters.attributes })
      .from(characters)
      .where(and(eq(characters.novelId, novelId), eq(characters.role, 'protagonist'), sql`${characters.deletedAt} IS NULL`))
      .all()

    const protagonistSection = protagonists.map(p => {
      let attrs: any = {}
      try { attrs = p.attributes ? JSON.parse(p.attributes) : {} } catch {}
      return `${p.name}：境界=${p.powerLevel || '未知'}，说话方式=${attrs.speechPattern || '未设定'}`
    }).join('\n')

    let llmConfig
    try {
      llmConfig = await resolveConfig(db, 'chapter_gen', novelId)
      llmConfig.apiKey = llmConfig.apiKey || ''
    } catch {
      return { ok: false, error: ERROR_MESSAGES.MODEL_CONFIG_NOT_FOUND }
    }

    const issueList = issues
      .map(
        (issue, idx) =>
          `${idx + 1}. [${issue.severity === 'error' ? '错误' : '警告'}] ${issue.message}${
            issue.suggestion ? `\n   建议：${issue.suggestion}` : ''
          }`
      )
      .join('\n')

    const messages = [
      {
        role: 'system' as const,
        content: `你是专业的小说修改编辑。根据指出的问题对章节进行针对性修改。
修改原则：
- 只修改有问题的部分，其余内容保持不变
- 修改后字数与原文相近（允许±10%）
- 不改变核心情节走向和结尾状态
- 直接输出完整修改后的正文，不要任何解释`,
      },
      {
        role: 'user' as const,
        content: `章节《${chapter.title}》检测到问题（评分 ${score}/100），请根据问题列表修改。

【修复时必须遵守的设定约束】
主角设定：
${protagonistSection || '无'}

【发现的问题】
${issueList}

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
    console.error('[repairChapterByIssues] failed:', error)
    return { ok: false, error: (error as Error).message }
  }
}