/**
 * @file workshop/generateGenreSystemPrompt.ts
 * @description 生成小说专属 system prompt（AI 调用）
 */
import { drizzle } from 'drizzle-orm/d1'
import { eq, and, isNull, inArray } from 'drizzle-orm'
import type { Env } from '../../lib/types'
import * as schema from '../../db/schema'
import type { WorkshopExtractedData } from './types'
import { resolveConfig, generate } from '../llm'

export async function generateGenreSystemPrompt(
  env: Env,
  novelId: string,
  data: WorkshopExtractedData,
  extraContext?: string
): Promise<string> {
  const db = drizzle(env.DB)
  let llmConfig
  try {
    llmConfig = await resolveConfig(db, 'summary_gen', novelId)
  } catch {
    try {
      llmConfig = await resolveConfig(db, 'chapter_gen', novelId)
    } catch {
      throw new Error('未配置摘要或章节生成模型，请先在模型配置中添加')
    }
  }

  const contextParts: string[] = []

  try {
    const protagonist = await db.select({
      name: schema.characters.name,
      powerLevel: schema.characters.powerLevel,
      description: schema.characters.description,
    })
      .from(schema.characters)
      .where(and(
        eq(schema.characters.novelId, novelId),
        eq(schema.characters.role, 'protagonist'),
        isNull(schema.characters.deletedAt)
      ))
      .limit(1)
      .get()
    if (protagonist) {
      contextParts.push(`主角：${protagonist.name}${protagonist.powerLevel ? '，当前实力等级：' + protagonist.powerLevel : ''}${protagonist.description ? '，简介：' + protagonist.description.slice(0, 200) : ''}`)
    }
  } catch {}

  try {
    const settings = await db.select({
      name: schema.novelSettings.name,
      type: schema.novelSettings.type,
      category: schema.novelSettings.category,
      content: schema.novelSettings.content,
      summary: schema.novelSettings.summary,
    })
      .from(schema.novelSettings)
      .where(and(
        eq(schema.novelSettings.novelId, novelId),
        inArray(schema.novelSettings.category, ['worldview', 'power_system']),
        isNull(schema.novelSettings.deletedAt)
      ))
      .limit(10)
      .all()
    for (const s of settings) {
      contextParts.push(`设定【${s.category}】${s.name}：${s.summary || s.content?.slice(0, 300) || ''}`)
    }
  } catch {}

  if (data.genre) contextParts.push(`题材类型：${data.genre}`)
  if (data.coreAppeal?.length) contextParts.push(`核心卖点：${data.coreAppeal.join('；')}`)
  if (data.description) contextParts.push(`故事简介：${data.description.slice(0, 300)}`)
  if (data.writingRules?.length) contextParts.push(`写作规则：${data.writingRules.map(r => r.content || r).join('；')}`)
  if (extraContext) contextParts.push(extraContext)

  const result = await generate(llmConfig, [
    {
      role: 'system',
      content: `你是一位资深网文编辑，擅长为不同题材的小说定制写作风格指导。请根据给定的小说信息，生成一段专属的写作系统提示词（system prompt）。

要求：
1. 按以下类别结构输出，每个类别用【】标签标注：
   【题材定位】一句话概括题材类型和核心叙事路子
   【基础信息】世界名、主角、力量/成长体系简述（从设定中提取，没有则省略；术语必须与设定一致，不得自行替换）
   【写作技巧】该题材特有的写法要点（贴合实际题材，东方修真/西方奇幻/都市/科幻等各有侧重）
   【节奏控制】爽点安排、悬念设置、关键成长节奏等
   【注意事项】禁止项、特殊规则等
2. 总字数400-600字
3. 直接输出提示词内容，不要加标题或解释
4. 不要包含硬性约束（角色一致性、设定一致性等），这些由系统自动注入
5. 不要包含工具使用规范，这些由系统自动注入
6. 所有术语（力量等级名称、地名、势力名等）必须与提供的设定完全一致，禁止使用设定外的通用词替换`,
    },
    {
      role: 'user',
      content: contextParts.join('\n'),
    },
  ])

  return result.text.trim()
}
