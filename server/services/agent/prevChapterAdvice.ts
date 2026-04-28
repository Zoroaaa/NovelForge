import { drizzle } from 'drizzle-orm/d1'
import { checkLogs } from '../../db/schema'
import { eq, and, desc, sql } from 'drizzle-orm'
import type { Env } from '../../lib/types'

export async function buildPrevChapterAdvice(
  env: Env,
  prevChapterId: string
): Promise<string | null> {
  const db = drizzle(env.DB)

  const logs = await db.select({
    checkType: checkLogs.checkType,
    characterResult: checkLogs.characterResult,
    coherenceResult: checkLogs.coherenceResult,
    volumeProgressResult: checkLogs.volumeProgressResult,
    issuesCount: checkLogs.issuesCount,
  })
    .from(checkLogs)
    .where(and(
      eq(checkLogs.chapterId, prevChapterId),
      sql`${checkLogs.checkType} IN ('character_consistency', 'chapter_coherence', 'volume_progress')`
    ))
    .all()

  if (logs.length === 0) return null

  const sections: string[] = []
  let hasAnyIssue = false

  for (const log of logs) {
    if (log.issuesCount === 0) continue

    let sectionContent = ''
    switch (log.checkType) {
      case 'character_consistency': {
        try {
          const result = typeof log.characterResult === 'string' ? JSON.parse(log.characterResult) : log.characterResult
          if (result?.conflicts?.length > 0) {
            sectionContent = result.conflicts.map((c: any) => {
              const suggestion = c.suggestion || `建议保持${c.dimension}一致性`
              return `  - [冲突] ${c.issue}\n    → ${suggestion}`
            }).join('\n')
          }
        } catch {}
        break
      }

      case 'chapter_coherence': {
        try {
          const result = typeof log.coherenceResult === 'string' ? JSON.parse(log.coherenceResult) : log.coherenceResult
          if (result?.issues?.length > 0) {
            sectionContent = result.issues.map((i: any) => {
              const suggestion = i.suggestion || '建议修正连贯性问题'
              return `  - [${i.severity === 'error' ? '错误' : '警告'}] ${i.message}\n    → ${suggestion}`
            }).join('\n')
          }
        } catch {}
        break
      }

      case 'volume_progress': {
        try {
          const result = typeof log.volumeProgressResult === 'string' ? JSON.parse(log.volumeProgressResult) : log.volumeProgressResult
          if (result && (result.currentChapter || result.currentWordCount)) {
            const parts: string[] = []
            if (result.currentChapter && result.targetChapter) {
              parts.push(`当前章节进度 ${Math.round((result.currentChapter / result.targetChapter) * 100)}%`)
            }
            if (result.currentWordCount && result.targetWordCount) {
              parts.push(`字数进度 ${Math.round((result.currentWordCount / result.targetWordCount) * 100)}%`)
            }
            if (parts.length > 0 || result.suggestion) {
              sectionContent = `  - ${parts.join('，')}${result.suggestion ? `\n    → ${result.suggestion}` : ''}`
            }
          }
        } catch {}
        break
      }
    }

    if (sectionContent) {
      hasAnyIssue = true
      switch (log.checkType) {
        case 'character_consistency': sections.push(`▶ 角色一致性：\n${sectionContent}`); break
        case 'chapter_coherence': sections.push(`▶ 章节连贯性：\n${sectionContent}`); break
        case 'volume_progress': sections.push(`▶ 卷进度：\n${sectionContent}`); break
      }
    }
  }

  if (!hasAnyIssue) return null

  return [
    '【上一章质量检查提示 - 本章需注意规避以下问题】',
    ...sections,
  ].join('\n\n')
}
