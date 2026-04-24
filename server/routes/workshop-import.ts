/**
 * @file workshop-import.ts
 * @description 创作工坊导入数据 API - 支持新建和更新
 */
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { drizzle } from 'drizzle-orm/d1'
import { eq, and, desc, sql } from 'drizzle-orm'
import type { Env } from '../lib/types'
import {
  characters,
  volumes,
  chapters,
  novelSettings,
  writingRules,
  foreshadowing,
  masterOutline,
} from '../db/schema'
import { enqueue } from '../lib/queue'

const router = new Hono<{ Bindings: Env }>()

const importDataSchema = z.object({
  module: z.enum(['chapter', 'volume', 'setting', 'character', 'rule', 'foreshadowing', 'master_outline']),
  data: z.union([
    z.record(z.string(), z.unknown()),
    z.array(z.record(z.string(), z.unknown()))
  ]),
  novelId: z.string().min(1, 'novelId 不能为空'),
  importMode: z.enum(['create', 'update', 'upsert']).default('upsert'),
})

type ImportResult = {
  action: 'created' | 'updated' | 'skipped'
  id: string
  name: string
  existed: boolean
}

router.get('/list/:module', zValidator('param', z.object({
  module: z.enum(['chapter', 'volume', 'setting', 'character', 'rule', 'foreshadowing', 'master_outline']),
})), zValidator('query', z.object({
  novelId: z.string().min(1),
})), async (c) => {
  const db = drizzle(c.env.DB)
  const { module } = c.req.valid('param')
  const { novelId } = c.req.valid('query')

  try {
    let items: any[] = []

    switch (module) {
      case 'master_outline': {
        const outlineList = await db.select({
          id: masterOutline.id,
          title: masterOutline.title,
          version: masterOutline.version,
          summary: masterOutline.summary,
          wordCount: masterOutline.wordCount,
        })
        .from(masterOutline)
        .where(and(
          eq(masterOutline.novelId, novelId),
          sql`${masterOutline.deletedAt} IS NULL`
        ))
        .orderBy(desc(masterOutline.version))
        .all()
        items = outlineList
        break
      }

      case 'setting':
        items = await db.select({
          id: novelSettings.id,
          name: novelSettings.name,
          type: novelSettings.type,
          category: novelSettings.category,
        })
        .from(novelSettings)
        .where(and(
          eq(novelSettings.novelId, novelId),
          eq(novelSettings.deletedAt, null as any)
        ))
        .all()
        break

      case 'character':
        items = await db.select({
          id: characters.id,
          name: characters.name,
          role: characters.role,
          description: characters.description,
        })
        .from(characters)
        .where(and(
          eq(characters.novelId, novelId),
          eq(characters.deletedAt, null as any)
        ))
        .all()
        break

      case 'rule':
        items = await db.select({
          id: writingRules.id,
          title: writingRules.title,
          category: writingRules.category,
          content: writingRules.content,
        })
        .from(writingRules)
        .where(and(
          eq(writingRules.novelId, novelId),
          eq(writingRules.deletedAt, null as any)
        ))
        .all()
        break

      case 'volume':
        items = await db.select({
          id: volumes.id,
          title: volumes.title,
          blueprint: volumes.blueprint,
          status: volumes.status,
        })
        .from(volumes)
        .where(and(
          eq(volumes.novelId, novelId),
          eq(volumes.deletedAt, null as any)
        ))
        .all()
        break

      case 'foreshadowing':
        items = await db.select({
          id: foreshadowing.id,
          title: foreshadowing.title,
          status: foreshadowing.status,
          importance: foreshadowing.importance,
        })
        .from(foreshadowing)
        .where(eq(foreshadowing.novelId, novelId))
        .all()
        break

      case 'chapter':
        items = await db.select({
          id: chapters.id,
          title: chapters.title,
          status: chapters.status,
          wordCount: chapters.wordCount,
        })
        .from(chapters)
        .where(eq(chapters.novelId, novelId))
        .all()
        break

      default:
        return c.json({ ok: false, error: 'Invalid module' }, 400)
    }

    return c.json({ ok: true, items })
  } catch (error) {
    console.error('List items failed:', error)
    return c.json({ ok: false, error: (error as Error).message }, 500)
  }
})

router.post('/import', zValidator('json', importDataSchema), async (c) => {
  const db = drizzle(c.env.DB)

  try {
    const body = c.req.valid('json')
    const { module, data, novelId, importMode } = body

    let itemsToImport: Record<string, unknown>[] = []

    if (Array.isArray(data)) {
      itemsToImport = data
    } else if (data.items && Array.isArray(data.items)) {
      itemsToImport = data.items
    } else {
      itemsToImport = [data]
    }

    const results: ImportResult[] = []

    for (const itemData of itemsToImport) {
      switch (module) {
        case 'character': {
          const charData = itemData as {
            id?: string
            name?: string
            role?: string
            description?: string
            aliases?: string[]
            attributes?: Record<string, unknown>
            powerLevel?: string
          }

          const name = charData.name || '未命名角色'

          if (importMode === 'update') {
            if (!charData.id) {
              results.push({ action: 'skipped', id: '', name, existed: false })
              continue
            }
            await db.update(characters)
              .set({
                name,
                role: charData.role || 'supporting',
                description: charData.description || '',
                aliases: charData.aliases ? JSON.stringify(charData.aliases) : null,
                attributes: charData.attributes ? JSON.stringify(charData.attributes) : null,
                powerLevel: charData.powerLevel || null,
                updatedAt: Math.floor(Date.now() / 1000),
              })
              .where(eq(characters.id, charData.id))
            results.push({ action: 'updated', id: charData.id, name, existed: true })
          } else {
            const existing = await db.select()
              .from(characters)
              .where(and(
                eq(characters.novelId, novelId),
                eq(characters.name, name),
                eq(characters.deletedAt, null as any)
              ))
              .limit(1)
              .all()

            if (existing.length > 0) {
              if (importMode === 'create') {
                results.push({ action: 'skipped', id: existing[0].id, name, existed: true })
              } else {
                await db.update(characters)
                  .set({
                    role: charData.role || existing[0].role,
                    description: charData.description || existing[0].description,
                    aliases: charData.aliases ? JSON.stringify(charData.aliases) : existing[0].aliases,
                    attributes: charData.attributes ? JSON.stringify(charData.attributes) : existing[0].attributes,
                    powerLevel: charData.powerLevel || existing[0].powerLevel,
                    updatedAt: Math.floor(Date.now() / 1000),
                  })
                  .where(eq(characters.id, existing[0].id))
                results.push({ action: 'updated', id: existing[0].id, name, existed: true })
              }
            } else {
              const [character] = await db.insert(characters).values({
                novelId,
                name,
                role: charData.role || 'supporting',
                description: charData.description || '',
                aliases: charData.aliases ? JSON.stringify(charData.aliases) : null,
                attributes: charData.attributes ? JSON.stringify(charData.attributes) : null,
                powerLevel: charData.powerLevel || null,
              }).returning()
              results.push({ action: 'created', id: character.id, name, existed: false })
            }
          }
          break
        }

        case 'volume': {
          const volData = itemData as {
            id?: string
            title?: string
            summary?: string
            blueprint?: string
            eventLine?: string | string[]
            notes?: string | string[]
            chapterCount?: number
          }

          const title = volData.title || '未命名卷'
          const eventLineValue = Array.isArray(volData.eventLine)
            ? JSON.stringify(volData.eventLine)
            : volData.eventLine || null
          const notesValue = Array.isArray(volData.notes)
            ? JSON.stringify(volData.notes)
            : volData.notes || null

          if (importMode === 'update') {
            if (!volData.id) {
              results.push({ action: 'skipped', id: '', name: title, existed: false })
              continue
            }
            await db.update(volumes)
              .set({
                title,
                summary: volData.summary || null,
                blueprint: volData.blueprint || null,
                eventLine: eventLineValue,
                notes: notesValue,
                chapterCount: volData.chapterCount || 0,
                updatedAt: Math.floor(Date.now() / 1000),
              })
              .where(eq(volumes.id, volData.id))
            results.push({ action: 'updated', id: volData.id, name: title, existed: true })
          } else {
            const existing = await db.select()
              .from(volumes)
              .where(and(
                eq(volumes.novelId, novelId),
                eq(volumes.title, title),
                eq(volumes.deletedAt, null as any)
              ))
              .limit(1)
              .all()

            if (existing.length > 0) {
              if (importMode === 'create') {
                results.push({ action: 'skipped', id: existing[0].id, name: title, existed: true })
              } else {
                await db.update(volumes)
                  .set({
                    summary: volData.summary || existing[0].summary,
                    blueprint: volData.blueprint || existing[0].blueprint,
                    eventLine: eventLineValue || existing[0].eventLine,
                    notes: notesValue || existing[0].notes,
                    chapterCount: volData.chapterCount || existing[0].chapterCount,
                    updatedAt: Math.floor(Date.now() / 1000),
                  })
                  .where(eq(volumes.id, existing[0].id))
                results.push({ action: 'updated', id: existing[0].id, name: title, existed: true })
              }
            } else {
              const existVolumes = await db.select().from(volumes).where(eq(volumes.novelId, novelId)).all()
              const sortOrder = existVolumes.length

              const [volume] = await db.insert(volumes).values({
                novelId,
                title,
                summary: volData.summary || null,
                blueprint: volData.blueprint || '',
                eventLine: eventLineValue || '',
                notes: notesValue || '',
                chapterCount: volData.chapterCount || 0,
                sortOrder,
                status: 'draft',
              }).returning()
              results.push({ action: 'created', id: volume.id, name: title, existed: false })
            }
          }
          break
        }

        case 'chapter': {
          const chapData = itemData as {
            id?: string
            title?: string
            content?: string
            summary?: string
          }

          const title = chapData.title || '未命名章节'

          if (importMode === 'update' && chapData.id) {
            await db.update(chapters)
              .set({
                title,
                content: chapData.content || null,
                summary: chapData.summary || null,
                wordCount: chapData.content ? chapData.content.length : 0,
                updatedAt: Math.floor(Date.now() / 1000),
              })
              .where(eq(chapters.id, chapData.id))
            results.push({ action: 'updated', id: chapData.id, name: title, existed: true })
          } else {
            let volumeId: string | null = null
            const existVolumes = await db.select().from(volumes).where(eq(volumes.novelId, novelId)).all()
            if (existVolumes.length > 0) {
              volumeId = existVolumes[0].id
            }

            const existChapters = await db.select().from(chapters).where(eq(chapters.novelId, novelId)).all()
            const sortOrder = existChapters.length

            const [chapter] = await db.insert(chapters).values({
              novelId,
              volumeId,
              title,
              content: chapData.content || '',
              summary: chapData.summary || null,
              sortOrder,
              status: 'draft',
              wordCount: chapData.content ? chapData.content.length : 0,
            }).returning()
            results.push({ action: 'created', id: chapter.id, name: title, existed: false })
          }
          break
        }

        case 'setting': {
          const settingData = itemData as {
            id?: string
            type?: string
            name?: string
            content?: string
            importance?: string
          }

          const name = settingData.name || '未命名设定'
          const importanceValue = settingData.importance ?? 'normal'

          if (importMode === 'update') {
            if (!settingData.id) {
              results.push({ action: 'skipped', id: '', name, existed: false })
              continue
            }
            await db.update(novelSettings)
              .set({
                name,
                type: settingData.type || 'misc',
                category: settingData.type || 'misc',
                content: settingData.content || '',
                importance: importanceValue,
                updatedAt: Math.floor(Date.now() / 1000),
              })
              .where(eq(novelSettings.id, settingData.id))
            results.push({ action: 'updated', id: settingData.id, name, existed: true })
          } else {
            const existing = await db.select()
              .from(novelSettings)
              .where(and(
                eq(novelSettings.novelId, novelId),
                eq(novelSettings.name, name),
                eq(novelSettings.deletedAt, null as any)
              ))
              .limit(1)
              .all()

            if (existing.length > 0) {
              if (importMode === 'create') {
                results.push({ action: 'skipped', id: existing[0].id, name, existed: true })
              } else {
                await db.update(novelSettings)
                  .set({
                    content: settingData.content || existing[0].content,
                    importance: importanceValue,
                    updatedAt: Math.floor(Date.now() / 1000),
                  })
                  .where(eq(novelSettings.id, existing[0].id))
                results.push({ action: 'updated', id: existing[0].id, name, existed: true })
              }
            } else {
              const existSettings = await db.select().from(novelSettings).where(eq(novelSettings.novelId, novelId)).all()
              const sortOrder = existSettings.length

              const [setting] = await db.insert(novelSettings).values({
                novelId,
                type: settingData.type || 'misc',
                category: settingData.type || 'misc',
                name,
                content: settingData.content || '',
                importance: importanceValue,
                sortOrder,
              }).returning()
              results.push({ action: 'created', id: setting.id, name, existed: false })
            }
          }
          break
        }

        case 'rule': {
          const ruleData = itemData as {
            id?: string
            category?: string
            title?: string
            content?: string
            priority?: number
          }

          const title = ruleData.title || '未命名规则'

          if (importMode === 'update') {
            if (!ruleData.id) {
              results.push({ action: 'skipped', id: '', name: title, existed: false })
              continue
            }
            await db.update(writingRules)
              .set({
                title,
                category: ruleData.category || 'custom',
                content: ruleData.content || '',
                priority: ruleData.priority || 3,
                updatedAt: Math.floor(Date.now() / 1000),
              })
              .where(eq(writingRules.id, ruleData.id))
            results.push({ action: 'updated', id: ruleData.id, name: title, existed: true })
          } else {
            const existing = await db.select()
              .from(writingRules)
              .where(and(
                eq(writingRules.novelId, novelId),
                eq(writingRules.title, title),
                eq(writingRules.deletedAt, null as any)
              ))
              .limit(1)
              .all()

            if (existing.length > 0) {
              if (importMode === 'create') {
                results.push({ action: 'skipped', id: existing[0].id, name: title, existed: true })
              } else {
                await db.update(writingRules)
                  .set({
                    content: ruleData.content || existing[0].content,
                    category: ruleData.category || existing[0].category,
                    priority: ruleData.priority || existing[0].priority,
                    updatedAt: Math.floor(Date.now() / 1000),
                  })
                  .where(eq(writingRules.id, existing[0].id))
                results.push({ action: 'updated', id: existing[0].id, name: title, existed: true })
              }
            } else {
              const existRules = await db.select().from(writingRules).where(eq(writingRules.novelId, novelId)).all()
              const sortOrder = existRules.length

              const [rule] = await db.insert(writingRules).values({
                novelId,
                category: ruleData.category || 'custom',
                title,
                content: ruleData.content || '',
                priority: ruleData.priority || 3,
                isActive: 1,
                sortOrder,
              }).returning()
              results.push({ action: 'created', id: rule.id, name: title, existed: false })
            }
          }
          break
        }

        case 'foreshadowing': {
          const fsData = itemData as {
            id?: string
            title?: string
            description?: string
            status?: string
            importance?: string
          }

          const title = fsData.title || '未命名伏笔'
          const statusValue = fsData.status ?? 'open'
          const importanceValue = fsData.importance ?? 'normal'

          if (importMode === 'update') {
            if (!fsData.id) {
              results.push({ action: 'skipped', id: '', name: title, existed: false })
              continue
            }
            await db.update(foreshadowing)
              .set({
                title,
                description: fsData.description || '',
                status: statusValue,
                importance: importanceValue,
                updatedAt: Math.floor(Date.now() / 1000),
              })
              .where(eq(foreshadowing.id, fsData.id))
            results.push({ action: 'updated', id: fsData.id, name: title, existed: true })
          } else {
            const existing = await db.select()
              .from(foreshadowing)
              .where(and(
                eq(foreshadowing.novelId, novelId),
                eq(foreshadowing.title, title)
              ))
              .limit(1)
              .all()

            if (existing.length > 0) {
              if (importMode === 'create') {
                results.push({ action: 'skipped', id: existing[0].id, name: title, existed: true })
              } else {
                await db.update(foreshadowing)
                  .set({
                    description: fsData.description || existing[0].description,
                    status: statusValue,
                    importance: importanceValue,
                    updatedAt: Math.floor(Date.now() / 1000),
                  })
                  .where(eq(foreshadowing.id, existing[0].id))
                results.push({ action: 'updated', id: existing[0].id, name: title, existed: true })
              }
            } else {
              const [foreshadow] = await db.insert(foreshadowing).values({
                novelId,
                title,
                description: fsData.description || '',
                status: statusValue,
                importance: importanceValue,
              }).returning()
              results.push({ action: 'created', id: foreshadow.id, name: title, existed: false })
            }
          }
          break
        }

        case 'master_outline': {
          const outlineData = itemData as {
            id?: string
            title?: string
            content?: string
          }

          const title = outlineData.title || '未命名总纲'
          const content = outlineData.content || ''

          if (importMode === 'update') {
            if (!outlineData.id) {
              results.push({ action: 'skipped', id: '', name: title, existed: false })
              continue
            }
            await db.update(masterOutline)
              .set({
                title,
                content,
                wordCount: content.length,
                updatedAt: Math.floor(Date.now() / 1000),
              })
              .where(eq(masterOutline.id, outlineData.id))
            results.push({ action: 'updated', id: outlineData.id, name: title, existed: true })
          } else {
            const lastVersion = await db
              .select({ version: masterOutline.version })
              .from(masterOutline)
              .where(eq(masterOutline.novelId, novelId))
              .orderBy(desc(masterOutline.version))
              .limit(1)
              .get()

            const newVersion = (lastVersion?.version || 0) + 1

            const [outline] = await db.insert(masterOutline).values({
              novelId,
              title,
              content,
              version: newVersion,
              wordCount: content.length,
            }).returning()
            results.push({ action: 'created', id: outline.id, name: title, existed: false })
          }
          break
        }

        default:
          continue
      }
    }

    const created = results.filter(r => r.action === 'created').length
    const updated = results.filter(r => r.action === 'updated').length
    const skipped = results.filter(r => r.action === 'skipped').length

    return c.json({
      ok: true,
      results,
      summary: { created, updated, skipped, total: results.length },
      message: `导入完成：新建 ${created}，更新 ${updated}，跳过 ${skipped}`,
    })
  } catch (error) {
    console.error('Import data failed:', error)
    return c.json({
      ok: false,
      error: (error as Error).message,
    }, 500)
  }
})

export { router as workshopImport }