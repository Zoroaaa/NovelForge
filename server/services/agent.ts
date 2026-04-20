/**
 * NovelForge · Agent 智能生成系统
 *
 * 基于 ReAct (Reasoning + Acting) 范式的智能章节生成Agent
 * 支持工具调用：queryOutline / queryCharacter / searchSemantic
 *
 * 工作流程：
 * 1. 接收章节ID → 构建上下文（ContextBuilder）
 * 2. 组装 System Prompt（包含角色设定、写作风格）
 * 3. 调用 LLM 流式生成，支持多轮工具调用
 * 4. 生成完成后自动触发摘要生成（summary_gen）
 */

import { drizzle } from 'drizzle-orm/d1'
import { chapters, modelConfigs, outlines, characters } from '../db/schema'
import { eq, like } from 'drizzle-orm'
import type { Env } from '../lib/types'
import { buildChapterContext, type ContextBundle } from './contextBuilder'
import { streamGenerate, resolveConfig } from './llm'
import { indexContent, searchSimilar, embedText } from './embedding'

export interface AgentConfig {
  maxIterations?: number
  enableRAG?: boolean
  enableAutoSummary?: boolean
}

export interface GenerationOptions {
  mode?: 'generate' | 'continue' | 'rewrite'
  existingContent?: string
}

export interface GenerationResult {
  success: boolean
  contextBundle: ContextBundle | null
  error?: string
  usage?: {
    promptTokens: number
    completionTokens: number
  }
}

const DEFAULT_AGENT_CONFIG: Required<AgentConfig> = {
  maxIterations: 3,
  enableRAG: true,
  enableAutoSummary: true,
}

/**
 * 主入口：智能章节生成（ReAct 多轮循环）
 */
export async function generateChapter(
  env: Env,
  chapterId: string,
  novelId: string,
  onChunk: (text: string) => void,
  onToolCall: (name: string, args: Record<string, any>, result: string) => void,
  onDone: (usage: { prompt_tokens: number; completion_tokens: number }, resolvedModelId: string) => void,
  onError: (err: Error) => void,
  config: Partial<AgentConfig> = {},
  options: GenerationOptions = {}
): Promise<void> {
  const agentConfig = { ...DEFAULT_AGENT_CONFIG, ...config }
  const db = drizzle(env.DB)

  try {
    // 1. 验证章节存在
    const chapter = await db.select().from(chapters).where(eq(chapters.id, chapterId)).get()
    if (!chapter) {
      onError(new Error('Chapter not found'))
      return
    }

    // 2. 构建上下文
    let contextBundle: ContextBundle | null = null

    if (agentConfig.enableRAG && env.VECTORIZE) {
      try {
        contextBundle = await buildChapterContext(env, novelId, chapterId)
        console.log('Context built:', contextBundle.debug)
      } catch (error) {
        console.warn('Context building failed, using simple mode:', error)
      }
    }

    // 3. 解析模型配置
    let llmConfig
    try {
      llmConfig = await resolveConfig(db, 'chapter_gen', novelId)
      llmConfig.apiKey = (env as any)[llmConfig.apiKeyEnv || 'VOLCENGINE_API_KEY'] || ''
    } catch (error) {
      console.warn('No model config found, using fallback')
      llmConfig = {
        provider: 'volcengine',
        modelId: 'doubao-seed-2-pro',
        apiBase: 'https://ark.cn-beijing.volces.com/api/v3',
        apiKey: (env as any).VOLCENGINE_API_KEY || '',
        params: { temperature: 0.85, max_tokens: 4096 },
      }
    }

    // 4. 组装初始消息
    const messages = buildMessages(chapter.title, contextBundle, options, llmConfig.params?.systemPromptOverride)

    // 5. ReAct 多轮循环
    const maxIterations = agentConfig.maxIterations || 3
    let iteration = 0
    let totalPromptTokens = 0
    let totalCompletionTokens = 0

    while (iteration < maxIterations) {
      iteration++
      let iterationContent = ''

      await streamGenerate(llmConfig, messages, {
        onChunk: (text) => {
          iterationContent += text
          onChunk(text)
        },
        onDone: (usage) => {
          totalPromptTokens += usage.prompt_tokens
          totalCompletionTokens += usage.completion_tokens
        },
        onError: (err) => {
          throw err
        },
      }, AGENT_TOOLS)

      // 将 LLM 生成的内容作为 assistant 消息追加到 messages
      if (iterationContent) {
        messages.push({ role: 'assistant', content: iterationContent })
      }

      // 检测最后一条 assistant 消息是否包含工具调用
      const lastMessage = messages[messages.length - 1]
      const toolCalls = extractToolCalls(lastMessage.content)

      if (toolCalls.length === 0) {
        // 无工具调用，生成完成，退出循环
        break
      }

      // 执行工具调用，将结果追加到 messages
      for (const toolCall of toolCalls) {
        try {
          const result = await executeAgentTool(env, toolCall.name, toolCall.args)
          onToolCall(toolCall.name, toolCall.args, result)
          messages.push({
            role: 'assistant',
            content: `[Tool: ${toolCall.name}] Called with: ${JSON.stringify(toolCall.args)}`,
          })
          messages.push({
            role: 'user',
            content: `[Tool Result: ${toolCall.name}]\n${result}`,
          })
          console.log(`Tool executed: ${toolCall.name}`, result.slice(0, 100))
        } catch (error) {
          const errorMsg = (error as Error).message
          onToolCall(toolCall.name, toolCall.args, `Error: ${errorMsg}`)
          messages.push({
            role: 'user',
            content: `[Tool Error: ${toolCall.name}]\n${errorMsg}`,
          })
          console.warn(`Tool execution failed: ${toolCall.name}`, error)
        }
      }
    }

    // 6. 触发自动摘要
    if (agentConfig.enableAutoSummary) {
      await triggerAutoSummary(env, chapterId, novelId, {
        prompt_tokens: totalPromptTokens,
        completion_tokens: totalCompletionTokens,
      })
    }

    onDone(
      { prompt_tokens: totalPromptTokens, completion_tokens: totalCompletionTokens },
      llmConfig.modelId
    )
  } catch (error) {
    console.error('Generation failed:', error)
    onError(error as Error)
  }
}

/**
 * 从消息内容中提取工具调用
 * 支持两种格式：
 * 1. JSON 格式的工具调用标记
 * 2. 自然语言中的工具调用指令
 */
function extractToolCalls(content: string): Array<{ name: string; args: Record<string, any> }> {
  const toolCalls: Array<{ name: string; args: Record<string, any> }> = []

  // 匹配 JSON 格式的工具调用：{"tool": "xxx", "args": {...}}
  const jsonRegex = /\{[\s\S]*?"tool"\s*:\s*"(\w+)"\s*,\s*"args"\s*:\s*\{[\s\S]*?\}[\s\S]*?\}/g
  let match

  while ((match = jsonRegex.exec(content)) !== null) {
    try {
      const parsed = JSON.parse(match[0])
      toolCalls.push({ name: parsed.tool, args: parsed.args || {} })
    } catch {
      // JSON 解析失败，忽略
    }
  }

  // 如果没有 JSON 格式的工具调用，检查自然语言格式
  if (toolCalls.length === 0) {
    const TOOL_NAMES = ['queryOutline', 'queryCharacter', 'searchSemantic']

    for (const toolName of TOOL_NAMES) {
      // 匹配：调用 queryOutline 工具，参数：...
      // 或：[Tool: queryOutline] args: {...}
      const regex = new RegExp(`(?:调用\\s+)?(?:\\[Tool:\\s*)?${toolName}(?:\\]\\s*(?:args|参数)\\s*[:：]\\s*)?`, 'g')
      if (regex.test(content)) {
        // 尝试提取 args
        let args: Record<string, any> = {}
        const argsRegex = new RegExp(`(?:args|参数)\\s*[:：]\\s*(\\{[\\s\\S]*?\\})`, 'g')
        const argsMatch = argsRegex.exec(content)
        if (argsMatch) {
          try {
            args = JSON.parse(argsMatch[1])
          } catch {
            // 解析失败，使用空 args
          }
        }
        toolCalls.push({ name: toolName, args })
      }
    }
  }

  return toolCalls
}

/**
 * 组装消息（根据是否有上下文选择不同策略）
 */
function buildMessages(
  chapterTitle: string,
  contextBundle: ContextBundle | null,
  options: GenerationOptions = {},
  systemPromptOverride?: string
): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> {
  const { mode = 'generate', existingContent } = options
  const baseSystemPrompt = `你是一位专业的网络小说作家，擅长创作玄幻/仙侠类小说。
你的写作风格：
- 文笔流畅，节奏紧凑
- 善用对话推动情节
- 注重场景描写和氛围营造
- 每章结尾留有悬念
- 人物性格鲜明，行为符合设定

【工具使用指南】
在创作前，你可以通过调用工具获取参考资料。如需使用工具，请在内容开头使用 JSON 格式：
{"tool": "工具名", "args": {"参数名": "参数值"}}

可用工具：
- queryOutline: 查询大纲内容，args: { novelId: "小说ID" }
- queryCharacter: 查询角色信息，args: { novelId: "小说ID" }
- searchSemantic: 语义搜索相关内容，args: { query: "搜索描述", novelId: "小说ID" }

示例：
{"tool": "queryCharacter", "args": {"novelId": "abc123"}}

注意：工具调用和正式创作应分开进行，先调用工具获取信息，再基于工具结果进行创作。`

  const presets: Record<string, string> = {
    fantasy: baseSystemPrompt,
    urban: `你是一位专业的都市小说作家。
你的写作风格：
- 贴近现实，代入感强
- 人物心理描写细腻
- 情节节奏明快，冲突激烈
- 对话生活化，富有幽默感

【工具使用指南】
在创作前，你可以通过调用工具获取参考资料。如需使用工具，请在内容开头使用 JSON 格式：
{"tool": "工具名", "args": {"参数名": "参数值"}}

可用工具：
- queryOutline: 查询大纲内容，args: { novelId: "小说ID" }
- queryCharacter: 查询角色信息，args: { novelId: "小说ID" }
- searchSemantic: 语义搜索相关内容，args: { query: "搜索描述", novelId: "小说ID" }

注意：工具调用和正式创作应分开进行，先调用工具获取信息，再基于工具结果进行创作。`,
    mystery: `你是一位专业的悬疑小说作家。
你的写作风格：
- 逻辑严密，伏笔巧妙
- 悬念迭起，扣人心弦
- 场景描写有画面感
- 结局出人意料又在情理之中

【工具使用指南】
在创作前，你可以通过调用工具获取参考资料。如需使用工具，请在内容开头使用 JSON 格式：
{"tool": "工具名", "args": {"参数名": "参数值"}}

可用工具：
- queryOutline: 查询大纲内容，args: { novelId: "小说ID" }
- queryCharacter: 查询角色信息，args: { novelId: "小说ID" }
- searchSemantic: 语义搜索相关内容，args: { query: "搜索描述", novelId: "小说ID" }

注意：工具调用和正式创作应分开进行，先调用工具获取信息，再基于工具结果进行创作。`,
    scifi: `你是一位专业的科幻小说作家。
你的写作风格：
- 硬核科幻，设定严谨
- 宏大叙事与微观细节并重
- 科技与人文思考结合
- 想象力丰富且有科学依据

【工具使用指南】
在创作前，你可以通过调用工具获取参考资料。如需使用工具，请在内容开头使用 JSON 格式：
{"tool": "工具名", "args": {"参数名": "参数值"}}

可用工具：
- queryOutline: 查询大纲内容，args: { novelId: "小说ID" }
- queryCharacter: 查询角色信息，args: { novelId: "小说ID" }
- searchSemantic: 语义搜索相关内容，args: { query: "搜索描述", novelId: "小说ID" }

注意：工具调用和正式创作应分开进行，先调用工具获取信息，再基于工具结果进行创作。`,
  }

  const systemPrompt = systemPromptOverride && Object.keys(presets).includes(systemPromptOverride)
    ? presets[systemPromptOverride]
    : (systemPromptOverride || baseSystemPrompt)

  if (mode === 'continue' && existingContent) {
    const tailContent = existingContent.slice(-15000)
    return [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: `【续写任务】
请在以下已有内容的基础上继续创作，保持文风一致，情节自然衔接。

【已有内容（最后部分）】：
${tailContent}

要求：续写 2000-3000 字，与前文衔接自然，情节发展合理。`,
      },
    ]
  }

  if (mode === 'rewrite' && existingContent) {
    return [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: `【重写任务】
请对以下内容进行改写，可以调整叙事方式、丰富描写、优化节奏，但保持核心情节不变。

【待改写内容】：
${existingContent}

要求：改写后 2000-3000 字，文笔更流畅，描写更丰富，节奏更紧凑。`,
      },
    ]
  }

  if (!contextBundle) {
    return [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: `请创作《${chapterTitle}》的正文内容。
要求：3000-5000字，第三人称叙述，情节连贯。`,
      },
    ]
  }

  const userContentParts: string[] = []

  userContentParts.push(`【创作任务】`)
  userContentParts.push(`请创作《${chapterTitle}》的正文内容，3000-5000字。`)

  if (contextBundle.mandatory.chapterOutline) {
    userContentParts.push(`\n【本章大纲】\n${contextBundle.mandatory.chapterOutline}`)
  }

  if (contextBundle.mandatory.prevChapterSummary) {
    userContentParts.push(`\n【上一章摘要】\n${contextBundle.mandatory.prevChapterSummary}`)
  }

  if (contextBundle.mandatory.recentChainSummaries.length > 0) {
    userContentParts.push(`\n【前情回顾】\n${contextBundle.mandatory.recentChainSummaries.join('\n')}`)
  }

  if (contextBundle.mandatory.volumeSummary) {
    userContentParts.push(`\n【当前卷概要】\n${contextBundle.mandatory.volumeSummary}`)
  }

  if (contextBundle.mandatory.protagonistCards.length > 0) {
    userContentParts.push(
      `\n【主要角色】\n${contextBundle.mandatory.protagonistCards.join('\n\n')}`
    )
  }

  if (contextBundle.ragChunks.length > 0) {
    userContentParts.push('\n【相关参考资料】')
    contextBundle.ragChunks.forEach((chunk, index) => {
      userContentParts.push(
        `\n参考资料 ${index + 1} [${chunk.sourceType}] (${chunk.title})：\n${chunk.content}`
      )
    })
  }

  userContentParts.push(
    '\n\n请基于以上资料进行创作，确保：\n' +
    '- 符合大纲要求\n' +
    '- 与前文衔接自然\n' +
    '- 角色行为符合设定\n' +
    '- 文风流畅，节奏紧凑'
  )

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userContentParts.join('\n') },
  ]
}

/**
 * 触发自动摘要生成
 */
export async function triggerAutoSummary(
  env: Env,
  chapterId: string,
  novelId: string,
  generationUsage: { prompt_tokens: number; completion_tokens: number }
): Promise<void> {
  try {
    const db = drizzle(env.DB)

    // 获取刚生成的章节内容
    const chapter = await db
      .select({
        title: chapters.title,
        content: chapters.content,
      })
      .from(chapters)
      .where(eq(chapters.id, chapterId))
      .get()

    if (!chapter?.content) {
      console.log('No content to summarize')
      return
    }

    // 解析摘要模型配置
    let summaryConfig
    try {
      summaryConfig = await resolveConfig(db, 'summary_gen', novelId)
      summaryConfig.apiKey =
        (env as any)[summaryConfig.apiKeyEnv || 'VOLCENGINE_API_KEY'] || ''
    } catch {
      // 使用默认配置
      summaryConfig = {
        provider: 'volcengine',
        modelId: 'doubao-lite-32k', // 摘要用轻量模型
        apiBase: 'https://ark.cn-beijing.volces.com/api/v3',
        apiKey: (env as any).VOLCENGINE_API_KEY || '',
        params: { temperature: 0.3, max_tokens: 500 }, // 低温度保证稳定性
      }
    }

    // 截取前2000字符用于摘要（避免超长输入）
    const contentForSummary = chapter.content.slice(0, 2000)

    const summaryMessages = [
      {
        role: 'system' as const,
        content:
          '你是一个专业的文本摘要助手。请为以下小说章节生成一段简洁的摘要（150-200字），概括本章的主要情节、关键转折点和人物动态。',
      },
      {
        role: 'user' as const,
        content: `章节标题：《${chapter.title}》\n\n正文内容：\n${contentForSummary}`,
      },
    ]

    // 非流式调用获取摘要
    const base = summaryConfig.apiBase || getDefaultBase(summaryConfig.provider)
    const resp = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${summaryConfig.apiKey}`,
      },
      body: JSON.stringify({
        model: summaryConfig.modelId,
        messages: summaryMessages,
        stream: false,
        temperature: summaryConfig.params?.temperature ?? 0.3,
        max_tokens: summaryConfig.params?.max_tokens ?? 500,
      }),
    })

    if (!resp.ok) {
      throw new Error(`Summary API error: ${resp.status}`)
    }

    const result = await resp.json()
    const summaryText = result.choices?.[0]?.message?.content

    if (summaryText) {
      // 更新数据库中的摘要字段
      await db
        .update(chapters)
        .set({
          summary: summaryText,
          summaryAt: Math.floor(Date.now() / 1000),
          summaryModel: summaryConfig.modelId,
          promptTokens: generationUsage.prompt_tokens,
          completionTokens: generationUsage.completion_tokens,
        })
        .where(eq(chapters.id, chapterId))

      console.log(`✅ Summary generated for chapter ${chapterId}:`, summaryText.slice(0, 100))
      
      // 异步触发摘要向量化
      if (env.VECTORIZE) {
        try {
          await indexContent(
            env,
            'summary',
            chapterId,
            novelId,
            `章节摘要: ${chapter.title}`,
            summaryText
          )
          console.log(`✅ Summary indexed for chapter ${chapterId}`)
        } catch (indexError) {
          console.warn('Failed to index summary:', indexError)
        }
      }
    }
  } catch (error) {
    console.warn('Auto-summary failed (non-critical):', error)
    // 摘要失败不影响主流程
  }
}

function getDefaultBase(provider: string): string {
  switch (provider) {
    case 'volcengine':
      return 'https://ark.cn-beijing.volces.com/api/v3'
    case 'anthropic':
      return 'https://api.anthropic.com/v1'
    case 'openai':
      return 'https://api.openai.com/v1'
    default:
      return 'https://ark.cn-beijing.volces.com/api/v3'
  }
}

const AGENT_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'queryOutline',
      description: '查询小说大纲内容，用于获取世界观、卷纲、章节大纲等信息',
      parameters: {
        type: 'object',
        properties: {
          novelId: { type: 'string', description: '小说ID' },
          type: { type: 'string', description: '大纲类型: world_setting/volume/chapter_outline' },
        },
        required: ['novelId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'queryCharacter',
      description: '查询角色信息，包括角色设定、属性、背景故事等',
      parameters: {
        type: 'object',
        properties: {
          novelId: { type: 'string', description: '小说ID' },
          role: { type: 'string', description: '角色类型筛选: protagonist/antagonist/supporting' },
        },
        required: ['novelId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'searchSemantic',
      description: '语义搜索相关文档，通过自然语言描述查找相关内容',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '搜索描述' },
          novelId: { type: 'string', description: '小说ID' },
          topK: { type: 'number', description: '返回结果数量，默认5' },
        },
        required: ['query', 'novelId'],
      },
    },
  },
]

async function executeAgentTool(
  env: Env,
  toolName: string,
  args: Record<string, any>
): Promise<string> {
  const db = drizzle(env.DB)

  switch (toolName) {
    case 'queryOutline': {
      const { novelId, type } = args
      const query = db.select().from(outlines).where(eq(outlines.novelId, novelId))
      if (type) {
        query.where(eq(outlines.type, type))
      }
      const results = await query.limit(10).all()
      return JSON.stringify(results.map(r => ({ title: r.title, content: r.content, type: r.type })), null, 2)
    }

    case 'queryCharacter': {
      const { novelId, role } = args
      const query = db.select().from(characters).where(eq(characters.novelId, novelId))
      if (role) {
        query.where(eq(characters.role, role))
      }
      const results = await query.limit(10).all()
      return JSON.stringify(results.map(c => ({ name: c.name, role: c.role, description: c.description })), null, 2)
    }

    case 'searchSemantic': {
      if (!env.VECTORIZE) {
        return JSON.stringify({ error: 'Vectorize not available' })
      }
      const { query, novelId, topK = 5 } = args
      const queryVector = await embedText(env.AI, query)
      const searchResults = await searchSimilar(env.VECTORIZE, queryVector, { topK, filter: { novelId } })
      return JSON.stringify(searchResults.map(r => ({ title: r.metadata.title, content: r.metadata.content, score: r.score })), null, 2)
    }

    default:
      return JSON.stringify({ error: `Unknown tool: ${toolName}` })
  }
}
