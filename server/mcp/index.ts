/**
 * @file index.ts
 * @description MCP Server实现，暴露核心工具供Claude Desktop等客户端使用
 * @version 1.0.0
 * @modified 2026-04-21 - 添加规范化注释
 */
import { drizzle } from 'drizzle-orm/d1'
import { eq, and, isNull, desc, sql } from 'drizzle-orm'
import type { Env } from '../lib/types'
import { novels, masterOutline, novelSettings, chapters, characters } from '../db/schema'
import { searchSimilar, embedText } from '../services/embedding'

export interface MCPTool {
  name: string
  description: string
  parameters: {
    type: string
    properties: Record<string, any>
    required?: string[]
  }
}

export interface MCPRequest {
  jsonrpc: '2.0'
  id: string | number
  method: string
  params?: any
}

export interface MCPResponse {
  jsonrpc: '2.0'
  id: string | number
  result?: any
  error?: {
    code: number
    message: string
    data?: any
  }
}

// MCP 工具定义
export const TOOLS: MCPTool[] = [
  {
    name: 'queryNovels',
    description: '查询小说列表，获取所有小说的基本信息',
    parameters: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: '返回数量限制，默认10',
        },
        status: {
          type: 'string',
          description: '按状态筛选: draft/writing/completed/archived',
        },
      },
    },
  },
  {
    name: 'queryOutlines',
    description: '查询指定小说的大纲结构',
    parameters: {
      type: 'object',
      properties: {
        novelId: {
          type: 'string',
          description: '小说ID（必填）',
        },
        type: {
          type: 'string',
          description: '大纲类型筛选: world_setting/volume/chapter_outline/custom',
        },
      },
      required: ['novelId'],
    },
  },
  {
    name: 'queryChapters',
    description: '查询指定小说的章节列表',
    parameters: {
      type: 'object',
      properties: {
        novelId: {
          type: 'string',
          description: '小说ID（必填）',
        },
        limit: {
          type: 'number',
          description: '返回数量限制，默认20',
        },
        status: {
          type: 'string',
          description: '按状态筛选: draft/generated/revised',
        },
      },
      required: ['novelId'],
    },
  },
  {
    name: 'getChapterContent',
    description: '获取指定章节的完整内容',
    parameters: {
      type: 'object',
      properties: {
        chapterId: {
          type: 'string',
          description: '章节ID（必填）',
        },
      },
      required: ['chapterId'],
    },
  },
  {
    name: 'searchSemantic',
    description: '语义搜索：根据描述搜索相关的大纲、章节或角色',
    parameters: {
      type: 'object',
      properties: {
        novelId: {
          type: 'string',
          description: '小说ID（必填，限定搜索范围）',
        },
        query: {
          type: 'string',
          description: '搜索描述（必填）',
        },
        topK: {
          type: 'number',
          description: '返回结果数量，默认5',
        },
      },
      required: ['novelId', 'query'],
    },
  },
  {
    name: 'createOutline',
    description: '创建新大纲节点',
    parameters: {
      type: 'object',
      properties: {
        novelId: { type: 'string', description: '小说ID（必填）' },
        title: { type: 'string', description: '大纲标题' },
        content: { type: 'string', description: '大纲内容' },
        type: { type: 'string', description: '类型: world_setting/volume/chapter_outline/custom' },
        parentId: { type: 'string', description: '父节点ID（可选）' },
      },
      required: ['novelId', 'title'],
    },
  },
  {
    name: 'updateChapter',
    description: '更新章节内容',
    parameters: {
      type: 'object',
      properties: {
        chapterId: { type: 'string', description: '章节ID（必填）' },
        content: { type: 'string', description: '新内容' },
        title: { type: 'string', description: '新标题（可选）' },
      },
      required: ['chapterId', 'content'],
    },
  },
  {
    name: 'generateChapterSummary',
    description: '手动触发章节摘要生成',
    parameters: {
      type: 'object',
      properties: {
        chapterId: { type: 'string', description: '章节ID（必填）' },
      },
      required: ['chapterId'],
    },
  },
  {
    name: 'bulkIndexNovels',
    description: '批量触发小说内容向量化（大纲、章节、角色）',
    parameters: {
      type: 'object',
      properties: {
        novelId: { type: 'string', description: '小说ID（必填）' },
        sourceTypes: {
          type: 'array',
          items: { type: 'string' },
          description: '要向量化的类型列表: outline/chapter/character，默认全部',
        },
      },
      required: ['novelId'],
    },
  },
]

// 工具实现
export async function handleToolCall(
  env: Env,
  toolName: string,
  args: any
): Promise<any> {
  const db = drizzle(env.DB)

  switch (toolName) {
    case 'queryNovels': {
      const limit = args?.limit || 10
      const status = args?.status

      let query = db
        .select({
          id: novels.id,
          title: novels.title,
          description: novels.description,
          genre: novels.genre,
          status: novels.status,
          wordCount: novels.wordCount,
          chapterCount: novels.chapterCount,
          updatedAt: novels.updatedAt,
        })
        .from(novels)
        .where(isNull(novels.deletedAt))
        .orderBy(desc(novels.updatedAt))
        .limit(limit)

      if (status) {
        query = (query as any).where(eq(novels.status, status))
      }

      const rows = await query.all()
      return {
        novels: rows,
        count: rows.length,
      }
    }

    case 'queryOutlines': {
      const { novelId, type } = args

      // v2.0: 查询总纲表（替代原 outlines）
      let query = db
        .select()
        .from(masterOutline)
        .where(and(
          eq(masterOutline.novelId, novelId),
          isNull(masterOutline.deletedAt)
        ))
        .orderBy(desc(masterOutline.version))

      const rows = await query.all()
      return {
        novelId,
        outlines: rows,
        count: rows.length,
      }
    }

    case 'queryChapters': {
      const { novelId, limit = 20, status } = args

      let query = db
        .select({
          id: chapters.id,
          title: chapters.title,
          sortOrder: chapters.sortOrder,
          wordCount: chapters.wordCount,
          status: chapters.status,
          summary: chapters.summary,
          updatedAt: chapters.updatedAt,
        })
        .from(chapters)
        .where(and(eq(chapters.novelId, novelId), isNull(chapters.deletedAt)))
        .orderBy(chapters.sortOrder)
        .limit(limit)

      if (status) {
        query = (query as any).where(eq(chapters.status, status))
      }

      const rows = await query.all()
      return {
        novelId,
        chapters: rows,
        count: rows.length,
      }
    }

    case 'getChapterContent': {
      const { chapterId } = args

      const row = await db
        .select({
          id: chapters.id,
          title: chapters.title,
          content: chapters.content,
          summary: chapters.summary,
          novelId: chapters.novelId,
          wordCount: chapters.wordCount,
        })
        .from(chapters)
        .where(eq(chapters.id, chapterId))
        .get()

      if (!row) {
        throw new Error(`Chapter not found: ${chapterId}`)
      }

      return {
        chapter: row,
      }
    }

    case 'searchSemantic': {
      const { novelId, query, topK = 5 } = args

      if (!env.VECTORIZE) {
        throw new Error('Vectorize not configured')
      }

      const queryVector = await embedText(env.AI, query)
      const results = await searchSimilar(env.VECTORIZE, queryVector, {
        topK,
        filter: { novelId },
      })

      return {
        novelId,
        query,
        results: results.map((r) => ({
          id: r.id,
          score: Math.round(r.score * 1000) / 1000,
          title: r.metadata.title,
          sourceType: r.metadata.sourceType,
          preview: r.metadata.content?.slice(0, 200),
        })),
        count: results.length,
      }
    }

    case 'createOutline': {
      const { novelId, title, content, type = 'custom', parentId } = args
      if (!novelId) throw new Error('novelId is required')
      
      // v2.0: 创建总纲版本（替代原 outlines 表）
      const [row] = await db.insert(masterOutline).values({
        novelId,
        title,
        content: content || '',
        version: 1,
        wordCount: content?.length || 0,
      }).returning()
      return { ok: true, id: row.id }
    }

    case 'updateChapter': {
      const { chapterId, content, title } = args
      if (!chapterId) throw new Error('chapterId is required')
      const updateData: any = { updatedAt: Math.floor(Date.now() / 1e3) }
      if (content) updateData.content = content
      if (title) updateData.title = title
      await db.update(chapters).set(updateData).where(eq(chapters.id, chapterId))
      return { ok: true, chapterId }
    }

    case 'generateChapterSummary': {
      const { chapterId } = args
      if (!chapterId) throw new Error('chapterId is required')
      const { triggerAutoSummary } = await import('../services/agent')
      await triggerAutoSummary(env, chapterId, '', { prompt_tokens: 0, completion_tokens: 0 })
      return { ok: true, message: 'Summary generation triggered', chapterId }
    }

    case 'bulkIndexNovels': {
      const { novelId, sourceTypes = ['outline', 'chapter', 'character'] } = args
      if (!novelId) throw new Error('novelId is required')
      if (!env.VECTORIZE) throw new Error('Vectorize not configured')

      const { indexContent } = await import('../services/embedding')
      let indexedCount = 0

      if (sourceTypes.includes('outline')) {
        // v2.0: 向量化总纲表（替代原 outlines）
        const outlinesToIndex = await db
          .select({ id: masterOutline.id, title: masterOutline.title, content: masterOutline.content })
          .from(masterOutline)
          .where(and(
            eq(masterOutline.novelId, novelId),
            isNull(masterOutline.content),
            sql`${masterOutline.content} IS NOT NULL`
          ))
          .all()
        for (const o of outlinesToIndex) {
          if (o.content) {
            await indexContent(env, 'outline', o.id, novelId, o.title, o.content)
            indexedCount++
          }
        }
      }

      if (sourceTypes.includes('chapter')) {
        const chaptersToIndex = await db
          .select({ id: chapters.id, title: chapters.title, content: chapters.content })
          .from(chapters)
          .where(and(eq(chapters.novelId, novelId), isNull(chapters.deletedAt), sql`${chapters.content} IS NOT NULL`))
          .all()
        for (const c of chaptersToIndex) {
          if (c.content) {
            await indexContent(env, 'chapter', c.id, novelId, c.title, c.content)
            indexedCount++
          }
        }
      }

      if (sourceTypes.includes('character')) {
        const charactersToIndex = await db
          .select({ id: characters.id, name: characters.name, description: characters.description })
          .from(characters)
          .where(and(eq(characters.novelId, novelId), isNull(characters.deletedAt), sql`${characters.description} IS NOT NULL`))
          .all()
        for (const ch of charactersToIndex) {
          if (ch.description) {
            await indexContent(env, 'character', ch.id, novelId, ch.name, ch.description)
            indexedCount++
          }
        }
      }

      return { ok: true, indexedCount, novelId }
    }

    default:
      throw new Error(`Unknown tool: ${toolName}`)
  }
}

// MCP 协议处理
export async function handleMCPRequest(
  env: Env,
  request: MCPRequest
): Promise<MCPResponse> {
  const { id, method, params } = request

  try {
    switch (method) {
      case 'initialize': {
        return {
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: {
              tools: {},
            },
            serverInfo: {
              name: 'novelforge-mcp',
              version: '1.0.0',
            },
          },
        }
      }

      case 'tools/list': {
        return {
          jsonrpc: '2.0',
          id,
          result: {
            tools: TOOLS,
          },
        }
      }

      case 'tools/call': {
        const { name, arguments: args } = params
        const result = await handleToolCall(env, name, args)
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [
              {
                type: 'text',
                text: JSON.stringify(result, null, 2),
              },
            ],
          },
        }
      }

      default:
        return {
          jsonrpc: '2.0',
          id,
          error: {
            code: -32601,
            message: `Method not found: ${method}`,
          },
        }
    }
  } catch (error) {
    return {
      jsonrpc: '2.0',
      id,
      error: {
        code: -32603,
        message: (error as Error).message,
      },
    }
  }
}
