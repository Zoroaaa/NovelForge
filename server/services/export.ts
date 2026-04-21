/**
 * @file export.ts
 * @description 导出服务模块，支持Markdown、TXT、EPUB、PDF、ZIP等多种格式导出
 * @version 1.0.0
 * @modified 2026-04-21 - 添加规范化注释
 */
import { drizzle } from 'drizzle-orm/d1'
import { novels, chapters, volumes, exports } from '../db/schema'
import { eq, and, isNull, asc } from 'drizzle-orm'
import type { Env } from '../lib/types'

export interface ExportOptions {
  format: 'md' | 'txt' | 'epub' | 'html' | 'zip'
  novelId: string
  volumeIds?: string[]  // 按卷范围导出（可选）
  includeTOC?: boolean  // 是否包含目录
  includeMeta?: boolean // 是否包含元数据
}

export interface ChapterData {
  id: string
  title: string
  content: string | null
  sortOrder: number
  volumeTitle?: string
}

export interface NovelData {
  title: string
  description?: string
  genre?: string
  chapters: ChapterData[]
}

/**
 * 从数据库加载小说完整数据
 */
async function loadNovelData(db: any, options: Omit<ExportOptions, 'format'>): Promise<NovelData> {
  const { novelId, volumeIds } = options

  // 加载小说基本信息
  const novel = await db.select().from(novels).where(eq(novels.id, novelId)).get()
  if (!novel) throw new Error('Novel not found')

  // 加载章节列表（按排序）
  let chapterQuery = db
    .select({
      id: chapters.id,
      title: chapters.title,
      content: chapters.content,
      sortOrder: chapters.sortOrder,
      volumeId: chapters.volumeId,
    })
    .from(chapters)
    .where(
      and(
        eq(chapters.novelId, novelId),
        isNull(chapters.deletedAt)
      )
    )
    .orderBy(asc(chapters.sortOrder))

  const allChapters = await chapterQuery.all()

  // 如果指定了卷范围，过滤章节
  let filteredChapters = allChapters
  if (volumeIds && volumeIds.length > 0) {
    filteredChapters = allChapters.filter((c: { volumeId?: string | null }) => c.volumeId && volumeIds.includes(c.volumeId))
  }

  // 加载卷标题映射
  const volumeMap = new Map<string, string>()
  if (filteredChapters.some((c: { volumeId?: string | null }) => c.volumeId)) {
    const volList = await db.select().from(volumes).where(eq(volumes.novelId, novelId)).all()
    volList.forEach((v: { id: string; title: string }) => volumeMap.set(v.id, v.title))
  }

  // 组装章节数据
  const chapterData: ChapterData[] = filteredChapters.map((ch: { id: string; title: string; content?: string | null; sortOrder: number; volumeId?: string | null }) => ({
    id: ch.id,
    title: ch.title,
    content: ch.content || '',
    sortOrder: ch.sortOrder,
    volumeTitle: ch.volumeId ? volumeMap.get(ch.volumeId) : undefined,
  }))

  return {
    title: novel.title,
    description: novel.description || undefined,
    genre: novel.genre || undefined,
    chapters: chapterData,
  }
}

// ========== 导出格式实现 ==========

/**
 * 导出为Markdown格式
 * @param {Env} env - 环境变量对象
 * @param {ExportOptions} options - 导出选项
 * @returns {Promise<Blob>} Markdown文件Blob
 */
export async function exportAsMarkdown(env: Env, options: ExportOptions): Promise<Blob> {
  const db = drizzle(env.DB)
  const data = await loadNovelData(db, options)

  let md = ''

  // 元信息
  if (options.includeMeta !== false) {
    md += `# ${data.title}\n\n`
    if (data.description) md += `**简介**: ${data.description}\n\n`
    if (data.genre) md += `**类型**: ${data.genre}\n\n`
    md += `---\n\n`
  }

  // 目录
  if (options.includeTOC !== false && data.chapters.length > 0) {
    md += `## 目录\n\n`
    data.chapters.forEach((ch, idx) => {
      md += `${idx + 1}. [${ch.title}](#${ch.title.replace(/\s+/g, '-')})\n`
    })
    md += `\n---\n\n`
  }

  // 正文
  data.chapters.forEach((ch, idx) => {
    if (idx > 0) md += `\n\n---\n\n`  // 章节分隔线
    md += `## ${ch.title}\n\n`

    // 将 HTML 转换为简单 Markdown（保留段落结构）
    if (ch.content) {
      const plainText = htmlToMarkdown(ch.content)
      md += `${plainText}\n`
    }
  })

  return new Blob([md], { type: 'text/markdown; charset=utf-8' })
}

/**
 * 导出为纯文本格式
 * @param {Env} env - 环境变量对象
 * @param {ExportOptions} options - 导出选项
 * @returns {Promise<Blob>} 纯文本文件Blob
 */
export async function exportAsTxt(env: Env, options: ExportOptions): Promise<Blob> {
  const db = drizzle(env.DB)
  const data = await loadNovelData(db, options)

  let txt = ''

  // 标题页
  if (options.includeMeta !== false) {
    txt += `${data.title}\n`
    txt += `${'='.repeat(data.title.length)}\n\n`
    if (data.description) txt += `简介：${data.description}\n`
    if (data.genre) txt += `类型：${data.genre}\n`
    txt += '\n'
    txt += `${'─'.repeat(40)}\n\n`
  }

  // 正文
  data.chapters.forEach((ch, idx) => {
    if (idx > 0) txt += '\n'
    txt += `【第 ${idx + 1} 章】${ch.title}\n\n`

    if (ch.content) {
      const plainText = stripHtmlTags(ch.content)
      txt += `${plainText}\n`
    }
  })

  return new Blob([txt], { type: 'text/plain; charset=utf-8' })
}

/**
 * 导出为EPUB格式
 * @description 使用epub-gen-memory库生成EPUB电子书
 * @param {Env} env - 环境变量对象
 * @param {ExportOptions} options - 导出选项
 * @returns {Promise<Blob>} EPUB文件Blob
 * @throws {Error} EPUB生成失败
 */
export async function exportAsEpub(env: Env, options: ExportOptions): Promise<Blob> {
  try {
    const EpubGenMemory = (await import('epub-gen-memory')).default
    const db = drizzle(env.DB)
    const data = await loadNovelData(db, options)

    if (data.chapters.length === 0) {
      throw new Error('没有可导出的章节')
    }

    const content = data.chapters.map(ch => ({
      title: ch.title,
      content: ch.content || '<p>（暂无内容）</p>',
    }))

    const epubOption: any = {
      title: data.title,
      author: 'NovelForge',
      description: data.description || '',
      publisher: 'NovelForge',
      css: `
        body { font-family: serif; font-size: 16px; line-height: 1.8; margin: 1em; }
        h2 { text-align: center; margin-top: 2em; font-size: 1.5em; }
        p { text-indent: 2em; margin: 0.5em 0; }
        blockquote { border-left: 3px solid #ccc; padding-left: 1em; color: #666; }
      `,
      version: 3,
    }

    const epubBlob = await (EpubGenMemory as any)(content, epubOption)

    if (!epubBlob || !(epubBlob instanceof Blob)) {
      throw new Error('EPUB生成返回了无效的结果')
    }

    return epubBlob as Blob
  } catch (error) {
    console.error('EPUB generation failed:', error)

    if ((error as Error).message.includes('epub-gen-memory') ||
        (error as Error).message.includes('Cannot find module')) {
      throw new Error('EPUB库未正确安装，请运行 npm install epub-gen-memory')
    }

    throw new Error(`EPUB生成失败: ${(error as Error).message}`)
  }
}

/**
 * 导出为 PDF 格式（使用 HTML + CSS 生成）
 * 
 * 注意：此实现生成可打印的 HTML，实际 PDF 转换需要浏览器渲染
 * 生产环境建议使用 Cloudflare Browser Rendering API
 */
export async function exportAsHtml(env: Env, options: ExportOptions): Promise<Blob> {
  const db = drizzle(env.DB)
  const data = await loadNovelData(db, options)

  // 生成适合打印的 HTML
  let html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>${escapeHtml(data.title)}</title>
  <style>
    @page {
      size: A4;
      margin: 2cm;
    }
    body {
      font-family: "Noto Serif SC", "SimSun", serif;
      font-size: 12pt;
      line-height: 1.8;
      color: #333;
    }
    .title-page {
      text-align: center;
      padding-top: 30%;
      page-break-after: always;
    }
    .title-page h1 {
      font-size: 28pt;
      margin-bottom: 2em;
    }
    .title-page .meta {
      font-size: 12pt;
      color: #666;
    }
    .toc {
      page-break-after: always;
    }
    .toc h2 {
      text-align: center;
      margin-bottom: 2em;
    }
    .toc ul {
      list-style: none;
      padding: 0;
    }
    .toc li {
      margin: 0.5em 0;
      border-bottom: 1px dotted #ccc;
    }
    .chapter {
      page-break-before: always;
    }
    .chapter h2 {
      text-align: center;
      font-size: 18pt;
      margin-bottom: 2em;
    }
    .chapter-content {
      text-indent: 2em;
    }
    .chapter-content p {
      margin: 0.5em 0;
    }
  </style>
</head>
<body>
`

  // 标题页
  if (options.includeMeta !== false) {
    html += `
  <div class="title-page">
    <h1>${escapeHtml(data.title)}</h1>
    <div class="meta">
      ${data.description ? `<p>${escapeHtml(data.description)}</p>` : ''}
      ${data.genre ? `<p>类型：${escapeHtml(data.genre)}</p>` : ''}
    </div>
  </div>
`
  }

  // 目录
  if (options.includeTOC !== false && data.chapters.length > 0) {
    html += `
  <div class="toc">
    <h2>目录</h2>
    <ul>
${data.chapters.map((ch, idx) => `      <li>第 ${idx + 1} 章 ${escapeHtml(ch.title)}</li>`).join('\n')}
    </ul>
  </div>
`
  }

  // 正文
  data.chapters.forEach((ch) => {
    html += `
  <div class="chapter">
    <h2>${escapeHtml(ch.title)}</h2>
    <div class="chapter-content">
${ch.content ? htmlToPdfContent(ch.content) : '<p>（暂无内容）</p>'}
    </div>
  </div>
`
  })

  html += `
</body>
</html>`

  // 返回 HTML Blob（客户端可调用 window.print() 或 puppeteer 转换为 PDF）
  return new Blob([html], { type: 'text/html; charset=utf-8' })
}

/**
 * 将 HTML 内容转换为适合 PDF 的格式
 */
function htmlToPdfContent(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '</p><p>')
    .replace(/<\/p>/gi, '</p>\n')
    .replace(/<p[^>]*>/gi, '<p>')
    .replace(/<\/p>/gi, '</p>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
}

/**
 * HTML 转义
 */
function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  }
  return text.replace(/[&<>"']/g, (char) => map[char])
}

/**
 * 导出为 ZIP 打包（包含所有格式）
 */
export async function exportAsZip(env: Env, options: ExportOptions): Promise<Blob> {
  try {
    const JSZip = (await import('jszip')).default
    const db = drizzle(env.DB)
    const data = await loadNovelData(db, options)

    if (data.chapters.length === 0) {
      throw new Error('没有可导出的章节')
    }

    const zip = new JSZip()
    const title = sanitizeFilename(data.title)

    const [mdBlob, txtBlob] = await Promise.all([
      exportAsMarkdown(env, { ...options, format: 'md' }),
      exportAsTxt(env, { ...options, format: 'txt' }),
    ])

    zip.file(`${title}.md`, await mdBlob.text())
    zip.file(`${title}.txt`, await txtBlob.text())

    try {
      const epubBlob = await exportAsEpub(env, options)
      zip.file(`${title}.epub`, epubBlob)
    } catch (e) {
      console.warn('Failed to add EPUB to zip:', e)
      zip.file(`${title}-epub-error.txt`, `EPUB生成失败: ${(e as Error).message}`)
    }

    try {
      const htmlBlob = await exportAsHtml(env, options)
      zip.file(`${title}-print.html`, await htmlBlob.text())
    } catch (e) {
      console.warn('Failed to add PDF/HTML to zip:', e)
    }

    const zipBlob = await zip.generateAsync({ type: 'blob' })

    if (!zipBlob || !(zipBlob instanceof Blob)) {
      throw new Error('ZIP生成返回了无效的结果')
    }

    return zipBlob
  } catch (error) {
    console.error('ZIP generation failed:', error)
    throw new Error(`ZIP打包失败: ${(error as Error).message}`)
  }
}

// ========== 工具函数 ==========

/**
 * 将 HTML 转换为简化 Markdown
 */
function htmlToMarkdown(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/h[1-6]>/gi, '\n\n')
    .replace(/<h[1-6][^>]*>/gi, '')
    .replace(/<strong[^>]*>(.*?)<\/strong>/gi, '**$1**')
    .replace(/<em[^>]*>(.*?)<\/em>/gi, '*$1*')
    .replace(/<blockquote[^>]*>(.*?)<\/blockquote>/gis, '> $1')
    .replace(/<li[^>]*>(.*?)<\/li>/gi, '- $1\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')  // 压缩多余空行
    .trim()
}

/**
 * 移除所有 HTML 标签，返回纯文本
 */
function stripHtmlTags(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim()
}

/**
 * 清理文件名（移除非法字符）
 */
function sanitizeFilename(name: string): string {
  return name
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/\s+/g, '_')
    .substring(0, 100)
}

export interface ExportRecord {
  id: string
  novelId: string
  format: string
  scope: string
  scopeMeta: string | null
  r2Key: string | null
  fileSize: number | null
  status: string
  errorMsg: string | null
}

export async function createExportRecord(
  env: Env,
  data: {
    novelId: string
    format: string
    scope: string
    scopeMeta?: string | null
  }
): Promise<ExportRecord> {
  const db = drizzle(env.DB)
  const [record] = await db.insert(exports).values({
    novelId: data.novelId,
    format: data.format,
    scope: data.scope,
    scopeMeta: data.scopeMeta || null,
    status: 'processing',
  }).returning()
  return record as ExportRecord
}

export async function updateExportRecord(
  env: Env,
  exportId: string,
  data: {
    status?: string
    r2Key?: string
    fileSize?: number
    errorMsg?: string
  }
): Promise<void> {
  const db = drizzle(env.DB)
  await db.update(exports).set(data).where(eq(exports.id, exportId))
}

/**
 * 执行导出操作
 * @description 根据格式类型调用对应的导出函数
 * @param {Env} env - 环境变量对象
 * @param {ExportOptions} options - 导出选项
 * @returns {Promise<{blob: Blob, contentType: string, fileExtension: string, filename: string}>} 导出结果
 * @throws {Error} 不支持的格式
 */
export async function performExport(
  env: Env,
  options: ExportOptions
): Promise<{ blob: Blob; contentType: string; fileExtension: string; filename: string }> {
  const { format } = options
  let blob: Blob
  const contentType = getContentType(format)
  const fileExtension = getFileExtension(format)

  switch (format) {
    case 'md':
      blob = await exportAsMarkdown(env, options)
      break
    case 'txt':
      blob = await exportAsTxt(env, options)
      break
    case 'epub':
      blob = await exportAsEpub(env, options)
      break
    case 'html':
      blob = await exportAsHtml(env, options)
      break
    case 'zip':
      blob = await exportAsZip(env, options)
      break
    default:
      throw new Error(`Unsupported format: ${format}`)
  }

  const filename = `novel_${options.novelId}_${Date.now()}.${fileExtension}`
  return { blob, contentType, fileExtension, filename }
}

function getContentType(format: string): string {
  switch (format) {
    case 'md':
      return 'text/markdown; charset=utf-8'
    case 'txt':
      return 'text/plain; charset=utf-8'
    case 'epub':
      return 'application/epub+zip'
    case 'html':
      return 'text/html; charset=utf-8'
    case 'zip':
      return 'application/zip'
    default:
      return 'application/octet-stream'
  }
}

function getFileExtension(format: string): string {
  if (format === 'epub') return 'epub'
  if (format === 'html') return 'html'
  return format
}
