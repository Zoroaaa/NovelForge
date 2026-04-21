/**
 * @file agent.ts
 * @description Agent智能生成系统模块，基于ReAct范式的智能章节生成，支持工具调用和多轮对话
 * @version 1.4.0
 * @modified 2026-04-21 - 添加规范化注释
 */
import { drizzle } from 'drizzle-orm/d1'
import { chapters, modelConfigs, characters, novelSettings, masterOutline, volumes, generationLogs } from '../db/schema'
import { eq, desc, sql } from 'drizzle-orm'
import type { Env } from '../lib/types'
import { buildChapterContext, type ContextBundle } from './contextBuilder'
import { streamGenerate, resolveConfig } from './llm'
import { indexContent, searchSimilar, embedText } from './embedding'
import { extractForeshadowingFromChapter } from './foreshadowing'
import { detectPowerLevelBreakthrough } from './powerLevel'

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

export interface ToolCallEvent {
  type: 'tool_call'
  name: string
  args: Record<string, any>
  status: 'running' | 'done'
  result?: string
}

const DEFAULT_AGENT_CONFIG: Required<AgentConfig> = {
  maxIterations: 5,
  enableRAG: true,
  enableAutoSummary: true,
}

// Phase 1.4: OpenAI 标准 tools 定义
const AGENT_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'queryOutline',
      description: '查询小说大纲内容，用于获取世界观、卷纲、章节大纲等信息。在需要了解整体剧情走向或特定部分设定时调用。',
      parameters: {
        type: 'object',
        properties: {
          novelId: { type: 'string', description: '小说ID' },
          type: { 
            type: 'string', 
            enum: ['world_setting', 'volume', 'chapter_outline', 'arc', 'custom'],
            description: '大纲类型筛选：world_setting(世界观)/volume(卷纲)/chapter_outline(章节大纲)/arc(故事线)/custom(自定义)' 
          },
        },
        required: ['novelId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'queryCharacter',
      description: '查询角色信息，包括角色设定、属性、背景故事等。在需要了解角色详情或确保角色一致性时调用。',
      parameters: {
        type: 'object',
        properties: {
          novelId: { type: 'string', description: '小说ID' },
          role: { 
            type: 'string', 
            enum: ['protagonist', 'antagonist', 'supporting'],
            description: '角色类型筛选：protagonist(主角)/antagonist(反派)/supporting(配角)' 
          },
        },
        required: ['novelId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'searchSemantic',
      description: '语义搜索相关文档，通过自然语言描述查找相关的历史内容、世界观片段等。在需要查找特定信息或参考之前的内容时调用。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '搜索描述，用自然语言描述你要查找的内容' },
          novelId: { type: 'string', description: '小说ID' },
          topK: { type: 'number', description: '返回结果数量，默认5，最大10' },
        },
        required: ['query', 'novelId'],
      },
    },
  },
]

/**
 * 主入口：智能章节生成（ReAct多轮循环）
 * @param {Env} env - 环境变量对象
 * @param {string} chapterId - 章节ID
 * @param {string} novelId - 小说ID
 * @param {Function} onChunk - 内容块回调
 * @param {Function} onToolCall - 工具调用回调
 * @param {Function} onDone - 完成回调
 * @param {Function} onError - 错误回调
 * @param {Partial<AgentConfig>} [config] - Agent配置
 * @param {GenerationOptions} [options] - 生成选项
 * @returns {Promise<void>}
 */
export async function generateChapter(
  env: Env,
  chapterId: string,
  novelId: string,
  onChunk: (text: string) => void,
  onToolCall: (event: ToolCallEvent) => void,
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
      llmConfig.apiKey = llmConfig.apiKey || (env as any)[llmConfig.apiKeyEnv || 'VOLCENGINE_API_KEY'] || ''
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

    // 5. Phase 1.4: ReAct 多轮循环（真正实现）
    const usageResult = await runReActLoop(
      env,
      llmConfig,
      messages,
      novelId,
      onChunk,
      onToolCall,
      agentConfig.maxIterations
    )

    // 6. 触发自动摘要
    if (agentConfig.enableAutoSummary) {
      await triggerAutoSummary(env, chapterId, novelId, {
        prompt_tokens: usageResult.promptTokens,
        completion_tokens: usageResult.completionTokens,
      })
    }

    // 7. 自动提取伏笔信息
    try {
      const foreshadowingResult = await extractForeshadowingFromChapter(env, chapterId, novelId)
      if (foreshadowingResult.newForeshadowing.length > 0 || foreshadowingResult.resolvedForeshadowingIds.length > 0) {
        console.log(`📝 Foreshadowing: ${foreshadowingResult.newForeshadowing.length} new, ${foreshadowingResult.resolvedForeshadowingIds.length} resolved`)
      }
    } catch (foreshadowError) {
      console.warn('Foreshadowing extraction failed (non-critical):', foreshadowError)
    }

    // 8. 自动检测境界突破事件
    try {
      const powerLevelResult = await detectPowerLevelBreakthrough(env, chapterId, novelId)
      if (powerLevelResult.hasBreakthrough) {
        console.log(`⚡ Power level: ${powerLevelResult.updates.length} breakthroughs detected`)
      }
    } catch (powerLevelError) {
      console.warn('Power level detection failed (non-critical):', powerLevelError)
    }

    onDone(
      { prompt_tokens: usageResult.promptTokens, completion_tokens: usageResult.completionTokens },
      llmConfig.modelId
    )
  } catch (error) {
    console.error('Generation failed:', error)
    onError(error as Error)
  }
}

/**
 * Phase 1.4: 核心 ReAct 循环实现
 * 使用 OpenAI 标准 Function Calling 格式
 */
async function runReActLoop(
  env: Env,
  llmConfig: any,
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  novelId: string,
  onChunk: (text: string) => void,
  onToolCall: (event: ToolCallEvent) => void,
  maxIterations: number
): Promise<{ promptTokens: number; completionTokens: number }> {
  let iteration = 0
  let totalPromptTokens = 0
  let totalCompletionTokens = 0

  while (iteration < maxIterations) {
    iteration++
    console.log(`🔄 ReAct iteration ${iteration}/${maxIterations}`)

    let iterationContent = ''
    let toolCallsInThisIteration: Array<any> = []

    await streamGenerate(llmConfig, messages, {
      onChunk: (text) => {
        iterationContent += text
        onChunk(text)
      },
      onDone: (usage) => {
        totalPromptTokens += usage.prompt_tokens
        totalCompletionTokens += usage.completion_tokens
        console.log(`✅ Iteration ${iteration} streaming complete, tokens: ${usage.prompt_tokens}/${usage.completion_tokens}`)
      },
      onError: (err) => {
        throw err
      },
    }, AGENT_TOOLS)

    // 将 LLM 输出作为 assistant 消息追加
    if (iterationContent.trim()) {
      messages.push({ role: 'assistant', content: iterationContent })
    }

    // Phase 1.4: 尝试从内容中提取工具调用（兼容模式）
    // 注意：真正的 OpenAI function calling 应该通过 stream 事件检测
    // 这里使用文本解析作为 fallback
    const extractedToolCalls = extractToolCallsFromContent(iterationContent)

    if (extractedToolCalls.length === 0) {
      // 无工具调用，生成完成，退出循环
      console.log(`✅ No tool calls detected in iteration ${iteration}, finishing`)
      break
    }

    // 执行所有检测到的工具调用
    for (const toolCall of extractedToolCalls) {
      try {
        onToolCall({
          type: 'tool_call',
          name: toolCall.name,
          args: toolCall.args,
          status: 'running',
        })

        const result = await executeAgentTool(env, toolCall.name, toolCall.args, novelId)

        onToolCall({
          type: 'tool_call',
          name: toolCall.name,
          args: toolCall.args,
          status: 'done',
          result: result.slice(0, 500),
        })

        // 将工具调用和结果追加到消息历史
        messages.push({
          role: 'assistant',
          content: `[已调用工具: ${toolCall.name}]`,
        })
        messages.push({
          role: 'user',
          content: `[工具 ${toolCall.name} 的执行结果]\n${result}`,
        })

        toolCallsInThisIteration.push(toolCall)
        console.log(`🔧 Tool executed: ${toolCall.name}`, result.slice(0, 100))
      } catch (error) {
        const errorMsg = (error as Error).message
        
        onToolCall({
          type: 'tool_call',
          name: toolCall.name,
          args: toolCall.args,
          status: 'done',
          result: `错误: ${errorMsg}`,
        })

        messages.push({
          role: 'user',
          content: `[工具 ${toolCall.name} 执行失败]\n错误: ${errorMsg}\n请重试或改用其他方式完成任务。`,
        })
        
        console.warn(`❌ Tool execution failed: ${toolCall.name}`, error)
      }
    }

    if (toolCallsInThisIteration.length === 0) {
      break
    }
  }

  if (iteration >= maxIterations) {
    console.warn(`⚠️ Reached maximum iterations (${maxIterations}), stopping loop`)
  }

  return { promptTokens: totalPromptTokens, completionTokens: totalCompletionTokens }
}

/**
 * Phase 1.4: 从文本内容中提取工具调用（fallback 兼容模式）
 * 支持多种格式以增加鲁棒性
 */
function extractToolCallsFromContent(content: string): Array<{ name: string; args: Record<string, any> }> {
  const toolCalls: Array<{ name: string; args: Record<string, any> }> = []
  
  if (!content || !content.trim()) return toolCalls

  // 方式1: OpenAI 标准格式（如果 LLM 直接输出了 function call 标记）
  // 匹配类似 {"name": "toolName", "arguments": "{...}"} 的格式
  const standardPattern = /\{[\s\S]*?"name"\s*:\s*"(\w+)"\s*,\s*"arguments"\s*:\s*(\{[\s\S]*?\})\s*?\}/g
  let match
  
  while ((match = standardPattern.exec(content)) !== null) {
    try {
      const toolName = match[1]
      const argsStr = match[2]
      const args = JSON.parse(argsStr)
      toolCalls.push({ name: toolName, args: args || {} })
    } catch {
      // JSON 解析失败，忽略
    }
  }

  // 方式2: 自定义 JSON 格式（向后兼容旧版提示词）
  if (toolCalls.length === 0) {
    const customPattern = /\{[\s\S]*?"tool"\s*:\s*"(\w+)"\s*,\s*"args"\s*:\s*(\{[\s\S]*?\})\s*?\}/g
    
    while ((match = customPattern.exec(content)) !== null) {
      try {
        const toolName = match[1]
        const argsStr = match[2]
        const args = JSON.parse(argsStr)
        toolCalls.push({ name: toolName, args: args || {} })
      } catch {
        // JSON 解析失败，忽略
      }
    }
  }

  // 方式3: 自然语言格式（最后兜底）
  if (toolCalls.length === 0) {
    const TOOL_NAMES = ['queryOutline', 'queryCharacter', 'searchSemantic']
    
    for (const toolName of TOOL_NAMES) {
      const patterns = [
        new RegExp(`(?:调用|使用|执行)?\\s*(?:工具\\s*)?${toolName}\\s*[：:]\\s*`, 'gi'),
        new RegExp(`\\[Tool\\s*[:\\.]?\\s*${toolName}\\]`, 'gi'),
      ]
      
      for (const pattern of patterns) {
        if (pattern.test(content)) {
          let args: Record<string, any> = {}
          
          // 尝试从附近文本提取参数
          const argsPatterns = [
            /(?:参数|args?|arguments?)\s*[：:]=?\s*(\{[\s\S]*?\})(?=\s*$|\n\n|\[)/gi,
            /(?:参数|args?|arguments?)\s*[：:]\s*(\{[^}]+\})/gi,
          ]
          
          for (const argsPattern of argsPatterns) {
            const argsMatch = argsPattern.exec(content)
            if (argsMatch) {
              try {
                args = JSON.parse(argsMatch[1])
              } catch {
                // 解析失败
              }
              break
            }
          }
          
          // 如果没有找到 args 但有 novelId，自动添加
          if (!args.novelId && content.includes('novelId')) {
            const novelIdMatch = /novelId\\s*[：:=]?\\s*["']?([^"'\\s,}]+)["']?/i.exec(content)
            if (novelIdMatch) {
              args.novelId = novelIdMatch[1]
            }
          }
          
          toolCalls.push({ name: toolName, args })
          break
        }
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

【重要：工具使用指南】
在正式创作前，如果你需要了解背景信息，可以调用以下工具获取资料。
可用的工具包括：
- queryOutline: 查询大纲（世界观、卷纲、章节大纲）
- queryCharacter: 查询角色信息
- searchSemantic: 语义搜索相关内容

当需要使用工具时，请在回复开头用以下JSON格式声明：
{"name": "工具名", "arguments": {"参数名": "参数值"}}

示例：
{"name": "queryCharacter", "arguments": {"novelId": "abc123"}]

注意：
1. 工具调用应该简洁明确，一次只调用一个工具
2. 获取到工具结果后，基于这些信息进行创作
3. 不要在正文中包含工具调用的JSON标记
4. 如果已有足够的信息可以直接创作，则无需调用工具`

  const presets: Record<string, string> = {
    fantasy: baseSystemPrompt,
    urban: `你是一位专业的都市小说作家。
你的写作风格：
- 贴近现实，代入感强
- 人物心理描写细腻
- 情节节奏明快，冲突激烈
- 对话生活化，富有幽默感

【重要：工具使用指南】
在正式创作前，如果你需要了解背景信息，可以调用工具获取资料。
可用工具：queryOutline / queryCharacter / searchSemantic
使用方式：{"name": "工具名", "arguments": {...}}`,
    mystery: `你是一位专业的悬疑小说作家。
你的写作风格：
- 逻辑严密，伏笔巧妙
- 悬念迭起，扣人心弦
- 场景描写有画面感
- 结局出人意料又在情理之中

【重要：工具使用指南】
在正式创作前，如果你需要了解背景信息，可以调用工具获取资料。
可用工具：queryOutline / queryCharacter / searchSemantic
使用方式：{"name": "工具名", "arguments": {...}}`,
    scifi: `你是一位专业的科幻小说作家。
你的写作风格：
- 硬核科幻，设定严谨
- 宏大叙事与微观细节并重
- 科技与人文思考结合
- 想象力丰富且有科学依据

【重要：工具使用指南】
在正式创作前，如果你需要了解背景信息，可以调用工具获取资料。
可用工具：queryOutline / queryCharacter / searchSemantic
使用方式：{"name": "工具名", "arguments": {...}}`,
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

  // Phase 1.2: 注入伏笔信息
  if (contextBundle.mandatory.openForeshadowing && contextBundle.mandatory.openForeshadowing.length > 0) {
    userContentParts.push(
      `\n【当前未收尾的伏笔（本章可能需要收尾或推进）】\n${contextBundle.mandatory.openForeshadowing.join('\n\n')}`
    )
  }

  // Phase 1.3: 注入境界信息
  if (contextBundle.mandatory.powerLevelInfo) {
    userContentParts.push(
      `\n【主角当前境界状态】\n${contextBundle.mandatory.powerLevelInfo}`
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
    '- 角色行为符合设定（特别是境界等级的一致性）\n' +
    '- 合理处理或推进未收尾的伏笔\n' +
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
        summaryConfig.apiKey || (env as any)[summaryConfig.apiKeyEnv || 'VOLCENGINE_API_KEY'] || ''
    } catch {
      // 使用默认配置
      summaryConfig = {
        provider: 'volcengine',
        modelId: 'doubao-lite-32k',
        apiBase: 'https://ark.cn-beijing.volces.com/api/v3',
        apiKey: (env as any).VOLCENGINE_API_KEY || '',
        params: { temperature: 0.3, max_tokens: 500 },
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

    const result = await resp.json() as any
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

/**
 * 执行 Agent 工具调用
 */
async function executeAgentTool(
  env: Env,
  toolName: string,
  args: Record<string, any>,
  novelId: string
): Promise<string> {
  const db = drizzle(env.DB)

  switch (toolName) {
    case 'queryOutline': {
      // v2.0: 查询总纲、卷大纲、小说设定（替代原 outlines 表）
      const { novelId: queryNovelId, type } = args
      const targetNovelId = queryNovelId || novelId
      
      // 根据类型查询不同的表
      if (type === 'master_outline' || !type) {
        // 查询总纲
        const masterOutlineResult = await db
          .select({ title: masterOutline.title, content: masterOutline.content, version: masterOutline.version })
          .from(masterOutline)
          .where(eq(masterOutline.novelId, targetNovelId))
          .orderBy(desc(masterOutline.version))
          .limit(1)
          .get()
        
        if (masterOutlineResult) {
          return JSON.stringify([{
            title: `总纲 v${masterOutlineResult.version}`,
            content: masterOutlineResult.content?.slice(0, 500),
            type: 'master_outline'
          }], null, 2)
        }
      }
      
      if (type === 'volume_outline' || type === 'volume') {
        // 查询卷大纲
        const volumeOutlines = await db
          .select({ title: volumes.title, outline: volumes.outline, summary: volumes.summary })
          .from(volumes)
          .where(eq(volumes.novelId, targetNovelId))
          .orderBy(volumes.sortOrder)
          .limit(10)
          .all()
        
        return JSON.stringify(volumeOutlines.map(v => ({
          title: `卷纲：${v.title}`,
          content: v.outline?.slice(0, 500) || v.summary?.slice(0, 500),
          type: 'volume_outline'
        })), null, 2)
      }
      
      // 默认查询小说设定（worldview/power_system/faction/geography/item_skill）
      const settingsType = type && ['worldview', 'power_system', 'faction', 'geography', 'item_skill', 'misc'].includes(type) ? type : undefined
      let settingsQuery = db
        .select({ name: novelSettings.name, content: novelSettings.content, type: novelSettings.type })
        .from(novelSettings)
        .where(eq(novelSettings.novelId, targetNovelId))
      
      if (settingsType) {
        settingsQuery = (settingsQuery as any).where(eq(novelSettings.type, settingsType))
      }
      
      const settingsResults = await settingsQuery
        .orderBy(desc(novelSettings.updatedAt))
        .limit(10)
        .all()
      
      return JSON.stringify(settingsResults.map(s => ({
        title: s.name,
        content: s.content?.slice(0, 500),
        type: s.type
      })), null, 2)
    }

    case 'queryCharacter': {
      const { novelId: queryNovelId, role } = args
      const targetNovelId = queryNovelId || novelId
      let query = db.select().from(characters).where(eq(characters.novelId, targetNovelId))
      if (role) {
        query = (query as any).where(eq(characters.role, role))
      }
      const results = await query.limit(10).all()
      return JSON.stringify(results.map(c => ({ name: c.name, role: c.role, description: c.description?.slice(0, 300) })), null, 2)
    }

    case 'searchSemantic': {
      if (!env.VECTORIZE) {
        return JSON.stringify({ error: 'Vectorize service not available' })
      }
      const { query, novelId: queryNovelId, topK = 5 } = args
      const targetNovelId = queryNovelId || novelId
      
      if (!query) {
        return JSON.stringify({ error: 'Query parameter is required' })
      }
      
      const queryVector = await embedText(env.AI, query)
      const searchResults = await searchSimilar(env.VECTORIZE, queryVector, { topK: Math.min(topK, 10), filter: { novelId: targetNovelId } })
      return JSON.stringify(searchResults.map(r => ({
        title: r.metadata.title,
        content: r.metadata.content?.slice(0, 400),
        score: Math.round(r.score * 1000) / 1000
      })), null, 2)
    }

    default:
      return JSON.stringify({ error: `Unknown tool: ${toolName}. Available tools: queryOutline, queryCharacter, searchSemantic` })
  }
}

export async function logGeneration(
  env: Env,
  data: {
    novelId: string
    chapterId: string
    stage: string
    modelId: string
    promptTokens?: number
    completionTokens?: number
    durationMs: number
    status: 'success' | 'error'
    errorMsg?: string
  }
): Promise<void> {
  const db = drizzle(env.DB)
  try {
    await db.insert(generationLogs).values({
      novelId: data.novelId,
      chapterId: data.chapterId,
      stage: data.stage,
      modelId: data.modelId,
      promptTokens: data.promptTokens,
      completionTokens: data.completionTokens,
      durationMs: data.durationMs,
      status: data.status,
      errorMsg: data.errorMsg,
    })
  } catch (logError) {
    console.error('Failed to write generation log:', logError)
  }
}

export async function getGenerationLogs(
  env: Env,
  options: { novelId?: string; limit?: number }
): Promise<any[]> {
  const db = drizzle(env.DB)
  const { novelId, limit = 50 } = options

  let query = db.select().from(generationLogs).orderBy(desc(generationLogs.createdAt)).limit(limit)
  
  if (novelId) {
    query = query.where(eq(generationLogs.novelId, novelId)) as any
  }

  return query.all()
}

export async function checkCharacterConsistency(
  env: Env,
  data: { chapterId: string; characterIds: string[] }
): Promise<{ conflicts: any[]; warnings: string[]; raw?: string }> {
  const db = drizzle(env.DB)
  const { chapterId, characterIds } = data

  const chapter = await db.select().from(chapters).where(eq(chapters.id, chapterId)).get()
  if (!chapter?.content) {
    throw new Error('Chapter not found or has no content')
  }

  let characterInfo = ''
  if (characterIds.length > 0) {
    const chars = await db.select().from(characters).where(
      characterIds.map(id => eq(characters.id, id)).reduce((a, b) => sql`${a} OR ${b}`)
    ).all()
    characterInfo = chars.map(c => `【${c.name}】${c.role}: ${c.description || ''}`).join('\n')
  }

  const checkPrompt = `你是一个角色一致性检查助手。请检查以下小说内容是否符合角色设定。
  
【角色设定】:
${characterInfo || '无特定角色设定'}

【待检查内容】:
${chapter.content.slice(0, 10000)}

请以JSON格式输出检查结果：
{
  "conflicts": [
    { "characterName": "角色名", "conflict": "冲突描述", "excerpt": "相关段落" }
  ],
  "warnings": ["警告1", "警告2"]
}

如果没有冲突，conflicts 数组为空。`

  let summaryConfig
  try {
    summaryConfig = await resolveConfig(db, 'summary_gen', chapter.novelId)
    summaryConfig.apiKey = summaryConfig.apiKey || (env as any)[summaryConfig.apiKeyEnv || 'VOLCENGINE_API_KEY'] || ''
  } catch {
    summaryConfig = {
      provider: 'volcengine',
      modelId: 'doubao-lite-32k',
      apiBase: 'https://ark.cn-beijing.volces.com/api/v3',
      apiKey: (env as any).VOLCENGINE_API_KEY || '',
      params: { temperature: 0.3, max_tokens: 1000 },
    }
  }

  const base = summaryConfig.apiBase || 'https://ark.cn-beijing.volces.com/api/v3'
  const resp = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${summaryConfig.apiKey}`,
    },
    body: JSON.stringify({
      model: summaryConfig.modelId,
      messages: [
        { role: 'system', content: '你是一个JSON生成助手，只输出JSON，不要其他内容。' },
        { role: 'user', content: checkPrompt },
      ],
      temperature: 0.3,
      max_tokens: 1000,
    }),
  })

  if (!resp.ok) {
    throw new Error(`Check failed: ${resp.statusText}`)
  }

  const result = await resp.json() as any
  const content = result.choices?.[0]?.message?.content || '{}'

  try {
    return JSON.parse(content)
  } catch {
    return { conflicts: [], warnings: ['解析失败'], raw: content }
  }
}

export async function generateOutlineBatch(
  env: Env,
  data: {
    volumeId: string
    novelId: string
    chapterCount?: number
    context?: string
  }
): Promise<{
  ok: boolean
  message?: string
  outlines?: any[]
  totalRequested?: number
  successCount?: number
  volumeOutlinePreview?: string
  error?: string
  details?: string
}> {
  const { volumeId, novelId, chapterCount, context } = data
  const db = drizzle(env.DB)

  try {
    const volume = await db
      .select({
        id: volumes.id,
        title: volumes.title,
        sortOrder: volumes.sortOrder,
        summary: volumes.summary,
      })
      .from(volumes)
      .where(eq(volumes.id, volumeId))
      .get()

    if (!volume) {
      return { ok: false, error: '卷不存在' }
    }

    const existingChapters = await db
      .select({
        id: chapters.id,
        title: chapters.title,
        sortOrder: chapters.sortOrder,
      })
      .from(chapters)
      .where(eq(chapters.volumeId, volumeId))
      .orderBy(chapters.sortOrder)
      .all()

    const targetCount = chapterCount || Math.max(existingChapters.length, 10)

    let llmConfig
    try {
      llmConfig = await resolveConfig(db, 'outline_gen', novelId)
      llmConfig.apiKey = llmConfig.apiKey || (env as any)[llmConfig.apiKeyEnv || 'VOLCENGINE_API_KEY'] || ''
    } catch {
      try {
        llmConfig = await resolveConfig(db, 'chapter_gen', novelId)
        llmConfig.apiKey = llmConfig.apiKey || (env as any)[llmConfig.apiKeyEnv || 'VOLCENGINE_API_KEY'] || ''
      } catch {
        llmConfig = {
          provider: 'volcengine',
          modelId: 'doubao-seed-2-pro',
          apiBase: 'https://ark.cn-beijing.volces.com/api/v3',
          apiKey: (env as any).VOLCENGINE_API_KEY || '',
          params: { temperature: 0.85, max_tokens: 4096 },
        }
      }
    }

    const existingChaptersInfo = existingChapters.length > 0
      ? `\n\n【现有章节】\n${existingChapters.map((ch, i) => `${i + 1}. 第${ch.sortOrder || i + 1}章《${ch.title}》`).join('\n')}`
      : ''

    const batchPrompt = `请为小说的某一卷生成完整的章节大纲规划。

【卷信息】：
- 标题：《${volume.title}》
- 卷序：第${volume.sortOrder + 1}卷
${volume.summary ? `- 卷概要：${volume.summary}` : ''}

【生成要求】：
- 需要规划 ${targetCount} 个章节
- 每个章节包含：章节标题、本章核心情节（200-300字）、关键冲突点、伏笔安排、人物动态
- 章节之间要有连贯性，形成完整的故事弧线
- 注意节奏：开头铺垫、中间发展、高潮迭起、结尾悬念
${existingChaptersInfo}
${context ? `\n【补充上下文】：\n${context}` : ''}

请以JSON数组格式输出（不要输出其他内容）：
[
  {
    "chapterTitle": "章节标题",
    "outline": "本章大纲内容（200-300字）",
    "keyConflicts": ["关键冲突1", "关键冲突2"],
    "foreshadowingSetup": ["埋入伏笔1", "收尾伏笔2"],
    "characterDynamics": "人物动态描述"
  }
]

要求：
1. 输出 ${targetCount} 个章节的大纲规划
2. 每章大纲质量要高，有具体的情节点而非空泛描述
3. 合理安排伏笔的埋入和收尾`

    const base = llmConfig.apiBase || 'https://ark.cn-beijing.volces.com/api/v3'
    const resp = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${llmConfig.apiKey}`,
      },
      body: JSON.stringify({
        model: llmConfig.modelId,
        messages: [
          { role: 'system', content: '你是一个专业的小说大纲助手，擅长构建连贯的章节大纲序列。你只输出JSON，不要其他内容。' },
          { role: 'user', content: batchPrompt },
        ],
        stream: false,
        temperature: llmConfig.params?.temperature ?? 0.85,
        max_tokens: 8000,
      }),
    })

    if (!resp.ok) {
      const errorText = await resp.text()
      return { ok: false, error: '批量生成失败', details: `${resp.status} ${errorText}` }
    }

    const result = await resp.json() as any
    const content = result.choices?.[0]?.message?.content || ''

    let parsedOutlines: Array<any>
    try {
      const jsonMatch = content.match(/\[[\s\S]*\]/)
      if (jsonMatch) {
        parsedOutlines = JSON.parse(jsonMatch[0])
      } else {
        parsedOutlines = JSON.parse(content)
      }
    } catch (parseError) {
      console.warn('Failed to parse batch outline result:', parseError)
      return { 
        ok: false, 
        error: '解析生成结果失败', 
        details: 'LLM返回的内容无法解析为JSON数组',
      }
    }

    if (!Array.isArray(parsedOutlines) || parsedOutlines.length === 0) {
      return { ok: false, error: '生成结果为空', details: 'LLM未返回有效的章节大纲' }
    }

    let volumeOutlineContent = `# 《${volume.title}》章节大纲\n\n`
    volumeOutlineContent += `生成时间：${new Date().toLocaleString('zh-CN')}\n\n`
    volumeOutlineContent += `---\n\n`

    const createdOutlines: any[] = []
    
    for (let i = 0; i < parsedOutlines.length; i++) {
      const outlineData = parsedOutlines[i]
      
      try {
        const chapterOutline = [
          `## ${outlineData.chapterTitle || `第${i + 1}章`}`,
          outlineData.outline || '',
          outlineData.keyConflicts && outlineData.keyConflicts.length > 0 
            ? `\n**关键冲突**：\n${outlineData.keyConflicts.map((c: string) => `- ${c}`).join('\n')}` 
            : '',
          outlineData.foreshadowingSetup && outlineData.foreshadowingSetup.length > 0
            ? `\n**伏笔安排**：\n${outlineData.foreshadowingSetup.map((f: string) => `- ${f}`).join('\n')}`
            : '',
          outlineData.characterDynamics ? `\n**人物动态**：\n${outlineData.characterDynamics}` : '',
        ].filter(Boolean).join('\n')

        volumeOutlineContent += chapterOutline + '\n\n---\n\n'

        createdOutlines.push({
          index: i,
          title: outlineData.chapterTitle || `第${i + 1}章`,
          action: 'created',
        })
      } catch (outlineError) {
        console.warn(`Failed to process outline ${i}:`, outlineError)
        createdOutlines.push({
          index: i,
          action: 'failed',
          error: (outlineError as Error).message,
        })
      }
    }

    try {
      await db
        .update(volumes)
        .set({
          outline: volumeOutlineContent,
          updatedAt: sql`(unixepoch())`,
        })
        .where(eq(volumes.id, volumeId))

      console.log(`✅ Volume outline updated for volume ${volumeId}`)
    } catch (updateError) {
      console.warn('Failed to update volume outline:', updateError)
      return { 
        ok: false, 
        error: '更新卷大纲失败', 
        details: (updateError as Error).message 
      }
    }

    console.log(`✅ Batch outline generation complete: ${createdOutlines.filter(o => o.action !== 'failed').length}/${parsedOutlines.length} chapters planned`)

    return {
      ok: true,
      message: `成功生成卷大纲，包含 ${createdOutlines.filter(o => o.action !== 'failed').length} 个章节规划`,
      outlines: createdOutlines,
      totalRequested: parsedOutlines.length,
      successCount: createdOutlines.filter(o => o.action !== 'failed').length,
      volumeOutlinePreview: volumeOutlineContent.slice(0, 500),
    }
  } catch (error) {
    console.error('Batch outline generation failed:', error)
    return { ok: false, error: '批量生成异常', details: (error as Error).message }
  }
}
