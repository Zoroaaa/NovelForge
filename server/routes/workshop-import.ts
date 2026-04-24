/**
 * @file workshop-import.ts
 * @description 创作工坊导入数据 API - 将格式化后的数据写入数据库
 */
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { drizzle } from 'drizzle-orm/d1'
import { eq } from 'drizzle-orm'
import type { Env } from '../lib/types'
import {
  characters,
  volumes,
  chapters,
  novelSettings,
  writingRules,
  foreshadowing,
} from '../db/schema'
import { enqueue } from '../lib/queue'

const router = new Hono<{ Bindings: Env }>()

const importDataSchema = z.object({
  module: z.enum(['chapter', 'volume', 'setting', 'character', 'rule', 'foreshadowing']),
  data: z.record(z.string(), z.unknown()),
  novelId: z.string().min(1, 'novelId 不能为空'),
})

router.post('/import', zValidator('json', importDataSchema), async (c) => {
  const db = drizzle(c.env.DB)

  try {
    const body = c.req.valid('json')
    const { module, data, novelId } = body

    let itemsToImport: Record<string, unknown>[] = []

    if (Array.isArray(data)) {
      itemsToImport = data
    } else if (data.items && Array.isArray(data.items)) {
      itemsToImport = data.items
    } else {
      itemsToImport = [data]
    }

    let createdItems: any[] = []

    for (const itemData of itemsToImport) {
      switch (module) {
        case 'character': {
          const charData = itemData as {
            name?: string
            role?: string
            description?: string
            aliases?: string[]
            attributes?: Record<string, unknown>
            powerLevel?: string
            relationships?: string[]
          }

          const [character] = await db.insert(characters).values({
            novelId,
            name: charData.name || '未命名角色',
            role: charData.role || 'supporting',
            description: charData.description || '',
            aliases: charData.aliases ? JSON.stringify(charData.aliases) : null,
            attributes: charData.attributes ? JSON.stringify(charData.attributes) : null,
            powerLevel: charData.powerLevel || null,
          }).returning()

          createdItems.push(character)

          if (character && c.env.VECTORIZE) {
            const indexText = `${character.name}${character.role ? ` (${character.role})` : ''}\n${(character.description || '').slice(0, 300)}`
            await enqueue(c.env, {
              type: 'index_content',
              payload: {
                sourceType: 'character',
                sourceId: character.id,
                novelId,
                title: character.name,
                content: indexText,
              },
            })
          }
          break
        }

        case 'volume': {
          const volData = itemData as {
            title?: string
            outline?: string
            blueprint?: string
            chapterCount?: number
            keyEvents?: string[]
            foreshadowingSetup?: string[]
          }

          const existVolumes = await db.select().from(volumes).where(eq(volumes.novelId, novelId)).all()
          const sortOrder = existVolumes.length + createdItems.filter(i => i && i.title && i.sortOrder !== undefined).length

          const [volume] = await db.insert(volumes).values({
            novelId,
            title: volData.title || '未命名卷',
            blueprint: volData.blueprint || volData.outline || '',
            eventLine: volData.outline || '',
            chapterCount: volData.chapterCount || 0,
            sortOrder,
            status: 'draft',
          }).returning()

          createdItems.push(volume)

          if (volData.foreshadowingSetup && volData.foreshadowingSetup.length > 0) {
            for (const fs of volData.foreshadowingSetup) {
              await db.insert(foreshadowing).values({
                novelId,
                title: fs,
                status: 'open',
                importance: 'normal',
              }).run()
            }
          }
          break
        }

        case 'chapter': {
          const chapData = itemData as {
            title?: string
            content?: string
            outline?: string
          }

          let volumeId: string | null = null
          const existVolumes = await db.select().from(volumes).where(eq(volumes.novelId, novelId)).all()
          if (existVolumes.length > 0) {
            volumeId = existVolumes[0].id
          }

          const existChapters = await db.select().from(chapters).where(eq(chapters.novelId, novelId)).all()
          const sortOrder = existChapters.length + createdItems.filter(i => i && i.sortOrder !== undefined).length

          const [chapter] = await db.insert(chapters).values({
            novelId,
            volumeId,
            title: chapData.title || '未命名章节',
            content: chapData.content || '',
            sortOrder,
            status: 'draft',
            wordCount: chapData.content ? chapData.content.length : 0,
          }).returning()

          createdItems.push(chapter)
          break
        }

        case 'setting': {
          const settingData = itemData as {
            type?: string
            name?: string
            content?: string
            summary?: string
            importance?: string
          }

          const existSettings = await db.select().from(novelSettings).where(eq(novelSettings.novelId, novelId)).all()
          const sortOrder = existSettings.length + createdItems.filter(i => i && i.sortOrder !== undefined).length

          const [setting] = await db.insert(novelSettings).values({
            novelId,
            type: settingData.type || 'misc',
            category: settingData.type || 'misc',
            name: settingData.name || '未命名设定',
            content: settingData.content || '',
            summary: settingData.summary || '',
            importance: (settingData.importance as 'high' | 'normal' | 'low') || 'normal',
            sortOrder,
          }).returning()

          createdItems.push(setting)

          if (setting && c.env.VECTORIZE) {
            await enqueue(c.env, {
              type: 'index_content',
              payload: {
                sourceType: 'setting',
                sourceId: setting.id,
                novelId,
                title: setting.name,
                content: settingData.content?.slice(0, 500) || '',
              },
            })
          }
          break
        }

        case 'rule': {
          const ruleData = itemData as {
            category?: string
            title?: string
            content?: string
            priority?: number
          }

          const existRules = await db.select().from(writingRules).where(eq(writingRules.novelId, novelId)).all()
          const sortOrder = existRules.length + createdItems.filter(i => i && i.sortOrder !== undefined).length

          const [rule] = await db.insert(writingRules).values({
            novelId,
            category: ruleData.category || 'custom',
            title: ruleData.title || '未命名规则',
            content: ruleData.content || '',
            priority: ruleData.priority || 3,
            isActive: 1,
            sortOrder,
          }).returning()

          createdItems.push(rule)
          break
        }

        case 'foreshadowing': {
          const fsData = itemData as {
            title?: string
            description?: string
            status?: string
            importance?: string
          }

          const [foreshadow] = await db.insert(foreshadowing).values({
            novelId,
            title: fsData.title || '未命名伏笔',
            description: fsData.description || '',
            status: (fsData.status as 'open' | 'resolved' | 'abandoned') || 'open',
            importance: (fsData.importance as 'high' | 'normal' | 'low') || 'normal',
          }).returning()

          createdItems.push(foreshadow)
          break
        }

        default:
          continue
      }
    }

    return c.json({
      ok: true,
      createdItems,
      count: createdItems.length,
      message: `成功导入 ${createdItems.length} 条数据到 ${module} 模块`,
    })
  } catch (error) {
    console.error('Import data failed:', error)
    return c.json({
      ok: false,
      error: (error as Error).message,
    }, 500)
  }
})

router.post('/import-batch', zValidator('json', z.object({
  module: z.enum(['chapter', 'volume', 'setting', 'character', 'rule', 'foreshadowing']),
  data: z.array(z.record(z.string(), z.unknown())),
  novelId: z.string().min(1, 'novelId 不能为空'),
})), async (c) => {
  const db = drizzle(c.env.DB)

  try {
    const body = c.req.valid('json')
    const { module, data, novelId } = body

    const createdItems: any[] = []

    for (const item of data) {
      switch (module) {
        case 'character': {
          const charData = item as {
            name?: string
            role?: string
            description?: string
            aliases?: string[]
            attributes?: Record<string, unknown>
            powerLevel?: string
          }

          const [character] = await db.insert(characters).values({
            novelId,
            name: charData.name || '未命名角色',
            role: charData.role || 'supporting',
            description: charData.description || '',
            aliases: charData.aliases ? JSON.stringify(charData.aliases) : null,
            attributes: charData.attributes ? JSON.stringify(charData.attributes) : null,
            powerLevel: charData.powerLevel || null,
          }).returning()

          createdItems.push(character)
          break
        }

        case 'volume': {
          const volData = item as {
            title?: string
            outline?: string
            blueprint?: string
            chapterCount?: number
          }

          const existVolumes = await db.select().from(volumes).where(eq(volumes.novelId, novelId)).all()
          const sortOrder = existVolumes.length + createdItems.filter(i => i && i.title).length

          const [volume] = await db.insert(volumes).values({
            novelId,
            title: volData.title || '未命名卷',
            blueprint: volData.blueprint || volData.outline || '',
            eventLine: volData.outline || '',
            chapterCount: volData.chapterCount || 0,
            sortOrder,
            status: 'draft',
          }).returning()

          createdItems.push(volume)
          break
        }

        case 'setting': {
          const settingData = item as {
            type?: string
            name?: string
            content?: string
            summary?: string
          }

          const existSettings = await db.select().from(novelSettings).where(eq(novelSettings.novelId, novelId)).all()
          const sortOrder = existSettings.length + createdItems.filter(i => i && i.name).length

          const [setting] = await db.insert(novelSettings).values({
            novelId,
            type: settingData.type || 'misc',
            category: settingData.type || 'misc',
            name: settingData.name || '未命名设定',
            content: settingData.content || '',
            summary: settingData.summary || '',
            importance: 'normal',
            sortOrder,
          }).returning()

          createdItems.push(setting)
          break
        }

        case 'rule': {
          const ruleData = item as {
            category?: string
            title?: string
            content?: string
            priority?: number
          }

          const existRules = await db.select().from(writingRules).where(eq(writingRules.novelId, novelId)).all()
          const sortOrder = existRules.length + createdItems.filter(i => i && i.title).length

          const [rule] = await db.insert(writingRules).values({
            novelId,
            category: ruleData.category || 'custom',
            title: ruleData.title || '未命名规则',
            content: ruleData.content || '',
            priority: ruleData.priority || 3,
            isActive: 1,
            sortOrder,
          }).returning()

          createdItems.push(rule)
          break
        }

        case 'foreshadowing': {
          const fsData = item as {
            title?: string
            description?: string
            status?: string
            importance?: string
          }

          const [foreshadow] = await db.insert(foreshadowing).values({
            novelId,
            title: fsData.title || '未命名伏笔',
            description: fsData.description || '',
            status: (fsData.status as 'open' | 'resolved' | 'abandoned') || 'open',
            importance: (fsData.importance as 'high' | 'normal' | 'low') || 'normal',
          }).returning()

          createdItems.push(foreshadow)
          break
        }

        default:
          continue
      }
    }

    return c.json({
      ok: true,
      createdItems,
      count: createdItems.length,
      message: `成功批量导入 ${createdItems.length} 条数据到 ${module} 模块`,
    })
  } catch (error) {
    console.error('Batch import data failed:', error)
    return c.json({
      ok: false,
      error: (error as Error).message,
    }, 500)
  }
})

export { router as workshopImport }