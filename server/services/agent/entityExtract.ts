/**
 * @file entityExtract.ts
 * @description 跨章一致性：step7 实体自动提取服务
 *   从章节内容中提取新出现的角色/道具/法宝/功法，写入 novelInlineEntities + entityStateLog。
 *   同时产出 step8 所需的 characterGrowths / knowledgeReveals 供后续消费。
 */
import { drizzle } from 'drizzle-orm/d1'
import { eq, and, desc } from 'drizzle-orm'
import {
  chapters,
  characters,
  novelSettings,
  novelInlineEntities,
  entityStateLog,
  chapterStructuredData,
} from '../../db/schema'
import type { Env } from '../../lib/types'
import { resolveConfig, generateWithMetrics } from '../llm'
import type { LLMCallResult } from '../llm'
import { JSON_OUTPUT_PROMPT, LOG_STYLES } from './constants'
import { indexContent } from '../embedding'

export interface EntityExtractResult {
  entities: Array<{
    entityType: string
    name: string
    description: string
    aliases?: string
    stateType?: string
    initState?: string
    isGrowable?: boolean
  }>
  stateChanges: Array<{
    entityName: string
    entityType: string
    stateType: string
    prevState?: string
    currState: string
    stateSummary: string
    stateDetail?: string
  }>
  characterGrowths: Array<{
    characterName: string
    dimension: string
    characterNameTarget?: string
    prevState?: string
    currState: string
    detail?: string
  }>
  knowledgeReveals: Array<{
    characterName: string
    targetEntityName: string
    revealDetail: string
    isSecret?: boolean
  }>
  metrics?: LLMCallResult
}

const EXTRACT_SYSTEM_PROMPT = `${JSON_OUTPUT_PROMPT}

你是一个专业的网络小说文本分析助手。你的任务是从章节内容中提取【首次出场的新实体】和【已有实体的状态变化】。

规则：
1. 只提取正文中明确出现过的实体，不得推测或编造
2. 已知角色（见已知角色列表）的信息不要重复提取为新实体
3. 已知设定（见已知设定列表）不要重复提取
4. 一个实体在本章可能同时满足多条提取规则，应全部覆盖（如一个新法宝既有首次出场又有状态变化）
5. "未实体化的概念提及"（如仅旁白提及）不应被提取
6. 如果本章无任何新增实体或状态变化，返回空数组

输出JSON格式：
{
  "entities": [
    {
      "entityType": "character|artifact|technique|location|item|faction",
      "name": "实体名称",
      "description": "一句话描述（来自原文）",
      "aliases": "别名（可选）",
      "stateType": "如果实体有初始状态则填写（如境界等级）",
      "initState": "初始状态描述",
      "isGrowable": true/false
    }
  ],
  "stateChanges": [
    {
      "entityName": "实体名",
      "entityType": "character|artifact|technique|...",
      "stateType": "等级|品阶|层级|熟练度|威力",
      "prevState": "变化前状态（如未知可为空）",
      "currState": "变化后状态",
      "stateSummary": "变化摘要（50字内）",
      "stateDetail": "变化细节（可选）"
    }
  ],
  "characterGrowths": [
    {
      "characterName": "角色名",
      "dimension": "ability|social|knowledge|emotion|combat|possession|growth",
      "characterNameTarget": "如果维度涉及目标角色则填写（如社交关系）",
      "prevState": "变化前状态",
      "currState": "变化后状态",
      "detail": "细节说明（可选）"
    }
  ],
  "knowledgeReveals": [
    {
      "characterName": "角色名",
      "targetEntityName": "得知的实体/信息名",
      "revealDetail": "得知的具体内容",
      "isSecret": true/false
    }
  ]
}`

function buildUserPrompt(
  chapterTitle: string,
  chapterContent: string,
  protagonistNames: string[],
  existingSettingNames: string[],
  recentStructuredData: string,
): string {
  return `【章节标题】${chapterTitle}

【本章正文】（分析前12000字）：
${chapterContent.slice(0, 12000)}

【已知角色列表】（不要提取为新实体）：
${protagonistNames.length > 0 ? protagonistNames.join('、') : '暂无'}

【已知设定列表】（不要提取为新实体）：
${existingSettingNames.length > 0 ? existingSettingNames.join('、') : '暂无'}

${recentStructuredData ? `【前文角色信息参考】\n${recentStructuredData}` : ''}

请严格按照JSON格式输出，不要输出任何非JSON内容。`
}

export async function extractEntitiesFromChapter(
  env: Env,
  chapterId: string,
  novelId: string,
): Promise<EntityExtractResult> {
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
    LOG_STYLES.ERROR(`[step7] 找不到章节或内容为空: ${chapterId}`)
    return { entities: [], stateChanges: [], characterGrowths: [], knowledgeReveals: [] }
  }

  const { title, content, sortOrder } = chapter[0]

  const allCharacters = await db
    .select({ name: characters.name, aliases: characters.aliases })
    .from(characters)
    .where(and(eq(characters.novelId, novelId), eq(characters.role, 'protagonist')))

  const protagonistNames = allCharacters.flatMap(c => {
    const names = [c.name]
    if (c.aliases) {
      try {
        const parsed = JSON.parse(c.aliases)
        if (Array.isArray(parsed)) names.push(...parsed)
      } catch { /* 忽略 */ }
    }
    return names
  })

  const existingSettings = await db
    .select({ name: novelSettings.name })
    .from(novelSettings)
    .where(and(eq(novelSettings.novelId, novelId), eq(novelSettings.type, 'power_system')))

  const existingSettingNames = existingSettings.map(s => s.name)

  const recentStructured = await db
    .select({
      characterChanges: chapterStructuredData.characterChanges,
      newEntities: chapterStructuredData.newEntities,
      chapterOrder: chapterStructuredData.chapterOrder,
    })
    .from(chapterStructuredData)
    .where(and(
      eq(chapterStructuredData.novelId, novelId),
      eq(chapterStructuredData.chapterOrder, sortOrder - 1),
    ))
    .limit(1)

  let recentStructuredData = ''
  if (recentStructured.length > 0) {
    const sd = recentStructured[0]
    if (sd.characterChanges) recentStructuredData += `【上一章角色变化】\n${sd.characterChanges}\n`
    if (sd.newEntities) recentStructuredData += `【上一章新出现元素】\n${sd.newEntities}\n`
  }

  let extractConfig
  try {
    extractConfig = await resolveConfig(db, 'analysis', novelId)
    extractConfig.apiKey = extractConfig.apiKey || ''
  } catch {
    throw new Error('❌ 未配置"智能分析"模型！请在全局配置中设置 analysis 阶段的模型')
  }

  const userPrompt = buildUserPrompt(title, content, protagonistNames, existingSettingNames, recentStructuredData)

  const metrics = await generateWithMetrics(
    { ...extractConfig, params: { ...(extractConfig.params || {}), temperature: 0.1 } },
    [
      { role: 'system', content: EXTRACT_SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ],
  )

  const jsonMatch = metrics.text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) {
    LOG_STYLES.ERROR('[step7] LLM返回内容无有效JSON')
    return { entities: [], stateChanges: [], characterGrowths: [], knowledgeReveals: [], metrics }
  }

  try {
    const parsed = JSON.parse(jsonMatch[0])
    return {
      entities: parsed.entities || [],
      stateChanges: parsed.stateChanges || [],
      characterGrowths: parsed.characterGrowths || [],
      knowledgeReveals: parsed.knowledgeReveals || [],
      metrics,
    }
  } catch {
    LOG_STYLES.ERROR('[step7] JSON解析失败')
    return { entities: [], stateChanges: [], characterGrowths: [], knowledgeReveals: [], metrics }
  }
}

export async function persistExtractedEntities(
  env: Env,
  chapterId: string,
  novelId: string,
  result: EntityExtractResult,
): Promise<{ entityCount: number; stateChangeCount: number }> {
  const db = drizzle(env.DB)
  const chapter = await db
    .select({ sortOrder: chapters.sortOrder })
    .from(chapters)
    .where(eq(chapters.id, chapterId))
    .limit(1)

  if (chapter.length === 0) return { entityCount: 0, stateChangeCount: 0 }

  const chapterOrder = chapter[0].sortOrder
  let entityCount = 0
  let stateChangeCount = 0

  for (const entity of result.entities) {
    const existingEntity = await db
      .select({ id: novelInlineEntities.id })
      .from(novelInlineEntities)
      .where(and(
        eq(novelInlineEntities.novelId, novelId),
        eq(novelInlineEntities.name, entity.name),
        eq(novelInlineEntities.entityType, entity.entityType),
      ))
      .limit(1)

    if (existingEntity.length > 0) {
      await db.update(novelInlineEntities)
        .set({
          description: entity.description,
          aliases: entity.aliases ?? null,
          lastChapterId: chapterId,
          lastChapterOrder: chapterOrder,
          updatedAt: Math.floor(Date.now() / 1000),
        })
        .where(eq(novelInlineEntities.id, existingEntity[0].id))
    } else {
      await db.insert(novelInlineEntities).values({
        novelId,
        entityType: entity.entityType,
        name: entity.name,
        aliases: entity.aliases ?? null,
        description: entity.description,
        firstChapterId: chapterId,
        firstChapterOrder: chapterOrder,
        lastChapterId: chapterId,
        lastChapterOrder: chapterOrder,
        isGrowable: entity.isGrowable ? 1 : 0,
      })
      entityCount++
    }

    if (entity.stateType && entity.initState) {
      await db.insert(entityStateLog).values({
        novelId,
        sourceType: entity.entityType === 'character' ? 'character' : 'inline_entity',
        sourceId: existingEntity.length > 0 ? existingEntity[0].id : '',
        entityName: entity.name,
        entityType: entity.entityType,
        chapterId,
        chapterOrder,
        stateType: entity.stateType,
        stateSummary: `初始状态：${entity.initState}`,
        currState: entity.initState,
      })
      stateChangeCount++
    }
  }

  for (const change of result.stateChanges) {
    const sourceEntity = await db
      .select({ id: novelInlineEntities.id })
      .from(novelInlineEntities)
      .where(and(
        eq(novelInlineEntities.novelId, novelId),
        eq(novelInlineEntities.name, change.entityName),
      ))
      .limit(1)

    const sourceId = sourceEntity.length > 0 ? sourceEntity[0].id : ''
    const sourceType = change.entityType === 'character' ? 'character' : 'inline_entity'

    await db.insert(entityStateLog).values({
      novelId,
      sourceType,
      sourceId,
      entityName: change.entityName,
      entityType: change.entityType,
      chapterId,
      chapterOrder,
      stateType: change.stateType,
      stateSummary: change.stateSummary,
      stateDetail: change.stateDetail ?? null,
      prevState: change.prevState ?? null,
      currState: change.currState,
    })
    stateChangeCount++
  }

  return { entityCount, stateChangeCount }
}

export async function triggerEntityVectorize(
  env: Env,
  novelId: string,
  result: EntityExtractResult,
): Promise<void> {
  if (!env.VECTORIZE) return

  for (const entity of result.entities) {
    const db = drizzle(env.DB)
    const existingEntity = await db
      .select({ id: novelInlineEntities.id })
      .from(novelInlineEntities)
      .where(and(
        eq(novelInlineEntities.novelId, novelId),
        eq(novelInlineEntities.name, entity.name),
        eq(novelInlineEntities.entityType, entity.entityType),
      ))
      .limit(1)

    if (existingEntity.length > 0) {
      try {
        const vectorIds = await indexContent(
          env,
          'inline_entity',
          existingEntity[0].id,
          novelId,
          entity.name,
          `${entity.name}：${entity.description}`,
          { sourceType: 'inline_entity' },
        )

        await db.update(novelInlineEntities)
          .set({ vectorId: vectorIds[0] ?? null, indexedAt: Math.floor(Date.now() / 1000) })
          .where(eq(novelInlineEntities.id, existingEntity[0].id))
      } catch (error) {
        LOG_STYLES.ERROR(`[step7] 实体向量化失败: ${entity.name} - ${error}`)
      }
    }
  }
}
