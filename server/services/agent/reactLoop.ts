/**
 * @file reactLoop.ts
 * @description Agent ReAct循环实现
 */
import type { Env } from '../../lib/types'
import type { ToolCallEvent } from './types'
import { streamGenerate } from '../llm'
import { AGENT_TOOLS } from './tools'
import { executeAgentTool } from './executor'
import { ERROR_MESSAGES, LOG_STYLES, REACT_LOOP_CONFIG } from './constants'

export interface ReActLoopResult {
  promptTokens: number
  completionTokens: number
  collectedContent: string
}

export async function runReActLoop(
  env: Env,
  llmConfig: any,
  messages: Array<{ role: 'system' | 'user' | 'assistant' | 'tool'; content?: string; tool_call_id?: string; name?: string }>,
  novelId: string,
  onChunk: (text: string) => void,
  onToolCall: (event: ToolCallEvent) => void,
  maxIterations: number
): Promise<ReActLoopResult> {
  const startTime = Date.now()

  let iteration = 0
  let totalPromptTokens = 0
  let totalCompletionTokens = 0
  let collectedContent = ''

  while (iteration < maxIterations) {
    if (Date.now() - startTime > REACT_LOOP_CONFIG.MAX_TOTAL_TIME) {
      LOG_STYLES.WARN(`ReAct循环超过最大总时间 (${REACT_LOOP_CONFIG.MAX_TOTAL_TIME}ms)，强制停止`)
      break
    }

    iteration++
    LOG_STYLES.ITERATION(iteration, maxIterations)

    let iterationContent = ''
    const collectedToolCalls: Array<{
      id: string
      name: string
      args: Record<string, any>
    }> = []

    await Promise.race([
      streamGenerate(llmConfig, messages as any, {
        onChunk: (text) => {
          iterationContent += text
          onChunk(text)
        },
        onToolCall: (toolCallDelta) => {
          if (toolCallDelta.status === 'complete') {
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
          LOG_STYLES.ITERATION_COMPLETE(iteration, iterationContent.length, collectedToolCalls.length)
        },
        onError: (err) => {
          throw err
        },
      }, AGENT_TOOLS),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`迭代超时 (${REACT_LOOP_CONFIG.ITERATION_TIMEOUT}ms)`)), REACT_LOOP_CONFIG.ITERATION_TIMEOUT)
      )
    ])

    const assistantMessage: any = { role: 'assistant' }

    if (iterationContent.trim()) {
      assistantMessage.content = iterationContent
    }

    if (collectedToolCalls.length > 0) {
      assistantMessage.tool_calls = collectedToolCalls.map(tc => ({
        id: tc.id,
        type: 'function',
        function: {
          name: tc.name,
          arguments: JSON.stringify(tc.args),
        },
      }))
    }

    if (iterationContent.trim() || collectedToolCalls.length > 0) {
      messages.push(assistantMessage)
    }

    if (collectedToolCalls.length === 0) {
      LOG_STYLES.NO_TOOL_CALLS(iteration)
      collectedContent += iterationContent
      break
    }

    collectedContent += iterationContent

    for (const toolCall of collectedToolCalls) {
      try {
        onToolCall({
          type: 'tool_call',
          name: toolCall.name,
          args: toolCall.args,
          status: 'running',
        })

        LOG_STYLES.TOOL(toolCall.name, toolCall.args)

        const result = await executeAgentTool(env, toolCall.name, toolCall.args, novelId)

        onToolCall({
          type: 'tool_call',
          name: toolCall.name,
          args: toolCall.args,
          status: 'done',
          result: result.slice(0, 500),
        })

        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          name: toolCall.name,
          content: result,
        })

        LOG_STYLES.TOOL_EXECUTED(toolCall.name, result.length)
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
          role: 'tool',
          tool_call_id: toolCall.id,
          name: toolCall.name,
          content: JSON.stringify({ error: errorMsg, message: '工具执行失败，请重试或改用其他方式完成任务。' }),
        })

        LOG_STYLES.TOOL_FAILED(toolCall.name, error)
      }
    }
  }

  if (iteration >= maxIterations) {
    LOG_STYLES.MAX_ITERATIONS_REACHED(maxIterations, Date.now() - startTime)
  } else if (Date.now() - startTime > REACT_LOOP_CONFIG.MAX_TOTAL_TIME) {
    LOG_STYLES.MAX_TOTAL_TIME_EXCEEDED(Date.now() - startTime, iteration)
  }

  return { promptTokens: totalPromptTokens, completionTokens: totalCompletionTokens, collectedContent }
}

export function extractToolCallsFromContent(content: string): Array<{ name: string; args: Record<string, any> }> {
  const toolCalls: Array<{ name: string; args: Record<string, any> }> = []

  if (!content || !content.trim()) return toolCalls

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
