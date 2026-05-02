/**
 * @file characterGrowth.ts
 * @description 跨章一致性：step8 角色成长追踪服务
 *   消费 step7 产出的 characterGrowths / knowledgeReveals，写入 characterGrowthLog 表，
 *   同步更新 characterRelationships 关系网络快照。
 */
import { drizzle } from 'drizzle-orm/d1'
import { eq, and } from 'drizzle-orm'
import {
  characters,
  characterGrowthLog,
  characterRelationships,
} from '../../db/schema'
import type { Env } from '../../lib/types'
import type { EntityExtractResult } from './entityExtract'
import { LOG_STYLES } from './constants'

const GROWTH_DIMENSIONS = ['ability', 'social', 'knowledge', 'emotion', 'combat', 'possession', 'growth'] as const
type GrowthDimension = typeof GROWTH_DIMENSIONS[number]

function isValidDimension(dim: string): dim is GrowthDimension {
  return GROWTH_DIMENSIONS.includes(dim as GrowthDimension)
}

async function resolveCharacterId(
  db: ReturnType<typeof drizzle>,
  novelId: string,
  name: string,
): Promise<{ id: string; name: string } | null> {
  const rows = await db
    .select({ id: characters.id, name: characters.name })
    .from(characters)
    .where(and(
      eq(characters.novelId, novelId),
      eq(characters.name, name),
    ))
    .limit(1)

  if (rows.length > 0) return rows[0]

  const aliasRows = await db
    .select({ id: characters.id, name: characters.name })
    .from(characters)
    .where(eq(characters.novelId, novelId))

  for (const row of aliasRows) {
    if (!row.name) continue
    const nameMatch = name.includes(row.name) || row.name.includes(name)
    if (nameMatch) return row
  }

  return null
}

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
