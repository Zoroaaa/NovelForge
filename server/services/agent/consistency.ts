/**
 * @file consistency.ts
 * @description Agent角色一致性检查与修复
 */
import { drizzle } from 'drizzle-orm/d1'
import { chapters, characters } from '../../db/schema'
import { eq, sql } from 'drizzle-orm'
import type { Env } from '../../lib/types'
import { resolveConfig, streamGenerate, getDefaultBase } from '../llm'
import type { CoherenceCheckResult } from './types'
import { ERROR_MESSAGES, JSON_OUTPUT_PROMPT } from './constants'

export async function checkCharacterConsistency(
  env: Env,
  data: { chapterId: string; characterIds: string[] }
): Promise<{ conflicts: any[]; warnings: string[]; raw?: string }> {
  const db = drizzle(env.DB)
  const { chapterId, characterIds } = data

  const chapter = await db.select().from(chapters).where(eq(chapters.id, chapterId)).get()
  if (!chapter?.content) {
    throw new Error(ERROR_MESSAGES.CHAPTER_NOT_FOUND_OR_EMPTY)
  }

  let characterInfo = ''
  if (characterIds.length > 0) {
    const chars = await db.select().from(characters).where(
      characterIds.map(id => eq(characters.id, id)).reduce((a, b) => sql`${a} OR ${b}`)
    ).all()
    characterInfo = chars.map(c => `【${c.name}】${c.role}: ${c.description || ''}`).join('\n')
  }

  const checkPrompt = `你是一个角色一致性检查助手。请检查以下小说内容是否符合角色设定。

【角色设定】:
${characterInfo || '无特定角色设定'}

【待检查内容】:
${chapter.content.slice(0, 10000)}

请以JSON格式输出检查结果：
{
  "conflicts": [
    { "characterName": "角色名", "conflict": "冲突描述", "excerpt": "相关段落" }
  ],
  "warnings": ["警告1", "警告2"]
}

如果没有冲突，conflicts 数组为空。`

  let summaryConfig
  try {
    summaryConfig = await resolveConfig(db, 'analysis', chapter.novelId)
    summaryConfig.apiKey = summaryConfig.apiKey || ''
  } catch (error) {
    return {
      conflicts: [],
      warnings: [ERROR_MESSAGES.MODEL_NOT_CONFIGED('智能分析') + '（用于一致性检查、境界检测、伏笔提取等分析任务）'],
    }
  }

  const base = summaryConfig.apiBase || getDefaultBase(summaryConfig.provider)
  const resp = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${summaryConfig.apiKey}`,
    },
    body: JSON.stringify({
      model: summaryConfig.modelId,
      messages: [
        { role: 'system', content: JSON_OUTPUT_PROMPT },
        { role: 'user', content: checkPrompt },
      ],
      temperature: 0.3,
      max_tokens: 1000,
    }),
  })

  if (!resp.ok) {
    throw new Error(ERROR_MESSAGES.API_ERROR(resp.status))
  }

  const result = await resp.json() as any
  const content = result.choices?.[0]?.message?.content || '{}'

  try {
    return JSON.parse(content)
  } catch {
    return { conflicts: [], warnings: ['解析失败'], raw: content }
  }
}

export async function repairChapterByIssues(
  env: Env,
  chapterId: string,
  novelId: string,
  issues: CoherenceCheckResult['issues'],
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

    let llmConfig
    try {
      llmConfig = await resolveConfig(db, 'chapter_gen', novelId)
      llmConfig.apiKey = llmConfig.apiKey || ''
    } catch {
      return { ok: false, error: ERROR_MESSAGES.MODEL_CONFIG_NOT_FOUND }
    }

    const issueList = issues
      .map((i, idx) => `${idx + 1}. [${i.severity === 'error' ? '错误' : '警告'}] ${i.message}${i.suggestion ? `\n   建议：${i.suggestion}` : ''}`)
      .join('\n')

    const messages = [
      {
        role: 'system' as const,
        content: `你是一位专业的小说修改编辑。你的任务是根据指出的问题，对章节内容进行针对性修改。
修改原则：
- 只修改有问题的部分，保持其余内容不变
- 不改变核心情节走向
- 修改后字数与原文相近
- 直接输出完整修改后的正文，不要任何解释或标注`,
      },
      {
        role: 'user' as const,
        content: `以下章节《${chapter.title}》经一致性检查发现问题（评分 ${score}/100），请根据问题列表进行修改。

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

    return { ok: true, repairedContent }
  } catch (error) {
    console.error('[repairChapterByIssues] failed:', error)
    return { ok: false, error: (error as Error).message }
  }
}
