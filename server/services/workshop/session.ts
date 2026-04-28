/**
 * @file workshop/session.ts
 * @description 创作工坊 - 会话管理
 */
import { drizzle } from 'drizzle-orm/d1'
import { eq, and, isNull } from 'drizzle-orm'
import type { Env } from '../../lib/types'
import * as schema from '../../db/schema'
import type { WorkshopExtractedData } from './types'

const {
  workshopSessions,
  novels,
  masterOutline,
  characters,
  volumes,
  chapters,
  novelSettings,
  writingRules,
} = schema

export interface WorkshopMessage {
  role: 'user' | 'assistant'
  content: string
  timestamp: number
}

export async function createWorkshopSession(
  env: Env,
  data: {
    novelId?: string
    stage?: string
  }
): Promise<any> {
  const db = drizzle(env.DB)

  let extractedData: WorkshopExtractedData = {}

  if (data.novelId) {
    extractedData = await loadNovelContextData(db, data.novelId, data.stage || 'concept')
  }

  const [session] = await db.insert(workshopSessions).values({
    novelId: data.novelId || null,
    stage: data.stage || 'concept',
    messages: JSON.stringify([]),
    extractedData: JSON.stringify(extractedData),
    status: 'active',
  }).returning()

  return session
}

export async function getWorkshopSession(
  env: Env,
  sessionId: string
): Promise<any> {
  const db = drizzle(env.DB)

  const session = await db
    .select()
    .from(workshopSessions)
    .where(eq(workshopSessions.id, sessionId))
    .get()

  if (!session) {
    throw new Error('Workshop session not found')
  }

  return session
}

export async function updateSession(
  db: any,
  sessionId: string,
  updates: {
    messages: WorkshopMessage[]
    extractedData: WorkshopExtractedData
  }
): Promise<void> {
  await db.update(workshopSessions)
    .set({
      messages: JSON.stringify(updates.messages),
      extractedData: JSON.stringify(updates.extractedData),
      updatedAt: Math.floor(Date.now() / 1000),
    })
    .where(eq(workshopSessions.id, sessionId))
}

export async function loadNovelContextData(
  db: any,
  novelId: string,
  targetStage: string
): Promise<WorkshopExtractedData> {
  const extractedData: WorkshopExtractedData = {}

  const novel = await db
    .select()
    .from(novels)
    .where(eq(novels.id, novelId))
    .get()

  if (!novel) {
    return extractedData
  }

  extractedData.title = novel.title
  if (novel.genre) extractedData.genre = novel.genre
  if (novel.description) extractedData.description = novel.description
  if (novel.targetWordCount) extractedData.targetWordCount = String(novel.targetWordCount)
  if (novel.targetChapterCount) extractedData.targetChapters = String(novel.targetChapterCount)

  if (targetStage === 'concept' || targetStage === 'worldbuild' || targetStage === 'character_design' || targetStage === 'volume_outline') {
    const outline = await db
      .select()
      .from(masterOutline)
      .where(and(eq(masterOutline.novelId, novelId), isNull(masterOutline.deletedAt)))
      .get()

    if (outline && outline.content) {
      extractedData.coreAppeal = extractCoreAppealFromContent(outline.content)
    }

    const rules = await db
      .select()
      .from(writingRules)
      .where(and(eq(writingRules.novelId, novelId), isNull(writingRules.deletedAt)))
      .all()

    if (rules.length > 0) {
      extractedData.writingRules = rules.map((r: typeof rules[number]) => ({
        category: r.category,
        title: r.title,
        content: r.content,
        priority: r.priority,
      }))
    }
  }

  if (targetStage === 'worldbuild' || targetStage === 'character_design' || targetStage === 'volume_outline') {
    const settings = await db
      .select()
      .from(novelSettings)
      .where(and(eq(novelSettings.novelId, novelId), isNull(novelSettings.deletedAt)))
      .all()

    if (settings.length > 0) {
      const worldSettings: Array<{ type: string; title: string; content: string; importance: string }> = []
      for (const s of settings) {
        worldSettings.push({
          type: s.type,
          title: s.name,
          content: s.content,
          importance: s.importance || 'normal',
        })
      }

      if (worldSettings.length > 0) {
        extractedData.worldSettings = worldSettings
      }
    }
  }

  if (targetStage === 'character_design' || targetStage === 'volume_outline') {
    const chars = await db
      .select()
      .from(characters)
      .where(and(eq(characters.novelId, novelId), isNull(characters.deletedAt)))
      .all()

    if (chars.length > 0) {
      extractedData.characters = chars.map((c: typeof chars[number]) => {
        let parsedAttrs = {}
        try {
          parsedAttrs = c.attributes ? JSON.parse(c.attributes) : {}
        } catch (e) {
          console.warn('[workshop] 解析角色attributes失败:', e)
        }

        return {
          name: c.name,
          role: c.role || 'supporting',
          description: c.description || '',
          aliases: c.aliases ? JSON.parse(c.aliases) : undefined,
          attributes: parsedAttrs,
          relationships: (parsedAttrs as any).relationships || undefined,
          powerLevel: c.powerLevel || undefined,
        }
      })
    }
  }

  if (targetStage === 'volume_outline') {
    const vols = await db
      .select()
      .from(volumes)
      .where(and(eq(volumes.novelId, novelId), isNull(volumes.deletedAt)))
      .all()

    if (vols.length > 0) {
      extractedData.volumes = vols.map((v: typeof vols[number]) => {
        let eventLine: string[] = []
        let notes: string[] = []
        let foreshadowingSetup: string[] = []
        let foreshadowingResolve: string[] = []
        try {
          if (v.eventLine) eventLine = JSON.parse(v.eventLine)
          if (v.notes) notes = JSON.parse(v.notes)
          if (v.foreshadowingSetup) foreshadowingSetup = JSON.parse(v.foreshadowingSetup)
          if (v.foreshadowingResolve) foreshadowingResolve = JSON.parse(v.foreshadowingResolve)
        } catch (e) {
          console.warn('[workshop] 解析卷字段失败:', e)
        }

        return {
          title: v.title,
          summary: v.summary || '',
          blueprint: v.blueprint || '',
          chapterCount: v.chapterCount || 0,
          eventLine,
          notes,
          foreshadowingSetup,
          foreshadowingResolve,
          targetWordCount: v.targetWordCount || null,
          targetChapterCount: v.targetChapterCount || null,
        }
      })
    }
  }

    return extractedData
}

export function extractCoreAppealFromContent(content: string): string[] | undefined {
  const coreAppealMatch = content.match(/## 核心看点\n([\s\S]*?)(?=\n## |$)/i)
  if (coreAppealMatch) {
    const lines = coreAppealMatch[1].trim().split('\n').filter(line => line.trim())
    return lines.length > 0 ? lines : undefined
  }
  return undefined
}
