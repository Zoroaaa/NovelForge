/**
 * NovelForge · LLM 统一调用层
 *
 * 从 model_configs 表读取配置，抹平不同 provider 的接口差异。
 * 所有 LLM 调用走这里，不直接 fetch。
 */

export type Stage =
  | 'outline_gen'
  | 'chapter_gen'
  | 'summary_gen'
  | 'embedding'
  | 'vision'

export interface LLMConfig {
  provider: 'volcengine' | 'anthropic' | 'openai' | 'custom'
  modelId: string
  apiBase?: string
  apiKey: string
  params?: {
    temperature?: number
    max_tokens?: number
    top_p?: number
  }
}

export interface StreamOptions {
  onChunk: (text: string) => void
  onDone: (usage: { prompt_tokens: number; completion_tokens: number }) => void
  onError: (err: Error) => void
}

/**
 * 解析当前 stage 应该用哪个模型配置
 * 优先级：novel 级 > global 级 > 硬编码默认
 */
export async function resolveConfig(
  db: D1Database,
  stage: Stage,
  novelId?: string
): Promise<LLMConfig> {
  // 先查 novel 级，再查 global，Drizzle ORM 生成 SQL
  const row = await db.prepare(`
    SELECT * FROM model_configs
    WHERE stage = ? AND is_active = 1
      AND (novel_id = ? OR novel_id IS NULL)
    ORDER BY CASE WHEN novel_id IS NOT NULL THEN 0 ELSE 1 END
    LIMIT 1
  `).bind(stage, novelId ?? null).first()

  if (!row) throw new Error(`No active model config for stage: ${stage}`)

  return {
    provider: row.provider as any,
    modelId: row.model_id as string,
    apiBase: row.api_base as string | undefined,
    apiKey: '', // 由 Workers secret 在运行时注入，不从 DB 读
    params: row.params ? JSON.parse(row.params as string) : {},
  }
}

/**
 * 流式生成（SSE → 前端）
 * 统一适配 OpenAI 兼容格式（Volcengine / Anthropic OpenAI-compat / OpenAI 均支持）
 */
export async function streamGenerate(
  config: LLMConfig,
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  opts: StreamOptions
): Promise<void> {
  const base = config.apiBase ?? getDefaultBase(config.provider)

  const resp = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.modelId,
      messages,
      stream: true,
      temperature: config.params?.temperature ?? 0.85,
      max_tokens: config.params?.max_tokens ?? 4096,
    }),
  })

  if (!resp.ok) {
    opts.onError(new Error(`LLM API error: ${resp.status} ${await resp.text()}`))
    return
  }

  const reader = resp.body!.getReader()
  const decoder = new TextDecoder()
  let promptTokens = 0
  let completionTokens = 0

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    const lines = decoder.decode(value).split('\n')
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const data = line.slice(6).trim()
      if (data === '[DONE]') { opts.onDone({ prompt_tokens: promptTokens, completion_tokens: completionTokens }); return }
      try {
        const json = JSON.parse(data)
        const delta = json.choices?.[0]?.delta?.content
        if (delta) opts.onChunk(delta)
        if (json.usage) {
          promptTokens = json.usage.prompt_tokens
          completionTokens = json.usage.completion_tokens
        }
      } catch {}
    }
  }
}

function getDefaultBase(provider: string): string {
  switch (provider) {
    case 'volcengine': return 'https://ark.cn-beijing.volces.com/api/v3'
    case 'anthropic':  return 'https://api.anthropic.com/v1'
    case 'openai':     return 'https://api.openai.com/v1'
    default: throw new Error('custom provider must set apiBase')
  }
}
