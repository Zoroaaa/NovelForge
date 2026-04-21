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
  const stopRef = useRef<(() => void) | null>(null)

  const generate = (chapterId: string, novelId: string, options?: {
    mode?: 'generate' | 'continue' | 'rewrite'
    existingContent?: string
  }) => {
    setOutput('')
    setStatus('generating')
    setContextInfo(null)
    setToolCalls([])

    stopRef.current = streamGenerate(
      { 
        chapterId, 
        novelId,
        mode: options?.mode || 'generate',
        existingContent: options?.existingContent,
      },
      // onChunk
      (chunk) => {
        try {
          const data = JSON.parse(chunk)
          if (data.type === 'context') {
            setContextInfo(data.context)
            return
          }
          // Phase 1.4: 处理工具调用事件（包含 status 字段）
          if (data.type === 'tool_call') {
            setToolCalls((prev) => {
              // 如果是同一个工具的更新，替换而不是追加
              const existingIndex = prev.findIndex(tc => tc.name === data.name && tc.status === 'running')
              if (existingIndex >= 0 && data.status === 'done') {
                const updated = [...prev]
                updated[existingIndex] = { name: data.name, args: data.args, result: data.result || '' }
                return updated
              }
              return [...prev, { name: data.name, args: data.args, result: data.result || '' }]
            })
            return
          }
          if (data.content) {
            setOutput((prev) => prev + data.content)
            return
          }
        } catch {
          setOutput((prev) => prev + chunk)
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

  return { output, status, generate, stop, contextInfo, setContextInfo, toolCalls }
}
