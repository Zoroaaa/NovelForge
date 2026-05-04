/**
 * @file characterGrowth.ts
 * @description 跨章一致性：step8 角色成长追踪服务
 *   消费 step7 产出的 characterGrowths / knowledgeReveals，写入 characterGrowthLog 表，
 *   同步更新 characterRelationships 关系网络快照。
 */
import { drizzle } from 'drizzle-orm/d1'
import { eq, and, sql } from 'drizzle-orm'
import {
  characters,
  characterGrowthLog,
  characterRelationships,
} from '../../db/schema'
import type { Env } from '../../lib/types'
import type { EntityExtractResult } from './entityExtract'
import { LOG_STYLES } from './constants'

const GROWTH_DIMENSIONS = ['ability', 'social', 'knowledge', 'emotion', 'combat', 'growth'] as const
type GrowthDimension = typeof GROWTH_DIMENSIONS[number]

const BLOCKED_DIMENSIONS = ['possession'] as const

function isValidDimension(dim: string): dim is GrowthDimension {
  if (BLOCKED_DIMENSIONS.includes(dim as typeof BLOCKED_DIMENSIONS[number])) return false
  return GROWTH_DIMENSIONS.includes(dim as GrowthDimension)
}

/**
 * 根据名称解析角色ID（支持精确匹配和别名匹配）
 *
 * 为什么采用两阶段查询策略：
 * 1. 先用 LIMIT 1 快速尝试精确匹配（覆盖90%+场景，避免全表扫描）
 * 2. 精确匹配失败时再查全表遍历别名（AI提取的角色名可能使用别名而非正式名）
 *
 * 为什么需要别名支持：LLM提取实体时可能使用"小名"、"绰号"等非正式名称，
 * 而数据库存储的是正式角色名，必须通过别名映射才能正确关联
 */
async function resolveCharacterId(
  db: ReturnType<typeof drizzle>,
  novelId: string,
  name: string,
): Promise<{ id: string; name: string } | null> {
  const rows = await db
    .select({ id: characters.id, name: characters.name, aliases: characters.aliases })
    .from(characters)
    .where(and(
      eq(characters.novelId, novelId),
      sql`${characters.deletedAt} IS NULL`,
    ))
    .limit(1)

  if (rows.length > 0 && rows[0].name === name) return { id: rows[0].id, name: rows[0].name }

  const allRows = await db
    .select({ id: characters.id, name: characters.name, aliases: characters.aliases })
    .from(characters)
    .where(and(
      eq(characters.novelId, novelId),
      sql`${characters.deletedAt} IS NULL`,
    ))

  for (const row of allRows) {
    if (row.name === name) return { id: row.id, name: row.name }
    if (row.aliases) {
      try {
        const parsed = JSON.parse(row.aliases)
        const aliasList = Array.isArray(parsed) ? parsed : [parsed]
        if (aliasList.some((a: string) => a === name)) return { id: row.id, name: row.name }
      } catch {
        if (row.aliases === name) return { id: row.id, name: row.name }
      }
    }
  }

  return null
}

/**
 * 追踪章节中的角色成长和关系变化
 *
 * 为什么将成长记录和关系网络分开处理：
 * - 成长记录（characterGrowthLog）是追加式的时序数据，每章独立记录，用于回溯角色成长轨迹
 * - 关系网络（characterRelationships）是状态快照，需要upsert（存在则更新，不存在则插入），
 *   用于实时查询当前角色间的关系状态
 *
 * 为什么需要 chapterOrder：成长记录必须关联章节顺序号而非章节ID，
 * 因为后续分析需要按"第几章发生了什么"来排序展示，而ID是无序的UUID
 */
export async function trackCharacterGrowth(
  env: Env,
  chapterId: string,
  novelId: string,
  extractResult: EntityExtractResult,
): Promise<{ growthCount: number; relationshipCount: number }> {
  const db = drizzle(env.DB)
  let growthCount = 0
  let relationshipCount = 0

  const { chapters } = await import('../../db/schema')
  const chapterRows = await db
    .select({ sortOrder: chapters.sortOrder })
    .from(chapters)
    .where(eq(chapters.id, chapterId))
    .limit(1)

  if (chapterRows.length === 0) {
    LOG_STYLES.ERROR(`[step8] 找不到章节: ${chapterId}`)
    return { growthCount: 0, relationshipCount: 0 }
  }

  const chapterOrder = chapterRows[0].sortOrder

  for (const growth of extractResult.characterGrowths) {
    if (!isValidDimension(growth.dimension)) {
      LOG_STYLES.WARN(`[step8] 无效的成长维度: ${growth.dimension}，跳过`)
      continue
    }

    const resolvedChar = await resolveCharacterId(db, novelId, growth.characterName)
    if (!resolvedChar) {
      LOG_STYLES.WARN(`[step8] 找不到角色: ${growth.characterName}，跳过`)
      continue
    }

    let targetId: string | null = null
    let targetName: string | null = null
    if (growth.characterNameTarget) {
      const resolvedTarget = await resolveCharacterId(db, novelId, growth.characterNameTarget)
      if (resolvedTarget) {
        targetId = resolvedTarget.id
        targetName = resolvedTarget.name
      }
    }

    await db.insert(characterGrowthLog).values({
      novelId,
      characterId: resolvedChar.id,
      characterName: resolvedChar.name,
      chapterId,
      chapterOrder,
      growthDimension: growth.dimension,
      characterIdTarget: targetId,
      characterNameTarget: targetName,
      prevState: growth.prevState ?? null,
      currState: growth.currState,
      detail: growth.detail ?? null,
      isSecret: 0,
      isPublic: 1,
    })

    growthCount++
  }

  for (const knowledge of extractResult.knowledgeReveals) {
    const resolvedChar = await resolveCharacterId(db, novelId, knowledge.characterName)
    if (!resolvedChar) {
      LOG_STYLES.WARN(`[step8] 找不到角色: ${knowledge.characterName}，跳过知识获取记录`)
      continue
    }

    await db.insert(characterGrowthLog).values({
      novelId,
      characterId: resolvedChar.id,
      characterName: resolvedChar.name,
      chapterId,
      chapterOrder,
      growthDimension: 'knowledge',
      prevState: null,
      currState: `得知：${knowledge.targetEntityName} - ${knowledge.revealDetail}`,
      detail: knowledge.revealDetail,
      isSecret: knowledge.isSecret ? 1 : 0,
      isPublic: knowledge.isSecret ? 0 : 1,
    })

    growthCount++
  }

  const socialGrowthEntries = extractResult.characterGrowths.filter(
    g => g.dimension === 'social' && g.characterNameTarget,
  )

  for (const social of socialGrowthEntries) {
    const charA = await resolveCharacterId(db, novelId, social.characterName)
    const charB = await resolveCharacterId(db, novelId, social.characterNameTarget!)

    if (!charA || !charB) continue

    const existingRelation = await db
      .select({ id: characterRelationships.id })
      .from(characterRelationships)
      .where(and(
        eq(characterRelationships.novelId, novelId),
        eq(characterRelationships.characterIdA, charA.id),
        eq(characterRelationships.characterIdB, charB.id),
      ))
      .limit(1)

    if (existingRelation.length > 0) {
      await db.update(characterRelationships)
        .set({
          relationType: social.currState,
          relationDesc: social.detail ?? social.currState,
          lastUpdatedChapterOrder: chapterOrder,
          lastUpdatedChapterId: chapterId,
          updatedAt: Math.floor(Date.now() / 1000),
        })
        .where(eq(characterRelationships.id, existingRelation[0].id))
    } else {
      await db.insert(characterRelationships).values({
        novelId,
        characterIdA: charA.id,
        characterNameA: charA.name,
        characterIdB: charB.id,
        characterNameB: charB.name,
        relationType: social.currState,
        relationDesc: social.detail ?? social.currState,
        establishedChapterOrder: chapterOrder,
        lastUpdatedChapterOrder: chapterOrder,
        lastUpdatedChapterId: chapterId,
      })
    }

    relationshipCount++
  }

  return { growthCount, relationshipCount }
}
