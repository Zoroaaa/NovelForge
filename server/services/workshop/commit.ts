/**
 * @file workshop/commit.ts
 * @description 创作工坊 - 提交逻辑（异步化版本）
 */
import { drizzle } from 'drizzle-orm/d1'
import { eq, and, isNull, sql, asc } from 'drizzle-orm'
import type { Env } from '../../lib/types'
import * as schema from '../../db/schema'
import { enqueue } from '../../lib/queue'
import type { WorkshopExtractedData } from './types'
import { buildOutlineContent } from './helpers'

const {
  workshopSessions,
  novels,
  masterOutline,
  novelSettings,
  writingRules,
  characters,
  chapters,
  volumes,
  foreshadowing,
  entityIndex,
} = schema

export async function commitWorkshopSession(
  env: Env,
  sessionId: string
): Promise<{ ok: boolean; novelId?: string; createdItems: any; queued?: boolean }> {
  await enqueue(env, { type: 'commit_workshop', payload: { sessionId } })
  return { ok: true, novelId: undefined, createdItems: {}, queued: true }
}

export async function commitWorkshopSessionCore(
  env: Env,
  sessionId: string
): Promise<{ ok: boolean; novelId?: string; createdItems: any }> {
  const db = drizzle(env.DB)

  const session = await db
    .select()
    .from(workshopSessions)
    .where(eq(workshopSessions.id, sessionId))
    .get()

  if (!session) {
    throw new Error('Session not found')
  }

  if (session.status === 'committed') {
    return { ok: true, novelId: session.novelId ?? undefined, createdItems: {} }
  }

  const data: WorkshopExtractedData = JSON.parse(session.extractedData || '{}')
  const createdItems: any = {}
  let novelId = session.novelId
  const stage = session.stage || 'concept'
  const isNewNovel = !novelId

  if (data.title && isNewNovel) {
    const [novel] = await db.insert(novels).values({
      title: data.title,
      description: data.description || '',
      genre: data.genre || '',
      status: 'draft',
      wordCount: 0,
      chapterCount: 0,
      targetWordCount: data.targetWordCount ? parseInt(data.targetWordCount, 10) : null,
      targetChapterCount: data.targetChapters ? parseInt(data.targetChapters, 10) : null,
    }).returning()

    novelId = novel.id
    createdItems.novel = novel
  }

  if (!novelId) {
    throw new Error('No novel ID available')
  }

  if (isNewNovel && (data.targetWordCount || data.targetChapters)) {
    const updateData: any = {}
    if (data.targetWordCount) {
      updateData.targetWordCount = parseInt(data.targetWordCount, 10)
    }
    if (data.targetChapters) {
      updateData.targetChapterCount = parseInt(data.targetChapters, 10)
    }
    await db.update(novels).set(updateData).where(eq(novels.id, novelId)).run()
  }

  if (data.title && (isNewNovel || stage === 'concept')) {
    const outlineContent = buildOutlineContent(data)
    await db.delete(masterOutline).where(eq(masterOutline.novelId, novelId)).run()
    const [outline] = await db.insert(masterOutline).values({
      novelId,
      title: `${data.title} - 总纲`,
      content: outlineContent,
      version: 1,
      summary: data.description || '',
      wordCount: outlineContent.length,
    }).returning()

    createdItems.outline = outline
  }

  if (data.worldSettings && data.worldSettings.length > 0) {
    const existingSettings = await db
      .select()
      .from(novelSettings)
      .where(and(eq(novelSettings.novelId, novelId), isNull(novelSettings.deletedAt)))
      .all()
    const settingMap = new Map(
      existingSettings.map((s: typeof existingSettings[number]) => [`${s.type}:${s.name}`, s])
    )

    const createdSettings: any[] = []
    for (const setting of data.worldSettings) {
      const key = `${setting.type}:${setting.title}`
      const existing = settingMap.get(key)

      if (existing) {
        await db.update(novelSettings)
          .set({
            content: setting.content,
            importance: setting.importance || 'normal',
            updatedAt: Math.floor(Date.now() / 1000),
          })
          .where(eq(novelSettings.id, existing.id))
          .run()
        createdSettings.push({ ...existing, content: setting.content })
      } else {
        const [novelSetting] = await db.insert(novelSettings).values({
          novelId,
          type: setting.type,
          category: setting.type,
          name: setting.title,
          content: setting.content,
          importance: setting.importance || 'normal',
          sortOrder: createdSettings.length,
        }).returning()
        createdSettings.push(novelSetting)
      }

      const novelSetting = createdSettings[createdSettings.length - 1]

      try {
        await enqueue(env, {
          type: 'index_content',
          payload: {
            sourceType: 'setting',
            sourceId: novelSetting.id,
            novelId: novelSetting.novelId,
            title: novelSetting.name,
            content: novelSetting.content.slice(0, 500),
            extraMetadata: {
              settingType: novelSetting.type,
              importance: novelSetting.importance,
            },
          },
        })
      } catch (err) {
        console.warn(`[workshop] 设定向量化入队失败 ${novelSetting.name}:`, err)
      }
    }
    createdItems.worldSettings = createdSettings
  }

  if (data.writingRules && data.writingRules.length > 0 && (isNewNovel || stage === 'concept')) {
    const existingRules = await db
      .select()
      .from(writingRules)
      .where(and(eq(writingRules.novelId, novelId), isNull(writingRules.deletedAt)))
      .all()
    const ruleMap = new Map(
      existingRules.map((r: typeof existingRules[number]) => [`${r.category}:${r.title}`, r])
    )

    const createdRules: any[] = []
    for (const rule of data.writingRules) {
      const key = `${rule.category || 'custom'}:${rule.title}`
      const existing = ruleMap.get(key)

      if (existing) {
        await db.update(writingRules)
          .set({
            content: rule.content,
            priority: rule.priority || 3,
            updatedAt: Math.floor(Date.now() / 1000),
          })
          .where(eq(writingRules.id, existing.id))
          .run()
        createdRules.push({ ...existing, content: rule.content, priority: rule.priority || 3 })
      } else {
        const [writingRule] = await db.insert(writingRules).values({
          novelId,
          category: rule.category || 'custom',
          title: rule.title,
          content: rule.content,
          priority: rule.priority || 3,
          isActive: 1,
          sortOrder: createdRules.length,
        }).returning()
        createdRules.push(writingRule)
      }
    }
    createdItems.writingRules = createdRules
  }

  if (data.characters && data.characters.length > 0) {
    const existingCharacters = await db
      .select()
      .from(characters)
      .where(and(eq(characters.novelId, novelId), isNull(characters.deletedAt)))
      .all()
    const charMap = new Map(
      existingCharacters.map((c: typeof existingCharacters[number]) => [c.name, c])
    )

    const createdCharacters = []
    for (const char of data.characters) {
      const finalAttributes = {
        ...(char.attributes || {}),
        ...(char.relationships ? { relationships: char.relationships } : {}),
      }

      const existing = charMap.get(char.name)
      let character: any

      if (existing) {
        await db.update(characters)
          .set({
            role: char.role || 'supporting',
            description: char.description || '',
            aliases: char.aliases ? JSON.stringify(char.aliases) : null,
            powerLevel: char.powerLevel || null,
            attributes: Object.keys(finalAttributes).length > 0
              ? JSON.stringify(finalAttributes)
              : null,
            updatedAt: Math.floor(Date.now() / 1000),
          })
          .where(eq(characters.id, existing.id))
          .run()
        character = {
          ...existing,
          role: char.role || 'supporting',
          description: char.description || '',
          powerLevel: char.powerLevel || null,
        }
      } else {
        const [newChar] = await db.insert(characters).values({
          novelId,
          name: char.name,
          role: char.role || 'supporting',
          description: char.description || '',
          aliases: char.aliases ? JSON.stringify(char.aliases) : null,
          powerLevel: char.powerLevel || null,
          attributes: Object.keys(finalAttributes).length > 0
            ? JSON.stringify(finalAttributes)
            : null,
        }).returning()
        character = newChar
      }
      createdCharacters.push(character)

      try {
        const indexText = [
          `${character.name}${character.role ? ` (${character.role})` : ''}`,
          (character.description || '').slice(0, 300),
          character.powerLevel ? `境界：${character.powerLevel}` : '',
        ].filter(Boolean).join('\n')

        await enqueue(env, {
          type: 'index_content',
          payload: {
            sourceType: 'character',
            sourceId: character.id,
            novelId: character.novelId,
            title: character.name,
            content: indexText,
          },
        })
      } catch (err) {
        console.warn(`[workshop] 角色向量化入队失败 ${character.name}:`, err)
      }
    }
    createdItems.characters = createdCharacters
  }

  if (data.volumes && data.volumes.length > 0) {
    const existingVolumes = await db
      .select()
      .from(volumes)
      .where(and(eq(volumes.novelId, novelId), isNull(volumes.deletedAt)))
      .all()
    const volumeMap = new Map(
      existingVolumes.map((v: typeof existingVolumes[number]) => [v.title, v])
    )

    const createdVolumes: any[] = []
    for (const vol of data.volumes) {
      const summaryValue = vol.summary || null
      const eventLineValue = Array.isArray(vol.eventLine)
        ? JSON.stringify(vol.eventLine)
        : null
      const notesValue = Array.isArray(vol.notes)
        ? JSON.stringify(vol.notes)
        : null
      const foreshadowingSetupValue = Array.isArray(vol.foreshadowingSetup)
        ? JSON.stringify(vol.foreshadowingSetup)
        : null
      const foreshadowingResolveValue = Array.isArray(vol.foreshadowingResolve)
        ? JSON.stringify(vol.foreshadowingResolve)
        : null

      const existing = volumeMap.get(vol.title)
      let volume: any

      if (existing) {
        await db.update(volumes)
          .set({
            summary: summaryValue,
            blueprint: vol.blueprint || null,
            eventLine: eventLineValue,
            notes: notesValue,
            foreshadowingSetup: foreshadowingSetupValue,
            foreshadowingResolve: foreshadowingResolveValue,
            targetWordCount: vol.targetWordCount || null,
            targetChapterCount: vol.targetChapterCount || null,
            sortOrder: createdVolumes.length,
            updatedAt: Math.floor(Date.now() / 1000),
          })
          .where(eq(volumes.id, existing.id))
          .run()
        volume = {
          ...existing,
          summary: summaryValue,
          blueprint: vol.blueprint || null,
          eventLine: eventLineValue,
          notes: notesValue,
          foreshadowingSetup: foreshadowingSetupValue,
          foreshadowingResolve: foreshadowingResolveValue,
        }
      } else {
        const [newVolume] = await db.insert(volumes).values({
          novelId,
          title: vol.title,
          summary: summaryValue,
          blueprint: vol.blueprint || null,
          eventLine: eventLineValue,
          notes: notesValue,
          foreshadowingSetup: foreshadowingSetupValue,
          foreshadowingResolve: foreshadowingResolveValue,
          chapterCount: 0,
          targetWordCount: vol.targetWordCount || null,
          targetChapterCount: vol.targetChapterCount || null,
          sortOrder: createdVolumes.length,
          status: 'draft',
        }).returning()
        volume = newVolume
      }
      createdVolumes.push(volume)

      const volumeChapters = volume.id
        ? await db.select({ id: chapters.id, sortOrder: chapters.sortOrder, title: chapters.title })
            .from(chapters)
            .where(and(eq(chapters.volumeId, volume.id), sql`${chapters.deletedAt} IS NULL`))
            .orderBy(asc(chapters.sortOrder))
            .all()
        : []

      const resolveChapterId = (hintText: string): string | null => {
        const match = hintText.match(/第(\d+)章/)
        if (!match || !volumeChapters.length) return null
        const targetIndex = parseInt(match[1]) - 1
        return volumeChapters[targetIndex]?.id || null
      }

      if (vol.foreshadowingSetup?.length) {
        for (const item of vol.foreshadowingSetup) {
          const parenMatch = item.match(/^(.+?)（(.+)）$/)
          const title = parenMatch ? parenMatch[1].trim() : item.split('（')[0].trim()
          const desc = parenMatch ? parenMatch[2].trim() : item

          const importanceMatch = title.match(/^【([高中低])】/)
          const cleanTitle = importanceMatch ? title.slice(importanceMatch[0].length) : title
          const importanceMap: Record<string, string> = { '高': 'high', '中': 'normal', '低': 'low' }
          const importance = importanceMatch ? (importanceMap[importanceMatch[1]] || 'normal') : 'normal'

          await db.insert(foreshadowing).values({
            novelId,
            volumeId: volume.id,
            title: cleanTitle,
            description: `【埋入计划】${desc}\n【所属卷】${vol.title}`,
            status: 'open',
            importance,
            chapterId: resolveChapterId(item),
          }).run()
        }
      }

      if (vol.foreshadowingResolve?.length) {
        for (const item of vol.foreshadowingResolve) {
          const parenMatch = item.match(/^(.+?)（(.+)）$/)
          const title = parenMatch ? parenMatch[1].trim() : item.split('（')[0].trim()
          const desc = parenMatch ? parenMatch[2].trim() : item

          const chapterNumMatch = desc.match(/第(\d+)章/)
          const targetChapterNum = chapterNumMatch ? parseInt(chapterNumMatch[1]) : null

          const importanceMatch = title.match(/^【([高中低])】/)
          const cleanTitle = importanceMatch ? title.slice(importanceMatch[0].length) : title
          const importanceMap: Record<string, string> = { '高': 'high', '中': 'normal', '低': 'low' }
          const importance = importanceMatch ? (importanceMap[importanceMatch[1]] || 'normal') : 'normal'

          let targetChapterId: string | null = null
          if (targetChapterNum && volumeChapters.length > 0) {
            const idx = targetChapterNum - 1
            targetChapterId = volumeChapters[idx]?.id || null
          }

          await db.insert(foreshadowing).values({
            novelId,
            volumeId: volume.id,
            title: cleanTitle,
            description: `【回收计划】${desc}\n【所属卷】${vol.title}`,
            status: 'resolve_planned',
            importance,
            chapterId: targetChapterId,
          }).run()
        }
      }
    }
    createdItems.volumes = createdVolumes
  }

  await rebuildEntityIndex(db, novelId, data, createdItems)

  await enqueue(env, {
    type: 'workshop_post_commit',
    payload: { sessionId, novelId },
  })

  await db.update(workshopSessions)
    .set({ status: 'committed', novelId })
    .where(eq(workshopSessions.id, sessionId))

  return { ok: true, novelId, createdItems }
}

/**
 * workshop_post_commit：纯调度器，不做任何 LLM 调用。
 * 将所有耗时 AI 任务拆分成独立 Queue 消息，每条单次 LLM 调用，
 * 天然不超 Cloudflare Queue visibility timeout，无需幂等锁。
 *
 * 执行顺序（串行入队，各自独立重试）：
 * 1. workshop_gen_system_prompt  — genre 专属 system prompt
 * 2. workshop_gen_outline        — AI 总纲内容生成
 * 3. workshop_gen_setting_summary × N  — 每条设定摘要
 * 4. workshop_gen_volume_summary  × N  — 每卷摘要
 * 5. workshop_gen_master_summary  — 总纲聚合摘要（依赖上面完成，串行靠队列顺序保证）
 */
export async function workshopPostCommit(
  env: Env,
  sessionId: string,
  novelId: string
): Promise<void> {
  const db = drizzle(env.DB)

  const session = await db
    .select()
    .from(workshopSessions)
    .where(eq(workshopSessions.id, sessionId))
    .get()

  if (!session) {
    console.warn('[workshop_post_commit] Session not found:', sessionId)
    return
  }

  if (session.status !== 'committed') {
    console.warn('[workshop_post_commit] Session not committed yet:', sessionId)
    return
  }

  const data: WorkshopExtractedData = JSON.parse(session.extractedData || '{}')
  const messages: import('../../lib/queue').QueueMessage[] = []

  // 1. genre system prompt
  if (data.genre) {
    messages.push({
      type: 'workshop_gen_system_prompt',
      payload: { sessionId, novelId },
    })
  }

  // 2. AI 总纲生成
  if (data.title) {
    messages.push({
      type: 'workshop_gen_outline',
      payload: { sessionId, novelId },
    })
  }

  // 3. 设定摘要（每条独立）
  if (data.worldSettings?.length) {
    const existingSettings = await db
      .select({ id: novelSettings.id, type: novelSettings.type, name: novelSettings.name })
      .from(novelSettings)
      .where(and(eq(novelSettings.novelId, novelId), isNull(novelSettings.deletedAt)))
      .all()
    const settingMap = new Map(
      existingSettings.map(s => [`${s.type}:${s.name}`, s])
    )

    for (const setting of data.worldSettings) {
      const existing = settingMap.get(`${setting.type}:${setting.title}`)
      if (!existing) continue
      messages.push({
        type: 'workshop_gen_setting_summary',
        payload: { novelId, settingId: existing.id, settingTitle: setting.title },
      })
    }
  }

  // 4. 卷摘要（每卷独立）
  if (data.volumes?.length) {
    const existingVolumes = await db
      .select({ id: volumes.id, title: volumes.title })
      .from(volumes)
      .where(and(eq(volumes.novelId, novelId), isNull(volumes.deletedAt)))
      .all()
    const volumeMap = new Map(existingVolumes.map(v => [v.title, v]))

    for (const vol of data.volumes) {
      const existing = volumeMap.get(vol.title)
      if (!existing) continue
      messages.push({
        type: 'workshop_gen_volume_summary',
        payload: { novelId, volumeId: existing.id, volumeTitle: vol.title },
      })
    }
  }

  // 5. 总纲聚合摘要（串行排在最后，等上面都完成后才跑）
  if (data.title && data.worldSettings) {
    messages.push({
      type: 'workshop_gen_master_summary',
      payload: { novelId },
    })
  }

  if (messages.length > 0) {
    const { enqueueBatch } = await import('../../lib/queue')
    await enqueueBatch(env, messages)
  }

  console.log(`[workshop_post_commit] 已入队 ${messages.length} 个子任务 for novel ${novelId}`)
}

export async function rebuildEntityIndex(
  db: any,
  novelId: string,
  data: WorkshopExtractedData,
  createdItems?: any
): Promise<void> {
  const now = Math.floor(Date.now() / 1000)

  const entries = []

  entries.push({
    entityType: 'novel',
    entityId: novelId,
    novelId,
    parentId: null,
    title: data.title || '未命名小说',
    sortOrder: 0,
    depth: 0,
  })

  if (data.worldSettings) {
    const settingIds: string[] = createdItems?.worldSettings?.map((s: any) => s.id) || []
    for (let i = 0; i < data.worldSettings.length; i++) {
      const setting = data.worldSettings[i]
      entries.push({
        entityType: 'setting',
        entityId: settingIds[i] || `ws_${i}`,
        novelId,
        parentId: novelId,
        title: setting.title,
        sortOrder: i,
        depth: 1,
        meta: JSON.stringify({ type: setting.type }),
      })
    }
  }

  if (data.characters) {
    const charIds: string[] = createdItems?.characters?.map((c: any) => c.id) || []
    for (let i = 0; i < data.characters.length; i++) {
      const char = data.characters[i]
      entries.push({
        entityType: 'character',
        entityId: charIds[i] || `char_${i}`,
        novelId,
        parentId: novelId,
        title: char.name,
        sortOrder: i,
        depth: 1,
        meta: JSON.stringify({ role: char.role }),
      })
    }
  }

  if (data.volumes) {
    const volIds: string[] = createdItems?.volumes?.map((v: any) => v.id) || []
    for (let i = 0; i < data.volumes.length; i++) {
      const vol = data.volumes[i]
      entries.push({
        entityType: 'volume',
        entityId: volIds[i] || `vol_${i}`,
        novelId,
        parentId: novelId,
        title: vol.title,
        sortOrder: i,
        depth: 1,
      })
    }
  }

  if (entries.length > 1) {
    for (const entry of entries.slice(1)) {
      await db.insert(entityIndex).values({
        ...entry,
        updatedAt: now,
      }).onConflictDoNothing().run()
    }
  }
}
