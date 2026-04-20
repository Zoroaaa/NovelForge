/**
 * NovelForge · LLM 服务层
 *
 * 支持功能：
 * - 多提供商 LLM API 统一封装 (Volcengine/Anthropic/OpenAI)
 * - 流式生成 (SSE)
 * - 模型配置解析与管理
 * - Token 计数与预算控制
 */

import type { Database } from 'drizzle-orm'
import type { modelConfigs } from '../db/schema'
import { eq, and, desc } from 'drizzle-orm'

export interface LLMConfig {
  provider: 'volcengine' | 'anthropic' | 'openai'
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
  apiKeyEnv?: string
}

export interface Message {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface StreamOptions {
  onChunk: (text: string) => void
  onDone: (usage: { prompt_tokens: number; completion_tokens: number }) => void
  onError: (error: Error) => void
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

/**
 * 解析模型配置
 * 
 * 优先级：
 * 1. 小说级别的 stage 配置（如 chapter_gen, summary_gen）
 * 2. 全局默认配置
 * 3. 硬编码 fallback
 */
export async function resolveConfig(
  db: Database<typeof modelConfigs>,
  stage: string,
  novelId: string
): Promise<LLMConfig> {
  // 1. 尝试获取小说级别的 stage 配置（novelId + stage 双过滤）
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
    return {
      provider: novelConfig.provider as 'volcengine' | 'anthropic' | 'openai',
      modelId: novelConfig.modelId,
      apiBase: novelConfig.apiBase || getDefaultBase(novelConfig.provider),
      apiKey: novelConfig.apiKey || '',
      params: novelConfig.params ? JSON.parse(novelConfig.params) : undefined,
      apiKeyEnv: novelConfig.apiKeyEnv,
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
    return {
      provider: globalConfig.provider as 'volcengine' | 'anthropic' | 'openai',
      modelId: globalConfig.modelId,
      apiBase: globalConfig.apiBase || getDefaultBase(globalConfig.provider),
      apiKey: globalConfig.apiKey || '',
      params: globalConfig.params ? JSON.parse(globalConfig.params) : undefined,
      apiKeyEnv: globalConfig.apiKeyEnv,
    }
  }

  // 3. Fallback 默认配置
  throw new Error(`No model config found for stage: ${stage}`)
}

/**
 * 流式生成文本
 */
export async function streamGenerate(
  config: LLMConfig,
  messages: Message[],
  options: StreamOptions,
  tools?: Array<{ type: string; function: { name: string; description: string; parameters: any } }>
): Promise<void> {
  const { onChunk, onDone, onError } = options

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
      ...(tools ? { tools } : {}),
    }

    // Anthropic 格式适配
    if (config.provider === 'anthropic') {
      payload.system = messages.find(m => m.role === 'system')?.content || ''
      payload.messages = messages.filter(m => m.role !== 'system')
      delete payload.model
      payload.anthropic_version = 'v1'
    }

    const response = await fetch(`${base}${config.provider === 'anthropic' ? '/messages' : '/chat/completions'}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
        ...(config.provider === 'anthropic' ? {
          'x-api-key': config.apiKey,
          'anthropic-dangerous-direct-browser-access': 'true',
        } : {}),
      },
      body: JSON.stringify(payload),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`LLM API error: ${response.status} ${errorText}`)
    }

    // 处理 SSE 流
    const reader = response.body?.getReader()
    if (!reader) {
      throw new Error('Response body is not readable')
    }

    let decoder = new TextDecoder()
    let buffer = ''
    let promptTokens = 0
    let completionTokens = 0

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

          // 提取内容
          let content = ''
          if (config.provider === 'anthropic') {
            content = data.content?.[0]?.text || ''
          } else {
            content = data.choices?.[0]?.delta?.content || ''
          }

          if (content) {
            onChunk(content)
            completionTokens += estimateTokens(content)
          }

          // 提取 token 使用量
          if (data.usage) {
            promptTokens = data.usage.prompt_tokens || 0
            completionTokens = data.usage.completion_tokens || completionTokens
          }
        } catch (e) {
          console.warn('Failed to parse SSE line:', trimmed)
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

  const response = await fetch(`${base}${config.provider === 'anthropic' ? '/messages' : '/chat/completions'}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
      ...(config.provider === 'anthropic' ? {
        'x-api-key': config.apiKey,
        'anthropic-dangerous-direct-browser-access': 'true',
      } : {}),
    },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`LLM API error: ${response.status} ${errorText}`)
  }

  const result = await response.json()
  
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

/** 中文 token 粗估：1 汉字 ≈ 1.3 token，英文 1 词 ≈ 1.3 token */
function estimateTokens(text: string): number {
  if (!text) return 0
  const cjk = (text.match(/[\u4e00-\u9fff]/g) || []).length
  const other = text.length - cjk
  return Math.ceil(cjk * 1.3 + other * 0.3)
}
