/**
 * @file plotGraph.ts
 * @description 情节图谱提取服务，从章节内容中提取节点和关系
 * @version 1.0.0
 */
import { drizzle } from 'drizzle-orm/d1'
import { plotNodes, plotEdges, chapters, characters } from '../db/schema'
import { eq, and, sql } from 'drizzle-orm'
import { resolveConfig, generateWithMetrics } from './llm'
import type { LLMCallResult } from './llm'
import type { Env } from '../lib/types'
import { logGeneration } from './agent/logging'

interface ExtractedNode {
  title: string
  type: 'event' | 'character' | 'location' | 'item' | 'foreshadowing'
  description: string
}

interface ExtractedEdge {
  fromTitle: string
  toTitle: string
  relation: string
}

interface ExtractionResult {
  nodes: ExtractedNode[]
  edges: ExtractedEdge[]
}

export async function extractPlotGraph(env: Env, chapterId: string, novelId: string): Promise<void> {
  const db = drizzle(env.DB)

  const chapter = await db.select({
    id: chapters.id,
    title: chapters.title,
    content: chapters.content,
    summary: chapters.summary,
  })
    .from(chapters)
    .where(eq(chapters.id, chapterId))
    .get()

  if (!chapter || !chapter.content) {
    console.warn(`[plotGraph] Chapter ${chapterId} has no content, skipping`)
    return
  }

  const content = chapter.content.length > 6000
    ? chapter.content.slice(0, 6000)
    : chapter.content

  const charList = await db.select({ id: characters.id, name: characters.name })
    .from(characters)
    .where(and(eq(characters.novelId, novelId), sql`${characters.deletedAt} IS NULL`))
    .all()

  const charNames = charList.map(c => c.name).join('、')

  const prompt = `你是一个小说情节分析专家。请从以下章节内容中提取关键情节节点和它们之间的关系。

## 已知角色列表
${charNames || '暂无角色信息'}

## 章节标题
${chapter.title}

## 章节内容
${content}

## 提取要求

请提取以下类型的节点：
- **event**: 关键事件/情节转折点
- **character**: 出场角色（仅提取已知角色列表中的角色）
- **location**: 重要地点/场景
- **item**: 重要物品/功法/宝物
- **foreshadowing**: 伏笔/悬念

请提取节点之间的关系，关系类型包括：
- caused_by: 因果关系（A导致了B）
- participated_in: 参与关系（角色参与了事件）
- occurred_at: 发生地点（事件发生在某地）
- owned_by: 拥有关系（物品属于某人）
- related_to: 一般关联（角色之间的关系：师徒/敌对/盟友/恋人/亲人等）
- leads_to: 情节推进（A引出B）

请以JSON格式返回：
{
  "nodes": [
    {
      "title": "节点名称",
      "type": "event|character|location|item|foreshadowing",
      "description": "简短描述（30字以内）"
    }
  ],
  "edges": [
    {
      "fromTitle": "源节点名称",
      "toTitle": "目标节点名称",
      "relation": "关系类型"
    }
  ]
}

注意：
1. 节点名称要简洁明确，同一实体在不同章节应使用相同名称
2. 角色节点必须来自已知角色列表
3. 关系描述要准确，避免模糊关系
4. 只提取重要的节点和关系，不要提取琐碎内容
5. 严格返回JSON，不要添加任何其他文字`

  const config = await resolveConfig(db, 'analysis', novelId)

  let metrics: LLMCallResult
  try {
    metrics = await generateWithMetrics(config, [
      { role: 'system', content: '你是一个专业的小说情节分析助手，擅长从文本中提取结构化的情节图谱数据。只返回JSON，不要添加任何解释。' },
      { role: 'user', content: prompt },
    ])
  } catch (llmError) {
    await logGeneration(env, {
      novelId,
      chapterId,
      stage: 'plot_graph_extraction',
      modelId: config?.modelId || 'N/A',
      durationMs: 0,
      status: 'error',
      errorMsg: (llmError as Error).message,
    })
    throw llmError
  }

  const extraction = parseExtractionResult(metrics.text)
  if (!extraction) {
    console.warn(`[plotGraph] Failed to parse extraction result for chapter ${chapterId}`)

    await logGeneration(env, {
      novelId,
      chapterId,
      stage: 'plot_graph_extraction',
      modelId: metrics.modelId || 'N/A',
      promptTokens: metrics.usage.prompt_tokens,
      completionTokens: metrics.usage.completion_tokens,
      durationMs: metrics.durationMs || 0,
      status: 'error',
      errorMsg: 'Failed to parse extraction result',
    })

    return
  }

  const oldNodeIds = (await db.select({ id: plotNodes.id })
    .from(plotNodes)
    .where(and(eq(plotNodes.chapterId, chapterId), eq(plotNodes.novelId, novelId)))
    .all()).map(n => n.id)

  if (oldNodeIds.length > 0) {
    const placeholders = oldNodeIds.map(() => '?').join(',')
    await env.DB.prepare(
      `DELETE FROM plot_edges WHERE novel_id = ? AND (from_id IN (${placeholders}) OR to_id IN (${placeholders}))`
    ).bind(novelId, ...oldNodeIds, ...oldNodeIds).run()
  }

  await db.delete(plotNodes)
    .where(and(eq(plotNodes.chapterId, chapterId), eq(plotNodes.novelId, novelId)))
    .run()

  const nodeIdMap = new Map<string, string>()

  for (const node of extraction.nodes) {
    const nodeId = Array.from(crypto.getRandomValues(new Uint8Array(8)))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('')

    const charMatch = charList.find(c => c.name === node.title)
    const meta = JSON.stringify({
      characterId: charMatch?.id || null,
      type: node.type,
    })

    await db.insert(plotNodes).values({
      id: nodeId,
      novelId,
      type: node.type,
      title: node.title,
      description: node.description,
      chapterId,
      meta,
      createdAt: Math.floor(Date.now() / 1000),
    })

    nodeIdMap.set(node.title, nodeId)
  }

  for (const edge of extraction.edges) {
    const fromId = nodeIdMap.get(edge.fromTitle)
    const toId = nodeIdMap.get(edge.toTitle)

    if (!fromId || !toId) continue

    const edgeId = Array.from(crypto.getRandomValues(new Uint8Array(8)))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('')

    await db.insert(plotEdges).values({
      id: edgeId,
      novelId,
      fromId,
      toId,
      relation: edge.relation,
      createdAt: Math.floor(Date.now() / 1000),
    })
  }

  console.log(`[plotGraph] Extracted ${extraction.nodes.length} nodes, ${extraction.edges.length} edges for chapter ${chapterId}`)

  await logGeneration(env, {
    novelId,
    chapterId,
    stage: 'plot_graph_extraction',
    modelId: metrics.modelId || 'N/A',
    promptTokens: metrics.usage.prompt_tokens,
    completionTokens: metrics.usage.completion_tokens,
    durationMs: metrics.durationMs || 0,
    status: 'success',
    contextSnapshot: JSON.stringify({ nodeCount: extraction.nodes.length, edgeCount: extraction.edges.length }),
  })
}

function parseExtractionResult(text: string): ExtractionResult | null {
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return null

    const parsed = JSON.parse(jsonMatch[0])

    const validTypes = ['event', 'character', 'location', 'item', 'foreshadowing']
    const validRelations = ['caused_by', 'participated_in', 'occurred_at', 'owned_by', 'related_to', 'leads_to']

    const nodes = (parsed.nodes || [])
      .filter((n: any) => n.title && validTypes.includes(n.type))
      .map((n: any) => ({
        title: String(n.title).slice(0, 100),
        type: n.type,
        description: String(n.description || '').slice(0, 200),
      }))

    const edges = (parsed.edges || [])
      .filter((e: any) => e.fromTitle && e.toTitle && validRelations.includes(e.relation))
      .map((e: any) => ({
        fromTitle: String(e.fromTitle).slice(0, 100),
        toTitle: String(e.toTitle).slice(0, 100),
        relation: e.relation,
      }))

    return { nodes, edges }
  } catch (e) {
    console.error('[plotGraph] Parse error:', e)
    return null
  }
}
