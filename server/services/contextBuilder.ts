/**
 * NovelForge · Agent 上下文组装器（完整版）
 *
 * 章节生成时，决定注入哪些内容作为 LLM 上下文。
 * 策略：强制注入（小体积高相关）+ RAG 检索（语义相关大纲片段）
 */

import { drizzle } from 'drizzle-orm/d1'
import { chapters, outlines, volumes, characters } from '../db/schema'
import { eq, and, sql, desc } from 'drizzle-orm'
import type { Env } from '../lib/types'
import { embedText, searchSimilar } from './embedding'

export interface ContextBundle {
  /** 强制注入部分（每次必带）*/
  mandatory: {
    chapterOutline: string
    prevChapterSummary: string
    volumeSummary: string
    protagonistCards: string[]
  }
  /** RAG 检索部分（语义最相关的大纲片段，按分数截断）*/
  ragChunks: Array<{
    sourceType: 'outline' | 'character' | 'chapter_summary'
    title: string
    content: string
    score: number
  }>
  /** 诊断信息（前端 ContextPreview 组件展示用）*/
  debug: {
    totalTokenEstimate: number
    ragHitsCount: number
    skippedByBudget: number
    buildTimeMs: number
  }
}

/**
 * Token 预算分配（可在 model_configs.params 中覆盖）
 */
export const DEFAULT_BUDGET = {
  total: 12000,
  mandatory: 6000,
  rag: 4000,
  systemPrompt: 2000,
}

export async function buildChapterContext(
  env: Env,
  novelId: string,
  chapterId: string,
  budget = DEFAULT_BUDGET
): Promise<ContextBundle> {
  const startTime = Date.now()
  const db = drizzle(env.DB)

  // 1. 并发拉取强制注入内容（走 D1，精准 ID 查询）
  const [chapterOutline, prevSummary, volumeSummary, protagonists] =
    await Promise.all([
      fetchChapterOutline(db, chapterId),
      fetchPrevChapterSummary(db, chapterId),
      fetchVolumeSummary(db, chapterId),
      fetchProtagonistCards(db, chapterId),
    ])

  // 2. 用本章大纲作为 query，RAG 检索语义相关片段
  let ragChunks: ContextBundle['ragChunks'] = []
  let skipped = 0

  if (chapterOutline && env.VECTORIZE) {
    try {
      const queryVector = await embedText(env.AI, chapterOutline)
      const ragResults = await searchSimilar(env.VECTORIZE, queryVector, {
        topK: 20,
        filter: { novelId },
      })

      // 3. 按 token 预算截断 RAG 结果
      let usedTokens = 0

      for (const match of ragResults) {
        const content = match.metadata.content || ''
        const estimated = estimateTokens(content)

        if (usedTokens + estimated > budget.rag) {
          skipped++
          continue
        }

        usedTokens += estimated
        ragChunks.push({
          sourceType: match.metadata.sourceType,
          title: match.metadata.title || 'Untitled',
          content,
          score: match.score,
        })
      }
    } catch (error) {
      console.warn('RAG search failed, using fallback:', error)
      // RAG 失败时使用简单的上下文填充
      ragChunks = await fallbackContext(db, novelId, budget.rag)
    }
  }

  const buildTimeMs = Date.now() - startTime

  return {
    mandatory: {
      chapterOutline,
      prevChapterSummary,
      volumeSummary,
      protagonistCards: protagonists,
    },
    ragChunks,
    debug: {
      totalTokenEstimate:
        estimateMandatoryTokens({ chapterOutline, prevSummary, volumeSummary, protagonists }) +
        ragChunks.reduce((sum, chunk) => sum + estimateTokens(chunk.content), 0),
      ragHitsCount: ragChunks.length,
      skippedByBudget: skipped,
      buildTimeMs,
    },
  }
}

// ========== D1 查询函数（完整实现）==========

async function fetchChapterOutline(db: any, chapterId: string): Promise<string> {
  try {
    const result = await db
      .select({
        content: outlines.content,
      })
      .from(chapters)
      .leftJoin(outlines, eq(chapters.outlineId, outlines.id))
      .where(eq(chapters.id, chapterId))
      .get()

    return result?.content || ''
  } catch (error) {
    console.warn('Failed to fetch chapter outline:', error)
    return ''
  }
}

async function fetchPrevChapterSummary(db: any, chapterId: string): Promise<string> {
  try {
    // 先获取当前章节的信息
    const currentChapter = await db
      .select({
        novelId: chapters.novelId,
        sortOrder: chapters.sortOrder,
      })
      .from(chapters)
      .where(eq(chapters.id, chapterId))
      .get()

    if (!currentChapter) return ''

    // 查找上一章的摘要（sortOrder < 当前章节，取最大的那个）
    const prevChapter = await db
      .select({
        summary: chapters.summary,
      })
      .from(chapters)
      .where(
        and(
          eq(chapters.novelId, currentChapter.novelId),
          sql`${chapters.sortOrder} < ${currentChapter.sortOrder}`
        )
      )
      .orderBy(desc(chapters.sortOrder))
      .limit(1)
      .get()

    return prevChapter?.summary || ''
  } catch (error) {
    console.warn('Failed to fetch previous chapter summary:', error)
    return ''
  }
}

async function fetchVolumeSummary(db: any, chapterId: string): Promise<string> {
  try {
    const result = await db
      .select({
        summary: volumes.summary,
      })
      .from(chapters)
      .leftJoin(volumes, eq(chapters.volumeId, volumes.id))
      .where(eq(chapters.id, chapterId))
      .get()

    return result?.summary || ''
  } catch (error) {
    console.warn('Failed to fetch volume summary:', error)
    return ''
  }
}

async function fetchProtagonistCards(db: any, chapterId: string): Promise<string[]> {
  try {
    // 获取当前小说的所有主角角色
    const currentChapter = await db
      .select({
        novelId: chapters.novelId,
      })
      .from(chapters)
      .where(eq(chapters.id, chapterId))
      .get()

    if (!currentChapter) return []

    const protagonistList = await db
      .select({
        name: characters.name,
        role: characters.role,
        description: characters.description,
        attributes: characters.attributes,
      })
      .from(characters)
      .where(
        and(
          eq(characters.novelId, currentChapter.novelId),
          sql`${characters.deletedAt} IS NULL`
        )
      )
      .all()

    // 只返回主角和重要配角
    return protagonistList
      .filter((c) => c.role === 'protagonist' || c.role === 'antagonist')
      .map((c) => {
        let card = `【${c.name}】`
        if (c.description) card += `\n${c.description}`
        if (c.attributes) {
          try {
            const attrs = JSON.parse(c.attributes)
            const attrStr = Object.entries(attrs)
              .map(([k, v]) => `${k}: ${v}`)
              .join(', ')
            card += `\n属性：${attrStr}`
          } catch {}
        }
        return card
      })
  } catch (error) {
    console.warn('Failed to fetch protagonist cards:', error)
    return []
  }
}

// ========== Fallback 策略（当 RAG 不可用时）==========

async function fallbackContext(
  db: any,
  novelId: string,
  budget: number
): Promise<ContextBundle['ragChunks']> {
  try {
    // 获取最近的大纲节点作为fallback
    const recentOutlines = await db
      .select({
        title: outlines.title,
        content: outlines.content,
        type: outlines.type,
      })
      .from(outlines)
      .where(
        and(
          eq(outlines.novelId, novelId),
          sql`${outlines.deletedAt} IS NULL`,
          sql`${outlines.content} IS NOT NULL`
        )
      )
      .orderBy(desc(outlines.updatedAt))
      .limit(5)
      .all()

    let usedTokens = 0
    const chunks: ContextBundle['ragChunks'] = []

    for (const outline of recentOutlines) {
      if (!outline.content) continue

      const estimated = estimateTokens(outline.content)
      if (usedTokens + estimated > budget) break

      usedTokens += estimated
      chunks.push({
        sourceType: 'outline',
        title: outline.title,
        content: outline.content,
        score: 1.0 - chunks.length * 0.1, // 降序分数
      })
    }

    return chunks
  } catch (error) {
    console.warn('Fallback context failed:', error)
    return []
  }
}

// ========== 工具函数 ==========

/** 中文 token 粗估：1 汉字 ≈ 1.3 token，英文 1 词 ≈ 1.3 token */
export function estimateTokens(text: string): number {
  if (!text) return 0
  const cjk = (text.match(/[\u4e00-\u9fff]/g) || []).length
  const other = text.length - cjk
  return Math.ceil(cjk * 1.3 + other * 0.3)
}

function estimateMandatoryTokens(m: {
  chapterOutline: string
  prevChapterSummary: string
  volumeSummary: string
  protagonistCards: string[]
}): number {
  return (
    estimateTokens(m.chapterOutline) +
    estimateTokens(m.prevChapterSummary) +
    estimateTokens(m.volumeSummary) +
    m.protagonists.reduce((s: number, c: string) => s + estimateTokens(c), 0)
  )
}
