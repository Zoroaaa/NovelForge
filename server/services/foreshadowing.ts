/**
 * @file foreshadowing.ts
 * @description 伏笔追踪服务模块，提供伏笔自动提取、状态检测和CRUD功能
 * @version 1.0.0
 * @modified 2026-04-21 - 添加规范化注释
 */
import { drizzle } from 'drizzle-orm/d1'
import { foreshadowing, chapters } from '../db/schema'
import { eq, and, isNull } from 'drizzle-orm'
import type { Env } from '../lib/types'
import { resolveConfig } from './llm'

export interface ForeshadowingExtractResult {
  newForeshadowing: Array<{
    title: string
    description: string
    importance: 'high' | 'normal' | 'low'
  }>
  resolvedForeshadowingIds: string[]
}

/**
 * 从章节内容中自动提取伏笔信息
 * 使用轻量模型分析章节内容，识别：
 * 1. 新埋入的伏笔（未解决的悬念、暗示等）
 * 2. 已收尾的伏笔（之前埋下的线索得到解答）
 */
export async function extractForeshadowingFromChapter(
  env: Env,
  chapterId: string,
  novelId: string
): Promise<ForeshadowingExtractResult> {
  const db = drizzle(env.DB)

  try {
    // 获取章节内容
    const chapter = await db
      .select({
        title: chapters.title,
        content: chapters.content,
      })
      .from(chapters)
      .where(eq(chapters.id, chapterId))
      .get()

    if (!chapter?.content) {
      console.log('No content to extract foreshadowing')
      return { newForeshadowing: [], resolvedForeshadowingIds: [] }
    }

    // 获取当前小说所有未收尾的伏笔（用于检测是否收尾）
    const existingOpen = await db
      .select({
        id: foreshadowing.id,
        title: foreshadowing.title,
        description: foreshadowing.description,
      })
      .from(foreshadowing)
      .where(
        and(
          eq(foreshadowing.novelId, novelId),
          eq(foreshadowing.status, 'open'),
          isNull(foreshadowing.deletedAt)
        )
      )
      .all()

    // 解析模型配置
    let extractConfig
    try {
      extractConfig = await resolveConfig(db, 'summary_gen', novelId)
      extractConfig.apiKey = extractConfig.apiKey || (env as any)[extractConfig.apiKeyEnv || 'VOLCENGINE_API_KEY'] || ''
    } catch {
      extractConfig = {
        provider: 'volcengine',
        modelId: 'doubao-lite-32k',
        apiBase: 'https://ark.cn-beijing.volces.com/api/v3',
        apiKey: (env as any).VOLCENGINE_API_KEY || '',
        params: { temperature: 0.3, max_tokens: 2000 },
      }
    }

    // 构建提示词
    const existingForeshadowingText = existingOpen.length > 0
      ? `\n\n【当前未收尾的伏笔列表】\n${existingOpen.map((f, i) => `${i + 1}. [ID:${f.id}] ${f.title}: ${f.description || ''}`).join('\n')}`
      : ''

    const extractPrompt = `你是一个专业的小说伏笔分析助手。请分析以下小说章节内容，提取其中的伏笔信息。

【章节标题】：《${chapter.title}》

【正文内容】（前3000字）：
${chapter.content.slice(0, 3000)}
${existingForeshadowingText}

请以JSON格式输出分析结果（不要输出其他内容）：
{
  "newForeshadowing": [
    {
      "title": "伏笔标题（简短描述）",
      "description": "详细说明",
      "importance": "high|normal|low"
    }
  ],
  "resolvedForeshadowingIds": ["已收尾的伏笔ID列表"]
}

判断标准：
1. 新伏笔：本章中出现的、尚未解决的悬念、暗示、隐藏线索、神秘人物/物品等
2. 收尾伏笔：之前埋下的伏笔在本章得到了解答或明确进展
3. 重要性判断：high=影响主线剧情/核心秘密；normal=影响支线/角色发展；low=细节装饰

如果本章没有新伏笔或没有收尾伏笔，对应数组为空数组[]。`

    // 调用 LLM 进行提取
    const base = extractConfig.apiBase || getDefaultBase(extractConfig.provider)
    const resp = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${extractConfig.apiKey}`,
      },
      body: JSON.stringify({
        model: extractConfig.modelId,
        messages: [
          { role: 'system', content: '你是一个JSON生成助手，只输出JSON，不要其他内容。' },
          { role: 'user', content: extractPrompt },
        ],
        stream: false,
        temperature: extractConfig.params?.temperature ?? 0.3,
        max_tokens: extractConfig.params?.max_tokens ?? 2000,
      }),
    })

    if (!resp.ok) {
      throw new Error(`Foreshadowing extraction API error: ${resp.status}`)
    }

    const result = await resp.json() as any
    const content = result.choices?.[0]?.message?.content || '{}'

    // 解析 JSON 结果
    let parsed: ForeshadowingExtractResult
    try {
      parsed = JSON.parse(content)
    } catch (parseError) {
      console.warn('Failed to parse foreshadowing extraction result:', parseError)
      return { newForeshadowing: [], resolvedForeshadowingIds: [] }
    }

    // 验证和清理数据
    parsed.newForeshadowing = (parsed.newForeshadowing || []).filter(f =>
      f.title && typeof f.title === 'string' && f.title.trim().length > 0
    ).map(f => ({
      title: f.title.trim().slice(0, 100),
      description: (f.description || '').trim().slice(0, 500),
      importance: ['high', 'normal', 'low'].includes(f.importance) ? f.importance : 'normal' as const,
    }))

    parsed.resolvedForeshadowingIds = (parsed.resolvedForeshadowingIds || []).filter(id =>
      typeof id === 'string' && id.trim().length > 0
    )

    // 将新伏笔写入数据库
    for (const newF of parsed.newForeshadowing) {
      try {
        await db.insert(foreshadowing).values({
          novelId,
          chapterId,
          title: newF.title,
          description: newF.description,
          status: 'open',
          importance: newF.importance,
        })
        console.log(`✅ New foreshadowing created: ${newF.title}`)
      } catch (insertError) {
        console.warn('Failed to insert foreshadowing:', insertError)
      }
    }

    // 更新已收尾的伏笔状态
    for (const resolvedId of parsed.resolvedForeshadowingIds) {
      try {
        await db
          .update(foreshadowing)
          .set({
            status: 'resolved',
            resolvedChapterId: chapterId,
          })
          .where(eq(foreshadowing.id, resolvedId))
        console.log(`✅ Foreshadowing resolved: ${resolvedId}`)
      } catch (updateError) {
        console.warn('Failed to update foreshadowing status:', updateError)
      }
    }

    console.log(`📝 Foreshadowing extraction complete: ${parsed.newForeshadowing.length} new, ${parsed.resolvedForeshadowingIds.length} resolved`)
    return parsed
  } catch (error) {
    console.error('Foreshadowing extraction failed:', error)
    return { newForeshadowing: [], resolvedForeshadowingIds: [] }
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
