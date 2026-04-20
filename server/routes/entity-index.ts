/**
 * NovelForge · 总索引路由（v2.0）
 *
 * API 端点：
 * GET    /api/v1/entities/:novelId            - 获取完整树形结构
 * GET    /api/v1/entities/:novelId/children/:parentId  - 获取子节点
 * POST   /api/v1/entities/rebuild             - 重建索引（管理员操作）
 */

import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { drizzle } from 'drizzle-orm/d1'
import {
  entityIndex,
  novels,
  volumes,
  chapters,
  characters,
  novelSettings,
  writingRules,
  foreshadowing,
} from '../db/schema'
import { eq, and, sql, desc } from 'drizzle-orm'
import type { Env } from '../lib/types'

const router = new Hono<{ Bindings: Env }>()

// GET /entities/:novelId - 获取小说的完整树形结构
router.get('/:novelId', async (c) => {
  const novelId = c.req.param('novelId')
  const db = drizzle(c.env.DB)

  // 查询所有实体节点
  const allEntities = await db.select()
    .from(entityIndex)
    .where(eq(entityIndex.novelId, novelId))
    .orderBy(entityIndex.depth, entityIndex.sortOrder)
    .all()

  // 构建树形结构
  const buildTree = (parentId: string | null = null): any[] => {
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

  // 根节点是小说本身
  const tree = buildTree(null)

  // 统计各类型数量
  const stats = allEntities.reduce((acc, e) => {
    acc[e.entityType] = (acc[e.entityType] || 0) + 1
    return acc
  }, {} as Record<string, number>)

  return c.json({
    tree,
    stats,
    totalNodes: allEntities.length,
  })
})

// GET /entities/:novelId/children/:parentId - 获取某个节点的直接子节点
router.get('/:novelId/children/:parentId', async (c) => {
  const { novelId, parentId } = c.req.params
  const db = drizzle(c.env.DB)

  const children = await db.select()
    .from(entityIndex)
    .where(and(
      eq(entityIndex.novelId, novelId),
      eq(entityIndex.parentId, parentId)
    ))
    .orderBy(entityIndex.sortOrder)
    .all()

  return c.json({ children })
})

// POST /entities/rebuild - 重建整个小说的实体索引树
const RebuildSchema = z.object({
  novelId: z.string().min(1),
})

router.post('/rebuild', zValidator('json', RebuildSchema), async (c) => {
  const { novelId } = c.req.valid('json')
  const db = drizzle(c.env.DB)
  
  try {
    // 清除旧索引
    await db.delete(entityIndex).where(eq(entityIndex.novelId, novelId))

    // 重建根节点（小说）
    const novel = await db.select()
      .from(novels)
      .where(eq(novels.id, novelId))
      .get()

    if (!novel) {
      return c.json({ error: '小说不存在' }, 404)
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

    // 卷节点
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

      // 章节点
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

    // 角色节点
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

    // 设定节点
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

    return c.json({ 
      ok: true, 
      message: '索引重建完成',
      stats: {
        volumes: volumeList.length,
        characters: charList.length,
        settings: settingList.length,
      }
    })
  } catch (error) {
    console.error('Failed to rebuild entity index:', error)
    return c.json({ error: '索引重建失败' }, 500)
  }
})

export { router as entityIndexRouter }
