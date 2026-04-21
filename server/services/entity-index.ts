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
        children: buildTree(entity.id),
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
  stats: {
    volumes: number
    characters: number
    settings: number
  }
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
      return { ok: false, message: '小说不存在', stats: { volumes: 0, characters: 0, settings: 0 } }
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
        parentId: novelId,
        title: vol.title,
        depth: 1,
        meta: JSON.stringify({
          status: vol.status,
          wordCount: vol.wordCount,
          chapterCount: vol.chapterCount || 0,
          hasOutline: !!vol.outline,
        }),
      })

      const chapterList = await db.select()
        .from(chapters)
        .where(and(
          eq(chapters.volumeId, vol.id),
          sql`${chapters.deletedAt} IS NULL`
        ))
        .orderBy(chapters.sortOrder)
        .all()

      for (const ch of chapterList) {
        await db.insert(entityIndex).values({
          entityType: 'chapter',
          entityId: ch.id,
          novelId,
          parentId: vol.id,
          title: ch.title,
          depth: 2,
          meta: JSON.stringify({
            status: ch.status,
            wordCount: ch.wordCount,
            hasSummary: !!ch.summary,
            hasContent: !!ch.content,
          }),
        })
      }
    }

    const charList = await db.select()
      .from(characters)
      .where(and(
        eq(characters.novelId, novelId),
        sql`${characters.deletedAt} IS NULL`
      ))
      .all()

    for (const char of charList) {
      await db.insert(entityIndex).values({
        entityType: 'character',
        entityId: char.id,
        novelId,
        parentId: novelId,
        title: char.name,
        depth: 1,
        meta: JSON.stringify({
          role: char.role,
          hasPowerLevel: !!char.powerLevel,
        }),
      })
    }

    const settingList = await db.select()
      .from(novelSettings)
      .where(and(
        eq(novelSettings.novelId, novelId),
        sql`${novelSettings.deletedAt} IS NULL`
      ))
      .all()

    for (const setting of settingList) {
      await db.insert(entityIndex).values({
        entityType: 'setting',
        entityId: setting.id,
        novelId,
        parentId: novelId,
        title: setting.name,
        depth: 1,
        meta: JSON.stringify({
          type: setting.type,
          category: setting.category,
          importance: setting.importance,
        }),
      })
    }

    console.log(`Entity index rebuilt for novel ${novelId}`)

    return { 
      ok: true, 
      message: '索引重建完成',
      stats: {
        volumes: volumeList.length,
        characters: charList.length,
        settings: settingList.length,
      }
    }
  } catch (error) {
    console.error('Failed to rebuild entity index:', error)
    return { 
      ok: false, 
      message: '索引重建失败', 
      error: (error as Error).message,
      stats: { volumes: 0, characters: 0, settings: 0 }
    }
  }
}
