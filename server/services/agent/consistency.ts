/**
 * @file consistency.ts
 * @description Agent角色一致性检查与修复
 */
import { drizzle } from 'drizzle-orm/d1'
import { chapters, characters } from '../../db/schema'
import { eq, and, sql, inArray, isNull } from 'drizzle-orm'
import type { Env } from '../../lib/types'
import { resolveConfig, generate, streamGenerate } from '../llm'
import { ERROR_MESSAGES, JSON_OUTPUT_PROMPT } from './constants'

export async function checkCharacterConsistency(
  env: Env,
  data: { chapterId: string; characterIds: string[] }
): Promise<{ conflicts: any[]; warnings: string[]; raw?: string; score: number }> {
  const db = drizzle(env.DB)
  const { chapterId } = data
  let { characterIds } = data

  const chapter = await db.select().from(chapters).where(eq(chapters.id, chapterId)).get()
  if (!chapter?.content) throw new Error(ERROR_MESSAGES.CHAPTER_NOT_FOUND_OR_EMPTY)

  if (characterIds.length === 0) {
    const mainChars = await db.select({ id: characters.id })
      .from(characters)
      .where(and(
        eq(characters.novelId, chapter.novelId),
        inArray(characters.role, ['protagonist', 'supporting', 'antagonist']),
        isNull(characters.deletedAt)
      ))
      .limit(10)
      .all()
    characterIds = mainChars.map(c => c.id)
  }

  if (characterIds.length === 0) {
    return { conflicts: [], warnings: ['未设置角色，跳过检查'], score: -1 }
  }

  let characterInfo = ''
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

  let analysisConfig
  try {
    analysisConfig = await resolveConfig(db, 'analysis', chapter.novelId)
    analysisConfig.apiKey = analysisConfig.apiKey || ''
  } catch {
    return {
      conflicts: [],
      warnings: [ERROR_MESSAGES.MODEL_NOT_CONFIGED('智能分析') + '（用于一致性检查、境界检测、伏笔提取等分析任务）'],
      score: 100,
    }
  }

  const checkPrompt = `请检查以下小说章节内容是否符合角色设定，重点检查四个维度。

【角色设定】
${characterInfo || '无特定角色设定'}

【待检查章节内容】
${chapter.content.slice(0, 10000)}

【检查维度（必须逐一检查）】
1. 实力一致性：章节中描写的角色能力/实力等级是否与"当前实力等级"设定一致？是否出现超出当前等级的能力？（等级名称以角色设定为准，不受题材限制）
2. 说话方式一致性：章节中角色的对话是否符合"说话方式"描述？有无明显的语气/用词与设定不符？
3. 性格行为一致性：角色的行为决策是否符合"性格"描述？有无明显背离性格设定的行为（特别是在压力场景下）？
4. 弱点表现一致性：如果本章涉及角色的"性格弱点"触发场景，角色的反应是否符合设定？

请以JSON格式输出检查结果：
{
  "conflicts": [
    {
      "characterName": "角色名",
      "dimension": "实力一致性|说话方式|性格行为|弱点表现",
      "issue": "具体问题描述（指出章节中的具体行为和设定的差异）",
      "excerpt": "相关原文片段（30字以内）",
      "severity": "error|warning",
      "suggestion": "给下一章的具体规避建议（以'建议'开头，30字以内）"
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
    const result = JSON.parse(text)
    const conflictCount = result.conflicts?.length || 0
    const score = conflictCount > 0 ? Math.max(0, 100 - conflictCount * 20) : 100
    return { ...result, score }
  } catch {
    return { conflicts: [], warnings: ['解析失败'], raw: text, score: 100 }
  }
}

export async function repairChapterByCharacterIssues(
  env: Env,
  chapterId: string,
  novelId: string,
  conflicts: Array<{ characterName: string; dimension: string; issue: string; excerpt?: string; suggestion?: string }>
): Promise<{ ok: boolean; repairedContent?: string; error?: string }> {
  const db = drizzle(env.DB)

  try {
    const chapter = await db
      .select({ content: chapters.content, title: chapters.title })
      .from(chapters)
      .where(eq(chapters.id, chapterId))
      .get()

    if (!chapter?.content) return { ok: false, error: ERROR_MESSAGES.CHAPTER_CONTENT_NOT_FOUND }

    const characters_data = await db
      .select({ name: characters.name, powerLevel: characters.powerLevel, attributes: characters.attributes })
      .from(characters)
      .where(and(eq(characters.novelId, novelId), sql`${characters.deletedAt} IS NULL`))
      .all()

    const characterSection = characters_data.map(p => {
      let attrs: any = {}
      try { attrs = p.attributes ? JSON.parse(p.attributes) : {} } catch {}
      return `${p.name}：境界=${p.powerLevel || '未知'}，说话方式=${attrs.speechPattern || '未设定'}，性格=${attrs.personality || '未设定'}`
    }).join('\n')

    let llmConfig
    try {
      llmConfig = await resolveConfig(db, 'chapter_gen', novelId)
      llmConfig.apiKey = llmConfig.apiKey || ''
    } catch {
      return { ok: false, error: ERROR_MESSAGES.MODEL_CONFIG_NOT_FOUND }
    }

    const conflictList = conflicts
      .map(
        (c, idx) =>
          `${idx + 1}. [角色：${c.characterName}] 维度：${c.dimension}\n   问题：${c.issue}\n   原文："${c.excerpt || '无'}"\n   建议：${c.suggestion || '保持角色言行一致'}`
      )
      .join('\n\n')

    const messages = [
      {
        role: 'system' as const,
        content: `你是专业的小说修改编辑。根据角色一致性检查报告对章节进行针对性修改。
修改原则：
- 只修改有问题的部分，其余内容保持不变
- 修改后字数与原文相近（允许±10%）
- 不改变核心情节走向和结尾状态
- 重点修正冲突中指出的角色言行、境界、说话方式问题
- 直接输出完整修改后的正文，不要任何解释`,
      },
      {
        role: 'user' as const,
        content: `章节《${chapter.title}》检测到角色一致性问题（${conflicts.length}个冲突），请根据问题列表修改。

【角色设定】
${characterSection || '无'}

【发现的问题】
${conflictList}

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
    console.error('[repairChapterByCharacterIssues] failed:', error)
    return { ok: false, error: (error as Error).message }
  }
}