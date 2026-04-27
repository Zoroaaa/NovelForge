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
import { safeParseJSON, extractStructuredData } from './extract'
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
        const newExtractedData = extractStructuredData(fullResponse, activeStage, currentData)

        messages[messages.length - 1] = {
          role: 'assistant',
          content: fullResponse,
          timestamp: Date.now(),
        }

        await updateSession(db, sessionId, {
          messages,
          extractedData: { ...currentData, ...newExtractedData },
        })

        console.log('[workshop] ✅ Assistant message saved to DB, length:', fullResponse.length)

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

export {
  createWorkshopSession,
  getWorkshopSession,
  commitWorkshopSession,
  commitWorkshopSessionCore,
  loadNovelContextData,
  WorkshopMessage,
  WorkshopExtractedData,
}
