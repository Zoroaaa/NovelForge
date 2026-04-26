/**
 * @file consistency.ts
 * @description Agent角色一致性检查与修复
 */
import { drizzle } from 'drizzle-orm/d1'
import { chapters, characters } from '../../db/schema'
import { eq, and, sql } from 'drizzle-orm'
import type { Env } from '../../lib/types'
import { resolveConfig, generate, streamGenerate } from '../llm'
import type { CoherenceCheckResult } from './types'
import { ERROR_MESSAGES, JSON_OUTPUT_PROMPT } from './constants'

// ============================================================
// 角色一致性检查（AI分析）
// ============================================================
export async function checkCharacterConsistency(
  env: Env,
  data: { chapterId: string; characterIds: string[] }
): Promise<{ conflicts: any[]; warnings: string[]; raw?: string }> {
  const db = drizzle(env.DB)
  const { chapterId, characterIds } = data

  const chapter = await db.select().from(chapters).where(eq(chapters.id, chapterId)).get()
  if (!chapter?.content) throw new Error(ERROR_MESSAGES.CHAPTER_NOT_FOUND_OR_EMPTY)

  let characterInfo = ''
  if (characterIds.length > 0) {
    const chars = await db
      .select()
      .from(characters)
      .where(characterIds.map(id => eq(characters.id, id)).reduce((a, b) => sql`${a} OR ${b}`))
      .all()
    characterInfo = chars.map(c => {
      let attrs: any = {}
      try { attrs = c.attributes ? JSON.parse(c.attributes) : {} } catch {}

      return [
        `【${c.name}】角色定位：${c.role}`,
        `当前境界：${c.powerLevel || '未设定'}`,
        `性格：${attrs.personality || '未设定'}`,
        `说话方式：${attrs.speechPattern || '未设定'}`,
        `性格弱点：${attrs.weakness || '未设定'}`,
        `性格描述：${(c.description || '').slice(0, 200)}`,
      ].join('\n')
    }).join('\n\n---\n')
  }

  let analysisConfig
  try {
    analysisConfig = await resolveConfig(db, 'analysis', chapter.novelId)
    analysisConfig.apiKey = analysisConfig.apiKey || ''
  } catch {
    return {
      conflicts: [],
      warnings: [ERROR_MESSAGES.MODEL_NOT_CONFIGED('智能分析') + '（用于一致性检查、境界检测、伏笔提取等分析任务）'],
    }
  }

  const checkPrompt = `请检查以下小说章节内容是否符合角色设定，重点检查四个维度。

【角色设定】
${characterInfo || '无特定角色设定'}

【待检查章节内容】
${chapter.content.slice(0, 10000)}

【检查维度（必须逐一检查）】
1. 境界一致性：章节中描写的角色能力/境界是否与"当前境界"设定一致？是否出现超出当前境界的能力？
2. 说话方式一致性：章节中角色的对话是否符合"说话方式"描述？有无明显的语气/用词与设定不符？
3. 性格行为一致性：角色的行为决策是否符合"性格"描述？有无明显背离性格设定的行为（特别是在压力场景下）？
4. 弱点表现一致性：如果本章涉及角色的"性格弱点"触发场景，角色的反应是否符合设定？

请以JSON格式输出检查结果：
{
  "conflicts": [
    {
      "characterName": "角色名",
      "dimension": "境界|说话方式|性格行为|弱点表现",
      "conflict": "具体冲突描述（指出章节中的具体行为和设定的差异）",
      "excerpt": "相关原文片段（30字以内）",
      "severity": "error|warning"
    }
  ],
  "warnings": ["不确定项或轻微偏差的提示"]
}

如果没有冲突，conflicts 为空数组[]。warnings 用于记录"可能有问题但不确定"的内容。`

  // 分析任务温度较低，覆盖 config.params
  const overrideConfig = {
    ...analysisConfig,
    params: { ...(analysisConfig.params || {}), temperature: 0.3, max_tokens: 1000 },
  }

  const { text } = await generate(overrideConfig, [
    { role: 'system', content: JSON_OUTPUT_PROMPT },
    { role: 'user', content: checkPrompt },
  ])

  try {
    return JSON.parse(text)
  } catch {
    return { conflicts: [], warnings: ['解析失败'], raw: text }
  }
}

// ============================================================
// 根据连贯性问题修复章节（流式）
// ============================================================
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

    return { ok: true, repairedContent }
  } catch (error) {
    console.error('[repairChapterByIssues] failed:', error)
    return { ok: false, error: (error as Error).message }
  }
}