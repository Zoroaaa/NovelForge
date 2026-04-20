/**
 * NovelForge · 导出服务层
 *
 * 支持多格式导出：
 * - Markdown (.md)
 * - 纯文本 (.txt)
 * - EPUB 电子书 (.epub)
 * - ZIP 打包下载 (.zip)
 */

import { drizzle } from 'drizzle-orm/d1'
import { novels, chapters, volumes } from '../db/schema'
import { eq, and, isNull, asc } from 'drizzle-orm'
import type { Env } from '../lib/types'

export interface ExportOptions {
  format: 'md' | 'txt' | 'epub' | 'zip'
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
  author?: string
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
    filteredChapters = allChapters.filter(c => c.volumeId && volumeIds.includes(c.volumeId))
  }

  // 加载卷标题映射
  const volumeMap = new Map<string, string>()
  if (filteredChapters.some(c => c.volumeId)) {
    const volList = await db.select().from(volumes).where(eq(volumes.novelId, novelId)).all()
    volList.forEach(v => volumeMap.set(v.id, v.title))
  }

  // 组装章节数据
  const chapterData: ChapterData[] = filteredChapters.map(ch => ({
    id: ch.id,
    title: ch.title,
    content: ch.content || '',
    sortOrder: ch.sortOrder,
    volumeTitle: ch.volumeId ? volumeMap.get(ch.volumeId) : undefined,
  }))

  return {
    title: novel.title,
    author: novel.author || undefined,
    description: novel.description || undefined,
    genre: novel.genre || undefined,
    chapters: chapterData,
  }
}

// ========== 导出格式实现 ==========

/**
 * 导出为 Markdown 格式
 */
export async function exportAsMarkdown(env: Env, options: ExportOptions): Promise<Blob> {
  const db = drizzle(env.DB)
  const data = await loadNovelData(db, options)

  let md = ''

  // 元信息
  if (options.includeMeta !== false) {
    md += `# ${data.title}\n\n`
    if (data.author) md += `**作者**: ${data.author}\n\n`
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
 */
export async function exportAsTxt(env: Env, options: ExportOptions): Promise<Blob> {
  const db = drizzle(env.DB)
  const data = await loadNovelData(db, options)

  let txt = ''

  // 标题页
  if (options.includeMeta !== false) {
    txt += `${data.title}\n`
    txt += `${'='.repeat(data.title.length)}\n\n`
    if (data.author) txt += `作者：${data.author}\n`
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
 * 导出为 EPUB 格式（使用 epub-gen-memory）
 */
export async function exportAsEpub(env: Env, options: ExportOptions): Promise<Blob> {
  try {
    const EpubGenMemory = (await import('epub-gen-memory')).default
    const db = drizzle(env.DB)
    const data = await loadNovelData(db, options)

    // 组装 EPUB 内容
    const content = data.chapters.map(ch => ({
      title: ch.title,
      content: ch.content || '<p>（暂无内容）</p>',
    }))

    const epubOption = {
      title: data.title,
      author: data.author || '未知作者',
      description: data.description || '',
      publisher: 'NovelForge',
      css: `
        body { font-family: serif; font-size: 16px; line-height: 1.8; margin: 1em; }
        h2 { text-align: center; margin-top: 2em; font-size: 1.5em; }
        p { text-indent: 2em; margin: 0.5em 0; }
        blockquote { border-left: 3px solid #ccc; padding-left: 1em; color: #666; }
      `,
      version: 3 as any,
    }

    // 生成 EPUB
    const epubBlob = await EpubGenMemory(content, epubOption)
    return epubBlob
  } catch (error) {
    console.error('EPUB generation failed:', error)
    throw new Error(`EPUB生成失败: ${(error as Error).message}`)
  }
}

/**
 * 导出为 ZIP 打包（包含所有格式）
 */
export async function exportAsZip(env: Env, options: ExportOptions): Promise<Blob> {
  try {
    const JSZip = (await import('jszip')).default
    const db = drizzle(env.DB)
    const data = await loadNovelData(db, options)
    const zip = new JSZip()
    const title = sanitizeFilename(data.title)

    // 并行生成各格式
    const [mdBlob, txtBlob] = await Promise.all([
      exportAsMarkdown(env, { ...options, format: 'md' }),
      exportAsTxt(env, { ...options, format: 'txt' }),
    ])

    // 添加到 ZIP
    zip.file(`${title}.md`, await mdBlob.text())
    zip.file(`${title}.txt`, await txtBlob.text())

    // 尝试添加 EPUB
    try {
      const epubBlob = await exportAsEpub(env, options)
      zip.file(`${title}.epub`, epubBlob)
    } catch (e) {
      console.warn('Failed to add EPUB to zip:', e)
    }

    // 生成 ZIP 文件
    const zipBlob = await zip.generateAsync({ type: 'blob' })
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
