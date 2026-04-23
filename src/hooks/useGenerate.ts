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
  args: Record<string, unknown>
  result: string
  status?: 'running' | 'done'  // Phase 1.4: 工具调用状态
}

export function useGenerate() {
  const [output, setOutput] = useState('')
  const [status, setStatus] = useState<'idle' | 'generating' | 'done' | 'error'>('idle')
  const [contextInfo, setContextInfo] = useState<ContextBundle | null>(null)
  const [toolCalls, setToolCalls] = useState<ToolCallEvent[]>([])
  const [usage, setUsage] = useState<{ prompt_tokens: number; completion_tokens: number } | null>(null)
  const [repairedContent, setRepairedContent] = useState<string | null>(null)
  const [repairInfo, setRepairInfo] = useState<{ originalScore: number; issues: Array<{ severity: 'error' | 'warning'; category?: string; message: string; suggestion?: string }> } | null>(null)
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
                updated[existingIndex] = { name: chunk.name as string, args: chunk.args as Record<string, unknown>, result: (chunk.result as string) || '' }
                return updated
              }
              return [...prev, { name: chunk.name as string, args: chunk.args as Record<string, unknown>, result: (chunk.result as string) || '' }]
            })
            return
          }
          if (chunk.type === 'done' && chunk.usage) {
            setUsage(chunk.usage as { prompt_tokens: number; completion_tokens: number })
            return
          }
          // Phase 2.3: 处理连贯性检查结果
          if (chunk.type === 'coherence_check') {
            const { score, issues } = chunk as { score: number; issues: Array<{ severity: string; message: string }> }
            const errorCount = issues?.filter((i: { severity: string }) => i.severity === 'error').length || 0
            const warningCount = issues?.filter((i: { severity: string }) => i.severity === 'warning').length || 0

            if (errorCount > 0) {
              toast.error(`连贯性检测发现 ${errorCount} 个问题（评分: ${score}/100）`, {
                description: score < 70 ? '正在自动修复...' : issues.slice(0, 3).map((i: { message: string }) => `• ${i.message}`).join('\n'),
                duration: 8000,
              })
            } else if (warningCount > 0) {
              toast.warning(`连贯性提示：${warningCount} 个建议（评分: ${score}/100）`, {
                description: issues.slice(0, 2).map((i: { message: string }) => `• ${i.message}`).join('\n'),
                duration: 6000,
              })
            }
            return
          }
          // 自动修复结果
          if (chunk.type === 'coherence_fix') {
            const { repairedContent: fixed, originalScore, issues: fixIssues } = chunk as { repairedContent: string; originalScore: number; issues: Array<{ severity: 'error' | 'warning'; message: string }> }
            setRepairedContent(fixed)
            setRepairInfo({ originalScore, issues: (fixIssues || []).map(i => ({ severity: i.severity, message: i.message })) })
            toast.success(`已自动修复（原评分 ${originalScore}/100）`, {
              description: '修复版本已就绪，可在编辑器中选择接受或忽略',
              duration: 8000,
            })
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

  const clearRepair = () => { setRepairedContent(null); setRepairInfo(null) }

  return { output, status, generate, stop, contextInfo, setContextInfo, toolCalls, usage, repairedContent, repairInfo, clearRepair }
}
