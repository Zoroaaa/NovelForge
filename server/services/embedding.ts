/**
 * @file embedding.ts
 * @description 向量化服务模块，使用Cloudflare Workers AI进行中文文本嵌入，支持Vectorize索引管理
 * @version 1.0.0
 * @modified 2026-04-21 - 添加规范化注释
 */
import { drizzle } from 'drizzle-orm/d1'
import { eq, and } from 'drizzle-orm'
import type { Env } from '../lib/types'
import { vectorIndex, masterOutline, chapters } from '../db/schema'

export interface VectorMetadata {
  novelId: string
  sourceType: 'outline' | 'chapter' | 'character' | 'summary' | 'setting' | 'foreshadowing'
  sourceId: string
  title?: string
  content?: string
  settingType?: string    // v3: 设定类型（world_rule, power_system, geography等）
  importance?: string     // v3: 重要性（high, normal, low）
}

export interface EmbeddingResult {
  vectorId: string
  values: number[]
  metadata: VectorMetadata
}

const EMBEDDING_MODEL = '@cf/baai/bge-m3'
const DIMENSIONS = 1024

/**
 * 对单个文本进行向量化
 * @param {Env['AI']} ai - Cloudflare AI绑定对象
 * @param {string} text - 要向量化的文本
 * @returns {Promise<number[]>} 向量数组
 * @throws {Error} 文本为空或API返回无效响应
 */
export async function embedText(
  ai: Env['AI'],
  text: string
): Promise<number[]> {
  if (!text || !text.trim()) {
    throw new Error('Cannot embed empty text')
  }

  const result = await ai.run(EMBEDDING_MODEL, {
    text: [text.trim()]
  })

  const data = result as any
  if (!data.data || !data.data[0]) {
    throw new Error('Embedding API returned invalid response')
  }

  return data.data[0] as number[]
}

/**
 * 批量向量化（用于长文档分块）
 * @param {Env['AI']} ai - Cloudflare AI绑定对象
 * @param {string[]} chunks - 文本块数组
 * @param {number} [concurrency=5] - 并发数量
 * @returns {Promise<number[][]>} 向量数组
 */
export async function embedBatch(
  ai: Env['AI'],
  chunks: string[],
  concurrency: number = 5
): Promise<number[][]> {
  const results: number[][] = []
  const batchSize = concurrency

  for (let i = 0; i < chunks.length; i += batchSize) {
    const batch = chunks.slice(i, i + batchSize)
    const batchResults = await Promise.all(batch.map(chunk => embedText(ai, chunk)))
    results.push(...batchResults)
  }

  return results
}

/**
 * 将向量插入到Vectorize索引
 * @param {any} vectorize - Vectorize绑定对象
 * @param {string} id - 向量ID
 * @param {number[]} values - 向量值数组
 * @param {VectorMetadata} metadata - 元数据对象
 * @returns {Promise<void>}
 */
export async function upsertVector(
  vectorize: any,
  id: string,
  values: number[],
  metadata: VectorMetadata
): Promise<void> {
  await vectorize.upsert([
    {
      id,
      values,
      metadata: {
        ...metadata,
        indexedAt: Date.now()
      }
    }
  ])
}

/**
 * 从 Vectorize 删除向量
 */
export async function deleteVector(
  vectorize: any,
  id: string
): Promise<void> {
  try {
    await vectorize.deleteByIds([id])
  } catch (error) {
    console.warn(`Failed to delete vector ${id}:`, error)
  }
}

/**
 * 语义相似度搜索
 * @param {any} vectorize - Vectorize绑定对象
 * @param {number[]} queryVector - 查询向量
 * @param {Object} [options] - 搜索选项
 * @param {number} [options.topK=10] - 返回结果数量
 * @param {Partial<VectorMetadata>} [options.filter] - 元数据过滤条件
 * @returns {Promise<Array<{id: string, score: number, metadata: VectorMetadata}>>} 搜索结果
 */
export async function searchSimilar(
  vectorize: any,
  queryVector: number[],
  options: {
    topK?: number
    filter?: Partial<VectorMetadata>
  } = {}
): Promise<Array<{
  id: string
  score: number
  metadata: VectorMetadata
}>> {
  const { topK = 10, filter } = options

  const results = await vectorize.query(queryVector, {
    topK,
    returnMetadata: true,
    ...(filter ? { filter } : {})
  })

  return (results.matches || []).map((match: any) => ({
    id: match.id,
    score: match.score,
    metadata: match.metadata as VectorMetadata
  }))
}

export const ACTIVE_SOURCE_TYPES = ['character', 'setting', 'foreshadowing'] as const
export type ActiveSourceType = typeof ACTIVE_SOURCE_TYPES[number]

/**
 * 多类型并行语义搜索（合并去重 + score 排序）
 * 用于通用搜索场景，默认只搜活跃类型（character/setting/foreshadowing）
 */
export async function searchSimilarMulti(
  vectorize: any,
  queryVector: number[],
  options: {
    topK?: number
    novelId: string
    sourceTypes?: string[]
  }
): Promise<Array<{
  id: string
  score: number
  metadata: VectorMetadata
}>> {
  const { topK = 10, novelId, sourceTypes = [...ACTIVE_SOURCE_TYPES] } = options

  if (sourceTypes.length === 0 || sourceTypes[0] === 'all') {
    return searchSimilar(vectorize, queryVector, { topK: topK * 3, filter: { novelId } })
      .then(r => r.slice(0, topK))
  }

  const perTypeK = Math.ceil(topK / Math.max(sourceTypes.length, 1))
  const results = await Promise.all(
    sourceTypes.map(st =>
      searchSimilar(vectorize, queryVector, { topK: perTypeK, filter: { novelId, sourceType: st } })
        .catch(() => [] as any[])
    )
  )

  const merged = results.flat()
  const seen = new Set<string>()
  return merged
    .filter(r => {
      if (seen.has(r.id)) return false
      seen.add(r.id)
      return true
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
}

/**
 * 文本分块策略（按段落/句子分割，控制token数量）
 */
export function chunkText(
  text: string,
  options: {
    maxChunkLength?: number
    overlap?: number
    maxChunks?: number
  } = {}
): string[] {
  const { maxChunkLength = 500, overlap = 50, maxChunks } = options

  if (!text || text.length <= maxChunkLength) {
    return text ? [text] : []
  }

  const chunks: string[] = []
  let start = 0

  while (start < text.length) {
    if (maxChunks && chunks.length >= maxChunks) break

    let end = Math.min(start + maxChunkLength, text.length)

    if (end < text.length) {
      const lastNewline = text.lastIndexOf('\n', end)
      const lastPeriod = text.lastIndexOf('。', end)
      const lastComma = text.lastIndexOf('，', end)

      const splitPoint = Math.max(lastNewline, lastPeriod, lastComma)

      if (splitPoint > start + maxChunkLength / 2) {
        end = splitPoint + 1
      }
    }

    chunks.push(text.slice(start, end).trim())
    start = end - overlap
  }

  return chunks.filter(chunk => chunk.length > 0)
}

/**
 * 计算内容hash（用于判断是否需要重新索引）
 */
function hashContent(content: string): string {
  // 简单的hash实现
  let hash = 0
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash
  }
  return hash.toString(16)
}

/**
 * 为大纲/章节等内容生成向量并索引
 * @param {Env} env - 环境变量对象
 * @param {VectorMetadata['sourceType']} sourceType - 内容类型
 * @param {string} sourceId - 内容ID
 * @param {string} novelId - 小说ID
 * @param {string} title - 内容标题
 * @param {string | null} content - 内容文本
 * @param {Record<string, string>} [extraMetadata] - 扩展元数据（settingType, importance等）
 * @returns {Promise<string[]>} 创建的向量ID数组
 */
export async function indexContent(
  env: Env,
  sourceType: VectorMetadata['sourceType'],
  sourceId: string,
  novelId: string,
  title: string,
  content: string | null,
  extraMetadata?: Record<string, string>
): Promise<string[]> {
  if (!content || !content.trim()) {
    return []
  }

  if (!env.VECTORIZE) {
    throw new Error('Vectorize binding not available (503)')
  }

  const db = drizzle(env.DB)
  const contentHash = hashContent(content)
  const rawChunks = chunkText(content)

  const MAX_INDEX_CHUNKS = 8
  const chunks = rawChunks.length > MAX_INDEX_CHUNKS
    ? rawChunks.slice(0, MAX_INDEX_CHUNKS)
    : rawChunks

  if (rawChunks.length > MAX_INDEX_CHUNKS) {
    console.warn(`[indexContent] ${sourceType}:${sourceId} truncated from ${rawChunks.length} to ${MAX_INDEX_CHUNKS} chunks (content length: ${content.length})`)
  }

  const vectorIds: string[] = []

  const existingIndex = await db
    .select()
    .from(vectorIndex)
    .where(
      and(
        eq(vectorIndex.sourceType, sourceType),
        eq(vectorIndex.sourceId, sourceId)
      )
    )
    .limit(1)
    .get()

  if (existingIndex && existingIndex.contentHash === contentHash) {
    console.log(`Content ${sourceType}:${sourceId} unchanged, skipping reindex`)
    return []
  }

  if (existingIndex) {
    const oldRecords = await db
      .select({ id: vectorIndex.id })
      .from(vectorIndex)
      .where(eq(vectorIndex.sourceId, sourceId))
      .all()

    await db.delete(vectorIndex).where(eq(vectorIndex.sourceId, sourceId))

    try {
      const oldIds = oldRecords.map(r => r.id)
      if (oldIds.length > 0) {
        await env.VECTORIZE.deleteByIds(oldIds)
      }
    } catch (e) {
      console.warn('Failed to delete old vectors:', e)
    }
  }

  const safeExtraMetadata: Record<string, string> = {}
  if (extraMetadata && typeof extraMetadata === 'object') {
    for (const [key, value] of Object.entries(extraMetadata)) {
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        safeExtraMetadata[key] = String(value)
      }
    }
  }

  const allVectors: Array<{ id: string; values: number[]; metadata: Record<string, any> }> = []
  const dbRecords: { id: string; novelId: string; sourceType: string; sourceId: string; chunkIndex: number; contentHash: string | null }[] = []

  const embeddings = await embedBatch(env.AI, chunks, 3)

  for (let i = 0; i < chunks.length; i++) {
    const vectorId = `${sourceType}_${sourceId}_${i}`
    const metadata: Record<string, any> = {
      novelId,
      sourceType,
      sourceId,
      title: i === 0 ? title : `${title} (Part ${i + 1})`,
      content: chunks[i],
      ...safeExtraMetadata,
      indexedAt: Date.now(),
    }

    allVectors.push({ id: vectorId, values: embeddings[i], metadata })
    dbRecords.push({
      id: vectorId,
      novelId,
      sourceType,
      sourceId,
      chunkIndex: i,
      contentHash: i === 0 ? contentHash : null,
    })
    vectorIds.push(vectorId)
  }

  try {
    for (let i = 0; i < allVectors.length; i += 10) {
      const batch = allVectors.slice(i, i + 10)
      await env.VECTORIZE.upsert(batch)
    }
  } catch (e) {
    console.error('Failed to upsert vectors to Vectorize:', e)
    throw new Error(`Vectorize upsert failed: ${(e as Error).message}`)
  }

  try {
    for (let i = 0; i < dbRecords.length; i += 20) {
      const batch = dbRecords.slice(i, i + 20)
      await db.insert(vectorIndex).values(batch)
    }
  } catch (e) {
    console.error('Failed to insert vector index records:', e)
  }

  console.log(`Indexed ${vectorIds.length} vectors for ${sourceType}:${sourceId}`)
  return vectorIds
}

/**
 * 删除内容的所有向量索引
 */
export async function deindexContent(
  env: Env,
  sourceType: VectorMetadata['sourceType'],
  sourceId: string,
  _totalChunks: number = 1
): Promise<void> {
  const db = drizzle(env.DB)

  const existingRecords = await db
    .select({ id: vectorIndex.id })
    .from(vectorIndex)
    .where(eq(vectorIndex.sourceId, sourceId))
    .all()

  if (existingRecords.length === 0) {
    return
  }

  for (const record of existingRecords) {
    await deleteVector(env.VECTORIZE, record.id)
  }

  await db.delete(vectorIndex).where(eq(vectorIndex.sourceId, sourceId))
}

export async function fetchContentForIndexing(
  env: Env,
  sourceType: 'outline' | 'chapter',
  sourceId: string
): Promise<{ content: string | null; title: string }> {
  const db = drizzle(env.DB)

  if (sourceType === 'outline') {
    const row = await db
      .select({ content: masterOutline.content, title: masterOutline.title })
      .from(masterOutline)
      .where(eq(masterOutline.id, sourceId))
      .get()
    return { content: row?.content || null, title: row?.title || '' }
  } else if (sourceType === 'chapter') {
    const row = await db
      .select({ content: chapters.content, title: chapters.title })
      .from(chapters)
      .where(eq(chapters.id, sourceId))
      .get()
    return { content: row?.content || null, title: row?.title || '' }
  }

  return { content: null, title: '' }
}
