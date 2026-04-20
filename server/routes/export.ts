/**
 * NovelForge · Export 导出路由
 *
 * 支持多格式导出：
 * - POST /api/export          - 通用导出入口（根据format参数）
 * - POST /api/export/epub     - EPUB 导出
 * - POST /api/export/md       - Markdown 导出
 * - POST /api/export/txt      - 纯文本导出
 * - POST /api/export/zip      - ZIP 打包下载
 */

import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { drizzle } from 'drizzle-orm/d1'
import { eq } from 'drizzle-orm'
import type { Env } from '../lib/types'
import {
  exportAsMarkdown,
  exportAsTxt,
  exportAsEpub,
  exportAsPdf,
  exportAsZip,
} from '../services/export'
import { exports as exportsTable } from '../db/schema'

const router = new Hono<{ Bindings: Env }>()

const ExportSchema = z.object({
  novelId: z.string().min(1),
  format: z.enum(['md', 'txt', 'epub', 'pdf', 'zip']),
  volumeIds: z.array(z.string()).optional(),
  includeTOC: z.boolean().optional(),
  includeMeta: z.boolean().optional(),
})

/**
 * POST /api/export
 *
 * 通用导出入口（根据 format 参数决定输出格式）
 */
router.post('/', zValidator('json', ExportSchema), async (c) => {
  const options = c.req.valid('json')
  const db = drizzle(c.env.DB)
  
  // 创建导出记录
  const exportRecord = await db.insert(exportsTable).values({
    novelId: options.novelId,
    format: options.format,
    scope: options.volumeIds && options.volumeIds.length > 0 ? 'volume' : 'full',
    scopeMeta: options.volumeIds ? JSON.stringify({ volumeIds: options.volumeIds }) : null,
    status: 'processing',
  }).returning()
  
  const exportId = exportRecord[0].id

  try {
    let blob: Blob
    const contentType = getContentType(options.format)
    const fileExtension = getFileExtension(options.format)

    switch (options.format) {
      case 'md':
        blob = await exportAsMarkdown(c.env, options)
        break
      case 'txt':
        blob = await exportAsTxt(c.env, options)
        break
      case 'epub':
        blob = await exportAsEpub(c.env, options)
        break
      case 'pdf':
        blob = await exportAsPdf(c.env, options)
        break
      case 'zip':
        blob = await exportAsZip(c.env, options)
        break
      default:
        // 更新记录为失败
        await db.update(exportsTable).set({
          status: 'error',
          errorMsg: `Unsupported format: ${options.format}`,
        }).where(eq(exportsTable.id, exportId))
        return c.json({ error: `Unsupported format: ${options.format}` }, 400)
    }

    // 上传到R2存储
    let r2Key: string | null = null
    if (c.env.STORAGE) {
      r2Key = `exports/${options.novelId}/${exportId}.${fileExtension}`
      await c.env.STORAGE.put(r2Key, blob, {
        httpMetadata: {
          contentType,
        },
      })
      
      // 更新记录为完成
      await db.update(exportsTable).set({
        status: 'done',
        r2Key,
        fileSize: blob.size,
      }).where(eq(exportsTable.id, exportId))
    }

    // 获取小说标题用于文件名
    const filename = `novel_${options.novelId}_${Date.now()}.${fileExtension}`

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
    
    // 更新记录为失败
    await db.update(exportsTable).set({
      status: 'error',
      errorMsg: (error as Error).message,
    }).where(eq(exportsTable.id, exportId))
    
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
 * GET /api/export/formats
 *
 * 返回支持的导出格式列表
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
        id: 'pdf',
        name: 'PDF 文档',
        description: 'PDF 格式，适合打印和分享（生成可打印HTML）',
        extension: '.pdf',
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

// ========== 工具函数 ==========

function getContentType(format: string): string {
  switch (format) {
    case 'md':
      return 'text/markdown; charset=utf-8'
    case 'txt':
      return 'text/plain; charset=utf-8'
    case 'epub':
      return 'application/epub+zip'
    case 'pdf':
      return 'text/html; charset=utf-8'
    case 'zip':
      return 'application/zip'
    default:
      return 'application/octet-stream'
  }
}

function getFileExtension(format: string): string {
  if (format === 'epub') return 'epub'
  if (format === 'pdf') return 'html'
  return format
}

export { router as export }
