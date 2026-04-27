/**
 * @file workshop/index.ts
 * @description 创作工坊 - 入口文件
 */
import { drizzle } from 'drizzle-orm/d1'
import { eq } from 'drizzle-orm'
import type { Env } from '../../lib/types'
import * as schema from '../../db/schema'
import { resolveConfig } from '../llm'
import type { WorkshopExtractedData } from './types'
import { createWorkshopSession, getWorkshopSession, updateSession, loadNovelContextData, WorkshopMessage } from './session'
import { buildSystemPrompt } from './prompt'
import { extractStructuredData } from './extract'
import { commitWorkshopSession, commitWorkshopSessionCore } from './commit'

const { workshopSessions } = schema

export async function processWorkshopMessage(
  env: Env,
  sessionId: string,
  userMessage: string,
  stageOverride: string | undefined,
  onChunk: (text: string) => void,
  onDone: (extractedData: WorkshopExtractedData) => void,
  onError: (error: Error) => void
): Promise<void> {
  const db = drizzle(env.DB)

  try {
    const session = await getWorkshopSession(env, sessionId)
    if (!session) {
      throw new Error('Session not found')
    }

    const messages: WorkshopMessage[] = JSON.parse(session.messages || '[]')
    const currentData: WorkshopExtractedData = JSON.parse(session.extractedData || '{}')
    const isNewNovel = !session.novelId

    const activeStage = stageOverride || session.stage
    if (stageOverride && stageOverride !== session.stage) {
      await db.update(workshopSessions)
        .set({ stage: stageOverride, updatedAt: Math.floor(Date.now() / 1000) })
        .where(eq(workshopSessions.id, sessionId))
        .run()
    }

    messages.push({
      role: 'user',
      content: userMessage,
      timestamp: Date.now(),
    })

    const systemPrompt = buildSystemPrompt(activeStage, currentData, isNewNovel)

    const llmMessages = [
      { role: 'system' as const, content: systemPrompt },
      ...messages.map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
    ]

    let llmConfig: any
    try {
      llmConfig = await resolveConfig(drizzle(env.DB), 'workshop', session.novelId || '')
      llmConfig.apiKey = llmConfig.apiKey || ''
    } catch (workshopError) {
      const workshopErrorMsg = workshopError instanceof Error ? workshopError.message : String(workshopError)
      console.warn('[workshop] Workshop config not found, falling back to chapter_gen:', workshopErrorMsg)
      try {
        llmConfig = await resolveConfig(drizzle(env.DB), 'chapter_gen', session.novelId || '')
        llmConfig.apiKey = llmConfig.apiKey || ''
      } catch (chapterError) {
        const chapterErrorMsg = chapterError instanceof Error ? chapterError.message : String(chapterError)
        console.error('[workshop] No suitable model config found:', {
          workshopError: workshopErrorMsg,
          chapterError: chapterErrorMsg,
          novelId: session.novelId,
          sessionId
        })
        throw new Error(
          `❌ 未配置"创作工坊"模型！\n\n` +
          `请在全局模型配置页面（/model-config）添加以下任一配置：\n` +
          `1. 用途选择"创作工坊"(workshop) - 推荐\n` +
          `2. 或用途选择"章节生成"(chapter_gen) 作为备选\n\n` +
          `当前状态：\n` +
          `- workshop 配置：${workshopErrorMsg}\n` +
          `- chapter_gen 配置：${chapterErrorMsg}`
        )
      }
    }

    let fullResponse = ''

    const { streamGenerate } = await import('../llm')

    const placeholderAssistantMsg: WorkshopMessage = {
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
    }
    messages.push(placeholderAssistantMsg)
    await updateSession(db, sessionId, { messages, extractedData: currentData })

    await streamGenerate(llmConfig, llmMessages, {
      onChunk: (text) => {
        fullResponse += text
        messages[messages.length - 1] = {
          ...placeholderAssistantMsg,
          content: fullResponse,
        }
        onChunk(text)
      },
      onDone: async () => {
        if (activeStage === 'volume_outline' && fullResponse.length > 0) {
          const hasClosingBlock = fullResponse.trimEnd().endsWith('```')
          if (!hasClosingBlock) {
            console.warn('[workshop] ⚠️ 卷纲输出疑似被截断（未找到 JSON 代码块结束标记），回复长度:', fullResponse.length)
            onChunk('\n\n⚠️ **输出可能被截断**：卷纲内容较长，AI 回复可能因模型输出长度限制（max_tokens）而被截断，导致右侧预览无法显示。建议：1) 在模型配置中增大 max_tokens（推荐 32000 以上）；2) 要求 AI 分卷输出；3) 确认后重新生成。')
          }
        }

        const newExtractedData = extractStructuredData(fullResponse, activeStage, currentData)

        if (activeStage === 'volume_outline' && !newExtractedData.volumes) {
          console.warn('[workshop] ⚠️ 卷纲数据提取失败，AI 回复长度:', fullResponse.length, '| 末尾100字符:', fullResponse.slice(-100))
          onChunk('\n\n⚠️ **卷纲数据提取失败**：AI 输出的 JSON 格式可能不完整或被截断，右侧预览无法显示卷纲。请尝试：1) 在模型配置中增大 max_tokens（推荐 32000 以上）；2) 要求 AI 分卷逐个输出。')
        }

        messages[messages.length - 1] = {
          role: 'assistant',
          content: fullResponse,
          timestamp: Date.now(),
        }

        await updateSession(db, sessionId, {
          messages,
          extractedData: { ...currentData, ...newExtractedData },
        })

        console.log('[workshop] ✅ Assistant message saved to DB, length:', fullResponse.length, '| stage:', activeStage, '| extractedKeys:', Object.keys(newExtractedData))

        if (!session.title && messages.length >= 2) {
          console.log('[workshop] 📝 Auto-generating title for session:', sessionId)
          try {
            const { generate } = await import('../llm')

            const titleMessages = [
              {
                role: 'system' as const,
                content: '用 8-12 个中文字概括用户对话的主题。只输出标题，不加标点和解释。'
              },
              {
                role: 'user' as const,
                content: `用户说：${messages[0].content}\nAI回复（前200字）：${fullResponse.slice(0, 200)}`
              }
            ]

            const titleResult = await generate(llmConfig, titleMessages)

            const generatedTitle = titleResult.text.trim().slice(0, 20)

            if (generatedTitle && generatedTitle !== '创作对话') {
              await db.update(workshopSessions)
                .set({
                  title: generatedTitle,
                  updatedAt: Math.floor(Date.now() / 1000)
                })
                .where(eq(workshopSessions.id, sessionId))
                .run()

              console.log('[workshop] ✅ Title auto-generated by AI:', generatedTitle)
            } else {
              console.log('[workshop] ℹ️ Title generation skipped (empty or default)')
            }
          } catch (titleError) {
            console.warn('[workshop] ⚠️ Failed to auto-generate title:', titleError)
          }
        }

        onDone(newExtractedData)
      },
      onError: async (error) => {
        if (fullResponse) {
          messages[messages.length - 1] = {
            role: 'assistant',
            content: fullResponse + '\n\n[生成中断]',
            timestamp: Date.now(),
          }
          await updateSession(db, sessionId, { messages, extractedData: currentData })
          console.log('[workshop] ⚠️ Partial message saved after error, length:', fullResponse.length)
        }
        onError(error)
      },
    })

  } catch (error) {
    console.error('Workshop message processing failed:', error)
    onError(error as Error)
  }
}

export async function reExtractSessionData(
  env: Env,
  sessionId: string
): Promise<{ extractedData: WorkshopExtractedData }> {
  const db = drizzle(env.DB)

  const session = await getWorkshopSession(env, sessionId)
  if (!session) {
    throw new Error('Session not found')
  }

  const messages: WorkshopMessage[] = JSON.parse(session.messages || '[]')
  const currentData: WorkshopExtractedData = JSON.parse(session.extractedData || '{}')
  const stage = session.stage

  const assistantMessages = messages.filter(m => m.role === 'assistant' && m.content)

  console.log('[workshop/re-extract] 开始重新提取, sessionId:', sessionId, '| stage:', stage, '| assistant消息数:', assistantMessages.length)

  const mergedData: WorkshopExtractedData = { ...currentData }

  for (const msg of assistantMessages) {
    try {
      const extracted = extractStructuredData(msg.content, stage, currentData)
      for (const [key, value] of Object.entries(extracted)) {
        if (value !== undefined && value !== null) {
          (mergedData as Record<string, unknown>)[key] = value
        }
      }
    } catch (e) {
      console.warn('[workshop/re-extract] 单条消息提取失败, 跳过, 错误:', (e as Error).message)
    }
  }

  await updateSession(db, sessionId, {
    messages,
    extractedData: mergedData,
  })

  console.log('[workshop/re-extract] 提取完成, 字段:', Object.keys(mergedData).join(', '))

  return { extractedData: mergedData }
}

export {
  createWorkshopSession,
  getWorkshopSession,
  commitWorkshopSession,
  commitWorkshopSessionCore,
  loadNovelContextData,
  WorkshopMessage,
  WorkshopExtractedData,
}
