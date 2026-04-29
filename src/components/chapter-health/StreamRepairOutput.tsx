/**
 * @file StreamRepairOutput.tsx
 * @description 修复结果流式输出组件
 */
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { Copy, Check, PenLine, Loader2 } from 'lucide-react'
import { useState } from 'react'

interface StreamRepairOutputProps {
  content: string
  status: 'idle' | 'repairing' | 'done' | 'error'
  onWrite: (content: string) => void
  error?: string | null
}

export function StreamRepairOutput({ content, status, onWrite, error }: StreamRepairOutputProps) {
  const [copied, setCopied] = useState(false)
  const [isWriting, setIsWriting] = useState(false)

  const handleCopy = async () => {
    if (!content) return
    await navigator.clipboard.writeText(content)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleWrite = async () => {
    if (!content || isWriting) return
    setIsWriting(true)
    try {
      await onWrite(content)
    } finally {
      setIsWriting(false)
    }
  }

  if (status === 'idle') {
    return null
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          {status === 'repairing' ? '修复中...' : status === 'done' ? '修复完成' : '修复出错'}
        </span>
        <div className="flex items-center gap-3">
          {content && (
            <Button variant="ghost" size="sm" onClick={handleCopy} className="h-7 gap-1">
              {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
              {copied ? '已复制' : '复制'}
            </Button>
          )}
        </div>
      </div>

      {error && (
        <div className="p-3 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-lg text-xs text-red-600 dark:text-red-400">
          {error}
        </div>
      )}

      <ScrollArea className="h-[300px] rounded-md border bg-muted/30 p-4">
        <div className="whitespace-pre-wrap text-sm leading-relaxed font-serif">
          {content || (status === 'repairing' ? '等待输出...' : '')}
          {status === 'repairing' && <span className="animate-pulse">▊</span>}
        </div>
      </ScrollArea>

      {status === 'done' && content && (
        <Button
          size="sm"
          className="w-full gap-2"
          onClick={handleWrite}
          disabled={isWriting}
        >
          {isWriting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              写入中...
            </>
          ) : (
            <>
              <PenLine className="h-4 w-4" />
              写入章节
            </>
          )}
        </Button>
      )}
    </div>
  )
}