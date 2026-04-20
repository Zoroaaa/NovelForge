import { useState, useRef } from 'react'
import { toast } from 'sonner'
import { streamGenerate } from '@/lib/api'
import type { ContextBundle } from '@/components/generate/ContextPreview'

export function useGenerate() {
  const [output, setOutput] = useState('')
  const [status, setStatus] = useState<'idle' | 'generating' | 'done' | 'error'>('idle')
  const [contextInfo, setContextInfo] = useState<ContextBundle | null>(null)
  const stopRef = useRef<(() => void) | null>(null)

  const generate = (chapterId: string, novelId: string) => {
    setOutput('')
    setStatus('generating')
    setContextInfo(null)

    stopRef.current = streamGenerate(
      { chapterId, novelId },
      // onChunk
      (chunk) => {
        // Phase 2: 解析增强的SSE数据格式
        try {
          const data = JSON.parse(chunk)
          if (data.type === 'context') {
            setContextInfo(data.context)
            return
          }
          if (data.content) {
            setOutput((prev) => prev + data.content)
            return
          }
        } catch {
          // Phase 1 兼容：纯文本chunk
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

  return { output, status, generate, stop, contextInfo, setContextInfo }
}
