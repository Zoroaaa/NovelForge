/**
 * @file executor.ts
 * @description Agent工具执行器
 */
import { drizzle } from 'drizzle-orm/d1'
import { chapters, modelConfigs, characters, novelSettings, masterOutline, volumes, foreshadowing } from '../../db/schema'
import { eq, desc, sql } from 'drizzle-orm'
import type { Env } from '../../lib/types'
import { embedText, ACTIVE_SOURCE_TYPES } from '../embedding'

export async function executeAgentTool(
  env: Env,
  toolName: string,
  args: Record<string, any>,
  novelId: string
): Promise<string> {
  const db = drizzle(env.DB)

  switch (toolName) {
    case 'queryOutline': {
      const { novelId: queryNovelId, type } = args
      const targetNovelId = queryNovelId || novelId

      if (type === 'master_outline' || !type) {
        const masterOutlineResult = await db
          .select({ title: masterOutline.title, content: masterOutline.content, version: masterOutline.version })
          .from(masterOutline)
          .where(eq(masterOutline.novelId, targetNovelId))
          .orderBy(desc(masterOutline.version))
          .limit(1)
          .get()

        if (masterOutlineResult) {
          return JSON.stringify([{
            title: `总纲 v${masterOutlineResult.version}`,
            content: masterOutlineResult.content,
            type: 'master_outline'
          }], null, 2)
        }
      }

      if (type === 'volume_outline' || type === 'volume') {
        const volumeOutlines = await db
          .select({ title: volumes.title, eventLine: volumes.eventLine, summary: volumes.summary })
          .from(volumes)
          .where(eq(volumes.novelId, targetNovelId))
          .orderBy(volumes.sortOrder)
          .limit(10)
          .all()

        return JSON.stringify(volumeOutlines.map(v => ({
          title: `卷纲：${v.title}`,
          content: v.eventLine || v.summary,
          type: 'volume_outline'
        })), null, 2)
      }

      const settingsType = type && ['worldview', 'power_system', 'faction', 'geography', 'item_skill', 'misc'].includes(type) ? type : undefined
      let settingsQuery = db
        .select({ name: novelSettings.name, content: novelSettings.content, type: novelSettings.type })
        .from(novelSettings)
        .where(eq(novelSettings.novelId, targetNovelId))

      if (settingsType) {
        settingsQuery = (settingsQuery as any).where(eq(novelSettings.type, settingsType))
      }

      const settingsResults = await settingsQuery
        .orderBy(desc(novelSettings.updatedAt))
        .limit(10)
        .all()

      return JSON.stringify(settingsResults.map(s => ({
        title: s.name,
        content: s.content,
        type: s.type
      })), null, 2)
    }

    case 'queryCharacter': {
      const { novelId: queryNovelId, role } = args
      const targetNovelId = queryNovelId || novelId
      let query = db.select().from(characters).where(eq(characters.novelId, targetNovelId))
      if (role) {
        query = (query as any).where(eq(characters.role, role))
      }
      const results = await query.limit(10).all()
      return JSON.stringify(results.map(c => ({ name: c.name, role: c.role, description: c.description?.slice(0, 300) })), null, 2)
    }

    case 'searchSemantic': {
      if (!env.VECTORIZE) {
        return JSON.stringify({ error: 'Vectorize service not available' })
      }
      const { query, novelId: queryNovelId, topK = 5 } = args
      const targetNovelId = queryNovelId || novelId

      if (!query) {
        return JSON.stringify({ error: 'Query parameter is required' })
      }

      const queryVector = await embedText(env.AI, query)
      const { searchSimilarMulti } = await import('../embedding')
      const searchResults = await searchSimilarMulti(env.VECTORIZE, queryVector, {
        topK: Math.min(topK, 10),
        novelId: targetNovelId,
        sourceTypes: args.sourceTypes || [...ACTIVE_SOURCE_TYPES],
      })
      return JSON.stringify(searchResults.map(r => ({
        title: r.metadata.title,
        content: r.metadata.content?.slice(0, 400),
        score: Math.round(r.score * 1000) / 1000
      })), null, 2)
    }

    default:
      return JSON.stringify({ error: `Unknown tool: ${toolName}. Available tools: queryOutline, queryCharacter, searchSemantic` })
  }
}
