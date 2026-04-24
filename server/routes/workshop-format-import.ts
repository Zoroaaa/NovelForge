/**
 * @file workshop-format-import.ts
 * @description 创作工坊导入格式化 API
 */
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import type { Env } from '../lib/types'
import { formatImportData, type ImportTargetModule } from '../services/formatImport'

const router = new Hono<{ Bindings: Env }>()

const formatImportSchema = z.object({
  content: z.string().min(1, '内容不能为空'),
  module: z.enum(['chapter', 'volume', 'setting', 'character', 'rule', 'foreshadowing', 'master_outline']),
  novelId: z.string().optional(),
})

router.post('/format-import', zValidator('json', formatImportSchema), async (c) => {
  try {
    const body = c.req.valid('json')
    const { content, module, novelId } = body

    const { drizzle } = await import('drizzle-orm/d1')
    const db = drizzle(c.env.DB)

    const result = await formatImportData(
      content,
      module as ImportTargetModule,
      novelId,
      db
    )

    return c.json({
      ok: true,
      ...result,
    })
  } catch (error) {
    console.error('Format import data failed:', error)
    return c.json({
      ok: false,
      error: (error as Error).message,
      parseStatus: 'error',
      data: {},
      rawContent: '',
    }, 500)
  }
})

export { router as workshopFormatImport }