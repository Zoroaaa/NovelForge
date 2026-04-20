import { useState, useRef } from 'react'
import { toast } from 'sonner'
import { streamGenerate } from '@/lib/api'
import type { ContextBundle } from '@/components/generate/ContextPreview'

export interface ToolCallEvent {
  name: string
  args: Record<string, any>
  result: string
}

export function useGenerate() {
  const [output, setOutput] = useState('')
  const [status, setStatus] = useState<'idle' | 'generating' | 'done' | 'error'>('idle')
  const [contextInfo, setContextInfo] = useState<ContextBundle | null>(null)
  const [toolCalls, setToolCalls] = useState<ToolCallEvent[]>([])
  const stopRef = useRef<(() => void) | null>(null)

  const generate = (chapterId: string, novelId: string) => {
    setOutput('')
    setStatus('generating')
    setContextInfo(null)
    setToolCalls([])

    stopRef.current = streamGenerate(
      { chapterId, novelId },
      // onChunk
      (chunk) => {
        try {
          const data = JSON.parse(chunk)
          if (data.type === 'context') {
            setContextInfo(data.context)
            return
          }
          if (data.type === 'tool_call') {
            setToolCalls((prev) => [...prev, { name: data.name, args: data.args, result: data.result }])
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
