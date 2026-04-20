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
import { chapters, modelConfigs } from '../db/schema'
import { eq } from 'drizzle-orm'
import type { Env } from '../lib/types'
import { buildChapterContext, type ContextBundle } from './contextBuilder'
import { streamGenerate, resolveConfig } from './llm'
import { indexContent } from './embedding'

export interface AgentConfig {
  maxIterations?: number
  enableRAG?: boolean
  enableAutoSummary?: boolean
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
 * 主入口：智能章节生成
 */
export async function generateChapter(
  env: Env,
  chapterId: string,
  novelId: string,
  onChunk: (text: string) => void,
  onDone: (usage: { prompt_tokens: number; completion_tokens: number }) => void,
  onError: (err: Error) => void,
  config: Partial<AgentConfig> = {}
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

    // 4. 组装消息（带上下文的增强版）
    const messages = buildMessages(chapter.title, contextBundle)

    // 5. 流式调用 LLM
    await streamGenerate(llmConfig, messages, {
      onChunk,
      onDone: async (usage) => {
        // 6. 生成完成后自动摘要
        if (agentConfig.enableAutoSummary) {
          await triggerAutoSummary(env, chapterId, novelId, usage)
        }
        onDone(usage)
      },
      onError,
    })

  } catch (error) {
    console.error('Generation failed:', error)
    onError(error as Error)
  }
}

/**
 * 组装消息（根据是否有上下文选择不同策略）
 */
function buildMessages(
  chapterTitle: string,
  contextBundle: ContextBundle | null
): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> {
  const systemPrompt = `你是一位专业的网络小说作家，擅长创作玄幻/仙侠类小说。
你的写作风格：
- 文笔流畅，节奏紧凑
- 善用对话推动情节
- 注重场景描写和氛围营造
- 每章结尾留有悬念
- 人物性格鲜明，行为符合设定`

  if (!contextBundle) {
    // 简单模式（Phase 1兼容）
    return [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: `请创作《${chapterTitle}》的正文内容。
要求：3000-5000字，第三人称叙述，情节连贯。`,
      },
    ]
  }

  // 智能模式（Phase 2 RAG增强）
  const userContentParts: string[] = []

  userContentParts.push(`【创作任务】`)
  userContentParts.push(`请创作《${chapterTitle}》的正文内容，3000-5000字。`)

  if (contextBundle.mandatory.chapterOutline) {
    userContentParts.push(`\n【本章大纲】\n${contextBundle.mandatory.chapterOutline}`)
  }

  if (contextBundle.mandatory.prevChapterSummary) {
    userContentParts.push(`\n【上一章摘要】\n${contextBundle.mandatory.prevChapterSummary}`)
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
async function triggerAutoSummary(
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
          modelUsed: summaryConfig.modelId,
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
