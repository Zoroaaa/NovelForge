/**
 * @file index.ts
 * @description MCP Server实现，暴露核心工具供Claude Desktop等客户端使用
 * @version 1.0.0
 * @modified 2026-04-21 - 添加规范化注释
 */
import { drizzle } from 'drizzle-orm/d1'
import { eq, and, isNull, desc, sql } from 'drizzle-orm'
import type { Env } from '../lib/types'
import { novels, masterOutline, novelSettings, chapters, characters, foreshadowing, writingRules, volumes } from '../db/schema'
import { searchSimilar, embedText, searchSimilarMulti, ACTIVE_SOURCE_TYPES } from '../services/embedding'

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
  {
    name: 'createChapter',
    description: '创建新章节',
    parameters: {
      type: 'object',
      properties: {
        novelId: { type: 'string', description: '小说ID（必填）' },
        volumeId: { type: 'string', description: '卷ID（可选）' },
        title: { type: 'string', description: '章节标题' },
        content: { type: 'string', description: '章节内容' },
        sortOrder: { type: 'number', description: '排序号' },
      },
      required: ['novelId', 'title'],
    },
  },
  {
    name: 'addForeshadowing',
    description: '新增伏笔记录',
    parameters: {
      type: 'object',
      properties: {
        novelId: { type: 'string', description: '小说ID（必填）' },
        chapterId: { type: 'string', description: '关联章节ID（可选）' },
        title: { type: 'string', description: '伏笔标题（必填）' },
        description: { type: 'string', description: '伏笔描述' },
        importance: { type: 'string', description: '重要程度: high/normal/low' },
      },
      required: ['novelId', 'title'],
    },
  },
  {
    name: 'resolveForeshadowing',
    description: '标记伏笔已收尾',
    parameters: {
      type: 'object',
      properties: {
        foreshadowingId: { type: 'string', description: '伏笔ID（必填）' },
        resolvedChapterId: { type: 'string', description: '收尾章节ID（可选）' },
        resolutionNote: { type: 'string', description: '收尾说明' },
      },
      required: ['foreshadowingId'],
    },
  },
  {
    name: 'addWritingRule',
    description: '添加创作规则',
    parameters: {
      type: 'object',
      properties: {
        novelId: { type: 'string', description: '小说ID（必填）' },
        category: { type: 'string', description: '规则类别: style/plot/character/worldbuilding/dialogue' },
        title: { type: 'string', description: '规则标题（必填）' },
        content: { type: 'string', description: '规则内容（必填）' },
        priority: { type: 'number', description: '优先级 1-10，默认5' },
      },
      required: ['novelId', 'title', 'content'],
    },
  },
  {
    name: 'triggerGenerate',
    description: '触发AI章节生成（异步，返回生成任务ID）',
    parameters: {
      type: 'object',
      properties: {
        chapterId: { type: 'string', description: '章节ID（必填）' },
        novelId: { type: 'string', description: '小说ID（必填）' },
        mode: { type: 'string', description: '生成模式: generate/continue/rewrite，默认generate' },
        context: { type: 'string', description: '额外上下文（可选）' },
      },
      required: ['chapterId', 'novelId'],
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
      const query = db
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
      const { novelId, query, topK = 5, sourceTypes } = args

      if (!env.VECTORIZE) {
        throw new Error('Vectorize not configured')
      }

      const queryVector = await embedText(env.AI, query)
      const results = await searchSimilarMulti(env.VECTORIZE, queryVector, {
        topK,
        novelId,
        sourceTypes: sourceTypes || [...ACTIVE_SOURCE_TYPES],
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
      const { novelId, sourceTypes = ['setting', 'character', 'foreshadowing'] } = args
      if (!novelId) throw new Error('novelId is required')
      if (!env.VECTORIZE) throw new Error('Vectorize not configured')

      const { indexContent } = await import('../services/embedding')
      let indexedCount = 0

      if (sourceTypes.includes('setting')) {
        const settingsToIndex = await db
          .select({ id: novelSettings.id, name: novelSettings.name, content: novelSettings.content, summary: novelSettings.summary, type: novelSettings.type, importance: novelSettings.importance })
          .from(novelSettings)
          .where(and(eq(novelSettings.novelId, novelId), sql`${novelSettings.deletedAt} IS NULL`, sql`${novelSettings.content} IS NOT NULL`))
          .all()
        for (const s of settingsToIndex) {
          const indexText = s.summary || (s.content.length > 500 ? s.content.slice(0, 500) : s.content)
          await indexContent(env, 'setting', s.id, novelId, s.name, indexText, { settingType: s.type, importance: s.importance })
          indexedCount++
        }
      }

      if (sourceTypes.includes('character')) {
        const charactersToIndex = await db
          .select({ id: characters.id, name: characters.name, description: characters.description, role: characters.role })
          .from(characters)
          .where(and(eq(characters.novelId, novelId), sql`${characters.deletedAt} IS NULL`, sql`${characters.description} IS NOT NULL`))
          .all()
        for (const ch of charactersToIndex) {
          const indexText = `${ch.name}${ch.role ? ` (${ch.role})` : ''}\n${(ch.description || '').slice(0, 300)}`
          await indexContent(env, 'character', ch.id, novelId, ch.name, indexText)
          indexedCount++
        }
      }

      if (sourceTypes.includes('foreshadowing')) {
        const itemsToIndex = await db
          .select({ id: foreshadowing.id, title: foreshadowing.title, description: foreshadowing.description, importance: foreshadowing.importance })
          .from(foreshadowing)
          .where(and(eq(foreshadowing.novelId, novelId), sql`${foreshadowing.deletedAt} IS NULL`, sql`${foreshadowing.description} IS NOT NULL`))
          .all()
        for (const f of itemsToIndex) {
          await indexContent(env, 'foreshadowing', f.id, novelId, f.title, f.description, { importance: f.importance })
          indexedCount++
        }
      }

      return { ok: true, indexedCount, novelId }
    }

    case 'createChapter': {
      const { novelId, volumeId, title, content, sortOrder } = args
      if (!novelId || !title) throw new Error('novelId and title are required')

      const maxSortOrder = await db
        .select({ maxOrder: sql<number>`MAX(${chapters.sortOrder})` })
        .from(chapters)
        .where(eq(chapters.novelId, novelId))
        .get()

      const [newChapter] = await db.insert(chapters).values({
        novelId,
        volumeId: volumeId || null,
        title,
        content: content || '',
        sortOrder: sortOrder ?? (maxSortOrder?.maxOrder ?? 0) + 1,
        wordCount: content?.length || 0,
      }).returning()

      return { ok: true, chapter: newChapter }
    }

    case 'addForeshadowing': {
      const { novelId, chapterId, title, description, importance = 'normal' } = args
      if (!novelId || !title) throw new Error('novelId and title are required')

      const [newForeshadowing] = await db.insert(foreshadowing).values({
        novelId,
        chapterId: chapterId || null,
        title,
        description: description || '',
        status: 'open',
        importance,
      }).returning()

      return { ok: true, foreshadowing: newForeshadowing }
    }

    case 'resolveForeshadowing': {
      const { foreshadowingId, resolvedChapterId, resolutionNote } = args
      if (!foreshadowingId) throw new Error('foreshadowingId is required')

      const updateData: any = {
        status: 'resolved',
        resolvedAt: Math.floor(Date.now() / 1e3),
      }
      if (resolvedChapterId) updateData.resolvedChapterId = resolvedChapterId
      if (resolutionNote) updateData.resolutionNote = resolutionNote

      await db.update(foreshadowing).set(updateData).where(eq(foreshadowing.id, foreshadowingId))
      return { ok: true, foreshadowingId, message: '伏笔已标记为已收尾' }
    }

    case 'addWritingRule': {
      const { novelId, category, title, content, priority = 5 } = args
      if (!novelId || !title || !content) throw new Error('novelId, title and content are required')

      const [newRule] = await db.insert(writingRules).values({
        novelId,
        category: category || 'style',
        title,
        content,
        priority,
        isActive: 1,
      }).returning()

      return { ok: true, rule: newRule }
    }

    case 'triggerGenerate': {
      const { chapterId, novelId, mode = 'generate', context } = args
      if (!chapterId || !novelId) throw new Error('chapterId and novelId are required')

      let config: any
      try {
        const { resolveConfig } = await import('../services/llm')
        config = await resolveConfig(env.DB as any, novelId, 'chapter_gen')
      } catch (e) {
        throw new Error(`无法获取模型配置: ${(e as Error).message}`)
      }

      const { streamGenerate } = await import('../services/llm')
      let generatedContent = ''
      let generationComplete = false

      try {
        await streamGenerate(
          config,
          [{ role: 'user' as const, content: `请生成章节内容（模式: ${mode}）${context ? `\n\n上下文：${context}` : ''}` }],
          {
            onChunk: (chunk: string) => {
              if (chunk) generatedContent += chunk
            },
            onDone: () => { generationComplete = true },
            onError: (error: Error) => { throw error },
          }
        )

        return {
          ok: true,
          message: '章节生成完成',
          chapterId,
          mode,
          wordCount: generatedContent.length,
          preview: generatedContent.slice(0, 500),
        }
      } catch (genError) {
        return {
          ok: false,
          error: `生成失败: ${(genError as Error).message}`,
          chapterId,
        }
      }
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
