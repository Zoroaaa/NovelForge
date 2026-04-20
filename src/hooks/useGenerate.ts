import { useState, useRef } from 'react'
import { toast } from 'sonner'
import { streamGenerate } from '@/lib/api'

export function useGenerate() {
  const [output, setOutput] = useState('')
  const [status, setStatus] = useState<'idle' | 'generating' | 'done' | 'error'>('idle')
  const stopRef = useRef<(() => void) | null>(null)

  const generate = (chapterId: string, novelId: string) => {
    setOutput('')
    setStatus('generating')
    stopRef.current = streamGenerate(
      { chapterId, novelId },
      (chunk) => setOutput(prev => prev + chunk),
      () => setStatus('done'),
      (e) => { setStatus('error'); toast.error(e.message) }
    )
  }

  const stop = () => { stopRef.current?.(); setStatus('idle') }

  return { output, status, generate, stop }
}
