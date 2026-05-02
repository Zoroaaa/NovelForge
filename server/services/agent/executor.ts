/**
 * @file executor.ts
 * @description Agent工具执行器 v3 — 实现8个资料包工具（含跨章一致性工具6/7/8）
 */
import { drizzle } from 'drizzle-orm/d1'
import {
  chapters, characters, novelSettings, foreshadowing,
  novelInlineEntities, entityStateLog, characterGrowthLog,
} from '../../db/schema'
import { eq, and, desc, like, or, sql, inArray } from 'drizzle-orm'
import type { Env } from '../../lib/types'
import { embedText, searchSimilarMulti, ACTIVE_SOURCE_TYPES } from '../embedding'

export async function executeAgentTool(
  env: Env,
  toolName: string,
  args: Record<string, any>,
  novelId: string
): Promise<string> {
  const db = drizzle(env.DB)

  switch (toolName) {

    // ── 工具1：历史章节关键词检索 ────────────────────────────
    case 'searchChapterHistory': {
      const { keyword, limit = 8 } = args
      if (!keyword) return JSON.stringify({ error: 'keyword参数必填' })

      const rows = await db
        .select({
          sortOrder: chapters.sortOrder,
          title: chapters.title,
          summary: chapters.summary,
        })
        .from(chapters)
        .where(and(
          eq(chapters.novelId, novelId),
          sql`${chapters.summary} IS NOT NULL AND ${chapters.summary} != ''`,
          sql`${chapters.deletedAt} IS NULL`,
          or(
            like(chapters.summary, `%${keyword}%`),
            like(chapters.title, `%${keyword}%`),
          )
        ))
        .orderBy(desc(chapters.sortOrder))
        .limit(Math.min(limit, 15))
        .all()

      if (rows.length === 0) {
        return JSON.stringify({ message: `未在历史章节中找到包含"${keyword}"的记录` })
      }

      return JSON.stringify(
        rows.reverse().map(r => ({
          chapter: `第${r.sortOrder + 1}章 ${r.title}`,
          summary: r.summary,
        })),
        null, 2
      )
    }

    // ── 工具2：精确查询指定角色完整卡片 ─────────────────────
    case 'queryCharacterByName': {
      const { name } = args
      if (!name) return JSON.stringify({ error: 'name参数必填' })

      const rows = await db
        .select({
          name: characters.name,
          aliases: characters.aliases,
          role: characters.role,
          description: characters.description,
          attributes: characters.attributes,
          powerLevel: characters.powerLevel,
        })
        .from(characters)
        .where(and(
          eq(characters.novelId, novelId),
          sql`${characters.deletedAt} IS NULL`,
          or(
            eq(characters.name, name),
            like(characters.aliases, `%${name}%`),
          )
        ))
        .limit(3)
        .all()

      if (rows.length === 0) {
        return JSON.stringify({ message: `未找到角色"${name}"，请确认名称或使用searchSemantic模糊搜索` })
      }

      return JSON.stringify(rows.map(r => {
        let attrs: any = {}
        let power: any = {}
        try { attrs = r.attributes ? JSON.parse(r.attributes) : {} } catch {}
        try { power = r.powerLevel ? JSON.parse(r.powerLevel) : {} } catch {}
        return {
          name: r.name,
          aliases: r.aliases || null,
          role: r.role,
          description: r.description,
          attributes: attrs,
          currentLevel: power.current || null,
          nextMilestone: power.nextMilestone || null,
        }
      }), null, 2)
    }

    // ── 工具3：查询所有开放伏笔列表 ──────────────────────────
    case 'queryForeshadowing': {
      const { importance, limit = 10 } = args

      const conditions: any[] = [
        eq(foreshadowing.novelId, novelId),
        eq(foreshadowing.status, 'open'),
        sql`${foreshadowing.deletedAt} IS NULL`,
      ]
      if (importance) {
        conditions.push(eq(foreshadowing.importance, importance))
      }

      const rows = await db
        .select({
          title: foreshadowing.title,
          description: foreshadowing.description,
          importance: foreshadowing.importance,
          createdAt: foreshadowing.createdAt,
        })
        .from(foreshadowing)
        .where(and(...conditions))
        .orderBy(desc(foreshadowing.createdAt))
        .limit(Math.min(limit, 20))
        .all()

      if (rows.length === 0) {
        return JSON.stringify({ message: '当前没有open状态的伏笔' })
      }

      return JSON.stringify(rows.map(r => ({
        title: r.title,
        importance: r.importance,
        description: r.description,
      })), null, 2)
    }

    // ── 工具4：按名称精确查询世界设定 ────────────────────────
    case 'querySettingByName': {
      const { name } = args
      if (!name) return JSON.stringify({ error: 'name参数必填' })

      const rows = await db
        .select({
          name: novelSettings.name,
          type: novelSettings.type,
          content: novelSettings.content,
          importance: novelSettings.importance,
        })
        .from(novelSettings)
        .where(and(
          eq(novelSettings.novelId, novelId),
          sql`${novelSettings.deletedAt} IS NULL`,
          like(novelSettings.name, `%${name}%`),
        ))
        .limit(3)
        .all()

      if (rows.length === 0) {
        return JSON.stringify({ message: `未找到名称含"${name}"的世界设定，请尝试searchSemantic模糊搜索` })
      }

      return JSON.stringify(rows.map(r => ({
        name: r.name,
        type: r.type,
        importance: r.importance,
        content: r.content,
      })), null, 2)
    }

    // ── 工具5：语义搜索（兜底） ───────────────────────────────
    case 'searchSemantic': {
      if (!env.VECTORIZE) {
        return JSON.stringify({ error: 'Vectorize服务不可用' })
      }
      const { query, topK = 5, sourceTypes } = args
      if (!query) return JSON.stringify({ error: 'query参数必填' })

      const queryVector = await embedText(env.AI, query)
      const { searchSimilarMulti } = await import('../embedding')
      const results = await searchSimilarMulti(env.VECTORIZE, queryVector, {
        topK: Math.min(topK, 10),
        novelId,
        sourceTypes: sourceTypes || [...ACTIVE_SOURCE_TYPES],
      })

      if (results.length === 0) {
        return JSON.stringify({ message: `未找到与"${query}"相关的内容` })
      }

      return JSON.stringify(results.map(r => ({
        type: r.metadata.sourceType,
        title: r.metadata.title,
        content: r.metadata.content?.slice(0, 500),
        score: Math.round(r.score * 1000) / 1000,
      })), null, 2)
    }

    // ── 工具6：查询内联实体 ───────────────────────────────
    case 'queryInlineEntity': {
      const { name: entityName, entityType } = args
      if (!entityName) return JSON.stringify({ error: 'name参数必填' })

      const conditions = [
        eq(novelInlineEntities.novelId, novelId),
        sql`${novelInlineEntities.deletedAt} IS NULL`,
      ]
      if (entityType) {
        conditions.push(eq(novelInlineEntities.entityType, entityType))
      }

      const entityRows = await db
        .select({
          name: novelInlineEntities.name,
          entityType: novelInlineEntities.entityType,
          description: novelInlineEntities.description,
          aliases: novelInlineEntities.aliases,
          firstChapterOrder: novelInlineEntities.firstChapterOrder,
          lastChapterOrder: novelInlineEntities.lastChapterOrder,
          isGrowable: novelInlineEntities.isGrowable,
        })
        .from(novelInlineEntities)
        .where(and(...conditions))
        .orderBy(desc(novelInlineEntities.lastChapterOrder))
        .limit(5)
        .all()

      const matched = entityRows.filter(r => {
        const nameMatch = r.name === entityName || r.name.includes(entityName)
        const aliasMatch = r.aliases && (r.aliases.includes(entityName))
        return nameMatch || aliasMatch
      })

      if (matched.length === 0) {
        return JSON.stringify({ message: `未找到名为"${entityName}"的内联实体` })
      }

      return JSON.stringify(matched.map(r => ({
        name: r.name,
        entityType: r.entityType,
        description: r.description,
        aliases: r.aliases,
        firstChapterOrder: r.firstChapterOrder,
        lastChapterOrder: r.lastChapterOrder,
        isGrowable: r.isGrowable === 1,
      })), null, 2)
    }

    // ── 工具7：查询实体状态历史 ───────────────────────────────
    case 'queryEntityStateHistory': {
      const { entityName: stateEntityName, stateType, limit: stateLimit = 10 } = args
      if (!stateEntityName) return JSON.stringify({ error: 'entityName参数必填' })

      const stateConditions = [
        eq(entityStateLog.novelId, novelId),
        eq(entityStateLog.entityName, stateEntityName),
      ]
      if (stateType) {
        stateConditions.push(eq(entityStateLog.stateType, stateType))
      }

      const stateRows = await db
        .select({
          chapterOrder: entityStateLog.chapterOrder,
          stateType: entityStateLog.stateType,
          prevState: entityStateLog.prevState,
          currState: entityStateLog.currState,
          stateSummary: entityStateLog.stateSummary,
        })
        .from(entityStateLog)
        .where(and(...stateConditions))
        .orderBy(desc(entityStateLog.chapterOrder))
        .limit(Math.min(stateLimit, 20))
        .all()

      if (stateRows.length === 0) {
        return JSON.stringify({ message: `未找到"${stateEntityName}"的状态历史` })
      }

      return JSON.stringify(stateRows, null, 2)
    }

    // ── 工具8：查询角色成长记录 ───────────────────────────────
    case 'queryCharacterGrowth': {
      const { characterName, dimension, limit: growthLimit = 10 } = args
      if (!characterName) return JSON.stringify({ error: 'characterName参数必填' })

      const resolvedChar = await db
        .select({ id: characters.id })
        .from(characters)
        .where(and(eq(characters.novelId, novelId), eq(characters.name, characterName)))
        .limit(1)

      if (resolvedChar.length === 0) {
        return JSON.stringify({ message: `未找到角色"${characterName}"` })
      }

      const growthConditions = [
        eq(characterGrowthLog.novelId, novelId),
        eq(characterGrowthLog.characterId, resolvedChar[0].id),
      ]
      if (dimension) {
        growthConditions.push(eq(characterGrowthLog.growthDimension, dimension))
      }

      const growthRows = await db
        .select({
          chapterOrder: characterGrowthLog.chapterOrder,
          growthDimension: characterGrowthLog.growthDimension,
          characterNameTarget: characterGrowthLog.characterNameTarget,
          prevState: characterGrowthLog.prevState,
          currState: characterGrowthLog.currState,
          detail: characterGrowthLog.detail,
        })
        .from(characterGrowthLog)
        .where(and(...growthConditions))
        .orderBy(desc(characterGrowthLog.chapterOrder))
        .limit(Math.min(growthLimit, 20))
        .all()

      if (growthRows.length === 0) {
        return JSON.stringify({ message: `未找到"${characterName}"的成长记录${dimension ? `（维度: ${dimension}）` : ''}` })
      }

      return JSON.stringify(growthRows, null, 2)
    }

    default:
      return JSON.stringify({
        error: `未知工具: ${toolName}`,
        availableTools: ['searchChapterHistory', 'queryCharacterByName', 'queryForeshadowing', 'querySettingByName', 'searchSemantic', 'queryInlineEntity', 'queryEntityStateHistory', 'queryCharacterGrowth'],
      })
  }
}
