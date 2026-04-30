import { useRef, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Send, Loader2 } from 'lucide-react'
import { STAGES } from './types'
import { cn } from '@/lib/utils'

interface ChatInputProps {
  value: string
  onChange: (value: string) => void
  onSend: () => void
  isGenerating: boolean
  stage: string
}

export function ChatInput({ value, onChange, onSend, isGenerating, stage }: ChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const stageInfo = STAGES.find((s) => s.id === stage)

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        onSend()
      }
    },
    [onSend]
  )

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      onChange(e.target.value)
      const ta = e.target
      ta.style.height = 'auto'
      ta.style.height = `${Math.min(ta.scrollHeight, 120)}px`
    },
    [onChange]
  )

  return (
    <div className="border-t p-4 bg-background/50 backdrop-blur-sm">
      <div className="max-w-3xl mx-auto flex gap-3 items-end">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={
            isGenerating
              ? 'AI 正在回复中...'
              : stageInfo?.description || '输入你的想法...'
          }
          disabled={isGenerating}
          rows={1}
          className={cn(
            'flex-1 resize-none rounded-md border border-input bg-background px-3 py-2',
            'text-base ring-offset-background placeholder:text-muted-foreground',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
            'disabled:cursor-not-allowed disabled:opacity-50 md:text-sm',
            'min-h-[40px] max-h-[120px] overflow-y-auto leading-relaxed'
          )}
          style={{ height: '40px' }}
        />
        <Button
          onClick={onSend}
          disabled={!value.trim() || isGenerating}
          size="icon"
          className="h-10 w-10 shrink-0"
        >
          {isGenerating ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
        </Button>
      </div>
    </div>
  )
}
