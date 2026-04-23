/**
 * @file coherence.ts
 * @description Agent章节连贯性检查
 */
import { drizzle } from 'drizzle-orm/d1'
import { chapters, characters, foreshadowing } from '../../db/schema'
import { eq, desc, sql, and } from 'drizzle-orm'
import type { Env } from '../../lib/types'
import type { CoherenceCheckResult } from './types'

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

    if (!prevChapter?.summary) return

    const prevEndingKeywords = extractKeyPhrases(prevChapter.summary.slice(-200))
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
        chapterId: foreshadowing.chapterId,
      })
      .from(foreshadowing)
      .where(
        and(
          eq(foreshadowing.novelId, novelId),
          eq(foreshadowing.status, 'open'),
          eq(foreshadowing.importance, 'high')
        )
      )
      .all()

    if (openForeshadowing.length === 0) return

    for (const fs of openForeshadowing.slice(0, 5)) {
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
  const commonLevels = [
    '凡人', '炼气', '筑基', '金丹', '元婴', '化神', '合体', '大乘', '渡劫', '仙人',
    '一级', '二级', '三级', '四级', '五级', '六级', '七级', '八级', '九级', '十级',
    '初级', '中级', '高级', '巅峰', '圆满',
  ]

  const fromIndex = commonLevels.findIndex(l => fromLevel.includes(l))
  const toIndex = commonLevels.findIndex(l => toLevel.includes(l))

  if (fromIndex === -1 || toIndex === -1) return 1
  return Math.abs(toIndex - fromIndex)
}
