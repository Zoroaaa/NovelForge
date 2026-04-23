/**
 * @file agent.ts
 * @description Agent智能生成系统模块，基于ReAct范式的智能章节生成，支持工具调用和多轮对话
 * @version 1.4.0
 * @modified 2026-04-21 - 添加规范化注释
 */
import { drizzle } from 'drizzle-orm/d1'
import { chapters, modelConfigs, characters, novelSettings, masterOutline, volumes, generationLogs, foreshadowing, novels } from '../db/schema'
import { eq, desc, sql, and } from 'drizzle-orm'
import type { Env } from '../lib/types'
import type { AppDb } from './contextBuilder'
import { buildChapterContext, assemblePromptContext, type ContextBundle } from './contextBuilder'
import { streamGenerate, resolveConfig, getDefaultBase } from './llm'
import { searchSimilar, embedText, ACTIVE_SOURCE_TYPES } from './embedding'
import { extractForeshadowingFromChapter } from './foreshadowing'
import { detectPowerLevelBreakthrough } from './powerLevel'
import { enqueue } from '../lib/queue'

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
      llmConfig.apiKey = llmConfig.apiKey || ''
    } catch (error) {
      throw new Error(`❌ 未配置"章节生成"模型！请在小说工作台或全局配置中设置 chapter_gen 阶段的模型（提供商 + 模型ID + API Key）`)
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

    // 5.5 B1修复: 先将生成的内容写入DB，再触发后处理
    // 原问题：后处理三步在onDone之前执行，此时DB中chapter.content仍是NULL，导致摘要/伏笔/境界检测全部静默退出
    const fullContent = usageResult.collectedContent
    if (fullContent && fullContent.trim().length > 0) {
      await db.update(chapters)
        .set({
          content: fullContent,
          wordCount: fullContent.length,
          updatedAt: sql`(unixepoch())`,
        })
        .where(eq(chapters.id, chapterId))
      console.log(`✅ B1 fix: Chapter content written to DB (${fullContent.length} chars) before post-processing`)
    }

    // 6-8. 架构优化: 后处理异步化 - 将摘要/伏笔/境界检测移入Queue
    // 原问题：三步串行阻塞5-15秒，用户必须等待完成后才收到[DONE]
    // 优化后：立即发送[DONE]，后处理在Queue中异步执行
    if (env.TASK_QUEUE) {
      await enqueue(env, {
        type: 'post_process_chapter',
        payload: {
          chapterId,
          novelId,
          enableAutoSummary: agentConfig.enableAutoSummary,
          usage: {
            prompt_tokens: usageResult.promptTokens,
            completion_tokens: usageResult.completionTokens,
          },
        },
      })
      console.log('✅ Post-processing tasks enqueued (async mode)')
    } else {
      // Fallback: Queue不可用时仍同步执行（保持向后兼容）
      console.warn('TASK_QUEUE unavailable, falling back to synchronous post-processing')
      if (agentConfig.enableAutoSummary) {
        await triggerAutoSummary(env, chapterId, novelId, {
          prompt_tokens: usageResult.promptTokens,
          completion_tokens: usageResult.completionTokens,
        })
      }
      try {
        const foreshadowingResult = await extractForeshadowingFromChapter(env, chapterId, novelId)
        if (foreshadowingResult.newForeshadowing.length > 0 || foreshadowingResult.resolvedForeshadowingIds.length > 0) {
          console.log(`📝 Foreshadowing: ${foreshadowingResult.newForeshadowing.length} new, ${foreshadowingResult.resolvedForeshadowingIds.length} resolved`)
        }
      } catch (foreshadowError) {
        console.warn('Foreshadowing extraction failed (non-critical):', foreshadowError)
      }
      try {
        const powerLevelResult = await detectPowerLevelBreakthrough(env, chapterId, novelId)
        if (powerLevelResult.hasBreakthrough) {
          console.log(`⚡ Power level: ${powerLevelResult.updates.length} breakthroughs detected`)
        }
      } catch (powerLevelError) {
        console.warn('Power level detection failed (non-critical):', powerLevelError)
      }
    }

    // 9. Phase 2.3: 异步连贯性质量检查（不阻塞主流程）
    setTimeout(async () => {
      try {
        const coherenceResult = await checkChapterCoherence(env, chapterId, novelId)
        if (coherenceResult.hasIssues) {
          console.warn(`⚠️ Coherence check found ${coherenceResult.issues.length} issues:`)
          coherenceResult.issues.forEach((issue: any) => console.warn(`  - [${issue.severity}] ${issue.message}`))
        }
      } catch (coherenceError) {
        console.warn('Coherence check failed (non-critical):', coherenceError)
      }
    }, 0)

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
  messages: Array<{ role: 'system' | 'user' | 'assistant' | 'tool'; content?: string; tool_call_id?: string; name?: string }>,
  novelId: string,
  onChunk: (text: string) => void,
  onToolCall: (event: ToolCallEvent) => void,
  maxIterations: number
): Promise<{ promptTokens: number; completionTokens: number; collectedContent: string }> {
  let iteration = 0
  let totalPromptTokens = 0
  let totalCompletionTokens = 0
  let collectedContent = ''

  while (iteration < maxIterations) {
    iteration++
    console.log(`🔄 ReAct iteration ${iteration}/${maxIterations} (Function Calling Mode)`)

    let iterationContent = ''
    const collectedToolCalls: Array<{
      id: string
      name: string
      args: Record<string, any>
    }> = []

    // Phase 2.1: 使用真正的 function calling（不再依赖文本解析）
    await streamGenerate(llmConfig, messages as any, {
      onChunk: (text) => {
        iterationContent += text
        onChunk(text)
      },
      onToolCall: (toolCallDelta) => {
        // 收集完整的工具调用
        if (toolCallDelta.status === 'complete') {
          // 避免重复添加
          const alreadyExists = collectedToolCalls.some(tc => tc.id === toolCallDelta.id)
          if (!alreadyExists && toolCallDelta.name) {
            collectedToolCalls.push({
              id: toolCallDelta.id,
              name: toolCallDelta.name,
              args: toolCallDelta.args || {},
            })
            console.log(`📌 Tool call collected: ${toolCallDelta.name}`, toolCallDelta.args)
          }
        }
      },
      onDone: (usage) => {
        totalPromptTokens += usage.prompt_tokens
        totalCompletionTokens += usage.completion_tokens
        console.log(`✅ Iteration ${iteration} complete - content: ${iterationContent.length} chars, tools: ${collectedToolCalls.length} calls`)
      },
      onError: (err) => {
        throw err
      },
    }, AGENT_TOOLS)

    // 构造 assistant 消息（支持 function calling 格式）
    const assistantMessage: any = { role: 'assistant' }

    if (iterationContent.trim()) {
      assistantMessage.content = iterationContent
    }

    if (collectedToolCalls.length > 0) {
      // OpenAI 标准：assistant 消息包含 tool_calls 数组
      assistantMessage.tool_calls = collectedToolCalls.map(tc => ({
        id: tc.id,
        type: 'function',
        function: {
          name: tc.name,
          arguments: JSON.stringify(tc.args),
        },
      }))
    }

    // 只有当有内容或工具调用时才添加消息
    if (iterationContent.trim() || collectedToolCalls.length > 0) {
      messages.push(assistantMessage)
    }

    // 如果没有工具调用，说明生成完成，退出循环
    if (collectedToolCalls.length === 0) {
      console.log(`✅ No tool calls in iteration ${iteration}, generation finished`)
      collectedContent += iterationContent
      break
    }

    // 累积本轮迭代的内容（即使有工具调用也要保留已生成的文本）
    collectedContent += iterationContent

    // 执行所有收集到的工具调用
    for (const toolCall of collectedToolCalls) {
      try {
        // 通知前端：工具开始执行
        onToolCall({
          type: 'tool_call',
          name: toolCall.name,
          args: toolCall.args,
          status: 'running',
        })

        console.log(`🔧 Executing tool: ${toolCall.name}`, toolCall.args)

        // 执行工具
        const result = await executeAgentTool(env, toolCall.name, toolCall.args, novelId)

        // 通知前端：工具执行完成
        onToolCall({
          type: 'tool_call',
          name: toolCall.name,
          args: toolCall.args,
          status: 'done',
          result: result.slice(0, 500),
        })

        // Phase 2.1: 使用 OpenAI 标准的 tool response 格式
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          name: toolCall.name,
          content: result,
        })

        console.log(`✅ Tool executed: ${toolCall.name}, result length: ${result.length}`)
      } catch (error) {
        const errorMsg = (error as Error).message

        // 通知前端：工具执行失败
        onToolCall({
          type: 'tool_call',
          name: toolCall.name,
          args: toolCall.args,
          status: 'done',
          result: `错误: ${errorMsg}`,
        })

        // 工具执行失败的 response
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          name: toolCall.name,
          content: JSON.stringify({ error: errorMsg, message: '工具执行失败，请重试或改用其他方式完成任务。' }),
        })

        console.warn(`❌ Tool execution failed: ${toolCall.name}`, error)
      }
    }
  }

  if (iteration >= maxIterations) {
    console.warn(`⚠️ Reached maximum iterations (${maxIterations}), stopping loop`)
  }

  return { promptTokens: totalPromptTokens, completionTokens: totalCompletionTokens, collectedContent }
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

  // v3: 使用 assemblePromptContext 统一组装上下文
  const contextText = assemblePromptContext(contextBundle)

  const userContent = `【创作任务】
请创作《${chapterTitle}》的正文内容，3000-5000字。

${contextText}

请基于以上资料进行创作，确保：
- 符合大纲要求
- 与前文衔接自然
- 角色行为符合设定（特别是境界等级的一致性）
- 合理处理或推进未收尾的伏笔
- 严格遵循创作规则中的文风、节奏要求
- 文风流畅，节奏紧凑`

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userContent },
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
      summaryConfig.apiKey = summaryConfig.apiKey || ''
    } catch (error) {
      throw new Error(`❌ 未配置"摘要生成"模型！请在小说工作台或全局配置中设置 summary_gen 阶段的模型（提供商 + 模型ID + API Key）`)
    }

    // 截取前2000字符用于摘要（避免超长输入）
    const contentForSummary = chapter.content

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
    }
  } catch (error) {
    console.warn('Auto-summary failed (non-critical):', error)
    // 摘要失败不影响主流程
  }
}

export async function generateMasterOutlineSummary(
  env: Env,
  novelId: string
): Promise<{ ok: boolean; summary?: string; error?: string }> {
  try {
    const db = drizzle(env.DB)

    const outline = await db
      .select({
        id: masterOutline.id,
        title: masterOutline.title,
        content: masterOutline.content,
      })
      .from(masterOutline)
      .where(eq(masterOutline.novelId, novelId))
      .orderBy(desc(masterOutline.version))
      .get()

    if (!outline?.content) {
      return { ok: false, error: '总纲内容为空' }
    }

    let summaryConfig
    try {
      summaryConfig = await resolveConfig(db, 'summary_gen', novelId)
      summaryConfig.apiKey = summaryConfig.apiKey || ''
    } catch (error) {
      return { ok: false, error: '未配置摘要生成模型' }
    }

    const contentForSummary = outline.content

    const summaryMessages = [
      {
        role: 'system' as const,
        content: '你是一个专业的文本摘要助手。请为以下小说总纲生成一段简洁的摘要（200-300字），概括核心世界观、主线剧情和关键设定。',
      },
      {
        role: 'user' as const,
        content: `总纲标题：《${outline.title}》\n\n总纲内容：\n${contentForSummary}`,
      },
    ]

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
      return { ok: false, error: `API错误: ${resp.status}` }
    }

    const result = await resp.json() as any
    const summaryText = result.choices?.[0]?.message?.content

    if (summaryText) {
      await db
        .update(masterOutline)
        .set({
          summary: summaryText,
          updatedAt: sql`(unixepoch())`,
        })
        .where(eq(masterOutline.id, outline.id))

      return { ok: true, summary: summaryText }
    }

    return { ok: false, error: '未生成有效摘要' }
  } catch (error) {
    console.warn('Master outline summary generation failed:', error)
    return { ok: false, error: (error as Error).message }
  }
}

export async function generateVolumeSummary(
  env: Env,
  volumeId: string,
  novelId: string
): Promise<{ ok: boolean; summary?: string; error?: string }> {
  try {
    const db = drizzle(env.DB)

    const volume = await db
      .select({
        id: volumes.id,
        title: volumes.title,
        blueprint: volumes.blueprint,
        eventLine: volumes.eventLine,
      })
      .from(volumes)
      .where(eq(volumes.id, volumeId))
      .get()

    if (!volume) {
      return { ok: false, error: '卷不存在' }
    }

    if (!volume.blueprint && !volume.eventLine) {
      return { ok: false, error: '卷蓝图和事件线都为空' }
    }

    let summaryConfig
    try {
      summaryConfig = await resolveConfig(db, 'summary_gen', novelId)
      summaryConfig.apiKey = summaryConfig.apiKey || ''
    } catch (error) {
      return { ok: false, error: '未配置摘要生成模型' }
    }

    const contentForSummary = [
      volume.blueprint ? `【卷蓝图】\n${volume.blueprint}` : '',
      volume.eventLine ? `\n【事件线】\n${volume.eventLine}` : '',
    ].join('\n')

    const summaryMessages = [
      {
        role: 'system' as const,
        content: '你是一个专业的文本摘要助手。请为以下卷的蓝图和事件线生成一段简洁的摘要（150-200字），概括本卷的核心情节和关键事件。',
      },
      {
        role: 'user' as const,
        content: `卷标题：《${volume.title}》\n\n${contentForSummary}`,
      },
    ]

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
      return { ok: false, error: `API错误: ${resp.status}` }
    }

    const result = await resp.json() as any
    const summaryText = result.choices?.[0]?.message?.content

    if (summaryText) {
      await db
        .update(volumes)
        .set({
          summary: summaryText,
          updatedAt: sql`(unixepoch())`,
        })
        .where(eq(volumes.id, volumeId))

      return { ok: true, summary: summaryText }
    }

    return { ok: false, error: '未生成有效摘要' }
  } catch (error) {
    console.warn('Volume summary generation failed:', error)
    return { ok: false, error: (error as Error).message }
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
          .select({ title: volumes.title, eventLine: volumes.eventLine, summary: volumes.summary })
          .from(volumes)
          .where(eq(volumes.novelId, targetNovelId))
          .orderBy(volumes.sortOrder)
          .limit(10)
          .all()
        
        return JSON.stringify(volumeOutlines.map(v => ({
          title: `卷纲：${v.title}`,
          content: v.eventLine?.slice(0, 500) || v.summary?.slice(0, 500),
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
      const { searchSimilarMulti } = await import('./embedding')
      const searchResults = await searchSimilarMulti(env.VECTORIZE, queryVector, {
        topK: Math.min(topK, 10),
        novelId: targetNovelId,
        sourceTypes: args.sourceTypes || [...ACTIVE_SOURCE_TYPES],
      })
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

// ========== Phase 2.3: 章节连贯性质量检查 ==========

export interface CoherenceCheckResult {
  hasIssues: boolean
  issues: Array<{
    severity: 'warning' | 'error'
    category: 'continuity' | 'foreshadowing' | 'power_level' | 'consistency'
    message: string
    suggestion?: string
  }>
  score: number  // 0-100，越高越好
}

/**
 * 异步检查章节连贯性（不阻塞主流程）
 * 检测项：
 * 1. 与前章摘要衔接是否自然
 * 2. 应收尾的伏笔是否已收（对比大纲中的伏笔指令）
 * 3. 主角境界是否出现不合理突变
 */
export async function checkChapterCoherence(
  env: Env,
  chapterId: string,
  novelId: string
): Promise<CoherenceCheckResult> {
  const db = drizzle(env.DB)
  const issues: CoherenceCheckResult['issues'] = []

  try {
    // 获取当前章节信息
    const currentChapter = await db
      .select({
        id: chapters.id,
        novelId: chapters.novelId,
        title: chapters.title,
        content: chapters.content,
        sortOrder: chapters.sortOrder,
      })
      .from(chapters)
      .where(eq(chapters.id, chapterId))
      .get()

    if (!currentChapter?.content) {
      return { hasIssues: false, issues: [], score: 100 }
    }

    // 1. 检查与前章摘要的衔接
    await checkContinuityWithPrevChapter(db, currentChapter, issues)

    // 2. 检查伏笔一致性
    await checkForeshadowingConsistency(db, env, novelId, currentChapter, issues)

    // 3. 检查主角境界合理性
    await checkPowerLevelConsistency(db, novelId, currentChapter, issues)

    // 计算总分
    const deduction = issues.reduce((sum, issue) => {
      return sum + (issue.severity === 'error' ? 20 : 10)
    }, 0)
    const score = Math.max(0, 100 - deduction)

    return {
      hasIssues: issues.length > 0,
      issues,
      score,
    }
  } catch (error) {
    console.error('Coherence check error:', error)
    return { hasIssues: false, issues: [], score: 0 }
  }
}

/**
 * 检查与前章的情节衔接
 */
async function checkContinuityWithPrevChapter(
  db: any,
  currentChapter: { id: string; novelId: string; title: string; content: string | null; sortOrder: number },
  issues: CoherenceCheckResult['issues']
): Promise<void> {
  try {
    const prevChapter = await db
      .select({
        summary: chapters.summary,
        title: chapters.title,
      })
      .from(chapters)
      .where(and(
        eq(chapters.novelId, currentChapter.novelId),
        sql`${chapters.sortOrder} < ${currentChapter.sortOrder}`,
        sql`${chapters.deletedAt} IS NULL`
      ))
      .orderBy(desc(chapters.sortOrder))
      .limit(1)
      .get()

    if (!prevChapter?.summary) return

    // 简单启发式：检查上一章结尾关键词是否在当前章节开头出现
    const prevEndingKeywords = extractKeyPhrases(prevChapter.summary.slice(-200))
    const currentBeginning = (currentChapter.content || '').slice(0, 500)

    const matchedKeywords = prevEndingKeywords.filter((kw: string) =>
      currentBeginning.includes(kw)
    )

    if (prevEndingKeywords.length > 0 && matchedKeywords.length === 0) {
      issues.push({
        severity: 'warning',
        category: 'continuity',
        message: `与上一章《${prevChapter.title}》的情节衔接可能不够紧密`,
        suggestion: '建议在章节开头适当回顾或承接上章的关键事件/人物状态',
      })
    }
  } catch (error) {
    console.warn('Continuity check failed:', error)
  }
}

/**
 * 检查伏笔一致性
 */
async function checkForeshadowingConsistency(
  db: any,
  env: Env,
  novelId: string,
  currentChapter: { id: string; content: string | null },
  issues: CoherenceCheckResult['issues']
): Promise<void> {
  try {
    // 获取未收尾的重要伏笔
    const openForeshadowing = await db
      .select({
        id: foreshadowing.id,
        title: foreshadowing.title,
        description: foreshadowing.description,
        importance: foreshadowing.importance,
        chapterId: foreshadowing.chapterId,
      })
      .from(foreshadowing)
      .where(
        and(
          eq(foreshadowing.novelId, novelId),
          eq(foreshadowing.status, 'open'),
          eq(foreshadowing.importance, 'high')
        )
      )
      .all()

    if (openForeshadowing.length === 0) return

    // 检查重要伏笔是否在本章有进展（简单关键词匹配）
    for (const fs of openForeshadowing.slice(0, 5)) {
      const keywords = [fs.title, ...(fs.description ? fs.description.split(/[，。、]/).slice(0, 3) : [])]

      const hasMention = keywords.some((kw: string) =>
        kw.trim().length > 1 && (currentChapter.content || '').includes(kw.trim())
      )

      if (!hasMention) {
        issues.push({
          severity: 'warning',
          category: 'foreshadowing',
          message: `重要伏笔《${fs.title}》本章未提及或推进`,
          suggestion: `建议在本章中适当提及或为该伏笔做铺垫（描述:${fs.description?.slice(0, 50)}）`,
        })
      }
    }
  } catch (error) {
    console.warn('Foreshadowing consistency check failed:', error)
  }
}

/**
 * 检查主角境界突变
 */
async function checkPowerLevelConsistency(
  db: any,
  novelId: string,
  currentChapter: { content: string | null },
  issues: CoherenceCheckResult['issues']
): Promise<void> {
  try {
    // 获取所有主角的当前境界
    const protagonists = await db
      .select({
        name: characters.name,
        powerLevel: characters.powerLevel,
      })
      .from(characters)
      .where(
        and(
          eq(characters.novelId, novelId),
          eq(characters.role, 'protagonist'),
          sql`${characters.deletedAt} IS NULL`
        )
      )
      .all()

    for (const protagonist of protagonists) {
      if (!protagonist.powerLevel) continue

      let powerData: any
      try {
        powerData = JSON.parse(protagonist.powerLevel)
      } catch {
        continue
      }

      // 检查是否有不合理的连续突破（同一章内多次突破）
      const breakthroughPattern = new RegExp(`${protagonist.name}.{0,50}(突破|进阶|晋升|升级).{0,30}(突破|进阶|晋升|升级)`, 'g')
      const matches = (currentChapter.content || '').match(breakthroughPattern)

      if (matches && matches.length > 1) {
        issues.push({
          severity: 'error',
          category: 'power_level',
          message: `${protagonist.name} 在本章出现 ${matches.length} 次境界变化描述，可能存在不合理突变`,
          suggestion: '通常一章节内不应超过1次重大境界突破，请检查是否符合设定逻辑',
        })
      }

      // 检查是否跳过了中间境界（如从练气期直接到金丹期）
      if (powerData.breakthroughs && powerData.breakthroughs.length > 0) {
        const lastBreakthrough = powerData.breakthroughs[powerData.breakthroughs.length - 1]
        if (lastBreakthrough.timestamp) {
          const breakthroughTime = new Date(lastBreakthrough.timestamp).getTime()
          const now = Date.now()

          // 如果最近一次突破就在几秒前（说明是刚生成的），且从低境界直接到高境界
          if (now - breakthroughTime < 60000) {  // 60秒内
            const levelGap = estimatePowerLevelGap(lastBreakthrough.from, lastBreakthrough.to)
            if (levelGap > 3) {
              issues.push({
                severity: 'warning',
                category: 'power_level',
                message: `${protagonist.name} 从 ${lastBreakthrough.from} 直接突破到 ${lastBreakthrough.to}，跨度较大`,
                suggestion: '考虑增加过渡阶段或在后续章节补充修炼过程描写',
              })
            }
          }
        }
      }
    }
  } catch (error) {
    console.warn('Power level consistency check failed:', error)
  }
}

// ========== 连贯性检查辅助函数 ==========

function extractKeyPhrases(text: string): string[] {
  if (!text || text.length < 10) return []
  const phrases: string[] = []
  const sentences = text.split(/[，。！？；\n]/).filter(s => s.trim().length > 5)

  for (const sentence of sentences.slice(-3)) {
    const words = sentence.trim().split(/[\s、：""''（）【】《》]+/)
      .filter(w => w.length >= 2)
    phrases.push(...words.slice(0, 2))
  }

  return [...new Set(phrases)].slice(0, 8)
}

function estimatePowerLevelGap(fromLevel: string, toLevel: string): number {
  const commonLevels = [
    '凡人', '炼气', '筑基', '金丹', '元婴', '化神', '合体', '大乘', '渡劫', '仙人',
    '一级', '二级', '三级', '四级', '五级', '六级', '七级', '八级', '九级', '十级',
    '初级', '中级', '高级', '巅峰', '圆满',
  ]

  const fromIndex = commonLevels.findIndex(l => fromLevel.includes(l))
  const toIndex = commonLevels.findIndex(l => toLevel.includes(l))

  if (fromIndex === -1 || toIndex === -1) return 1
  return Math.abs(toIndex - fromIndex)
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
    summaryConfig = await resolveConfig(db, 'analysis', chapter.novelId)
    summaryConfig.apiKey = summaryConfig.apiKey || ''
  } catch (error) {
    throw new Error(`❌ 未配置"智能分析"模型！请在全局配置中设置 analysis 阶段的模型（用于一致性检查、境界检测、伏笔提取等分析任务）`)
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
      llmConfig.apiKey = llmConfig.apiKey || ''
    } catch {
      try {
        llmConfig = await resolveConfig(db, 'chapter_gen', novelId)
        llmConfig.apiKey = llmConfig.apiKey || ''
      } catch (error) {
        throw new Error(`❌ 未配置"大纲生成"或"章节生成"模型！请在小说工作台或全局配置中设置 outline_gen 或 chapter_gen 阶段的模型`)
      }
    }

    const existingChaptersInfo = existingChapters.length > 0
      ? `\n\n【现有章节】\n${existingChapters.map((ch, i) => `${i + 1}. 第${ch.sortOrder || i + 1}章《${ch.title}》`).join('\n')}`
      : ''

    const batchPrompt = `请为小说的某一卷生成章节标题和摘要规划。

【卷信息】：
- 标题：《${volume.title}》
- 卷序：第${volume.sortOrder + 1}卷
${volume.summary ? `- 卷概要：${volume.summary}` : ''}

【生成要求】：
- 需要规划 ${targetCount} 个章节
- 每个章节包含：章节标题、章节摘要（150-200字，概括本章核心情节）
- 章节之间要有连贯性，形成完整的故事弧线
- 注意节奏：开头铺垫、中间发展、高潮迭起、结尾悬念
${existingChaptersInfo}
${context ? `\n【补充上下文】：\n${context}` : ''}

请以JSON数组格式输出（不要输出其他内容）：
[
  {
    "chapterTitle": "章节标题",
    "summary": "章节摘要（150-200字）"
  }
]

要求：
1. 输出 ${targetCount} 个章节的标题和摘要
2. 摘要质量要高，有具体的情节点而非空泛描述
3. 章节标题要有吸引力，符合小说风格`

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

    const chapterPlans = parsedOutlines.map((outlineData: any, i: number) => ({
      index: i,
      chapterTitle: outlineData.chapterTitle || `第${i + 1}章`,
      summary: outlineData.summary || '',
    }))

    console.log(`✅ Batch chapter plans generated: ${chapterPlans.length} chapters`)

    return {
      ok: true,
      message: `成功生成 ${chapterPlans.length} 个章节规划`,
      outlines: chapterPlans,
      totalRequested: parsedOutlines.length,
      successCount: chapterPlans.length,
    }
  } catch (error) {
    console.error('Batch outline generation failed:', error)
    return { ok: false, error: '批量生成异常', details: (error as Error).message }
  }
}

export async function confirmBatchChapterCreation(
  env: Env,
  data: {
    volumeId: string
    novelId: string
    chapterPlans: Array<{ chapterTitle: string; summary: string }>
  }
): Promise<{
  ok: boolean
  message?: string
  createdChapters?: Array<{ id: string; title: string; sortOrder: number }>
  error?: string
}> {
  const { volumeId, novelId, chapterPlans } = data
  const db = drizzle(env.DB)

  try {
    const volume = await db
      .select({
        id: volumes.id,
        sortOrder: volumes.sortOrder,
      })
      .from(volumes)
      .where(eq(volumes.id, volumeId))
      .get()

    if (!volume) {
      return { ok: false, error: '卷不存在' }
    }

    const existingChapters = await db
      .select({
        sortOrder: chapters.sortOrder,
      })
      .from(chapters)
      .where(eq(chapters.volumeId, volumeId))
      .orderBy(desc(chapters.sortOrder))
      .limit(1)
      .get()

    const startSortOrder = existingChapters ? existingChapters.sortOrder + 1 : 0

    const createdChapters: Array<{ id: string; title: string; sortOrder: number }> = []

    for (let i = 0; i < chapterPlans.length; i++) {
      const plan = chapterPlans[i]
      try {
        const [chapter] = await db
          .insert(chapters)
          .values({
            novelId,
            volumeId,
            title: plan.chapterTitle,
            summary: plan.summary,
            sortOrder: startSortOrder + i,
            content: null,
            wordCount: 0,
            status: 'draft',
          })
          .returning()

        createdChapters.push({
          id: chapter.id,
        title: chapter.title,
          sortOrder: chapter.sortOrder,
        })
      } catch (insertError) {
        console.warn(`Failed to create chapter ${i}:`, insertError)
      }
    }

    await db
      .update(volumes)
      .set({
        chapterCount: sql`${volumes.chapterCount} + ${createdChapters.length}`,
        updatedAt: sql`(unixepoch())`,
      })
      .where(eq(volumes.id, volumeId))

    await db
      .update(novels)
      .set({
        chapterCount: sql`${novels.chapterCount} + ${createdChapters.length}`,
        updatedAt: sql`(unixepoch())`,
      })
      .where(eq(novels.id, novelId))

    console.log(`✅ Batch chapter creation complete: ${createdChapters.length}/${chapterPlans.length} chapters created`)

    return {
      ok: true,
      message: `成功创建 ${createdChapters.length} 个章节`,
      createdChapters,
    }
  } catch (error) {
    console.error('Batch chapter creation failed:', error)
    return { ok: false, error: '批量创建章节异常' }
  }
}

export async function generateNextChapter(
  env: Env,
  data: {
    volumeId: string
    novelId: string
  }
): Promise<{
  ok: boolean
  chapterTitle?: string
  summary?: string
  error?: string
}> {
  const { volumeId, novelId } = data
  const db = drizzle(env.DB)

  try {
    const volume = await db
      .select({
        id: volumes.id,
        title: volumes.title,
        blueprint: volumes.blueprint,
        eventLine: volumes.eventLine,
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
        title: chapters.title,
        summary: chapters.summary,
      })
      .from(chapters)
      .where(eq(chapters.volumeId, volumeId))
      .orderBy(desc(chapters.sortOrder))
      .limit(3)
      .all()

    let llmConfig
    try {
      llmConfig = await resolveConfig(db, 'outline_gen', novelId)
      llmConfig.apiKey = llmConfig.apiKey || ''
    } catch {
      try {
        llmConfig = await resolveConfig(db, 'chapter_gen', novelId)
        llmConfig.apiKey = llmConfig.apiKey || ''
      } catch (error) {
        return { ok: false, error: '未配置大纲生成或章节生成模型' }
      }
    }

    const recentChaptersInfo = existingChapters.length > 0
      ? `\n\n【最近章节】\n${existingChapters.map((ch, i) => `${i + 1}. 《${ch.title}》\n   摘要：${ch.summary || '无'}`).join('\n\n')}`
      : ''

    const prompt = `请为小说的某一卷生成下一章的标题和摘要。

【卷信息】：
- 标题：《${volume.title}》
${volume.blueprint ? `- 卷蓝图：\n${volume.blueprint}` : ''}
${volume.eventLine ? `- 事件线：\n${volume.eventLine}` : ''}
${volume.summary ? `- 卷摘要：${volume.summary}` : ''}
${recentChaptersInfo}

【生成要求】：
- 生成下一章的章节标题（要有吸引力，符合小说风格）
- 生成章节摘要（150-200字，概括本章核心情节）
- 章节要与已有章节连贯，承接上一章的结尾
- 注意节奏：开头铺垫、中间发展、高潮迭起、结尾悬念

请以JSON格式输出（不要输出其他内容）：
{
  "chapterTitle": "章节标题",
  "summary": "章节摘要（150-200字）"
}`

    const base = llmConfig.apiBase || getDefaultBase(llmConfig.provider)
    const resp = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${llmConfig.apiKey}`,
      },
      body: JSON.stringify({
        model: llmConfig.modelId,
        messages: [
          { role: 'system', content: '你是一个专业的小说创作助手，擅长生成连贯的章节标题和摘要。你只输出JSON，不要其他内容。' },
          { role: 'user', content: prompt },
        ],
        stream: false,
        temperature: llmConfig.params?.temperature ?? 0.85,
        max_tokens: 1000,
      }),
    })

    if (!resp.ok) {
      const errorText = await resp.text()
      return { ok: false, error: `API错误: ${resp.status} ${errorText}` }
    }

    const result = await resp.json() as any
    const content = result.choices?.[0]?.message?.content || ''

    let parsedResult: any
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        parsedResult = JSON.parse(jsonMatch[0])
      } else {
        parsedResult = JSON.parse(content)
      }
    } catch (parseError) {
      console.warn('Failed to parse next chapter result:', parseError)
      return { ok: false, error: '解析生成结果失败' }
    }

    if (!parsedResult.chapterTitle || !parsedResult.summary) {
      return { ok: false, error: '生成结果不完整' }
    }

    return {
      ok: true,
      chapterTitle: parsedResult.chapterTitle,
      summary: parsedResult.summary,
    }
  } catch (error) {
    console.error('Next chapter generation failed:', error)
    return { ok: false, error: '生成下一章异常' }
  }
}

export async function generateSettingSummary(
  env: Env,
  settingId: string,
): Promise<{ ok: boolean; summary?: string; error?: string }> {
  const db = drizzle(env.DB) as AppDb

  const row = await db
    .select({
      id: novelSettings.id,
      name: novelSettings.name,
      type: novelSettings.type,
      content: novelSettings.content,
      novelId: novelSettings.novelId,
    })
    .from(novelSettings)
    .where(eq(novelSettings.id, settingId))
    .get()

  if (!row) return { ok: false, error: '设定不存在' }
  if (!row.content?.trim()) return { ok: false, error: '设定内容为空' }

  let llmConfig
  try {
    llmConfig = await resolveConfig(db as any, 'summary_gen', row.novelId)
  } catch (e) {
    return { ok: false, error: `未配置摘要生成模型: ${(e as Error).message}` }
  }

  const contentForLLM = row.content

  const systemPrompt = `你是一个专业的小说世界观设定助手，擅长将冗长的设定描述精炼为语义丰富的短摘要。
你只输出摘要文本本身（纯文本），不要输出任何解释、标题或格式标记。`

  const userPrompt = `请为以下小说设定生成一段简洁的摘要。

【设定名称】：${row.name}
【设定类型】：${row.type}

【设定内容】：
${contentForLLM}

【要求】：
1. 摘要长度控制在200-400字之间
2. 保留核心概念、关键数值、重要关系和独特规则
3. 省略细节描述和举例说明
4. 使用与原文一致的术语体系
5. 输出纯文本，不要任何格式标记`

  const base = llmConfig.apiBase || getDefaultBase(llmConfig.provider)

  const resp = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${llmConfig.apiKey}`,
    },
    body: JSON.stringify({
      model: llmConfig.modelId,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      stream: false,
      temperature: llmConfig.params?.temperature ?? 0.3,
      max_tokens: 800,
    }),
  })

  if (!resp.ok) {
    const errorText = await resp.text()
    console.error(`[generateSettingSummary] API error ${resp.status}:`, errorText)
    return { ok: false, error: `API错误: ${resp.status}` }
  }

  const result = await resp.json() as any
  const aiSummary = result.choices?.[0]?.message?.content?.trim()

  if (!aiSummary) return { ok: false, error: '模型返回为空' }

  await db
    .update(novelSettings)
    .set({ summary: aiSummary, updatedAt: sql`(unixepoch())` })
    .where(eq(novelSettings.id, settingId))

  console.log(`✅ Setting summary generated for ${row.name} (${aiSummary.length} chars)`)

  return { ok: true, summary: aiSummary }
}
