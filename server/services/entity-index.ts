/**
 * @file entity-index.ts
 * @description 实体索引服务模块，提供实体树构建和索引重建功能
 * @version 1.0.0
 * @modified 2026-04-21 - 添加规范化注释
 */
import { drizzle } from 'drizzle-orm/d1'
import {
  entityIndex,
  novels,
  volumes,
  chapters,
  characters,
  novelSettings,
  masterOutline,
  writingRules,
  foreshadowing,
} from '../db/schema'
import { eq, and, sql } from 'drizzle-orm'
import type { Env } from '../lib/types'

export interface EntityNode {
  id: string
  type: string
  entityId: string
  title: string
  depth: number
  meta: any
  children: EntityNode[]
}

export interface EntityTree {
  tree: EntityNode[]
  stats: Record<string, number>
  totalNodes: number
}

export async function getEntityTree(env: Env, novelId: string): Promise<EntityTree> {
  const db = drizzle(env.DB)

  const allEntities = await db.select()
    .from(entityIndex)
    .where(eq(entityIndex.novelId, novelId))
    .orderBy(entityIndex.depth, entityIndex.sortOrder)
    .all()

  const buildTree = (parentId: string | null = null): EntityNode[] => {
    return allEntities
      .filter(e => e.parentId === parentId)
      .map(entity => ({
        id: entity.id,
        type: entity.entityType,
        entityId: entity.entityId,
        title: entity.title,
        depth: entity.depth,
        meta: entity.meta ? JSON.parse(entity.meta) : null,
        children: buildTree(entity.entityId),
      }))
  }

  const tree = buildTree(null)

  const stats = allEntities.reduce((acc, e) => {
    acc[e.entityType] = (acc[e.entityType] || 0) + 1
    return acc
  }, {} as Record<string, number>)

  return {
    tree,
    stats,
    totalNodes: allEntities.length,
  }
}

export async function getEntityChildren(
  env: Env,
  novelId: string,
  parentId: string
): Promise<any[]> {
  const db = drizzle(env.DB)

  const children = await db.select()
    .from(entityIndex)
    .where(and(
      eq(entityIndex.novelId, novelId),
      eq(entityIndex.parentId, parentId)
    ))
    .orderBy(entityIndex.sortOrder)
    .all()

  return children
}

export async function rebuildEntityIndex(env: Env, novelId: string): Promise<{
  ok: boolean
  message: string
  stats: Record<string, number>
  error?: string
}> {
  const db = drizzle(env.DB)

  try {
    await db.delete(entityIndex).where(eq(entityIndex.novelId, novelId))

    const novel = await db.select()
      .from(novels)
      .where(eq(novels.id, novelId))
      .get()

    if (!novel) {
      return { ok: false, message: '小说不存在', stats: {} }
    }

    await db.insert(entityIndex).values({
      entityType: 'novel',
      entityId: novelId,
      novelId,
      parentId: null,
      title: novel.title,
      depth: 0,
      meta: JSON.stringify({
        status: novel.status,
        wordCount: novel.wordCount,
        chapterCount: novel.chapterCount,
      }),
    })

    const MODULE_PREFIX = '__module__'
    let stats: Record<string, number> = {}

    const mo = await db.select()
      .from(masterOutline)
      .where(and(eq(masterOutline.novelId, novelId), sql`${masterOutline.deletedAt} IS NULL`))
      .get()

    if (mo) {
      await db.insert(entityIndex).values({
        entityType: 'master-outline',
        entityId: mo.id,
        novelId,
        parentId: `${MODULE_PREFIX}master-outline`,
        title: mo.title || '总纲',
        depth: 2,
        meta: JSON.stringify({ version: mo.version, wordCount: mo.wordCount, hasContent: !!mo.content }),
      })
      stats['总纲'] = 1
    }

    await db.insert(entityIndex).values({
      entityType: 'module',
      entityId: `${MODULE_PREFIX}master-outline`,
      novelId,
      parentId: novelId,
      title: '总纲',
      depth: 1,
      sortOrder: 0,
      meta: JSON.stringify({ moduleType: 'master-outline', count: mo ? 1 : 0 }),
    })

    await db.insert(entityIndex).values({
      entityType: 'module',
      entityId: `${MODULE_PREFIX}settings`,
      novelId,
      parentId: novelId,
      title: '设定',
      depth: 1,
      sortOrder: 1,
      meta: JSON.stringify({ moduleType: 'settings' }),
    })

    const settingList = await db.select()
      .from(novelSettings)
      .where(and(eq(novelSettings.novelId, novelId), sql`${novelSettings.deletedAt} IS NULL`))
      .orderBy(novelSettings.sortOrder)
      .all()

    for (const setting of settingList) {
      await db.insert(entityIndex).values({
        entityType: 'setting',
        entityId: setting.id,
        novelId,
        parentId: `${MODULE_PREFIX}settings`,
        title: setting.name,
        depth: 2,
        meta: JSON.stringify({
          type: setting.type,
          category: setting.category,
          importance: setting.importance,
        }),
      })
    }
    stats['设定'] = settingList.length

    await db.insert(entityIndex).values({
      entityType: 'module',
      entityId: `${MODULE_PREFIX}volumes`,
      novelId,
      parentId: novelId,
      title: '卷',
      depth: 1,
      sortOrder: 2,
      meta: JSON.stringify({ moduleType: 'volumes' }),
    })

    const volumeList = await db.select()
      .from(volumes)
      .where(eq(volumes.novelId, novelId))
      .orderBy(volumes.sortOrder)
      .all()

    for (const vol of volumeList) {
      await db.insert(entityIndex).values({
        entityType: 'volume',
        entityId: vol.id,
        novelId,
        parentId: `${MODULE_PREFIX}volumes`,
        title: vol.title,
        depth: 2,
        meta: JSON.stringify({
          status: vol.status,
          wordCount: vol.wordCount,
          chapterCount: vol.chapterCount || 0,
          hasOutline: !!vol.eventLine,
        }),
      })

      const chapterList = await db.select()
        .from(chapters)
        .where(and(eq(chapters.volumeId, vol.id), sql`${chapters.deletedAt} IS NULL`))
        .orderBy(chapters.sortOrder)
        .all()

      for (const ch of chapterList) {
        await db.insert(entityIndex).values({
          entityType: 'chapter',
          entityId: ch.id,
          novelId,
          parentId: vol.id,
          title: ch.title,
          depth: 3,
          meta: JSON.stringify({
            status: ch.status,
            wordCount: ch.wordCount,
            hasSummary: !!ch.summary,
            hasContent: !!ch.content,
          }),
        })
      }
    }
    stats['卷'] = volumeList.length

    await db.insert(entityIndex).values({
      entityType: 'module',
      entityId: `${MODULE_PREFIX}characters`,
      novelId,
      parentId: novelId,
      title: '角色',
      depth: 1,
      sortOrder: 3,
      meta: JSON.stringify({ moduleType: 'characters' }),
    })

    const charList = await db.select()
      .from(characters)
      .where(and(eq(characters.novelId, novelId), sql`${characters.deletedAt} IS NULL`))
      .all()

    for (const char of charList) {
      await db.insert(entityIndex).values({
        entityType: 'character',
        entityId: char.id,
        novelId,
        parentId: `${MODULE_PREFIX}characters`,
        title: char.name,
        depth: 2,
        meta: JSON.stringify({
          role: char.role,
          hasPowerLevel: !!char.powerLevel,
        }),
      })
    }
    stats['角色'] = charList.length

    await db.insert(entityIndex).values({
      entityType: 'module',
      entityId: `${MODULE_PREFIX}foreshadowing`,
      novelId,
      parentId: novelId,
      title: '伏笔',
      depth: 1,
      sortOrder: 4,
      meta: JSON.stringify({ moduleType: 'foreshadowing' }),
    })

    const foreshadowingList = await db.select()
      .from(foreshadowing)
      .where(and(eq(foreshadowing.novelId, novelId), sql`${foreshadowing.deletedAt} IS NULL`))
      .all()

    for (const item of foreshadowingList) {
      await db.insert(entityIndex).values({
        entityType: 'foreshadowing',
        entityId: item.id,
        novelId,
        parentId: `${MODULE_PREFIX}foreshadowing`,
        title: item.title,
        depth: 2,
        meta: JSON.stringify({
          status: item.status,
          importance: item.importance,
        }),
      })
    }
    stats['伏笔'] = foreshadowingList.length

    await db.insert(entityIndex).values({
      entityType: 'module',
      entityId: `${MODULE_PREFIX}rules`,
      novelId,
      parentId: novelId,
      title: '规则',
      depth: 1,
      sortOrder: 5,
      meta: JSON.stringify({ moduleType: 'rules' }),
    })

    const rulesList = await db.select()
      .from(writingRules)
      .where(and(eq(writingRules.novelId, novelId), sql`${writingRules.deletedAt} IS NULL`))
      .orderBy(writingRules.sortOrder)
      .all()

    for (const rule of rulesList) {
      await db.insert(entityIndex).values({
        entityType: 'rule',
        entityId: rule.id,
        novelId,
        parentId: `${MODULE_PREFIX}rules`,
        title: rule.title,
        depth: 2,
        meta: JSON.stringify({
          category: rule.category,
          priority: rule.priority,
          isActive: rule.isActive,
        }),
      })
    }
    stats['规则'] = rulesList.length

    console.log(`Entity index rebuilt for novel ${novelId}`)

    return {
      ok: true,
      message: '索引重建完成',
      stats,
    }
  } catch (error) {
    console.error('Failed to rebuild entity index:', error)
    return {
      ok: false,
      message: '索引重建失败',
      error: (error as Error).message,
      stats: {},
    }
  }
}
