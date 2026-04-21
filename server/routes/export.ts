/**
 * @file export.ts
 * @description 导出路由模块，提供小说导出功能，支持多种格式
 * @version 1.0.0
 * @modified 2026-04-21 - 添加规范化注释
 */
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import type { Env } from '../lib/types'
import {
  createExportRecord,
  updateExportRecord,
  performExport,
} from '../services/export'

const router = new Hono<{ Bindings: Env }>()

const ExportSchema = z.object({
  novelId: z.string().min(1),
  format: z.enum(['md', 'txt', 'epub', 'html', 'zip']),
  volumeIds: z.array(z.string()).optional(),
  includeTOC: z.boolean().optional(),
  includeMeta: z.boolean().optional(),
})

/**
 * POST / - 导出小说
 * @description 导出小说为指定格式，支持MD、TXT、EPUB、PDF、ZIP
 * @param {string} novelId - 小说ID
 * @param {string} format - 导出格式：md | txt | epub | pdf | zip
 * @param {string[]} [volumeIds] - 可选的卷ID列表，指定导出范围
 * @param {boolean} [includeTOC] - 是否包含目录
 * @param {boolean} [includeMeta] - 是否包含元信息
 * @returns {Blob} 导出文件
 * @throws {500} 导出失败
 */
router.post('/', zValidator('json', ExportSchema), async (c) => {
  const options = c.req.valid('json')
  
  const exportRecord = await createExportRecord(c.env, {
    novelId: options.novelId,
    format: options.format,
    scope: options.volumeIds && options.volumeIds.length > 0 ? 'volume' : 'full',
    scopeMeta: options.volumeIds ? JSON.stringify({ volumeIds: options.volumeIds }) : null,
  })
  
  const exportId = exportRecord.id

  try {
    const { blob, contentType, fileExtension, filename } = await performExport(c.env, options)

    let r2Key: string | null = null
    if (c.env.STORAGE) {
      r2Key = `exports/${options.novelId}/${exportId}.${fileExtension}`
      await c.env.STORAGE.put(r2Key, blob, {
        httpMetadata: {
          contentType,
        },
      })
      
      await updateExportRecord(c.env, exportId, {
        status: 'done',
        r2Key,
        fileSize: blob.size,
      })
    }

    return new Response(blob, {
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': String(blob.size),
        'X-Export-Id': exportId,
      },
    })
  } catch (error) {
    console.error('Export failed:', error)
    
    await updateExportRecord(c.env, exportId, {
      status: 'error',
      errorMsg: (error as Error).message,
    })
    
    return c.json(
      {
        error: 'Export failed',
        details: (error as Error).message,
      },
      500
    )
  }
})

/**
 * GET /formats - 获取支持的导出格式列表
 * @description 返回所有支持的导出格式及其详细信息
 * @returns {Object} { formats: Array<{id, name, description, extension, mimeType}> }
 */
router.get('/formats', (c) => {
  return c.json({
    formats: [
      {
        id: 'md',
        name: 'Markdown',
        description: '标准 Markdown 格式，适合编辑和转换',
        extension: '.md',
        mimeType: 'text/markdown',
      },
      {
        id: 'txt',
        name: '纯文本',
        description: '纯文本格式，兼容性最强',
        extension: '.txt',
        mimeType: 'text/plain',
      },
      {
        id: 'epub',
        name: 'EPUB 电子书',
        description: '电子书标准格式，支持 Kindle、Apple Books 等',
        extension: '.epub',
        mimeType: 'application/epub+zip',
      },
      {
        id: 'html',
        name: '可打印 HTML',
        description: 'HTML 格式，适合浏览器打印，支持样式和排版',
        extension: '.html',
        mimeType: 'text/html',
      },
      {
        id: 'zip',
        name: 'ZIP 打包',
        description: '包含所有格式的压缩包（MD + TXT + EPUB）',
        extension: '.zip',
        mimeType: 'application/zip',
      },
    ],
  })
})

export { router as export }
