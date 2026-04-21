/**
 * @file useGenerate.ts
 * @description AI生成Hook，封装章节生成的流式处理逻辑和状态管理
 * @version 1.0.0
 * @modified 2026-04-21 - 添加规范化注释
 */
import { useState, useRef } from 'react'
import { toast } from 'sonner'
import { streamGenerate } from '@/lib/api'
import type { ContextBundle } from '@/components/generate/ContextPreview'

export interface ToolCallEvent {
  name: string
  args: Record<string, any>
  result: string
  status?: 'running' | 'done'  // Phase 1.4: 工具调用状态
}

export function useGenerate() {
  const [output, setOutput] = useState('')
  const [status, setStatus] = useState<'idle' | 'generating' | 'done' | 'error'>('idle')
  const [contextInfo, setContextInfo] = useState<ContextBundle | null>(null)
  const [toolCalls, setToolCalls] = useState<ToolCallEvent[]>([])
  const [usage, setUsage] = useState<{ prompt_tokens: number; completion_tokens: number } | null>(null)
  const stopRef = useRef<(() => void) | null>(null)

  const generate = (chapterId: string, novelId: string, options?: {
    mode?: 'generate' | 'continue' | 'rewrite'
    existingContent?: string
  }) => {
    setOutput('')
    setStatus('generating')
    setContextInfo(null)
    setToolCalls([])
    setUsage(null)

    stopRef.current = streamGenerate(
      { 
        chapterId, 
        novelId,
        mode: options?.mode || 'generate',
        existingContent: options?.existingContent,
      },
      // onChunk
      (data: unknown) => {
        try {
          if (typeof data !== 'object' || data === null) {
            if (typeof data === 'string') {
              setOutput((prev) => prev + data)
            }
            return
          }
          const chunk = data as Record<string, unknown>
          if (chunk.type === 'context') {
            setContextInfo(chunk.context as ContextBundle)
            return
          }
          if (chunk.type === 'tool_call') {
            setToolCalls((prev) => {
              const existingIndex = prev.findIndex(tc => tc.name === chunk.name && tc.status === 'running')
              if (existingIndex >= 0 && chunk.status === 'done') {
                const updated = [...prev]
                updated[existingIndex] = { name: chunk.name as string, args: chunk.args as Record<string, any>, result: (chunk.result as string) || '' }
                return updated
              }
              return [...prev, { name: chunk.name as string, args: chunk.args as Record<string, any>, result: (chunk.result as string) || '' }]
            })
            return
          }
          if (chunk.type === 'done' && chunk.usage) {
            setUsage(chunk.usage as { prompt_tokens: number; completion_tokens: number })
            return
          }
          if (chunk.content) {
            setOutput((prev) => prev + (chunk.content as string))
            return
          }
        } catch {
          if (typeof data === 'string') {
            setOutput((prev) => prev + data)
          }
        }
      },
      // onDone
      () => setStatus('done'),
      // onError
      (e) => {
        setStatus('error')
        toast.error(e.message)
      }
    )
  }

  const stop = () => {
    stopRef.current?.()
    setStatus('idle')
  }

  return { output, status, generate, stop, contextInfo, setContextInfo, toolCalls, usage }
}
