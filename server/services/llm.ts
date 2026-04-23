/**
 * @file llm.ts
 * @description LLM服务层模块，提供多提供商API统一封装、流式生成、模型配置管理等功能
 * @version 2.0.0
 * @modified 2026-04-21 - 扩展支持国内外主流大模型提供商
 */
import { modelConfigs } from '../db/schema'
import { eq, and, desc } from 'drizzle-orm'
import type { DrizzleD1Database } from 'drizzle-orm/d1'
import { drizzle } from 'drizzle-orm/d1'
import type { Env } from '../lib/types'

export type ProviderType = 
  | 'baidu' | 'tencent' | 'aliyun' | 'volcengine' | 'zhipu' 
  | 'minimax' | 'moonshot' | 'siliconflow' | 'deepseek' 
  | 'openai' | 'anthropic' | 'google' | 'mistral' | 'xai' 
  | 'groq' | 'perplexity' | 'openrouter' | 'nvidia' | 'gitee' 
  | 'modelscope' | 'custom'

export interface LLMConfig {
  provider: ProviderType
  modelId: string
  apiBase: string
  apiKey: string
  params?: {
    temperature?: number
    max_tokens?: number
    top_p?: number
    frequency_penalty?: number
    presence_penalty?: number
    systemPromptOverride?: string
  }
}

export interface Message {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface StreamOptions {
  onChunk: (text: string) => void
  onDone: (usage: { prompt_tokens: number; completion_tokens: number }) => void
  onError: (error: Error) => void
  onToolCall?: (toolCall: {
    id: string
    name: string
    args: Record<string, any>
    status: 'start' | 'delta' | 'complete'
  }) => void
}

export interface ModelParams {
  temperature: number
  max_tokens: number
  top_p: number
  frequency_penalty: number
  presence_penalty: number
  stop: string[]
}

const DEFAULT_PARAMS: ModelParams = {
  temperature: 0.85,
  max_tokens: 4096,
  top_p: 0.9,
  frequency_penalty: 0.3,
  presence_penalty: 0.3,
  stop: [],
}

const PROVIDER_BASES: Record<string, string> = {
  baidu: 'https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop',
  tencent: 'https://api.hunyuan.cloud.tencent.com/v1',
  aliyun: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  volcengine: 'https://ark.cn-beijing.volces.com/api/v3',
  zhipu: 'https://open.bigmodel.cn/api/paas/v4',
  minimax: 'https://api.minimax.chat/v1',
  moonshot: 'https://api.moonshot.cn/v1',
  siliconflow: 'https://api.siliconflow.cn/v1',
  deepseek: 'https://api.deepseek.com/v1',
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com/v1',
  google: 'https://generativelanguage.googleapis.com/v1beta',
  mistral: 'https://api.mistral.ai/v1',
  xai: 'https://api.x.ai/v1',
  groq: 'https://api.groq.com/openai/v1',
  perplexity: 'https://api.perplexity.ai',
  openrouter: 'https://openrouter.ai/api/v1',
  nvidia: 'https://integrate.api.nvidia.com/v1',
  gitee: 'https://ai.gitee.com/v1',
  modelscope: 'https://api-inference.modelscope.cn/v1',
}

/**
 * 解析模型配置
 * @description 按优先级获取模型配置：小说级配置 > 全局配置 > 硬编码fallback
 * @param {DrizzleD1Database} db - 数据库实例
 * @param {string} stage - 生成阶段（如chapter_gen, summary_gen, workshop）
 * @param {string} novelId - 小说ID（可选，为空时直接查全局配置）
 * @returns {Promise<LLMConfig>} LLM配置对象
 * @throws {Error} 未找到对应阶段的配置
 */
export async function resolveConfig(
  db: DrizzleD1Database,
  stage: string,
  novelId: string
): Promise<LLMConfig> {
  console.log(`[resolveConfig] Looking for config: stage=${stage}, novelId=${novelId || '(none)'}`)

  // 1. 如果有 novelId，尝试获取小说级别的 stage 配置
  if (novelId && novelId.trim() !== '') {
    const novelConfig = await db
      .select()
      .from(modelConfigs)
      .where(
        and(
          eq(modelConfigs.novelId, novelId),
          eq(modelConfigs.stage, stage),
          eq(modelConfigs.isActive, 1)
        )
      )
      .orderBy(desc(modelConfigs.createdAt))
      .limit(1)
      .get()

    if (novelConfig) {
      console.log(`[resolveConfig] Found novel-level config for ${stage}`)
      return {
        provider: novelConfig.provider as ProviderType,
        modelId: novelConfig.modelId,
        apiBase: novelConfig.apiBase || getDefaultBase(novelConfig.provider),
        apiKey: novelConfig.apiKey || '',
        params: novelConfig.params ? JSON.parse(novelConfig.params) : undefined,
      }
    }
  }

  // 2. 尝试获取全局配置（scope='global' + stage 过滤）
  const globalConfig = await db
    .select()
    .from(modelConfigs)
    .where(
      and(
        eq(modelConfigs.scope, 'global'),
        eq(modelConfigs.stage, stage),
        eq(modelConfigs.isActive, 1)
      )
    )
    .orderBy(desc(modelConfigs.createdAt))
    .limit(1)
    .get()

  if (globalConfig) {
    console.log(`[resolveConfig] Found global config for ${stage}: provider=${globalConfig.provider}, model=${globalConfig.modelId}`)
    return {
      provider: globalConfig.provider as ProviderType,
      modelId: globalConfig.modelId,
      apiBase: globalConfig.apiBase || getDefaultBase(globalConfig.provider),
      apiKey: globalConfig.apiKey || '',
      params: globalConfig.params ? JSON.parse(globalConfig.params) : undefined,
    }
  }

  // 3. 未找到配置，抛出详细错误
  console.error(`[resolveConfig] No config found for stage=${stage}, novelId=${novelId || '(none)'}`)
  throw new Error(`No model config found for stage: ${stage}`)
}

/**
 * 流式生成文本
 * @param {LLMConfig} config - LLM配置对象
 * @param {Message[]} messages - 消息数组
 * @param {StreamOptions} options - 流式选项
 * @param {Function} [options.onChunk] - 每次收到内容块的回调
 * @param {Function} [options.onDone] - 生成完成的回调
 * @param {Function} [options.onError] - 发生错误的回调
 * @param {Array} [tools] - 可选的工具定义数组
 * @returns {Promise<void>}
 */
export async function streamGenerate(
  config: LLMConfig,
  messages: Message[],
  options: StreamOptions,
  tools?: Array<{ type: string; function: { name: string; description: string; parameters: any } }>
): Promise<void> {
  const { onChunk, onDone, onError, onToolCall } = options

  try {
    const base = config.apiBase || getDefaultBase(config.provider)
    const mergedParams = { ...DEFAULT_PARAMS, ...config.params }

    const payload: any = {
      model: config.modelId,
      messages,
      stream: true,
      temperature: mergedParams.temperature,
      max_tokens: mergedParams.max_tokens,
      top_p: mergedParams.top_p,
      frequency_penalty: mergedParams.frequency_penalty,
      presence_penalty: mergedParams.presence_penalty,
      ...(mergedParams.stop.length > 0 ? { stop: mergedParams.stop } : {}),
      ...(tools && tools.length > 0 ? { tools, tool_choice: 'auto' } : {}),
    }

    if (config.provider === 'anthropic') {
      payload.system = messages.find(m => m.role === 'system')?.content || ''
      payload.messages = messages.filter(m => m.role !== 'system')
      delete payload.model
      payload.anthropic_version = 'v1'
    }

    const endpoint = config.provider === 'anthropic' ? '/messages' : '/chat/completions'
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    }

    if (config.provider === 'anthropic') {
      headers['x-api-key'] = config.apiKey
      headers['anthropic-dangerous-direct-browser-access'] = 'true'
    }

    const response = await fetch(`${base}${endpoint}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`LLM API error: ${response.status} ${errorText}`)
    }

    const reader = response.body?.getReader()
    if (!reader) {
      throw new Error('Response body is not readable')
    }

    const decoder = new TextDecoder()
    let buffer = ''
    let promptTokens = 0
    let completionTokens = 0

    // Function calling 状态管理
    const toolCallMap = new Map<number, { id: string; name: string; args: string }>()

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || trimmed === 'data: [DONE]') continue
        if (!trimmed.startsWith('data:')) continue

        try {
          const jsonStr = trimmed.slice(5).trim()
          const data = JSON.parse(jsonStr)

          // 处理 Anthropic 格式
          if (config.provider === 'anthropic') {
            const content = data.content?.[0]?.text || ''
            if (content) {
              onChunk(content)
              completionTokens += estimateTokens(content)
            }
            if (data.usage) {
              promptTokens = data.usage.input_tokens || 0
              completionTokens = data.usage.output_tokens || completionTokens
            }
            continue
          }

          // 处理 OpenAI 兼容格式
          const delta = data.choices?.[0]?.delta
          if (!delta) {
            if (data.usage) {
              promptTokens = data.usage.prompt_tokens || 0
              completionTokens = data.usage.completion_tokens || completionTokens
            }
            continue
          }

          // 1. 处理文本内容
          const content = delta.content || ''
          if (content) {
            onChunk(content)
            completionTokens += estimateTokens(content)
          }

          // 2. 处理 function calling（核心改进）
          if (delta.tool_calls && onToolCall && tools && tools.length > 0) {
            for (const tc of delta.tool_calls) {
              const index = tc.index ?? 0

              if (!toolCallMap.has(index)) {
                toolCallMap.set(index, {
                  id: tc.id || '',
                  name: '',
                  args: '',
                })
              }

              const currentTool = toolCallMap.get(index)!

              if (tc.id) {
                currentTool.id = tc.id
              }

              if (tc.function) {
                if (tc.function.name) {
                  currentTool.name = tc.function.name
                }
                if (tc.function.arguments) {
                  currentTool.args += tc.function.arguments
                }
              }

              // 通知外部：工具调用开始/更新
              const argsObj = (() => {
                try {
                  return JSON.parse(currentTool.args || '{}')
                } catch {
                  return {}
                }
              })()

              onToolCall({
                id: currentTool.id,
                name: currentTool.name,
                args: argsObj,
                status: tc.function?.arguments ? 'delta' : 'start',
              })
            }
          }

          // 3. 提取 token 使用量
          if (data.usage) {
            promptTokens = data.usage.prompt_tokens || 0
            completionTokens = data.usage.completion_tokens || completionTokens
          }

          // 4. 检测完成（finish_reason 为 tool_calls 时）
          const finishReason = data.choices?.[0]?.finish_reason
          if (finishReason === 'tool_calls' || finishReason === 'stop') {
            // 通知所有工具调用完成
            if (onToolCall && toolCallMap.size > 0) {
              for (const [index, tool] of toolCallMap) {
                if (tool.name && tool.args) {
                  try {
                    const finalArgs = JSON.parse(tool.args)
                    onToolCall({
                      id: tool.id,
                      name: tool.name,
                      args: finalArgs,
                      status: 'complete',
                    })
                  } catch (e) {
                    console.warn(`Failed to parse tool args for ${tool.name}:`, tool.args)
                  }
                }
              }
            }
          }
        } catch (e) {
          console.warn('Failed to parse SSE line:', trimmed)
        }
      }
    }

    // 清理：确保所有工具调用都标记为 complete（防止遗漏）
    if (onToolCall && toolCallMap.size > 0) {
      for (const [index, tool] of toolCallMap) {
        if (tool.name && tool.args) {
          try {
            const finalArgs = JSON.parse(tool.args)
            // 检查是否已经发送过 complete 事件（避免重复）
            const alreadyCompleted = Array.from(toolCallMap.entries())
              .some(([i, t]) => i !== index && t.id === tool.id)

            if (!alreadyCompleted) {
              onToolCall({
                id: tool.id,
                name: tool.name,
                args: finalArgs,
                status: 'complete',
              })
            }
          } catch (e) {
            console.warn(`Final cleanup failed for tool ${tool.name}:`, e)
          }
        }
      }
    }

    onDone({
      prompt_tokens: promptTokens || estimateTokens(messages.map(m => m.content).join('')),
      completion_tokens: completionTokens,
    })

  } catch (error) {
    console.error('Stream generation failed:', error)
    onError(error as Error)
  }
}

/**
 * 非流式生成（用于摘要等场景）
 * @param {LLMConfig} config - LLM配置对象
 * @param {Message[]} messages - 消息数组
 * @param {Object} [options] - 可选配置
 * @param {Function} [options.onToken] - 每次收到token的回调
 * @returns {Promise<{text: string, usage: {prompt_tokens: number, completion_tokens: number}}>} 生成结果
 */
export async function generate(
  config: LLMConfig,
  messages: Message[],
  options?: {
    onToken?: (token: string) => void
  }
): Promise<{ text: string; usage: { prompt_tokens: number; completion_tokens: number } }> {
  const base = config.apiBase || getDefaultBase(config.provider)
  const mergedParams = { ...DEFAULT_PARAMS, ...config.params }

  const payload: any = {
    model: config.modelId,
    messages,
    stream: false,
    temperature: mergedParams.temperature,
    max_tokens: mergedParams.max_tokens,
  }

  // Anthropic 格式适配
  if (config.provider === 'anthropic') {
    payload.system = messages.find(m => m.role === 'system')?.content || ''
    payload.messages = messages.filter(m => m.role !== 'system')
    delete payload.model
  }

  const endpoint = config.provider === 'anthropic' ? '/messages' : '/chat/completions'
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${config.apiKey}`,
  }

  if (config.provider === 'anthropic') {
    headers['x-api-key'] = config.apiKey
    headers['anthropic-dangerous-direct-browser-access'] = 'true'
  }

  const response = await fetch(`${base}${endpoint}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`LLM API error: ${response.status} ${errorText}`)
  }

  const result = await response.json() as any
  
  let text = ''
  let promptTokens = 0
  let completionTokens = 0

  if (config.provider === 'anthropic') {
    text = result.content?.[0]?.text || ''
    promptTokens = result.usage?.input_tokens || 0
    completionTokens = result.usage?.output_tokens || 0
  } else {
    text = result.choices?.[0]?.message?.content || ''
    promptTokens = result.usage?.prompt_tokens || 0
    completionTokens = result.usage?.completion_tokens || 0
  }

  if (options?.onToken) {
    options.onToken(text)
  }

  return {
    text,
    usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens },
  }
}

// ========== 内部工具函数 ==========

export function getDefaultBase(provider: string): string {
  return PROVIDER_BASES[provider] || 'https://api.openai.com/v1'
}

/** 中文 token 粗估：1 汉字 ≈ 1.3 token，英文 1 词 ≈ 1.3 token */
function estimateTokens(text: string): number {
  if (!text) return 0
  const cjk = (text.match(/[\u4e00-\u9fff]/g) || []).length
  const other = text.length - cjk
  return Math.ceil(cjk * 1.3 + other * 0.3)
}

export async function generateOutline(
  env: Env,
  data: {
    novelId: string
    title: string
    type: string
    parentTitle?: string
    context?: string
  }
): Promise<string> {
  const { novelId, title, type, parentTitle, context } = data
  const db = drizzle(env.DB)

  let llmConfig
  try {
    llmConfig = await resolveConfig(db, 'outline_gen', novelId)
    llmConfig.apiKey = llmConfig.apiKey || ''
  } catch {
    throw new Error(`❌ 未配置"大纲生成"模型！请在小说工作台或全局配置中设置 outline_gen 阶段的模型（提供商 + 模型ID + API Key）`)
  }

  const typeLabels: Record<string, string> = {
    world_setting: '世界观设定',
    volume: '卷纲',
    chapter_outline: '章节大纲',
    arc: '故事线',
    custom: '自定义大纲',
  }

  const typeLabel = typeLabels[type] || '大纲'

  const outlinePrompt = `请为小说生成${typeLabel}内容。

【标题】：${title}
【类型】：${typeLabel}
${parentTitle ? `【上级节点】：${parentTitle}` : ''}
${context ? `【补充上下文】：\n${context}` : ''}

要求：
1. 内容详细、结构清晰
2. 符合${typeLabel}的定位和作用
3. 如果是章节大纲，包含情节走向、关键冲突、人物动态
4. 如果是卷纲，包含本卷主线、重要转折点、人物成长
5. 如果是世界观设定，包含地理、势力、修炼体系、历史背景
6. 使用 Markdown 格式
7. 字数 800-2000 字`

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
        { role: 'system', content: '你是一个专业的小说大纲助手，擅长构建世界观、卷纲和章节大纲。' },
        { role: 'user', content: outlinePrompt },
      ],
      stream: false,
      temperature: 0.85,
      max_tokens: 4096,
    }),
  })

  if (!resp.ok) {
    const errorText = await resp.text()
    throw new Error(`生成失败: ${resp.status} ${errorText}`)
  }

  const result = await resp.json() as any
  return result.choices?.[0]?.message?.content || ''
}
