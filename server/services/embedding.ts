/**
 * NovelForge · Embedding 向量化服务
 *
 * 使用 Cloudflare Workers AI (@cf/baai/bge-base-zh-v1.5) 进行中文文本嵌入
 * 支持 Vectorize 索引的增删改查
 */

import type { Env } from '../lib/types'

export interface VectorMetadata {
  novelId: string
  sourceType: 'outline' | 'chapter' | 'character' | 'summary'
  sourceId: string
  title?: string
  content?: string
}

export interface EmbeddingResult {
  vectorId: string
  values: number[]
  metadata: VectorMetadata
}

const EMBEDDING_MODEL = '@cf/baai/bge-base-zh-v1.5'
const DIMENSIONS = 768

/**
 * 对单个文本进行向量化
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
 */
export async function embedBatch(
  ai: Env['AI'],
  chunks: string[]
): Promise<number[][]> {
  const results: number[][] = []

  for (const chunk of chunks) {
    const vector = await embedText(ai, chunk)
    results.push(vector)
  }

  return results
}

/**
 * 将向量插入到 Vectorize 索引
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

/**
 * 文本分块策略（按段落/句子分割，控制token数量）
 */
export function chunkText(
  text: string,
  options: {
    maxChunkLength?: number
    overlap?: number
  } = {}
): string[] {
  const { maxChunkLength = 500, overlap = 50 } = options

  if (!text || text.length <= maxChunkLength) {
    return text ? [text] : []
  }

  const chunks: string[] = []
  let start = 0

  while (start < text.length) {
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
 * 为大纲/章节等内容生成向量并索引
 */
export async function indexContent(
  env: Env,
  sourceType: VectorMetadata['sourceType'],
  sourceId: string,
  novelId: string,
  title: string,
  content: string | null
): Promise<string[]> {
  if (!content || !content.trim()) {
    return []
  }

  const vectorIds: string[] = []
  const chunks = chunkText(content)

  for (let i = 0; i < chunks.length; i++) {
    const vectorId = `${sourceType}_${sourceId}_${i}`
    const values = await embedText(env.AI, chunks[i])

    await upsertVector(env.VECTORIZE, vectorId, values, {
      novelId,
      sourceType,
      sourceId,
      title: i === 0 ? title : `${title} (Part ${i + 1})`,
      content: chunks[i]
    })

    vectorIds.push(vectorId)
  }

  return vectorIds
}

/**
 * 删除内容的所有向量索引
 */
export async function deindexContent(
  env: Env,
  sourceType: VectorMetadata['sourceType'],
  sourceId: string,
  totalChunks: number = 1
): Promise<void> {
  const idsToDelete = Array.from({ length: totalChunks }, (_, i) =>
    `${sourceType}_${sourceId}_${i}`
  )

  for (const id of idsToDelete) {
    await deleteVector(env.VECTORIZE, id)
  }
}
