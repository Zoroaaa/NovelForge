import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { Copy, Check } from 'lucide-react'
import { useState } from 'react'

interface StreamOutputProps {
  content: string
  status: 'idle' | 'generating' | 'done' | 'error'
}

export function StreamOutput({ content, status }: StreamOutputProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    if (!content) return
    await navigator.clipboard.writeText(content)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (status === 'idle') {
    return (
      <div className="text-center text-muted-foreground py-8">
        <p className="text-sm">点击"生成"按钮开始 AI 创作</p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          {status === 'generating' ? '生成中...' : status === 'done' ? '生成完成' : '生成出错'}
        </span>
        {content && (
          <Button variant="ghost" size="sm" onClick={handleCopy} className="h-7 gap-1">
            {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
            {copied ? '已复制' : '复制'}
          </Button>
        )}
      </div>

      <ScrollArea className="h-[400px] rounded-md border bg-muted/30 p-4">
        <div className="whitespace-pre-wrap text-sm leading-relaxed font-serif">
          {content || (status === 'generating' ? '等待输出...' : '')}
          {status === 'generating' && <span className="animate-pulse">▊</span>}
        </div>
      </ScrollArea>
    </div>
  )
}
